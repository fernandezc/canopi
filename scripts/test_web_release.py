"""Web Edition release tooling: archive admission, deploy files, live checks and the catalog asset."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import unittest

from scripts import web_release
from scripts.test_generate_web_catalog import create_export_fixture, generator

COMMIT = "abcdef012345" + "6" * 28
MAX_BYTES = 4000


def site_files():
    return {
        "index.html": b'<!doctype html><title>Canopi</title><script type="module" crossorigin src="/assets/web-1.js"></script>',
        "assets/web-1.js": b"console.log('canopi')",
        "assets/web-1.css": b"body{}",
        "assets/logo.svg": b"<svg/>",
        "assets/font.woff2": b"woff2",
        "pdf-fonts/NotoSans-Regular.ttf": b"ttf",
        "canopi-catalog/manifest.json": json.dumps(
            {"assets": {"species": [{"path": "species/species-0000.parquet"}],
                        "names": {"en": {"path": "names/names-en.parquet"}}, "images": []}}).encode(),
        "canopi-catalog/species/species-0000.parquet": b"PAR1species",
        "canopi-catalog/names/names-en.parquet": b"PAR1names",
    }


def manifest_for(files, **changes):
    manifest = {
        "name": "Canopi Web Edition", "version": "2.1.0", "commit": COMMIT[:12], "basePath": "/",
        "spaFallback": {"source": "/*", "destination": "/index.html", "status": 200},
        "limits": {"cloudflarePagesMaxAssetBytes": MAX_BYTES, "cloudflarePagesMaxFiles": 20},
        "catalog": {"files": ["canopi-catalog/species/species-0000.parquet", "canopi-catalog/names/names-en.parquet"]},
        "files": [{"path": path, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                  for path, data in sorted(files.items())],
    }
    manifest.update(changes)
    return manifest


class ArchiveCase(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.archive = self.root / f"canopi-web-edition-root-v2.1.0-{COMMIT[:12]}.tar.gz"

    def build(self, files=None, manifest=None, extra=None):
        files = site_files() if files is None else files
        manifest = manifest_for(files) if manifest is None else manifest
        source = self.root / "source"
        shutil.rmtree(source, ignore_errors=True)
        self.archive.unlink(missing_ok=True)
        shutil.rmtree(self.root / "site", ignore_errors=True)
        for path, data in {**files, **(extra or {}), web_release.MANIFEST_NAME: json.dumps(manifest).encode()}.items():
            (source / path).parent.mkdir(parents=True, exist_ok=True)
            (source / path).write_bytes(data)
        web_release.deterministic_tar_gz(source, self.archive)
        checksums = self.root / "WEB-RELEASE-SHA256SUMS.txt"
        checksums.write_text(f"{web_release.sha256_file(self.archive)}  {self.archive.name}\n")
        return checksums

    def verify(self, checksums=None, **options):
        return web_release.verify_archive(self.archive, version="2.1.0", commit=COMMIT, checksums=checksums,
                                          output_dir=self.root / "site", **options)

    def assert_rejected(self, pattern, checksums=None):
        with self.assertRaisesRegex(web_release.ReleaseError, pattern):
            self.verify(checksums)


class ArchiveTests(ArchiveCase):
    def test_a_valid_archive_is_admitted_and_receives_the_deploy_files(self):
        checksums = self.build()
        identity = self.verify(checksums, deploy_files=True)
        self.assertEqual((identity.version, identity.commit, identity.files), ("2.1.0", COMMIT[:12], 10))
        site = self.root / "site"
        headers = (site / "_headers").read_text()
        self.assertIn("/assets/*\n  Cache-Control: public, max-age=31536000, immutable", headers)
        self.assertIn("/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin", headers)
        for directory in ["assets", "canopi-catalog", "pdf-fonts"]:
            self.assertEqual((site / directory / "404.html").read_bytes(), b"")
        self.assertFalse((site / "404.html").exists())
        self.assertFalse((site / "_redirects").exists())

    def test_the_archive_is_deterministic(self):
        self.build()
        first = self.archive.read_bytes()
        self.archive.unlink()
        self.build()
        self.assertEqual(first, self.archive.read_bytes())

    def test_unsafe_tar_entries_are_rejected_before_anything_is_written(self):
        def entry(name, kind=tarfile.REGTYPE, link=""):
            info = tarfile.TarInfo(name)
            info.type = kind
            info.linkname = link
            return info
        for info in [entry("/etc/passwd"), entry("../outside.js"), entry("assets/../../outside.js"),
                     entry("assets/link.js", tarfile.SYMTYPE, "/etc/passwd"),
                     entry("assets/hard.js", tarfile.LNKTYPE, "index.html"),
                     entry("dev/null", tarfile.CHRTYPE), entry("assets/fifo", tarfile.FIFOTYPE)]:
            with self.subTest(name=info.name, type=info.type):
                self.archive.unlink(missing_ok=True)
                with tarfile.open(self.archive, "w:gz") as tar:
                    tar.addfile(tarfile.TarInfo("index.html"), io.BytesIO(b""))
                    tar.addfile(info, io.BytesIO(b""))
                output = self.root / f"site-{info.type}-{len(info.name)}"
                with self.assertRaises(web_release.ReleaseError):
                    web_release.safe_extract(self.archive, output)
                self.assertEqual(list(output.iterdir()), [])
                self.assertFalse((self.root.parent / "outside.js").exists())

    def test_checksum_mismatch_or_absence_is_rejected(self):
        checksums = self.build()
        checksums.write_text("0" * 64 + f"  {self.archive.name}\n")
        self.assert_rejected("checksum mismatch", checksums)
        checksums.write_text("0" * 64 + "  other.tar.gz\n")
        self.assert_rejected("does not list", checksums)

    def test_unlisted_files_are_rejected(self):
        self.build(extra={"assets/extra.js": b"not in the manifest"})
        self.assert_rejected("unlisted file: assets/extra.js")

    def test_a_listed_file_with_other_bytes_is_rejected(self):
        files = site_files()
        manifest = manifest_for(files)
        files["assets/web-1.js"] = b"console.log('changed')"
        self.build(files, manifest)
        self.assert_rejected("differs for assets/web-1.js")

    def test_wrong_base_path_or_fallback_is_rejected(self):
        files = site_files()
        self.build(files, manifest_for(files, basePath="/app/"))
        self.assert_rejected("basePath")
        self.archive.unlink()
        self.build(files, manifest_for(files, spaFallback={"source": "/app/*", "destination": "/app/index.html", "status": 200}))
        self.assert_rejected("spaFallback")

    def test_version_and_commit_must_be_the_release(self):
        files = site_files()
        self.build(files, manifest_for(files, version="2.0.0"))
        self.assert_rejected("version")
        self.archive.unlink()
        self.build(files, manifest_for(files, commit="0" * 12))
        self.assert_rejected("not the release commit")
        # `package-web-edition.mjs --commit` records the full commit; the archive name keeps 12 characters.
        self.build(files, manifest_for(files, commit=COMMIT))
        self.assertEqual(self.verify().commit, COMMIT)

    def test_oversize_files_and_file_count_are_rejected(self):
        files = site_files()
        files["assets/big.js"] = b"x" * (MAX_BYTES + 1)
        self.build(files)
        self.assert_rejected("above the Pages limit 4000")
        files = site_files()
        files.update({f"assets/n{index}.js": b"" for index in range(12)})
        self.archive.unlink()
        self.build(files)
        self.assert_rejected("files, above the Pages limit 20")

    def test_a_google_maps_key_is_rejected(self):
        files = site_files()
        files["assets/web-1.js"] = b"const key = 'AIza" + b"Sy" + b"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p'"
        self.build(files)
        self.assert_rejected("Google Maps key found in assets/web-1.js")

    def test_raw_duckdb_wasm_and_deploy_owned_files_are_rejected(self):
        cases = [("assets/duckdb-eh.wasm", "raw DuckDB"), ("_redirects", "deploy-owned"),
                 ("404.html", "deploy-owned"), ("assets/_headers", "deploy-owned")]
        for index, (path, pattern) in enumerate(cases):
            with self.subTest(path=path):
                files = site_files()
                files[path] = b"x"
                self.archive.unlink(missing_ok=True)
                self.build(files)
                with self.assertRaisesRegex(web_release.ReleaseError, pattern):
                    web_release.verify_archive(self.archive, version="2.1.0", output_dir=self.root / f"site-{index}")

    def test_missing_index_or_catalog_assets_are_rejected(self):
        files = site_files()
        del files["canopi-catalog/names/names-en.parquet"]
        self.build(files)
        self.assert_rejected("catalog asset missing: canopi-catalog/names/names-en.parquet")
        files = site_files()
        del files["index.html"]
        self.archive.unlink()
        self.build(files)
        self.assert_rejected("index.html is missing")

    def test_the_archive_name_must_name_the_release(self):
        self.build()
        self.archive = self.archive.rename(self.root / "canopi-web-edition-v2.1.0-abcdef012345.tar.gz")
        self.assert_rejected("not the root Web Edition archive")


class PublishScriptTests(ArchiveCase):
    """publish-web-release.sh up to its first deploy, with a local GitHub boundary."""

    def publish(self, *extra, draft=False, release_checksums=None):
        checksums = self.build()
        published = self.root / "published"
        published.mkdir(exist_ok=True)
        shutil.copy(release_checksums or checksums, published / checksums.name)
        shutil.copy(self.archive, published / self.archive.name)
        fake = self.root / "bin"
        fake.mkdir(exist_ok=True)
        (fake / "gh").write_text(f"""#!/usr/bin/env bash
echo "gh $*" >> {self.root}/calls
case "$1 $2" in
  "release view") printf '%s\\n' {"true" if draft else "false"} ;;
  "api repos/example/canopi/commits/v2.1.0") printf '%s\\n' {COMMIT} ;;
  "release download")
    for arg; do
      if [[ "$prev" == --dir ]]; then dir="$arg"; fi
      if [[ "$prev" == --pattern ]]; then cp {published}/$arg "$dir/" 2>/dev/null || true; fi
      prev="$arg"
    done ;;
  *) exit 1 ;;
esac
""")
        for tool in ["npx", "docker"]:
            (fake / tool).write_text(f'#!/usr/bin/env bash\necho "{tool} $*" >> {self.root}/calls\nexit 1\n')
        for tool in fake.iterdir():
            tool.chmod(0o755)
        return subprocess.run(
            ["bash", str(Path(__file__).with_name("publish-web-release.sh")), "--tag", "v2.1.0",
             "--repo", "example/canopi", *extra],
            env={**os.environ, "PATH": f"{fake}{os.pathsep}{os.environ['PATH']}", "TMPDIR": str(self.root)},
            capture_output=True, text=True)

    def calls(self):
        path = self.root / "calls"
        return path.read_text().splitlines() if path.exists() else []

    def test_verify_only_downloads_and_admits_the_published_archive(self):
        result = self.publish("--verify-only")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("stopping before deploy", result.stdout)

    def test_a_draft_release_is_never_deployed(self):
        result = self.publish("--verify-only", draft=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not a published release", result.stderr)

    def test_a_local_artifact_is_deployed_only_if_the_release_checksums_vouch_for_it(self):
        # The operator's local copy carries its own matching checksum file; the release's differs.
        local = self.root / "local"
        local.mkdir()
        checksums = self.build()
        shutil.copy(self.archive, local / self.archive.name)
        shutil.copy(checksums, local / checksums.name)
        release_checksums = self.root / "release-sums.txt"
        release_checksums.write_text("0" * 64 + f"  {self.archive.name}\n")
        result = self.publish("--artifact", str(local / self.archive.name), release_checksums=release_checksums)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checksum mismatch", result.stderr)
        downloads = [call for call in self.calls() if call.startswith("gh release download")]
        self.assertEqual(len(downloads), 1)
        self.assertIn("--pattern WEB-RELEASE-SHA256SUMS.txt", downloads[0])
        self.assertNotIn(".tar.gz", downloads[0])
        self.assertFalse(any(call.startswith(("npx", "docker")) for call in self.calls()))


class LiveCheckTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.site = Path(temp.name)
        self.files = site_files()
        manifest = manifest_for(self.files)
        for path, data in {**self.files, web_release.MANIFEST_NAME: json.dumps(manifest).encode()}.items():
            (self.site / path).parent.mkdir(parents=True, exist_ok=True)
            (self.site / path).write_bytes(data)
        self.overrides = {}
        self.inject = b""

    def get(self, url):
        path = re.sub(r"^https://example\.test", "", url)
        if path in self.overrides:
            return self.overrides[path]
        # Mixed-case header names: HTTP header names are case-insensitive.
        headers = {"x-content-type-OPTIONS": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin"}
        file = path.lstrip("/")
        if file == web_release.MANIFEST_NAME:
            return web_release.Response(200, {k.lower(): v for k, v in {**headers, "Cache-Control": "no-cache", "Content-Type": "application/json"}.items()},
                                        (self.site / file).read_bytes())
        if file in self.files and file != "index.html":
            types = {".js": "application/javascript", ".css": "text/css; charset=utf-8", ".json": "application/json",
                     ".parquet": "application/octet-stream", ".woff2": "font/woff2", ".ttf": "font/ttf", ".svg": "image/svg+xml"}
            cache = "public, max-age=31536000, immutable" if file.startswith("assets/") else "no-cache"
            return web_release.Response(200, {k.lower(): v for k, v in {**headers, "Content-Type": types[Path(file).suffix], "Cache-Control": cache}.items()},
                                        self.files[file])
        if file.startswith(("assets/", "canopi-catalog/", "pdf-fonts/")):
            return web_release.Response(404, {k.lower(): v for k, v in headers.items()}, b"")
        return web_release.Response(200, {k.lower(): v for k, v in {**headers, "Content-Type": "text/html; charset=utf-8"}.items()},
                                    self.files["index.html"].replace(b"<title>", self.inject + b"<title>"))

    def check(self, production=False):
        return web_release.http_check("https://example.test/", self.site, production=production, get=self.get)

    def test_a_correct_deployment_passes_with_any_header_case(self):
        self.assertEqual(len(self.check()), 4)

    def test_production_html_may_carry_cloudflare_injections_but_preview_html_may_not(self):
        self.inject = b'<a href="https://example.test/cdn-cgi/content?id=1" aria-hidden="true"></a>'
        self.check(production=True)
        with self.assertRaisesRegex(web_release.ReleaseError, "HTML differs"):
            self.check()

    def test_missing_headers_spa_fallback_for_assets_and_stale_manifest_fail(self):
        html = web_release.Response(200, {"content-type": "text/html", "x-content-type-options": "nosniff"},
                                    self.files["index.html"])
        stale = web_release.Response(200, {"x-content-type-options": "nosniff", "cache-control": "no-cache"},
                                     json.dumps({"version": "2.0.0", "commit": "0" * 12}).encode())
        for path, response, pattern in [
            ("/assets/missing-0000.js", html, "expected 404"),
            ("/designs", web_release.Response(200, {"content-type": "text/html"}, self.files["index.html"]), "nosniff"),
            ("/" + web_release.MANIFEST_NAME, stale, "serves 2.0.0"),
            ("/assets/web-1.js", web_release.Response(200, {"x-content-type-options": "nosniff", "content-type": "text/plain"},
                                                      self.files["assets/web-1.js"]), "Content-Type"),
        ]:
            with self.subTest(path=path):
                self.overrides = {path: response}
                with self.assertRaisesRegex(web_release.ReleaseError, pattern):
                    self.check()

    def test_production_is_current_only_when_it_serves_the_manifest_and_passes_its_checks(self):
        self.assertTrue(web_release.production_current("https://example.test", self.site, get=self.get))
        # A _headers fix keeps the manifest bytes, so a matching manifest alone must not skip the deploy.
        self.overrides = {"/assets/web-1.js": web_release.Response(
            200, {"x-content-type-options": "nosniff", "content-type": "application/javascript", "cache-control": "max-age=0"},
            self.files["assets/web-1.js"])}
        self.assertFalse(web_release.production_current("https://example.test", self.site, get=self.get))
        self.overrides = {"/" + web_release.MANIFEST_NAME: web_release.Response(200, {}, b"old")}
        self.assertFalse(web_release.production_current("https://example.test", self.site, get=self.get))

    def test_wait_for_polls_until_the_manifest_matches_or_times_out(self):
        calls = []
        responses = [web_release.Response(200, {}, b"old"), self.get("/" + web_release.MANIFEST_NAME)]
        web_release.wait_for("https://example.test", self.site, timeout=60, get=lambda url: responses.pop(0),
                             sleep=calls.append)
        self.assertEqual(len(calls), 1)
        with self.assertRaisesRegex(web_release.ReleaseError, "did not serve"):
            web_release.wait_for("https://example.test", self.site, timeout=0,
                                 get=lambda url: web_release.Response(200, {}, b"old"), sleep=calls.append)

    def test_deploy_url_reads_wrangler_output(self):
        output = ("Uploaded 3 files\n✨ Deployment complete! Take a peek over at https://1a2b3c4d.canopi-web.pages.dev\n"
                  "✨ Deployment alias URL: https://release-2-1-0.canopi-web.pages.dev\n")
        self.assertEqual(web_release.deploy_url(output, "canopi-web"), "https://1a2b3c4d.canopi-web.pages.dev")
        with self.assertRaises(web_release.ReleaseError):
            web_release.deploy_url("no url here", "canopi-web")


class CatalogAssetTests(unittest.TestCase):
    def test_asset_name_carries_both_contract_fingerprints_and_the_export_identity(self):
        name = web_release.web_catalog_asset_name()
        self.assertRegex(name, r"^canopi-web-catalog-v\d+-[0-9a-f]{64}-[0-9a-f]{64}-[0-9a-f]{64}\.tar\.gz$")
        self.assertLess(len(name), 255)

    def test_a_generated_catalog_round_trips_byte_for_byte_and_rejects_strays(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            export = root / "canopi-export-test.db"
            create_export_fixture(export)
            generator.generate_web_catalog(export_path=export, output_dir=root / "catalog", species_shard_count=2,
                                           image_shard_count=2, max_asset_bytes=25 * 1024 * 1024)
            web_release.pack_catalog(root / "catalog", root / "one.tar.gz")
            web_release.pack_catalog(root / "catalog", root / "two.tar.gz")
            self.assertEqual((root / "one.tar.gz").read_bytes(), (root / "two.tar.gz").read_bytes())
            manifest = web_release.unpack_catalog(root / "one.tar.gz", root / "unpacked")
            self.assertEqual(manifest, json.loads((root / "catalog/manifest.json").read_text()))
            (root / "catalog/stray.parquet").write_bytes(b"stray")
            with self.assertRaisesRegex(web_release.ReleaseError, "unlisted catalog file: stray.parquet"):
                web_release.pack_catalog(root / "catalog", root / "three.tar.gz")
            (root / "catalog/stray.parquet").unlink()
            next((root / "catalog/species").iterdir()).write_bytes(b"changed")
            with self.assertRaisesRegex(web_release.ReleaseError, "catalog asset (byte count|checksum) differs"):
                web_release.pack_catalog(root / "catalog", root / "three.tar.gz")


if __name__ == "__main__":
    unittest.main()
