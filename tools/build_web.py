"""Assemble the browser version into one folder that GitHub Pages can serve.

    python tools/build_web.py            -> writes _site/
    python -m http.server -d _site 8000  -> play at http://localhost:8000

_site/ = web/ (game + download page) + assets/ (shared with the desktop game)
         + docs/img/ (screenshots used by the download page).
"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / '_site'
SKIP = shutil.ignore_patterns('*.TMP', '*.import', '__pycache__')

if OUT.exists():
    shutil.rmtree(OUT)
shutil.copytree(ROOT / 'web', OUT, ignore=SKIP)
shutil.copytree(ROOT / 'assets', OUT / 'assets', ignore=SKIP)
shutil.copytree(ROOT / 'docs' / 'img', OUT / 'img', ignore=SKIP)
(OUT / '.nojekyll').touch()
print(f'Built {OUT}')
