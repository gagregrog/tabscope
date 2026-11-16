#!/usr/bin/env bash
# Two-step release. The Firefox xpi is signed by hand between the steps.
#
#   ./release.sh prepare [patch|minor|major]
#     Bumps the manifest version (patch by default), commits, tags it and
#     builds dist/tabscope-<version>.zip and
#     dist/tabscope-<version>-unsigned.xpi. Nothing leaves this machine.
#
#   ./release.sh publish path/to/signed.xpi
#     Releases the version that prepare tagged at HEAD. Checks the signed
#     xpi, pushes main and the tag, and creates the GitHub release with the
#     zip and the signed xpi.
set -euo pipefail
cd "$(dirname "$0")"

die() { echo "error: $*" >&2; exit 1; }

usage() {
  echo "Usage: $0 prepare [patch|minor|major]" >&2
  echo "       $0 publish <signed.xpi>" >&2
  exit 1
}

manifest_version() {
  python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])'
}

prepare() {
  local part="$1"
  [[ "$(git branch --show-current)" == main ]] || die "releases are cut from main"
  [[ -z "$(git status --porcelain)" ]] || die "working tree is not clean"

  local current major minor patch version tag
  current="$(manifest_version < manifest.json)"
  [[ "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || die "manifest version '$current' is not like 1.2.0"
  major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}" patch="${BASH_REMATCH[3]}"
  case "$part" in
    major) version="$((major + 1)).0.0" ;;
    minor) version="$major.$((minor + 1)).0" ;;
    patch) version="$major.$minor.$((patch + 1))" ;;
    *) usage ;;
  esac
  tag="v$version"
  git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "tag $tag already exists"

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
2. Run: $0 publish <signed.xpi>

To discard: git tag -d $tag && git reset --hard HEAD~1
EOF
}

publish() {
  local signed="$1" version tag
  version="$(git show HEAD:manifest.json | manifest_version)"
  tag="v$version"
  [[ "$(git rev-parse -q --verify "refs/tags/$tag^{commit}")" == "$(git rev-parse HEAD)" ]] ||
    die "HEAD is not tagged $tag; run prepare first"
  [[ -f "$signed" ]] || die "no file at $signed"
  [[ -f "dist/tabscope-$version.zip" ]] || die "dist/tabscope-$version.zip is missing; run prepare first"
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
  prepare) [[ $# -le 2 ]] || usage; prepare "${2:-patch}" ;;
  publish) [[ $# -eq 2 ]] || usage; publish "$2" ;;
  *) usage ;;
esac
