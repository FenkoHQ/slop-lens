#!/usr/bin/env bash
# Parity check against the reference Python analyzer.
#
# Everything numeric and structural must match exactly: score, band, word
# count, penalties, per-rule counts, and every violation's rule, penalty and
# resolved character offsets.
#
# Advice and violation text are compared with punctuation normalised, because
# Slop Lens deliberately does not use em dashes and slop-guard's own strings
# do. That is the only sanctioned difference.
set -euo pipefail

cd "$(dirname "$0")/.."

# Slop Lens ships no em dashes. The single exception is the detector pattern in
# rules.js, which has to contain one to find them.
stray=$(grep -rn "—" src/ manifest.json README.md | grep -v "EM_DASH_RE" || true)
if [ -n "$stray" ]; then
  echo "em dashes found in shipped files:"
  echo "$stray"
  exit 1
fi

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

node test/run-js.mjs > "$out/js.json"
uv run --quiet --with slop-guard==0.5.0 test/run-py.py > "$out/py.json"

python3 - "$out" <<'PY'
import json
import pathlib
import re
import sys

out = pathlib.Path(sys.argv[1])
py = json.loads((out / "py.json").read_text())
js = json.loads((out / "js.json").read_text())

EXACT = ("score", "band", "word_count", "total_penalty", "counts")
VIOLATION_EXACT = ("rule", "penalty", "start", "end")

failures = 0


def normalise(text):
    """Drop the punctuation Slop Lens rewrites, keep the wording."""
    return re.sub(r"\s+", " ", re.sub(r"[—.:;]", " ", text)).strip().lower()


def report(name, field, expected, actual):
    global failures
    failures += 1
    print(f"MISMATCH [{name}] {field}")
    print(f"  py: {expected}")
    print(f"  js: {actual}")


for name in py:
    for field in EXACT:
        if py[name][field] != js[name][field]:
            report(name, field, py[name][field], js[name][field])

    for field in ("weighted_sum", "density"):
        if round(py[name][field], 2) != round(js[name][field], 2):
            report(name, field, py[name][field], js[name][field])

    expected_advice = [normalise(line) for line in py[name]["advice"]]
    actual_advice = [normalise(line) for line in js[name]["advice"]]
    if expected_advice != actual_advice:
        report(name, "advice", expected_advice, actual_advice)

    expected_hits = py[name]["violations"]
    actual_hits = js[name]["violations"]
    if len(expected_hits) != len(actual_hits):
        report(name, "violation count", len(expected_hits), len(actual_hits))
        continue

    for index, (expected, actual) in enumerate(zip(expected_hits, actual_hits)):
        for field in VIOLATION_EXACT:
            if expected[field] != actual[field]:
                report(name, f"violation[{index}].{field}", expected[field], actual[field])

        for field in ("match", "context"):
            if normalise(expected[field]) != normalise(actual[field]):
                report(name, f"violation[{index}].{field}", expected[field], actual[field])

print(f"{len(py)} samples checked, {failures} mismatches")
sys.exit(1 if failures else 0)
PY

# The harnesses stub chrome.action, so only a real browser can prove the
# toolbar calls are accepted. Skip rather than fail where chromium is absent.
if command -v chromium >/dev/null 2>&1; then
  echo
  node test/probe-extension.mjs
else
  echo
  echo "chromium not found, skipping the toolbar probe"
fi
