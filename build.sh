#!/usr/bin/env bash
# Packages the extension. Usage: ./build.sh chrome|firefox [--dev] [output]
# The Chrome zip ships manifest.json as is. The Firefox xpi applies the
# overrides in firefox-manifest.json. --dev names the extension
# "Tabscope (dev)", and the finder then draws a green outline. A Chrome dev
# build also writes dist/chrome-dev/ to load with "Load unpacked".
set -euo pipefail
cd "$(dirname "$0")"
target="${1:-}"
shift || true
dev=""
if [[ "${1:-}" == "--dev" ]]; then
  dev="-dev"
  shift
fi
case "$target" in
  chrome) output="${1:-tabscope$dev.zip}" ;;
  firefox) output="${1:-tabscope$dev.xpi}" ;;
  *) echo "Usage: $0 chrome|firefox [--dev] [output]" >&2; exit 1 ;;
esac
python3 - "$target" "$output" "$dev" <<'PY'
import json
import shutil
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

target, output, dev = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
manifest = json.loads(Path('manifest.json').read_text())
if dev:
    # palette.js checks for this suffix.
    manifest['name'] += ' (dev)'
if target == 'firefox':
    manifest.update(json.loads(Path('firefox-manifest.json').read_text()))
    # Firefox has no favicon permission and warns about unknown ones.
    manifest['permissions'] = [p for p in manifest['permissions'] if p != 'favicon']

files = sorted(
    [*Path('.').glob('*.js'), *Path('.').glob('*.html'), *Path('.').glob('*.css'), *Path('icons').glob('*.png')]
)
output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    archive.writestr('manifest.json', json.dumps(manifest, indent=2) + '\n')
    for path in files:
        archive.write(path, path.as_posix())
print(f'Built {output}')

if target == 'chrome' and dev:
    folder = Path('dist/chrome-dev')
    shutil.rmtree(folder, ignore_errors=True)
    with ZipFile(output) as archive:
        archive.extractall(folder)
    print(f'Built {folder}/')
PY
