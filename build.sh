#!/usr/bin/env bash
# Packages the extension. Usage: ./build.sh chrome|firefox [output]
# The Chrome zip ships manifest.json as is. The Firefox xpi applies the
# overrides in firefox-manifest.json.
set -euo pipefail
cd "$(dirname "$0")"
target="${1:-}"
case "$target" in
  chrome) output="${2:-tabscope.zip}" ;;
  firefox) output="${2:-tabscope.xpi}" ;;
  *) echo "Usage: $0 chrome|firefox [output]" >&2; exit 1 ;;
esac
python3 - "$target" "$output" <<'PY'
import json
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

target, output = sys.argv[1], Path(sys.argv[2])
manifest = json.loads(Path('manifest.json').read_text())
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
PY
