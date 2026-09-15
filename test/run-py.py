"""Run the reference Python analyzer over test/samples.json.

    uv run --with slop-guard==0.5.0 test/run-py.py > /tmp/py.json
"""

import json
import pathlib
import sys

from slop_guard import analyze_text

HERE = pathlib.Path(__file__).parent
samples = json.loads((HERE / "samples.json").read_text(encoding="utf-8"))

out = {sample["name"]: analyze_text(sample["text"]) for sample in samples}
json.dump(out, sys.stdout, indent=2)
