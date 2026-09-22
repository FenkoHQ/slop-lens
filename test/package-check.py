"""Release archives contain runtime assets and public documentation only."""
import importlib.util
from pathlib import Path
import tempfile
import sys

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('package', Path(__file__).resolve().parents[1] / 'tools/package.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)

with tempfile.TemporaryDirectory() as directory:
    package.ROOT = Path(directory)
    expected = {'manifest.json', 'LICENSE', 'PRIVACY.md', 'README.md', 'src/theme.js', 'fonts/saira.woff2'}
    excluded = {'.agents/context.md', '.codex/settings.json', '.env', 'HANDOFF.md', 'docs/plan.md', 'test/fixture.js', 'tools/build.py'}
    for name in expected | excluded:
        path = package.ROOT / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('fixture')
    shipped = {str(path) for path in package.shipped_files()}
    assert shipped == expected, f'Unexpected release contents: {shipped ^ expected}'
print('Release contents check passed')
