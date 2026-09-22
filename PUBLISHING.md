# Publishing Slop Lens

Verified 22 September 2026. Current distribution is GitHub releases. Chrome
Web Store and Firefox Add-ons instructions below are preparation for a future
submission; neither store has received this release.

## Published release

| Item | Value |
| --- | --- |
| Name | Slop Lens |
| Publisher | Fenko Security |
| Version | 0.0.2 |
| Licence | MIT; bundled Saira and pdf.js retain their own licences |
| Website | https://fenko.nz/slop-lens/ |
| Download | https://github.com/FenkoHQ/slop-lens/releases/latest |
| This release | https://github.com/FenkoHQ/slop-lens/releases/tag/v0.0.2 |
| Source | https://github.com/FenkoHQ/slop-lens |
| Support | https://github.com/FenkoHQ/slop-lens/issues |
| Full privacy policy | https://github.com/FenkoHQ/slop-lens/blob/main/PRIVACY.md |
| Privacy summary | https://fenko.nz/slop-lens/#privacy |
| Extension revision | `0551b70872f79d6796c75c04681dbb062bf53bd6` |
| Website revision | `a838b191794858990043b9a30d36fbf47e7e10ef` |

The released ZIP is `slop-lens-0.0.2.zip` (659,712 bytes). Its SHA-256 is:

```text
3a67f02c5bf12d04d930c9810346bd95804d0a2c8a5383ec280a5271b00ec84b
```

The downloaded release matched the local package. CI passed, with 19 engine
parity samples, 27 Chromium checks and the release-contents regression check.
Firefox has not been verified by that suite. The production website, footer
link and screenshot were read back after deployment.

## Listing fields

| Field | Suggested value |
| --- | --- |
| Name | Slop Lens |
| Language | English |
| Category | Productivity, or the closest writing-tools category offered |
| Price | Free |
| Homepage | https://fenko.nz/slop-lens/ |
| Support URL | https://github.com/FenkoHQ/slop-lens/issues |
| Privacy URL | https://github.com/FenkoHQ/slop-lens/blob/main/PRIVACY.md |
| Official publisher site | https://fenko.nz, if verified in the publisher account |
| Account/login required | No |
| Remote code | No |

Use the existing Fenko publisher account. Account verification, contact email
and any business declarations must come from that account; this repository
does not establish their status.

Short description:

```text
Find formulaic writing patterns in pages and PDFs. Scores locally in your browser, with no uploads or telemetry. A free Fenko tool.
```

Detailed description:

```text
Slop Lens highlights formulaic writing patterns in the page you are reading.
Expand a signal to see the matched words and inspect the passage yourself.

• Scan a page or selected text.
• Score PDFs, text files and Markdown files on your device.
• See a 0–100 score, with higher scores indicating more matched patterns.
• Show the score and colour on the toolbar.
• Enable automatic scanning if you want it; site access is optional.
• Choose System, Light or Dark appearance.

Scoring runs locally. Rules, fonts and the PDF parser are bundled with the
extension. There are no uploads, accounts, analytics or telemetry. Preferences
stay on your device. Temporary per-tab readings end with the browser session.

The rules target English prose. Scanned image-only PDFs need text recognition
before they can be scored. Browser-protected pages cannot be scanned.

A score does not establish AI authorship or provenance. Human writing can
match the rules, and generated text can avoid them. Use it to review writing,
not to accuse its author.

Free and open source, from Fenko Security. Based on Eric W. Tramel's
slop-guard 0.5.0 rules.
```

Single-purpose description:

```text
Identify and explain formulaic writing patterns in pages, selected text and
user-selected documents through local scoring and highlighting.
```

## Permission explanations

Paste these into the matching dashboard fields.

| Permission | Explanation |
| --- | --- |
| `activeTab` | Read the current page or selection when the user clicks the toolbar icon, so the extension can score that text locally. |
| `scripting` | Inject the bundled extractor, analyzer and highlight overlay into the selected tab. No script is downloaded from a server. |
| `storage` | Keep theme, toolbar and auto-scan preferences in device-local storage. Keep per-tab scores in session storage to refresh toolbar indicators. Nothing uses browser-account sync. |
| Optional `<all_urls>` | Enable user-requested automatic scanning as pages load. Auto-scan is off by default; permission is requested when enabled, and removal is requested when disabled. |

Remote-code explanation:

```text
No remotely hosted code is used. JavaScript, scoring rules, fonts and pdf.js
are bundled in the extension. There is no scoring API or downloaded model.
```

## Data-use disclosures

The extension processes website content and chosen documents locally. It also
handles tab IDs and navigation events for scanning and toolbar updates. It
stores preferences locally and scores temporarily, without content or URL
history. It sends none of that data to Fenko or another service.

Disclose local processing in Chrome's form and policy. Do not select a blanket
"no user data handled" answer merely because nothing is uploaded. Website
content applies; map navigation-related handling to the dashboard's browsing
activity definition. Identify any other applicable categories using the exact
wording shown in the account. No advertising, sale, profiling, credit use or
unrelated transfer occurs in this implementation.

Google explicitly includes on-device processing in its disclosure rules.
See the [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
and [privacy fields guide](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).

For Firefox's transmission declaration, the current manifest has
`data_collection_permissions.required: ["none"]`. It has no automatic data
transmission. User-clicked support and homepage links open external websites;
those sites have their own policies. Mozilla documents this declaration in
[its data-consent guide](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

## Images and video

All paths below are relative to the repository. The five screenshots and demo
were regenerated from the extension UI for 0.0.2. Promotional views use sample
text and mocked tab APIs; they are illustrative assets, not browser-test proof.

| Asset | File | Size |
| --- | --- | --- |
| Extension icon | `icons/icon-128.png` | 128 × 128 PNG |
| High score | `store/screenshot-1-saturated.png` | 1280 × 800 RGB PNG |
| Expanded signals | `store/screenshot-2-signals.png` | 1280 × 800 RGB PNG |
| Low score | `store/screenshot-3-clean.png` | 1280 × 800 RGB PNG |
| File scorer | `store/screenshot-4-file.png` | 1280 × 800 RGB PNG |
| Settings | `store/screenshot-5-settings.png` | 1280 × 800 RGB PNG |
| Demo | `store/promo.mp4` | 1280 × 800, about 22 seconds |
| README animation | `store/promo.gif` | 720 × 450 |
| Small promotional tile | Not created | 440 × 280 required for Chrome |
| Marquee tile | Not created | 1400 × 560 optional for Chrome |

Chrome requires an icon, a small promotional tile and at least one screenshot.
Its video field takes a YouTube URL, not an MP4 upload. The demo has not been
uploaded to YouTube. Check [image requirements](https://developer.chrome.com/docs/webstore/images)
and [listing fields](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
when submitting.

Regenerate assets with two terminals:

```sh
uv run --no-project tools/serve.py
```

```sh
node tools/capture.mjs shots
node tools/capture.mjs video
```

Requires Node with built-in WebSocket support, Chromium and ffmpeg. Review
all rendered assets after capture. Keep the Fenko palette, Saira typography
and claims consistent with the actual extension.

## Chrome Web Store submission

1. Create an item under the existing Fenko publisher account in the
   [developer dashboard](https://chrome.google.com/webstore/devconsole).
2. Upload the released ZIP and inspect the manifest validation results.
   The package contains compatibility fields for Firefox as well as Chrome;
   resolve any reported incompatibility in a new version, not by silently
   replacing the published ZIP.
3. Add the listing text, English locale, category, URLs and graphic assets.
   Create the missing 440 × 280 promotional tile first.
4. Fill in single purpose, permission explanations, remote-code declaration,
   data-use disclosures and the privacy-policy URL.
5. Choose the intended visibility and territories, review the account's
   outstanding requirements, and submit for review.
6. After approval, install the store-distributed build and verify page scanning,
   selection, PDF/text input, theme persistence, toolbar indicators, auto-scan
   opt-in and permission removal. Then add the real store URL to the Fenko page
   and README. Do not invent a store ID or claim approval before it exists.

No Chrome Web Store item ID or approved listing was created in this work.

## Firefox Add-ons submission

Current manifest identity:

```text
ID: {411dc062-62b1-4928-9713-6f0a2fc383de}
Minimum Firefox version: 128.0
Data transmission declaration: none
```

Keep the ID stable. Before submission, test the actual extension in Firefox,
including the background-script path, optional host permission flow, themes,
PDF parsing and storage behaviour. Chromium results do not cover these.

Submit through [AMO Developer Hub](https://addons.mozilla.org/developers/).
Choose a public listing if it should appear on AMO, or self-distribution if
only Mozilla signing is wanted. These are different distribution choices.
Complete validation, metadata, privacy details and reviewer notes, then retain
the signed XPI. The GitHub ZIP is currently unsigned.

The extension's own JavaScript is unbundled, but it includes minified pdf.js
6.3.289. Before AMO submission, document and verify that library's provenance
and provide the matching source/build material required by Mozilla. A reviewer
source package has not been prepared. Follow Mozilla's
[source requirements](https://extensionworkshop.com/documentation/publish/source-code-submission/)
and [submission procedure](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/).

Reviewer note:

```text
No login is required. On an ordinary English article, click the toolbar icon
to scan it. Select a passage before opening the popup to scan that selection.
Expand Signals to inspect matches. Score a file opens the local PDF/text page.

Auto-scan is off by default. Enable it in Settings to request site access;
disable it to request removal. Theme and toolbar preferences are device-local.
No analyzed content or results are uploaded.
```

## GitHub release procedure

The workflow in `.github/workflows/release.yml` publishes tags matching the
manifest version. It verifies the code, builds a ZIP and attaches `SHA256SUMS`.
A normal push to `main` does not publish a release.

For the next release, update `manifest.json`, finish review and commit the
change, then run the following from a clean checkout. Replace `0.0.3` if the
next agreed version differs.

```sh
./test/verify.sh
uv run --no-project tools/package.py /tmp/slop-lens-0.0.3.zip
git status --short --branch
git ls-remote origin refs/heads/main refs/tags/v0.0.3
git push origin main
git tag v0.0.3
git push origin v0.0.3
gh run list --repo FenkoHQ/slop-lens --workflow release.yml
```

Confirm the matching tag's workflow succeeds. Download the published assets
into a new directory and run `sha256sum -c SHA256SUMS` there. Compare the ZIP's
hash to the local build. Never overwrite a released tag or replace its archive
with different bytes; issue a new version.

The ZIP includes runtime files and public README/privacy/licence files.
Development notes, tests, tool configuration and store artwork are excluded.
GitHub's source archive retains the full tagged source tree.

## Fenko website publication

Website source: `/home/ali/fenko/fenko-www`, GitLab project `fenko/www`.

| File | Purpose |
| --- | --- |
| `content/english/slop-lens.md` | Tool page, installation and privacy summary |
| `config/_default/menus.en.toml` | `footer_tools` entry |
| `layouts/_default/free-tool.html` | Existing Fenko page styling for free-tool content |
| `static/images/slop-lens.png` | Current promotional screenshot |
| `CLAIMS.md` | Source and limits of public capability claims |

Run `npm run build` to include generated Open Graph assets. Publish reviewed
changes to GitLab `main`. Cloudflare Pages project `fenkowww` watches that
branch and runs the build; no manual container deployment is involved.

Verify the deployment's commit hash, then read the public page, homepage
footer, canonical URL and image. A successful build or Git push alone does
not establish that the page is live. Update claims and installation wording
when store distribution or browser coverage changes.

## Installing the current GitHub build

Chrome/Chromium/Edge: unzip the release, open `chrome://extensions`, enable
Developer mode, choose **Load unpacked**, then select the extracted directory.

Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
Add-on**, then select `manifest.json`. The unsigned temporary installation is
removed on restart. Store signing is a separate publication step.

GitHub builds do not update themselves. Download and load a newer release to
upgrade. Preserve the existing extracted directory when replacing its files
if retaining the unpacked installation's identity and settings matters.
