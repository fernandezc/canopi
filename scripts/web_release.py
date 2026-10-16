#!/usr/bin/env python3
"""Web Edition release tooling: the Web catalog asset, archive admission and live HTTP checks.

Callers: `publish-db-release.sh` (catalog-asset-name, pack-catalog), the Release Candidate
workflow's `web` job (catalog-asset-name, unpack-catalog, verify) and
`publish-web-release.sh` (verify, live-matches, deploy-url, wait-for, http-check).
Archives are untrusted input: run this module with `python3 -I`; extraction writes only
regular files and directories below a fresh directory.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import socket
import ssl
import sys
import tarfile
import time
from typing import Any, Callable
import urllib.error
import urllib.request

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

MANIFEST_NAME = "canopi-web-edition-manifest.json"
CATALOG_DIR = "canopi-catalog"
CATALOG_MANIFEST = "manifest.json"
SPA_FALLBACK = {"source": "/*", "destination": "/index.html", "status": 200}
GOOGLE_KEY_RE = re.compile(rb"AIza[0-9A-Za-z_-]{20,}")
RAW_DUCKDB_WASM_RE = re.compile(r"(?:^|/)duckdb-.*\.wasm$", re.IGNORECASE)
CHECKSUM_LINE_RE = re.compile(r"([0-9a-f]{64})  ([^\s/]+)")
# Pages reads these names as configuration, so the artifact may never carry them;
# `add_deploy_files` writes the release's own.
DEPLOY_OWNED = ("_headers", "_redirects", "_routes.json", "_worker.js", "404.html")
# An empty 404.html in a directory makes Pages answer a missing file there with 404
# instead of the SPA fallback; the top level keeps the fallback for client routes.
NOT_FOUND_DIRS = ("assets", "canopi-catalog", "pdf-fonts")
HEADERS_FILE = """/index.html
  Cache-Control: no-cache
/canopi-web-edition-manifest.json
  Cache-Control: no-cache
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/canopi-catalog/*
  Cache-Control: no-cache
/pdf-fonts/*
  Cache-Control: no-cache
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
"""
CONTENT_TYPES = {
    ".js": "javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".parquet": "application/octet-stream",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".svg": "image/svg",
}
MISSING_PATHS = ("/assets/missing-0000.js", "/canopi-catalog/missing.parquet", "/pdf-fonts/missing.ttf")
CLIENT_ROUTES = ("/", "/designs", "/a/b/c")
MODULE_SCRIPT_RE = re.compile(r'<script type="module"[^>]*\ssrc="([^"]+)"')
USER_AGENT = "canopi-web-release-check/1"


class ReleaseError(RuntimeError):
    """A release input or a live deployment failed a check."""

    def __init__(self, violations: list[str] | str):
        self.violations = [violations] if isinstance(violations, str) else list(violations)
        super().__init__("\n".join(f"- {violation}" for violation in self.violations))


# ---------------------------------------------------------------- safe archives


def _safe_member_path(name: str) -> PurePosixPath | None:
    path = PurePosixPath(name)
    parts = [part for part in path.parts if part != "."]
    if (not parts or path.is_absolute() or ".." in parts or "\\" in name
            or any(ord(char) < 32 for char in name)):
        return None
    return PurePosixPath(*parts)


def safe_extract(archive: Path, destination: Path) -> list[str]:
    """Extract regular files and directories only; return the extracted file paths."""
    if destination.exists() and any(destination.iterdir()):
        raise ReleaseError(f"extraction directory is not empty: {destination}")
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    files: list[str] = []
    seen: set[str] = set()
    violations: list[str] = []
    try:
        with tarfile.open(archive, mode="r:gz") as tar:
            members = tar.getmembers()
            for member in members:
                relative = _safe_member_path(member.name)
                if relative is None:
                    violations.append(f"unsafe archive path: {member.name!r}")
                elif not (member.isfile() or member.isdir()):
                    violations.append(f"archive entry is not a regular file or directory: {member.name!r}")
                elif member.isfile() and str(relative) in seen:
                    violations.append(f"duplicate archive entry: {member.name!r}")
                elif member.isfile():
                    seen.add(str(relative))
            if violations:
                raise ReleaseError(violations)
            for member in members:
                relative = _safe_member_path(member.name)
                assert relative is not None
                target = root.joinpath(*relative.parts)
                if not target.resolve().is_relative_to(root):
                    raise ReleaseError(f"unsafe archive path: {member.name!r}")
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                source = tar.extractfile(member)
                assert source is not None
                with source, open(target, "xb") as out:
                    while chunk := source.read(1024 * 1024):
                        out.write(chunk)
                files.append(str(relative))
    except (tarfile.TarError, EOFError, gzip.BadGzipFile, OSError) as error:
        if isinstance(error, ReleaseError):
            raise
        raise ReleaseError(f"cannot read archive {archive.name}: {error}") from error
    return sorted(files)


def deterministic_tar_gz(source_dir: Path, output: Path) -> None:
    """Write source_dir's files as a tar.gz whose bytes depend on content and paths only."""
    files = sorted(
        str(path.relative_to(source_dir).as_posix())
        for path in source_dir.rglob("*")
        if path.is_file()
    )
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for relative in files:
            data = (source_dir / relative).read_bytes()
            info = tarfile.TarInfo(relative)
            info.size = len(data)
            info.mode = 0o644
            info.mtime = 0
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            tar.addfile(info, io.BytesIO(data))
    with open(output, "xb") as out:
        with gzip.GzipFile(filename="", mode="wb", fileobj=out, mtime=0, compresslevel=9) as gz:
            gz.write(raw.getvalue())


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _files_under(root: Path) -> tuple[list[str], list[str]]:
    files, violations = [], []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            violations.append(f"symbolic link: {relative}")
        elif path.is_file():
            files.append(relative)
        elif not path.is_dir():
            violations.append(f"unsupported filesystem entry: {relative}")
    return files, violations


# ---------------------------------------------------------------- Web catalog asset


def web_catalog_asset_name(root: Path = REPO_ROOT) -> str:
    """The catalog's identity: artifact contract, storage contract and source export."""
    from scripts import species_catalog_contract as storage
    from scripts import web_catalog_artifact_contract as artifact

    plan = artifact.compile_web_catalog_artifact(root=root)
    release = storage.project(storage.ProjectionTarget.RELEASE, root=root)
    web = storage.project(storage.ProjectionTarget.WEB_CATALOG, root=root)
    return (
        f"canopi-web-catalog-v{plan.version}-{plan.fingerprint}-"
        f"{web.fingerprint}-{release.source_export_sha256}.tar.gz"
    )


def _catalog_asset_paths(manifest: dict[str, Any]) -> list[str]:
    assets = manifest.get("assets")
    if not isinstance(assets, dict):
        raise ReleaseError("catalog manifest has no assets")
    entries: list[Any] = []
    for value in assets.values():
        entries.extend(value.values() if isinstance(value, dict) else value)
    paths = []
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            raise ReleaseError("catalog manifest has a malformed asset entry")
        paths.append(entry["path"])
    return paths


def verify_catalog_dir(catalog_dir: Path, root: Path = REPO_ROOT) -> dict[str, Any]:
    """Admit a generated catalog for this checkout's contracts, byte for byte."""
    from scripts import species_catalog_contract as storage
    from scripts import web_catalog_artifact_contract as artifact

    plan = artifact.compile_web_catalog_artifact(root=root)
    web = storage.project(storage.ProjectionTarget.WEB_CATALOG, root=root)
    files, violations = _files_under(catalog_dir)
    try:
        manifest = json.loads((catalog_dir / CATALOG_MANIFEST).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ReleaseError(f"catalog manifest is unreadable: {error}") from error
    if manifest.get("generated_by") != plan.generated_by:
        violations.append(f"catalog generated_by is {manifest.get('generated_by')!r}, expected {plan.generated_by!r}")
    if manifest.get("artifact_contract_fingerprint") != plan.fingerprint:
        violations.append("catalog artifact contract fingerprint does not match this checkout")
    source = manifest.get("source") if isinstance(manifest.get("source"), dict) else {}
    if source.get("storage_contract_fingerprint") != web.fingerprint:
        violations.append("catalog storage contract fingerprint does not match this checkout")
    listed = set()
    entries = []
    for value in (manifest.get("assets") or {}).values():
        entries.extend(value.values() if isinstance(value, dict) else value)
    for entry in entries:
        path = entry.get("path") if isinstance(entry, dict) else None
        relative = _safe_member_path(path) if isinstance(path, str) else None
        if relative is None:
            violations.append(f"unsafe catalog asset path: {path!r}")
            continue
        listed.add(str(relative))
        target = catalog_dir / str(relative)
        if not target.is_file() or target.is_symlink():
            violations.append(f"catalog asset missing: {relative}")
            continue
        if target.stat().st_size != entry.get("bytes"):
            violations.append(f"catalog asset byte count differs: {relative}")
        elif sha256_file(target) != entry.get("sha256"):
            violations.append(f"catalog asset checksum differs: {relative}")
    if not listed:
        violations.append("catalog manifest lists no assets")
    unlisted = sorted(set(files) - listed - {CATALOG_MANIFEST})
    violations.extend(f"unlisted catalog file: {path}" for path in unlisted)
    if violations:
        raise ReleaseError(violations)
    return manifest


def pack_catalog(catalog_dir: Path, output: Path) -> None:
    verify_catalog_dir(catalog_dir)
    deterministic_tar_gz(catalog_dir, output)


def unpack_catalog(archive: Path, output_dir: Path) -> dict[str, Any]:
    safe_extract(archive, output_dir)
    return verify_catalog_dir(output_dir)


# ---------------------------------------------------------------- Web Edition archive


@dataclass(frozen=True)
class Identity:
    version: str
    commit: str
    files: int


def _verify_checksum(archive: Path, checksums: Path) -> None:
    expected = None
    for line in checksums.read_text(encoding="utf-8").splitlines():
        match = CHECKSUM_LINE_RE.fullmatch(line)
        if not match:
            raise ReleaseError(f"malformed checksum line in {checksums.name}: {line!r}")
        if match.group(2) == archive.name:
            if expected is not None:
                raise ReleaseError(f"{checksums.name} lists {archive.name} twice")
            expected = match.group(1)
    if expected is None:
        raise ReleaseError(f"{checksums.name} does not list {archive.name}")
    actual = sha256_file(archive)
    if actual != expected:
        raise ReleaseError(f"checksum mismatch for {archive.name}: expected {expected}, found {actual}")


def verify_web_edition(site: Path, *, version: str, commit: str | None = None) -> Identity:
    """Check an extracted root Web Edition against its own manifest and the hosting limits."""
    try:
        manifest = json.loads((site / MANIFEST_NAME).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ReleaseError(f"{MANIFEST_NAME} is unreadable: {error}") from error
    violations: list[str] = []
    if manifest.get("version") != version:
        violations.append(f"manifest version is {manifest.get('version')!r}, expected {version!r}")
    short = manifest.get("commit")
    # The packager records 12 characters from a checkout, 40 when given --commit.
    if not isinstance(short, str) or not re.fullmatch(r"[0-9a-f]{12}|[0-9a-f]{40}", short):
        violations.append(f"manifest commit {short!r} is not a commit")
    elif commit is not None and not commit.startswith(short):
        violations.append(f"manifest commit {short} is not the release commit {commit}")
    if manifest.get("basePath") != "/":
        violations.append(f"manifest basePath is {manifest.get('basePath')!r}, expected '/'")
    if manifest.get("spaFallback") != SPA_FALLBACK:
        violations.append(f"manifest spaFallback is {manifest.get('spaFallback')!r}, expected {SPA_FALLBACK!r}")
    limits = manifest.get("limits") if isinstance(manifest.get("limits"), dict) else {}
    max_bytes = limits.get("cloudflarePagesMaxAssetBytes")
    max_files = limits.get("cloudflarePagesMaxFiles")
    if not isinstance(max_bytes, int) or not isinstance(max_files, int) or max_bytes <= 0 or max_files <= 0:
        raise ReleaseError(violations + ["manifest limits are missing"])
    entries = manifest.get("files")
    if not isinstance(entries, list) or not entries:
        raise ReleaseError(violations + ["manifest lists no files"])

    present, entry_violations = _files_under(site)
    violations.extend(entry_violations)
    listed: dict[str, dict[str, Any]] = {}
    for entry in entries:
        path = entry.get("path") if isinstance(entry, dict) else None
        relative = _safe_member_path(path) if isinstance(path, str) else None
        if relative is None or str(relative) != path:
            violations.append(f"unsafe manifest path: {path!r}")
        elif path in listed:
            violations.append(f"manifest lists {path} twice")
        else:
            listed[path] = entry
    for path in sorted(set(present) - set(listed) - {MANIFEST_NAME}):
        violations.append(f"unlisted file: {path}")
    for path, entry in listed.items():
        target = site / path
        if not target.is_file():
            violations.append(f"listed file missing: {path}")
            continue
        size = target.stat().st_size
        if size != entry.get("bytes"):
            violations.append(f"byte count differs for {path}: manifest {entry.get('bytes')}, actual {size}")
        elif sha256_file(target) != entry.get("sha256"):
            violations.append(f"checksum differs for {path}")
    for path in present:
        size = (site / path).stat().st_size
        if size > max_bytes:
            violations.append(f"{path} is {size} bytes, above the Pages limit {max_bytes}")
        if RAW_DUCKDB_WASM_RE.search(path):
            violations.append(f"raw DuckDB WASM file: {path}")
        name = PurePosixPath(path).name
        if path in DEPLOY_OWNED or (name in DEPLOY_OWNED and name != "404.html"):
            violations.append(f"deploy-owned file in the artifact: {path}")
        if GOOGLE_KEY_RE.search((site / path).read_bytes()):
            violations.append(f"Google Maps key found in {path}")
    if len(present) > max_files:
        violations.append(f"{len(present)} files, above the Pages limit {max_files}")
    if "index.html" not in present:
        violations.append("index.html is missing")
    catalog_manifest = f"{CATALOG_DIR}/{CATALOG_MANIFEST}"
    if catalog_manifest not in present:
        violations.append(f"{catalog_manifest} is missing")
    else:
        try:
            catalog = json.loads((site / catalog_manifest).read_text(encoding="utf-8"))
            catalog_files = {f"{CATALOG_DIR}/{path}" for path in _catalog_asset_paths(catalog)}
        except (json.JSONDecodeError, ReleaseError) as error:
            violations.append(f"{catalog_manifest} is unreadable: {error}")
            catalog_files = set()
        listed_catalog = (manifest.get("catalog") or {}).get("files", [])
        for path in sorted(catalog_files | set(listed_catalog)):
            if path not in present:
                violations.append(f"catalog asset missing: {path}")
        if not catalog_files:
            violations.append("catalog lists no assets")
    if violations:
        raise ReleaseError(violations)
    return Identity(version=version, commit=short, files=len(present))


def add_deploy_files(site: Path) -> None:
    for name in DEPLOY_OWNED:
        if (site / name).exists():
            raise ReleaseError(f"deploy-owned file already present: {name}")
    (site / "_headers").write_text(HEADERS_FILE, encoding="utf-8")
    for directory in NOT_FOUND_DIRS:
        (site / directory).mkdir(exist_ok=True)
        (site / directory / "404.html").write_bytes(b"")


def verify_archive(
    archive: Path,
    *,
    version: str,
    output_dir: Path,
    commit: str | None = None,
    checksums: Path | None = None,
    deploy_files: bool = False,
) -> Identity:
    match = re.fullmatch(r"canopi-web-edition-root-v(.+)-([0-9a-f]{12})\.tar\.gz", archive.name)
    if not match or match.group(1) != version:
        raise ReleaseError(f"{archive.name} is not the root Web Edition archive of {version}")
    if checksums is not None:
        _verify_checksum(archive, checksums)
    safe_extract(archive, output_dir)
    identity = verify_web_edition(output_dir, version=version, commit=commit)
    if identity.commit[:12] != match.group(2):
        raise ReleaseError(f"archive name commit {match.group(2)} differs from manifest commit {identity.commit}")
    if deploy_files:
        add_deploy_files(output_dir)
    return identity


# ---------------------------------------------------------------- live checks


@dataclass(frozen=True)
class Response:
    status: int
    headers: dict[str, str]
    body: bytes

    def header(self, name: str) -> str:
        return self.headers.get(name.lower(), "")


def fetch(url: str, timeout: float = 60) -> Response:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status, headers, body = response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        status, headers, body = error.code, error.headers, error.read()
    # HTTP header names are case-insensitive; keep one lowercase spelling.
    return Response(status, {key.lower(): value for key, value in headers.items()}, body)


def _sample_files(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    samples: dict[str, dict[str, Any]] = {}
    for entry in sorted(entries, key=lambda item: item["path"]):
        suffix = PurePosixPath(entry["path"]).suffix
        if suffix in CONTENT_TYPES and suffix not in samples:
            samples[suffix] = entry
    return list(samples.values())


def http_check(
    base_url: str,
    site: Path,
    *,
    production: bool,
    get: Callable[[str], Response] = fetch,
) -> list[str]:
    """Check a live deployment of `site`; return the checks that passed or raise."""
    base = base_url.rstrip("/")
    manifest_bytes = (site / MANIFEST_NAME).read_bytes()
    manifest = json.loads(manifest_bytes)
    index = (site / "index.html").read_text(encoding="utf-8")
    violations: list[str] = []
    passed: list[str] = []

    def check(url_path: str, response: Response) -> None:
        if "nosniff" not in response.header("X-Content-Type-Options").lower():
            violations.append(f"{url_path}: X-Content-Type-Options nosniff is missing")

    live = get(base + "/" + MANIFEST_NAME)
    check("/" + MANIFEST_NAME, live)
    if live.status != 200:
        violations.append(f"/{MANIFEST_NAME}: status {live.status}")
    else:
        try:
            live_manifest = json.loads(live.body)
        except json.JSONDecodeError:
            live_manifest = {}
        if (live_manifest.get("version"), live_manifest.get("commit")) != (manifest["version"], manifest["commit"]):
            violations.append(
                f"/{MANIFEST_NAME}: serves {live_manifest.get('version')} {live_manifest.get('commit')}, "
                f"expected {manifest['version']} {manifest['commit']}")
        elif live.body != manifest_bytes:
            violations.append(f"/{MANIFEST_NAME}: bytes differ from the release manifest")
        if "no-cache" not in live.header("Cache-Control").lower():
            violations.append(f"/{MANIFEST_NAME}: Cache-Control {live.header('Cache-Control')!r} is not no-cache")
    passed.append("manifest identity and no-cache")

    expected_script = MODULE_SCRIPT_RE.search(index)
    for route in CLIENT_ROUTES:
        response = get(base + route)
        check(route, response)
        text = response.body.decode("utf-8", "replace")
        if response.status != 200 or "<title>Canopi</title>" not in text:
            violations.append(f"{route}: status {response.status}, Canopi title {'<title>Canopi</title>' in text}")
            continue
        if "text/html" not in response.header("Content-Type"):
            violations.append(f"{route}: Content-Type {response.header('Content-Type')!r}")
        if production:
            # Cloudflare injects a hidden link and a script into HTML on the custom domain,
            # so its HTML is compared by the module entry, not byte for byte.
            live_script = MODULE_SCRIPT_RE.search(text)
            if expected_script is None or live_script is None or live_script.group(1) != expected_script.group(1):
                violations.append(f"{route}: module script differs from the release index.html")
        elif response.body != index.encode("utf-8"):
            violations.append(f"{route}: HTML differs from the release index.html")
    passed.append("app shell on " + ", ".join(CLIENT_ROUTES))
    root = get(base + "/")
    if "strict-origin-when-cross-origin" not in root.header("Referrer-Policy").lower():
        violations.append("/: Referrer-Policy strict-origin-when-cross-origin is missing")

    for entry in _sample_files(manifest["files"]):
        url_path = "/" + entry["path"]
        response = get(base + url_path)
        check(url_path, response)
        suffix = PurePosixPath(entry["path"]).suffix
        if response.status != 200:
            violations.append(f"{url_path}: status {response.status}")
            continue
        if hashlib.sha256(response.body).hexdigest() != entry["sha256"]:
            violations.append(f"{url_path}: bytes differ from the release")
        if CONTENT_TYPES[suffix] not in response.header("Content-Type").lower():
            violations.append(f"{url_path}: Content-Type {response.header('Content-Type')!r}, expected {CONTENT_TYPES[suffix]}")
        if entry["path"].startswith("assets/") and "immutable" not in response.header("Cache-Control"):
            violations.append(f"{url_path}: Cache-Control {response.header('Cache-Control')!r} is not immutable")
    passed.append("sample assets by extension")

    for url_path in MISSING_PATHS:
        response = get(base + url_path)
        check(url_path, response)
        if response.status != 404:
            violations.append(f"{url_path}: status {response.status}, expected 404")
    passed.append("missing assets answer 404")
    if violations:
        raise ReleaseError(violations)
    return passed


def check_tls(host: str, port: int = 443, min_days: int = 14) -> str:
    context = ssl.create_default_context()
    with socket.create_connection((host, port), timeout=30) as raw:
        with context.wrap_socket(raw, server_hostname=host) as tls:
            certificate = tls.getpeercert()
            version = tls.version()
    expires = ssl.cert_time_to_seconds(certificate["notAfter"])
    days = (expires - time.time()) / 86400
    if days < min_days:
        raise ReleaseError(f"{host}: TLS certificate expires in {days:.0f} days")
    return f"{host}: {version}, certificate valid for {days:.0f} more days"


def live_matches(base_url: str, site: Path, get: Callable[[str], Response] = fetch) -> bool:
    response = get(base_url.rstrip("/") + "/" + MANIFEST_NAME)
    return response.status == 200 and response.body == (site / MANIFEST_NAME).read_bytes()


def wait_for(base_url: str, site: Path, timeout: float, interval: float = 15,
             get: Callable[[str], Response] = fetch, sleep: Callable[[float], None] = time.sleep) -> None:
    deadline = time.monotonic() + timeout
    while True:
        try:
            if live_matches(base_url, site, get):
                return
        except (OSError, urllib.error.URLError):
            pass
        if time.monotonic() >= deadline:
            raise ReleaseError(f"{base_url} did not serve the release manifest within {timeout:.0f} s")
        sleep(interval)


def deploy_url(output: str, project: str) -> str:
    """The deployment URL from `wrangler pages deploy` output."""
    peek = re.search(r"Take a peek over at (https://\S+)", output)
    if peek:
        return peek.group(1).rstrip(".")
    match = re.search(rf"https://[0-9a-z-]+\.{re.escape(project)}\.pages\.dev", output)
    if not match:
        raise ReleaseError("wrangler output names no deployment URL")
    return match.group(0)


# ---------------------------------------------------------------- CLI


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("catalog-asset-name", help="print the Web catalog release asset name")
    pack = sub.add_parser("pack-catalog", help="verify a generated catalog and archive it deterministically")
    pack.add_argument("--catalog-dir", type=Path, required=True)
    pack.add_argument("--output", type=Path, required=True)
    unpack = sub.add_parser("unpack-catalog", help="safely extract and verify a catalog archive")
    unpack.add_argument("--archive", type=Path, required=True)
    unpack.add_argument("--output-dir", type=Path, required=True)
    verify = sub.add_parser("verify", help="admit a root Web Edition archive")
    verify.add_argument("--archive", type=Path, required=True)
    verify.add_argument("--version", required=True)
    verify.add_argument("--commit")
    verify.add_argument("--checksums", type=Path)
    verify.add_argument("--output-dir", type=Path, required=True)
    verify.add_argument("--add-deploy-files", action="store_true")
    for name in ("http-check", "live-matches", "wait-for"):
        live = sub.add_parser(name)
        live.add_argument("--base-url", required=True)
        live.add_argument("--site", type=Path, required=True)
        if name == "http-check":
            live.add_argument("--production", action="store_true")
        if name == "wait-for":
            live.add_argument("--timeout", type=float, default=600)
    tls = sub.add_parser("check-tls")
    tls.add_argument("--host", required=True)
    url = sub.add_parser("deploy-url", help="read wrangler output on stdin, print the deployment URL")
    url.add_argument("--project", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "catalog-asset-name":
            print(web_catalog_asset_name())
        elif args.command == "pack-catalog":
            pack_catalog(args.catalog_dir, args.output)
            print(f"Packed {args.output.name}")
        elif args.command == "unpack-catalog":
            manifest = unpack_catalog(args.archive, args.output_dir)
            print(f"Web catalog verified ({len(_catalog_asset_paths(manifest))} assets from {manifest['source']['export_file']})")
        elif args.command == "verify":
            identity = verify_archive(
                args.archive, version=args.version, commit=args.commit, checksums=args.checksums,
                output_dir=args.output_dir, deploy_files=args.add_deploy_files)
            print(f"Web Edition {identity.version} at {identity.commit} verified ({identity.files} files)")
        elif args.command == "http-check":
            for line in http_check(args.base_url, args.site, production=args.production):
                print(f"ok: {line}")
        elif args.command == "live-matches":
            return 0 if live_matches(args.base_url, args.site) else 3
        elif args.command == "wait-for":
            wait_for(args.base_url, args.site, args.timeout)
            print(f"{args.base_url} serves the release manifest")
        elif args.command == "check-tls":
            print(check_tls(args.host))
        elif args.command == "deploy-url":
            print(deploy_url(sys.stdin.read(), args.project))
    except ReleaseError as error:
        print(f"ERROR: {args.command} failed:\n{error}", file=sys.stderr)
        return 1
    except (OSError, urllib.error.URLError, ssl.SSLError) as error:
        print(f"ERROR: {args.command} failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
