# Handoff

Paused 2026-09-13. On 2026-09-15 the repo moved to
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
# 18 checks, 0 failures                real unpacked extension over CDP

python3 tools/package.py
# slop-lens-0.0.1.zip, 57 files, 645 KB, reproducible sha256
```

Store assets are committed: five 1280x800 screenshots plus `promo.mp4` and
`promo.gif` in `store/`, all rendered from the real UI by
`node tools/capture.mjs`.

## Decision taken, not yet acted on

**Slop Lens moves to Fenko as a free tool.** Agreed 2026-09-13, deferred.

It fits the existing free-tools set (Fox Generator, Passkey Town, Age Encrypt,
Fenko Vault) on all three traits they share: runs client-side with nothing
uploaded, open source, privacy as the pitch rather than a footnote. It has the
strongest version of the third, because zero host permissions and no
networking primitive in `src/` make the claim structural rather than a policy.

Three conditions attached to the move:

1. Footer free tool with a page, the way Age Encrypt is done. Not a product,
   and not competing with Foxhound or RiskyPlugins for attention.
2. Repo moves to the FenkoHQ org, matching Fenko Vault. The current
   combination of a personal repo and a `fenko.nz` extension id is the one
   arrangement that makes no sense.
3. Framed as provenance, never as authorship detection. It measures style
   tells, which correlate with generated text; that is suggestive for triage,
   not evidence. `CLAIMS.md` in `fenko-www` forbids untraceable claims, and
   this tool's refusal to accuse anyone is the part worth keeping.

Open question nobody has answered: Fenko attribution means Fenko maintenance.
This tracks slop-guard 0.5.0 upstream, which can move without warning, and a
stale rule set ages worse on a company page than on a personal one.

The concrete first step agreed was: set `homepage_url` to
`https://fenko.nz/slop-lens` and draft `content/english/slop-lens.md` against
the Age Encrypt layout, for review before anything actually moves.

## Distribution

Decided 2026-09-15: free and open source, never on a store, not signed.
Tagged releases ship one unsigned zip, loaded unpacked in Chrome or as a
temporary add-on in Firefox. README "Releasing" has the steps. Mozilla
unlisted signing (needs AMO API keys) was set up and then stripped as not
worth it for now.

- Firefox add-on id is `{411dc062-62b1-4928-9713-6f0a2fc383de}`. A GUID
  rather than `name@domain`, so no email-shaped identifier ships. Becomes
  permanent if it is ever signed.
- `strict_min_version` is 128: `optional_host_permissions` does not exist
  before that, and auto-scan depends on it.
- No release published yet.
- **Firefox runtime is still untested.** `web-ext lint --self-hosted` passes
  with only expected warnings, but every browser check in `verify.sh` drives
  Chromium. The MV3 dual declaration (`service_worker` plus `scripts`) has
  never run under Gecko.

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
