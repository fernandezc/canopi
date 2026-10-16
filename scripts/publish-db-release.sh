#!/usr/bin/env bash

set -euo pipefail

log() {
  printf '[publish-db] %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: Required command '$1' is not installed or not on PATH." >&2
    exit 1
  fi
}

usage() {
  cat <<'EOF'
Usage:
  scripts/publish-db-release.sh --export-path PATH [options]

Options:
  --export-path PATH   Source canopi-data export database (required)
  --output-path PATH   Temporary output path for generated DB
  --tag TAG            GitHub release tag to upload to (default: canopi-core-db)
  --repo OWNER/REPO    GitHub repository (default: detected from git remote)
  --web-catalog-only   Publish only the Web catalog, for a DB identity already on the tag
  --dry-run            Build and verify everything, print the asset names, upload nothing

Publishes the prepared DB and the Web catalog generated from the same export, each
under its identity name with a .sha256, and never overwrites an existing asset.
EOF
}

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

require_cmd gh
require_cmd python3
require_cmd sha256sum

detect_repo() {
  local remote
  remote="$(git config --get remote.origin.url 2>/dev/null || true)"
  case "$remote" in
    git@github.com:*.git)
      printf '%s\n' "${remote#git@github.com:}" | sed 's/\.git$//'
      ;;
    https://github.com/*.git)
      printf '%s\n' "${remote#https://github.com/}" | sed 's/\.git$//'
      ;;
    https://github.com/*)
      printf '%s\n' "${remote#https://github.com/}"
      ;;
    *)
      return 1
      ;;
  esac
}

export_path=""
output_path=""
tag="canopi-core-db"
repo="$(detect_repo || true)"
tmpdir=""
web_catalog_only=0
dry_run=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --export-path)
      export_path="$2"
      shift 2
      ;;
    --output-path)
      output_path="$2"
      shift 2
      ;;
    --tag)
      tag="$2"
      shift 2
      ;;
    --repo)
      repo="$2"
      shift 2
      ;;
    --web-catalog-only)
      web_catalog_only=1
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$export_path" ]]; then
  echo "ERROR: --export-path is required." >&2
  usage >&2
  exit 1
fi

if [[ -z "$repo" ]]; then
  echo "ERROR: --repo is required when the GitHub repository cannot be detected from git remote.origin.url." >&2
  exit 1
fi

python3 scripts/species_catalog_contract.py check
expected_schema_version="$(python3 scripts/species_catalog_contract.py value prepared-schema-version)"
asset_name="$(python3 scripts/species_catalog_contract.py value prepared-db-asset-name)"
web_asset_name="$(python3 scripts/web_release.py catalog-asset-name)"
if [[ -z "$asset_name" || -z "$web_asset_name" ]]; then
  echo "ERROR: Could not derive the DB and Web catalog asset names." >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
trap '[[ -n "$tmpdir" ]] && rm -rf "$tmpdir"' EXIT
upload_dir="$tmpdir/upload"
mkdir -p "$upload_dir"
upload_path="$upload_dir/$asset_name"
checksum_path="$upload_dir/${asset_name}.sha256"
web_upload_path="$upload_dir/$web_asset_name"
web_checksum_path="$upload_dir/${web_asset_name}.sha256"
if [[ -z "$output_path" ]]; then
  output_path="$tmpdir/prepared.db"
fi

log "Target release: $repo@$tag"
log "Checking GitHub release tag exists: $tag"
gh release view "$tag" --repo "$repo" --json assets --jq '.assets[].name' > "$tmpdir/assets.txt"
if grep -Fxq "$web_asset_name" "$tmpdir/assets.txt"; then
  echo "ERROR: $web_asset_name is already published on $tag; identity assets are never overwritten." >&2
  exit 1
fi

if [[ "$web_catalog_only" -eq 1 ]]; then
  if ! grep -Fxq "$asset_name" "$tmpdir/assets.txt"; then
    echo "ERROR: --web-catalog-only needs $asset_name on $tag; publish the DB and catalog together instead." >&2
    exit 1
  fi
  python3 scripts/species_catalog_contract.py verify-source-export "$export_path"
else
  if grep -Fxq "$asset_name" "$tmpdir/assets.txt"; then
    echo "ERROR: $asset_name is already published on $tag; use --web-catalog-only to add its Web catalog." >&2
    exit 1
  fi
  log "Building bundled DB from export: $export_path"
  python3 scripts/prepare-db.py --export-path "$export_path" --output-path "$output_path"

  if [[ ! -s "$output_path" ]]; then
    echo "ERROR: Generated DB is missing or empty: $output_path" >&2
    exit 1
  fi

  python3 scripts/species_catalog_contract.py verify-db --profile prepared "$output_path"
  python3 scripts/species_catalog_contract.py verify-source-export "$export_path"
fi

log "Generating the Web catalog from the same export"
python3 scripts/generate-web-catalog.py --export-path "$export_path" --output-dir "$tmpdir/web-catalog"
python3 -I scripts/web_release.py pack-catalog --catalog-dir "$tmpdir/web-catalog" --output "$web_upload_path"
if [[ ! -s "$web_upload_path" ]]; then
  echo "ERROR: Web catalog archive is missing or empty: $web_upload_path" >&2
  exit 1
fi

python3 scripts/species_catalog_contract.py check
publication_asset_name="$(python3 scripts/species_catalog_contract.py value prepared-db-asset-name)"
publication_web_asset_name="$(python3 scripts/web_release.py catalog-asset-name)"
if [[ "$publication_asset_name" != "$asset_name" || "$publication_web_asset_name" != "$web_asset_name" ]]; then
  echo "ERROR: Species Catalog release identity changed during preparation: expected $asset_name and $web_asset_name, observed $publication_asset_name and $publication_web_asset_name" >&2
  exit 1
fi

web_sha256="$(sha256sum "$web_upload_path" | awk '{print $1}')"
printf '%s  %s\n' "$web_sha256" "$web_asset_name" > "$web_checksum_path"
uploads=("$web_upload_path" "$web_checksum_path")

if [[ "$web_catalog_only" -eq 0 ]]; then
  if [[ "$output_path" != "$upload_path" ]] && ! ln "$output_path" "$upload_path" 2>/dev/null; then
    cp "$output_path" "$upload_path"
  fi
  db_sha256="$(sha256sum "$upload_path" | awk '{print $1}')"
  printf '%s  %s\n' "$db_sha256" "$asset_name" > "$checksum_path"
  uploads=("$upload_path" "$checksum_path" "${uploads[@]}")
fi

if [[ "$dry_run" -eq 1 ]]; then
  for upload in "${uploads[@]}"; do
    log "Would upload: $(basename "$upload")"
  done
  log "Dry run: nothing uploaded to $repo@$tag"
  exit 0
fi

log "Uploading identity assets and checksums"
gh release upload "$tag" \
  "${uploads[@]}" \
  --repo "$repo"

if [[ "$web_catalog_only" -eq 0 ]]; then
  log "Published $asset_name to $repo@$tag"
  log "Schema version: $expected_schema_version"
  log "SHA256: $db_sha256"
fi
log "Published $web_asset_name to $repo@$tag"
log "Web catalog SHA256: $web_sha256"
