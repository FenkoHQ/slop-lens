# Privacy policy

**Slop Lens collects nothing, stores nothing, and sends nothing.**

## What the extension does with page content

When you click the toolbar icon, Slop Lens reads the text of the page in that
tab, scores it in memory, shows you the result, and forgets it. Nothing is
written to disk and nothing leaves the browser.

## What the extension does with files you give it

Files picked or dropped on the "Score a file" page are read in that tab,
scored, and discarded when the tab closes. They are not uploaded, copied or
stored. PDF parsing uses a bundled copy of pdf.js configured so that it makes
no network requests of its own.

## Data collected

None. Specifically:

- No analytics, telemetry, crash reporting or usage metrics.
- No accounts, logins or identifiers.
- No cookies or `localStorage`.
- No synced data. The two toolbar display preferences are kept in
  `storage.local`, which stays on the device; `storage.sync` is deliberately
  not used.
- The band and number last shown for a tab are held in `storage.session`, so
  that changing a setting can update tabs immediately. That area lives in
  memory, is never written to disk, and is discarded when the browser closes.
  It holds a band name and a number, never page content or URLs.
- No page content, URLs, titles or scores transmitted anywhere.
- No data sold, shared or disclosed to any third party, because none is
  collected in the first place.

## How that is enforced, not just promised

The extension requests **no host permissions**. Under Manifest V3 that means
it has no ability to make network requests to any site, and no ability to read
any page until you explicitly invoke it on that tab with the toolbar button.

The source contains no networking code at all. You can check:

```
grep -rE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|https?://" src/
```

That returns nothing but an SVG namespace declaration. Every asset, including
the typeface, is bundled in the package.

## Permissions and why each is needed

| Permission | Why |
| --- | --- |
| `activeTab` | Grants temporary read access to the one tab you invoke the extension on, and only for that invocation. This is what lets it see the article text to score. |
| `scripting` | Injects the analyzer into that tab so scoring runs locally in the page rather than on a server. |
| `<all_urls>` (optional) | Only requested if you turn on **Scan pages automatically**, and released when you turn it off. Lets a page be scored as it loads rather than on a click. |
| `storage` | Remembers three display preferences: whether the toolbar shows the slop number, and whether the icon is tinted. Device-local only. |

There is no `host_permissions` entry, so the extension has no standing access
to any site and cannot act on pages you have not asked it about.

## Changes

Any future version that collects data would require new permissions and a
visible update prompt. This policy will be updated before any such release.

## Contact

Raise an issue on the project repository.
