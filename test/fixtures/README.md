# Socialfix modal fixture (injected panels + collapse toggle)

Local, network-free stand-in for Instagram's Followers/Following modal so the
extension's **real** `styles.css`, `src/config.js` and `src/ui.js` can be
exercised in headless Chromium via `file://` — no extension loading, no login.
It builds the modal, injects the Feature 2 / Feature 7 panels exactly the way
`feature2.js` / `feature7.js` do (`ui.renderSubsection` /
`ui.renderListSubsection` + `ui.insertAboveList`), and exposes `window.__fx`
so the panel placement and the `▴ Hide` / `▾ Show` toggle contract can be
asserted. Everything the orchestrator needs is reachable from `window.__fx`
(see API below).

Files (all in this directory; `ig-modal.html` references the repo's `styles.css`/`src/*.js` by relative path):

| file | what |
|---|---|
| `ig-modal.html` | the page: dark overlay → `[role=dialog]` (transparent) → white 12px-radius card (400px wide, `max-height: calc(100vh - 40px)`, column flex, `overflow:hidden`) → 43px header with a `<div>` titled **Following**/**Followers** (+ a ✕ close button) → search row (`<input placeholder="Search">`) → **flex-row** list wrapper → `.ig-scroll` scroll container (inline `height:356px`, like Instagram's) with 60 rows (`<a href="/user_N/"><img></a><a href="/user_N/">user_N</a><button><div>Following</div></button>`). Loads, in order: `styles.css`, `config.js`, `ui.js`, `fixture.js` (scripts at the end of `<body>`). Neither `config.js` nor `ui.js` touches `chrome.*`, so no shim is needed. |
| `fixture.js` | builds the modal per query params, injects the real Feature 2 / Feature 7 panel, exposes `window.__fx`. Never catches errors. |
| `check.sh` | the checklist below as a PASS/FAIL runner over the gstack `browse` CLI (`bash check.sh`, or `bash check.sh A B` for sections). |

## Setup (gstack `browse`)

Fastest path: `bash <this dir>/check.sh` (all sections) or `bash check.sh A B`
— it prints PASS/FAIL per assertion and drops screenshots in `/tmp/bwi-fx`.
By hand:

```bash
B="$HOME/.claude/skills/gstack/browse/dist/browse"
FX=$(git rev-parse --show-toplevel)/test/fixtures    # this directory
mkdir -p /tmp/bwi-fx                       # screenshots must live under /tmp or cwd

$B viewport 1280x800
$B goto "file://$FX/ig-modal.html?title=following"
$B wait '.bwi-section__toggle'             # the panel is in (15s timeout → FAIL if it never appears)
$B js "await __fx.settle(200)"             # let layout land
$B console --errors                        # must be empty
$B js "__fx.errors.length"                 # must print 0
$B js "__fx.rects()"                       # geometry snapshot (JSON)
$B js "__fx.toggleState()"                 # the toggle's current state
$B screenshot /tmp/bwi-fx/following.png    # then Read the PNG to look at it
$B screenshot /tmp/bwi-fx/card.png --selector '#fx-card'
```

`$B js` prints the value; objects come back as JSON; a returned Promise is
awaited — but note browse wraps any code containing `await` in an async
block that needs an explicit `return` (`$B js "await x; return y"`; a lone
`await __fx.reopen()` expression is fine; `check.sh`'s `run_js` adds the
`return` for you).

## Variants (query params)

| param | values | effect |
|---|---|---|
| `title` | `following` (default) / `followers` | header text; `following` builds the Feature 2 panel (`renderSubsection`, 12 rows streamed via `addRow`, then `finish()` → "12 people don't follow you back"), `followers` builds the Feature 7 panel (`renderListSubsection("89 accounts no longer follow you", 12 users, {dataKey:"unfollowers", note})`). |
| `panel` | `1` (default) / `0` | inject the panel or not. |
| `rows` | int (60) | native rows (the 356px list should overflow). |
| `panelRows` | int (12) | fake users in the panel. |
| `panelDelay` | ms (0) | insert the panel this long AFTER the dialog (mimics Feature 2's async scan landing later). |

## `window.__fx` API

Getters (live — they change after `reopen()`): `card`, `scroll`, `dialog`,
`overlay`, `panelRoot`, `panelApi` (the object
`renderSubsection`/`renderListSubsection` returned — drive `addRow`,
`finish`, `showError`, `setProgress` by hand), `panelReady` (Promise), `params`.

| call | returns |
|---|---|
| `rects()` | `{viewport, dialog, card{x,y,w,h,classes}, scroll{…,scrollHeight,clientHeight,scrollTop,overflowY,inlineHeight,rowsMounted}, panel{…,collapsed,rows,listMaxHeight,listHeight,aboveList,insideCard}}` (`panel` is `null` with `panel=0`) |
| `toggleState()` | `{present, glyph, label, caretText, ariaExpanded, collapsed, listDisplay, listVisible, progressDisplay, caretTransform, glyphTransform, labelTransform, title, buttonTitle, panelHeight}` for the panel's `.bwi-section__toggle` |
| `clickToggle()` | clicks the toggle, returns `toggleState()` |
| `reopen(overrides?, opts?)` → Promise | tears the modal down and builds a NEW `[role=dialog]` (like closing/reopening Instagram's modal), optionally with changed params, e.g. `reopen({title:'followers'})`; resolves to `rects()` after settle (default 300ms) |
| `settle(ms?)` / `nextFrame()` | Promise helpers (2 rAF + `ms`, default 30) |
| `setBadge()` | refreshes the on-screen variant badge (bottom-left) for screenshots |
| `errors` | array of `window.onerror` + `unhandledrejection` records (they still reach the console) |
| `ROW_H` 60, `LIST_H` 356 | constants |

## Checklist (what `check.sh` asserts, and why)

Numbers assume viewport **1280x800** and the default 12-row panel.

### A. `?title=following` (Feature 2 panel)
1. `panelRoot.dataset.bwi === 'subsection'`, inside the card, 12 `.bwi-row`.
2. `rects().panel.aboveList` (panel above, not beside, the list — `insertAboveList` climbed past the flex-row wrapper) and the native list still overflows.
3. `finish()` rewrote the title to "12 people don't follow you back" and the progress line is hidden.
4. The panel's `.bwi-list` is bounded (`min(32vh, 240px)` → ≤ 240px here) and internally scrolling.
5. **Toggle expanded** — `toggleState()`: `glyph '▴'`, `label 'Hide'`, `ariaExpanded 'true'`, `collapsed false`, `listDisplay !== 'none'`. Screenshot.
6. `clickToggle()` → `glyph '▾'`, `label 'Show'`, `ariaExpanded 'false'`, `collapsed true`, `listDisplay 'none'`, and `caretTransform/glyphTransform/labelTransform === 'none'` (regression: the old CSS rotated the caret and turned "Show" sideways). Screenshot.
7. `clickToggle()` again → back to ▴ Hide / true.
8. Collapsing actually frees space (the panel is >50px shorter while collapsed; expanding restores the height).
9. `reopen()` → a fresh dialog gets a fresh panel above its list, toggle expanded.
10. **Idle** — a MutationObserver on the card counts < 20 records over 500ms (no observer feedback loop); `__fx.errors.length === 0`; `$B console --errors` empty.

### B. `?title=followers` (Feature 7 panel)
`panelRoot.dataset.bwi === 'unfollowers'`, `.bwi-section__note` present, 12 `.bwi-row`, `panel.aboveList`; the title is the caller's text; same toggle contract (▴ Hide → ▾ Show collapsed, nothing transformed → ▴ Hide). Screenshot; idle + no errors.

### C. `?panelDelay=400`
The panel arrives after the dialog exists (Feature 2's scan is async) and must still land above the list, inside the card; toggle contract holds; idle + no errors.

### D. `?panel=0`
`rects().panel === null` and there is no `bwi-` markup or `[data-bwi]` anywhere in the card (ui.js injects nothing on its own); the native list is intact (60 rows, `356px`, overflows); idle + no errors.

## Gotchas
- **`$B wait` needs a visible element.** `.bwi-section__toggle` is a real button, so it counts; if it times out the panel wasn't injected — check `$B console --errors` and `__fx.errors`.
- The fixture never swallows errors: any throw from ui.js shows in `$B console` and in `__fx.errors`.
- `panel=0` has no toggle to wait for — `check.sh` opens that variant with `open "panel=0" nowait`.
- The fixture is **not shipped**: `scripts/package.sh` zips only the runtime paths.
