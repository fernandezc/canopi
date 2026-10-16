#!/usr/bin/env bash
# Deploys a published release's root Web Edition archive to Cloudflare Pages with the
# operator's logged-in wrangler (docs/guides/editions.md#web-publishing): verify, preview
# deploy and checks, production deploy and checks. Checks live in scripts/web_release.py;
# the browser smoke is desktop/web/e2e-release/. Safe to re-run: a production that already
# serves the release manifest and passes its HTTP checks is only checked again; otherwise
# (say, after a _headers fix) both deploys run again.

set -Eeuo pipefail

WRANGLER_VERSION="4.107.1"
PLAYWRIGHT_IMAGE="mcr.microsoft.com/playwright:v1.63.0-noble"
PRODUCTION_URL="https://web.projectcanopi.com"
PRODUCTION_HOST="web.projectcanopi.com"

usage() {
  cat <<'EOF'
Usage:
  scripts/publish-web-release.sh --tag vX.Y.Z [options]

Options:
  --tag vX.Y.Z         Published GitHub release to deploy (required)
  --repo OWNER/REPO    GitHub repository (default: opencanopi/canopi)
  --project NAME       Cloudflare Pages project (default: canopi-web)
  --artifact PATH      Use a local canopi-web-edition-root-*.tar.gz instead of downloading it
  --checksums PATH     With --artifact --verify-only: checksums to trust (default: beside the archive);
                       a deploy always verifies against the release's WEB-RELEASE-SHA256SUMS.txt
  --verify-only        Stop after verifying the archive and adding the deploy files
EOF
}

caller_dir="$PWD"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
tag=""
repo="opencanopi/canopi"
project="canopi-web"
artifact=""
checksums=""
verify_only=0

absolute() {
  if [[ "$1" == /* ]]; then printf '%s\n' "$1"; else printf '%s\n' "$caller_dir/$1"; fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) tag="${2:?--tag requires a value}"; shift 2 ;;
    --repo) repo="${2:?--repo requires a value}"; shift 2 ;;
    --project) project="${2:?--project requires a value}"; shift 2 ;;
    --artifact) artifact="$(absolute "${2:?--artifact requires a path}")"; shift 2 ;;
    --checksums) checksums="$(absolute "${2:?--checksums requires a path}")"; shift 2 ;;
    --verify-only) verify_only=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ ! "$tag" =~ ^v([0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.+-]+)?)$ ]]; then
  echo "ERROR: --tag must be a release tag such as v2.1.0." >&2
  exit 1
fi
version="${BASH_REMATCH[1]}"

work="$(mktemp -d)"
log_file="$(mktemp "${TMPDIR:-/tmp}/canopi-web-release-${version}.XXXXXX.log")"
trap 'rm -rf "$work"' EXIT
# fd 3 keeps the terminal's stderr: the trap runs inside `run`, whose stderr is the log.
exec 3>&2
failed=0
on_error() {
  # A failing command substitution reports once, from the main shell.
  if [[ "$failed" -eq 1 || "$BASH_SUBSHELL" -gt 0 ]]; then return; fi
  failed=1
  echo "[publish-web] FAILED. Last lines of $log_file:" >&3
  tail -n 40 "$log_file" >&3
}
trap on_error ERR

stage() {
  printf '[publish-web] %s\n' "$*"
  printf '\n== %s\n' "$*" >> "$log_file"
}

run() {
  "$@" >> "$log_file" 2>&1
}

web_release() {
  python3 -I "$repo_root/scripts/web_release.py" "$@"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: Required command '$1' is not installed or not on PATH." >&2
    exit 1
  fi
}

require_cmd python3
printf '[publish-web] Verbose log: %s\n' "$log_file"

commit=""
if [[ -z "$artifact" || "$verify_only" -eq 0 ]]; then
  require_cmd gh
  stage "Reading release $tag in $repo"
  if [[ "$(gh release view "$tag" --repo "$repo" --json isDraft --jq .isDraft)" != "false" ]]; then
    echo "ERROR: $tag is not a published release; publish it before deploying the Web Edition." >&2
    exit 1
  fi
  commit="$(gh api "repos/$repo/commits/$tag" --jq .sha)"
  if [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then
    echo "ERROR: Could not resolve $tag to a commit." >&2
    exit 1
  fi
fi

if [[ -z "$artifact" ]]; then
  stage "Downloading the Web Edition archive and WEB-RELEASE-SHA256SUMS.txt"
  mkdir "$work/download"
  run gh release download "$tag" --repo "$repo" --dir "$work/download" \
    --pattern "canopi-web-edition-root-v${version}-*.tar.gz" --pattern "WEB-RELEASE-SHA256SUMS.txt"
  mapfile -t archives < <(find "$work/download" -maxdepth 1 -name "canopi-web-edition-root-v${version}-*.tar.gz")
  if [[ "${#archives[@]}" -ne 1 ]]; then
    echo "ERROR: $tag must carry exactly one root Web Edition archive; found ${#archives[@]}." >&2
    exit 1
  fi
  artifact="${archives[0]}"
  checksums="$work/download/WEB-RELEASE-SHA256SUMS.txt"
elif [[ "$verify_only" -eq 0 ]]; then
  # A deploy trusts only the published release's checksums, never a file beside a local archive.
  if [[ -n "$checksums" ]]; then
    echo "ERROR: --checksums applies to --verify-only; a deploy verifies against $tag's WEB-RELEASE-SHA256SUMS.txt." >&2
    exit 1
  fi
  stage "Downloading WEB-RELEASE-SHA256SUMS.txt for the local archive"
  mkdir "$work/download"
  run gh release download "$tag" --repo "$repo" --dir "$work/download" --pattern "WEB-RELEASE-SHA256SUMS.txt"
  checksums="$work/download/WEB-RELEASE-SHA256SUMS.txt"
elif [[ -z "$checksums" ]]; then
  checksums="$(dirname "$artifact")/WEB-RELEASE-SHA256SUMS.txt"
fi

stage "Verifying $(basename "$artifact") and adding the deploy files"
site="$work/site"
commit_args=()
if [[ -n "$commit" ]]; then commit_args=(--commit "$commit"); fi
run web_release verify --archive "$artifact" --checksums "$checksums" --version "$version" \
  "${commit_args[@]}" --output-dir "$site" --add-deploy-files

if [[ "$verify_only" -eq 1 ]]; then
  stage "Verified Web Edition $version; stopping before deploy (--verify-only)"
  exit 0
fi

require_cmd npx
require_cmd docker
if [[ ! -d "$repo_root/desktop/web/node_modules/@playwright/test" ]]; then
  echo "ERROR: The browser smoke needs desktop/web/node_modules; run npm ci --prefix desktop/web." >&2
  exit 1
fi

wrangler_deploy() {
  local branch="$1" output="$work/wrangler-$1.txt"
  mkdir -p "$work/wrangler-cwd"
  (cd "$work/wrangler-cwd" && npx --yes "wrangler@$WRANGLER_VERSION" pages deploy "$site" \
    --project-name "$project" --branch "$branch" --commit-hash "$commit") > "$output" 2>&1 || {
    cat "$output" >> "$log_file"
    return 1
  }
  cat "$output" >> "$log_file"
  web_release deploy-url --project "$project" < "$output"
}

smoke() {
  run docker run --rm --ipc=host --user "$(id -u):$(id -g)" -e HOME=/tmp -e NPM_CONFIG_UPDATE_NOTIFIER=false \
    -e CANOPI_WEB_RELEASE_URL="$1" -e CANOPI_WEB_RELEASE_OUTPUT=/tmp/web-release-results \
    -v "$repo_root/desktop/web:/web:ro" -w /web "$PLAYWRIGHT_IMAGE" \
    npx playwright test --config e2e-release/playwright.config.ts
}

if web_release production-current --base-url "$PRODUCTION_URL" --site "$site" >> "$log_file" 2>&1; then
  stage "Production already serves $version and passes its HTTP checks; skipping both deploys"
else
  preview_branch="release-${version}"
  stage "Deploying preview branch $preview_branch"
  preview_url="$(wrangler_deploy "$preview_branch")"
  stage "HTTP checks on $preview_url"
  run web_release http-check --base-url "$preview_url" --site "$site"
  stage "Browser smoke (Chromium, WebKit) on $preview_url"
  smoke "$preview_url"

  stage "Deploying production"
  run wrangler_deploy production
  stage "Waiting for $PRODUCTION_URL to serve $version (up to 10 min)"
  run web_release wait-for --base-url "$PRODUCTION_URL" --site "$site" --timeout 600
fi

stage "HTTP and TLS checks on $PRODUCTION_URL"
run web_release http-check --base-url "$PRODUCTION_URL" --site "$site" --production
run web_release check-tls --host "$PRODUCTION_HOST"
stage "Browser smoke (Chromium, WebKit) on $PRODUCTION_URL"
smoke "$PRODUCTION_URL"
stage "Web Edition $version is live at $PRODUCTION_URL"
