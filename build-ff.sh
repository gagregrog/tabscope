#!/usr/bin/env bash
# Packages the extension as an unsigned Firefox .xpi. The Chrome manifest is the
# source; firefox-manifest.json overrides its keys.
set -euo pipefail
cd "$(dirname "$0")"
python3 - "${1:-tabscope.xpi}" <<'PY'
import json
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

manifest = json.loads(Path('manifest.json').read_text())
manifest.update(json.loads(Path('firefox-manifest.json').read_text()))
# Firefox has no favicon permission and warns about unknown ones.
manifest['permissions'] = [p for p in manifest['permissions'] if p != 'favicon']

files = sorted(
    [*Path('.').glob('*.js'), *Path('.').glob('*.html'), *Path('.').glob('*.css'), *Path('icons').glob('*.png')]
)
output = Path(sys.argv[1])
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    archive.writestr('manifest.json', json.dumps(manifest, indent=2) + '\n')
    for path in files:
        archive.write(path, path.as_posix())
print(f'Built {output}')
PY
