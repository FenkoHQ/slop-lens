# Privacy policy

Slop Lens is a free, open-source Fenko Security extension. It scores text on
your device. It has no analytics, telemetry, accounts or scoring service.

## Page content and files

Clicking the toolbar icon reads the current page or your selection. Optional
auto-scan reads pages as they load, after you grant site access. Analysis runs
in the browser; page content, URLs and results are not uploaded.

PDF, text and Markdown files you choose are read in the file-scoring tab.
PDF parsing uses bundled pdf.js. Files are not uploaded or saved by the
extension. Closing the tab discards its file and analysis.

## Local storage

Theme, toolbar and auto-scan preferences use `storage.local`. They stay on
this device and are not synced through your browser account.

The last band and score for each scanned tab use `storage.session`, keyed by
tab ID. This holds no page text or URLs and is cleared when the browser
session ends. Browsers without session storage do not retain those readings.

## Permissions

| Permission | Purpose |
| --- | --- |
| `activeTab` | Access the tab when you invoke the extension. |
| `scripting` | Extract page text and show highlights in that tab. |
| `offscreen` | Host local scoring workers in Chrome so scans can be stopped without blocking the page. |
| `storage` | Save device-local preferences and temporary readings. |
| `<all_urls>` (optional) | Read pages for auto-scan. Requested when enabled; the extension requests removal when disabled. |

There are no required host permissions. Auto-scan is off on installation.
Browser restrictions still prevent scanning protected pages.

## Network activity

The analyzer has no network calls. Fonts, rules and PDF parsing code ship
inside the extension. This is an implementation property, not a guarantee
that browser permissions prohibit every possible network request.

Fenko, privacy, source and support links open external websites only when
clicked. Those visits are subject to the destination site's privacy policy.
They do not send the page being scored or its results.

## Changes and contact

Policy changes will be recorded here alongside the source. Browser permission
prompts alone do not guarantee notice of every possible data-handling change.

Report issues at [FenkoHQ/slop-lens](https://github.com/FenkoHQ/slop-lens/issues).
