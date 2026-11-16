#!/usr/bin/env bash
# Two-step release. The Firefox xpi is signed by hand between the steps.
#
#   ./release.sh prepare 1.2.0
#     Sets the version, commits, tags v1.2.0 and builds
#     dist/tabscope-1.2.0.zip and dist/tabscope-1.2.0-unsigned.xpi.
#     Nothing leaves this machine.
#
#   ./release.sh publish 1.2.0 path/to/signed.xpi
#     Checks the signed xpi, pushes main and the tag, and creates the
#     GitHub release with the zip and the signed xpi.
set -euo pipefail
cd "$(dirname "$0")"

die() { echo "error: $*" >&2; exit 1; }

usage() {
  echo "Usage: $0 prepare <version>" >&2
  echo "       $0 publish <version> <signed.xpi>" >&2
  exit 1
}

manifest_version() {
  python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])'
}

check_version() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version must look like 1.2.0, got '$1'"
}

prepare() {
  local version="$1" tag="v$1"
  check_version "$version"
  [[ "$(git branch --show-current)" == main ]] || die "releases are cut from main"
  [[ -z "$(git status --porcelain)" ]] || die "working tree is not clean"
  git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "tag $tag already exists"

  local current
  current="$(manifest_version < manifest.json)"
  [[ "$(printf '%s\n%s\n' "$current" "$version" | sort -V | tail -1)" == "$version" && "$current" != "$version" ]] ||
    die "version $version is not above the current $current"

  # Edits the line in place so the rest of the manifest keeps its formatting.
  sed -i.bak -E "s/(\"version\": *\")[^\"]+\"/\\1$version\"/" manifest.json && rm manifest.json.bak
  [[ "$(manifest_version < manifest.json)" == "$version" ]] || die "could not set the version in manifest.json"

  git commit -q -m "Release $tag" manifest.json
  git tag -a "$tag" -m "Release $tag"

  ./build.sh chrome "dist/tabscope-$version.zip"
  ./build.sh firefox "dist/tabscope-$version-unsigned.xpi"

  cat <<EOF

Prepared $tag (local only).
1. Upload dist/tabscope-$version-unsigned.xpi to addons.mozilla.org and download the signed xpi.
2. Run: $0 publish $version <signed.xpi>

To discard: git tag -d $tag && git reset --hard HEAD~1
EOF
}

publish() {
  local version="$1" signed="$2" tag="v$1"
  check_version "$version"
  [[ -f "$signed" ]] || die "no file at $signed"
  [[ -f "dist/tabscope-$version.zip" ]] || die "dist/tabscope-$version.zip is missing; run prepare first"
  git rev-parse -q --verify "refs/tags/$tag" >/dev/null || die "tag $tag does not exist; run prepare first"
  [[ "$(git show "$tag:manifest.json" | manifest_version)" == "$version" ]] || die "tag $tag does not carry version $version"
  gh auth status >/dev/null 2>&1 || die "gh is not logged in; run gh auth login"

  local entries
  entries="$(unzip -Z1 "$signed")" || die "$signed is not a zip"
  grep -qE '^META-INF/(cose\.sig|mozilla\.rsa)$' <<<"$entries" || die "$signed has no Mozilla signature"
  [[ "$(unzip -p "$signed" manifest.json | manifest_version)" == "$version" ]] ||
    die "$signed is not version $version"

  local xpi="dist/tabscope-$version.xpi"
  [[ "$(cd "$(dirname "$signed")" && pwd)/$(basename "$signed")" == "$PWD/$xpi" ]] || cp "$signed" "$xpi"

  git push origin main "$tag"
  gh release create "$tag" "dist/tabscope-$version.zip" "$xpi" \
    --verify-tag --title "$tag" --generate-notes
}

case "${1:-}" in
  prepare) [[ $# -eq 2 ]] || usage; prepare "$2" ;;
  publish) [[ $# -eq 3 ]] || usage; publish "$2" "$3" ;;
  *) usage ;;
esac
