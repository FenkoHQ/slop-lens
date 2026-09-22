# Handoff

On 2026-09-15 the repo moved to
`github.com/FenkoHQ/slop-lens` (public) and distribution was set to GitHub
releases only: no Chrome Web Store, no AMO listing.

Lives at `/home/ali/playground/slop-lens`. Moved there from
`/home/ali/playground/ai-q/slop-lens` on 2026-09-13; `ai-q` is a scratch
directory of unrelated one-offs and this is a real project. The build zip is
written beside the project, so it lands at
`/home/ali/playground/slop-lens-<version>.zip`.

`README.md` covers how the thing works. This file is only the open decisions,
so picking it up later does not mean re-deriving them.

## State

Feature complete and tested. Nothing is half-finished in the code.

```
./test/verify.sh
# 19 samples checked, 0 mismatches     engine parity against Python slop-guard
# 27 checks, 0 failures                real unpacked extension over CDP

uv run --no-project tools/package.py
# slop-lens-0.0.2.zip, reproducible sha256
```

Store assets are committed: five 1280x800 screenshots plus `promo.mp4` and
`promo.gif` in `store/`, all rendered from the real UI by
`node tools/capture.mjs`.

## Fenko free-tool integration, 22 September 2026

The repository is already public under FenkoHQ. Distribution remains GitHub
releases only. The extension now links to `https://fenko.nz/slop-lens/`, uses
Fenko attribution, and shares a device-local System/Light/Dark preference
across its pages. The lens icon and scoring rules are unchanged.

Website work is in the `feat/slop-lens` branch of the Fenko website repository.
The page belongs in the footer free-tools list. Describe scores as writing
patterns, never proof of AI authorship or provenance.

The privacy policy documents optional site access, local preferences, session
readings and external links. Lack of required host permissions is not a
network isolation guarantee.

Firefox remains outside the automated browser suite. Do not treat a Chromium
pass as Firefox verification. The release ZIP excludes development files.

## Things that will bite whoever picks this up

**Use `python3 tools/serve.py`, not `python3 -m http.server`.** Chrome serves
an edited engine file from memory cache otherwise, and a working fix reads as
a no-op. That cost real time here once.

**The harnesses stub `chrome.*`, so they cannot catch a call the real browser
rejects.** `chrome.action.setIcon` rejects a page-relative path, which broke
every settings toggle while three harness runs said it worked.
`test/probe-extension.mjs` exists because of that, and asserts the rejection
deliberately. Do not trust a harness-only pass on anything touching
`chrome.action`.

**A leaked headless Chromium will answer for the next probe run.**
`test/probe-extension.mjs` used to use fixed devtools ports and kill only the
launcher process, so orphaned browsers accumulated and a later run would attach
to one of them. After this project moved directories, an orphan was still
serving the extension from the old path and the probe reported a perfectly good
extension as broken. It now lets Chrome pick an ephemeral port, reads it back
from `DevToolsActivePort` in the profile it created, and kills the whole
process group. If you see `extension did not load; cannot probe`, check for
stray chromium before suspecting the extension:
`pgrep -af user-data-dir=/tmp/slop-lens`.

**Screenshot and video capture needs real wall-clock time.**
`chromium --virtual-time-budget` fast-forwards page timers without advancing
the pdf.js worker, so the PDF shot lands mid-parse. `tools/capture.mjs` drives
CDP with real waits for that reason.
