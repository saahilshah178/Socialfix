# Socialfix modal fixtures (feature3 resize + panel toggle)

Local, network-free stand-in for Instagram's Followers/Following modal so the
extension's **real** `styles.css`, `src/config.js`, `src/ui.js` and
`src/feature3.js` can be exercised in headless Chromium via `file://` — no
extension loading, no login. Everything the orchestrator needs is reachable
from `window.__fx` (see API below).

Files (all in this directory; `ig-modal.html` references the repo's `styles.css`/`src/*.js` by relative path):

| file | what |
|---|---|
| `ig-modal.html` | the page: dark overlay → `[role=dialog]` (transparent) → white 12px-radius card (400px wide, `max-height: calc(100vh - 40px)`, column flex, `overflow:hidden`) → 43px header with a `<div>` titled **Following**/**Followers** (+ a ✕ close button) → search row (`<input placeholder="Search">`) → **flex-row** list wrapper → `.ig-scroll` scroll container with 60 rows (`<a href="/user_N/"><img></a><a href="/user_N/">user_N</a><button><div>Following</div></button>`). Loads, in order: `styles.css`, `chrome-shim.js`, `config.js`, `ui.js`, `feature3.js`, `fixture.js` (scripts at the end of `<body>` — feature3 observes `document.body` at load, like a document_idle content script). |
| `chrome-shim.js` | `window.chrome.{storage.local (get/set/remove/clear, Promise + callback forms, backed by ONE JSON blob in localStorage), storage.onChanged, runtime.{getManifest,id,onMessage,lastError}, tabs.{query,sendMessage}}`. `__bwiResetStorage()`, `__bwiStorageDump()`, `__bwiStorageLog`. |
| `fixture.js` | builds the modal per query params, injects the real Feature 2 / Feature 7 panel with `BWI.ui.renderSubsection` / `renderListSubsection` + `ui.insertAboveList`, exposes `window.__fx`. Never catches errors. |
| `check.sh` | the checklist below as a PASS/FAIL runner over the gstack `browse` CLI (`bash check.sh`, or `bash check.sh A D` for sections). |

## Setup (gstack `browse`)

Fastest path: `bash <this dir>/check.sh` (all sections) or `bash check.sh A D`
— it prints PASS/FAIL per assertion and drops screenshots in `/tmp/bwi-fx`.
By hand:

```bash
B="$HOME/.claude/skills/gstack/browse/dist/browse"
FX=$(git rev-parse --show-toplevel)/test/fixtures    # this directory
mkdir -p /tmp/bwi-fx                       # screenshots must live under /tmp or cwd

$B viewport 1280x1100                      # tall enough that feature3's 95vh clamp never bites (see Gotchas)
$B goto "file://$FX/ig-modal.html?mode=fixed"
$B wait '.bwi-resize-layer'                # feature3 attached (15s timeout → FAIL if it never appears)
$B js "await __fx.settle(300)"             # let the first scan/apply land
$B console --errors                        # must be empty
$B js "__fx.errors.length"                 # must print 0
$B js "__fx.rects()"                       # geometry snapshot (JSON)
$B screenshot /tmp/bwi-fx/fixed.png        # then Read the PNG to look at it
$B screenshot /tmp/bwi-fx/card.png --selector '#fx-card'
```

`$B js` prints the value; objects come back as JSON; a returned Promise is
awaited — but note browse wraps any code containing `await` in an async
block that needs an explicit `return` (`$B js "await x; return y"`; a lone
`await __fx.drag(...)` expression is fine; `check.sh`'s `run_js` adds the
`return` for you), so
`$B js "await __fx.drag('se',60,40)"` works as-is. If `$B viewport` complains
before any page is open, run it again right after the first `goto` — and verify
with `$B js "__fx.viewportInfo()"` (`innerHeight` must be 1100 for section A's
numbers).

Start every variant with a clean store unless you are testing persistence:
`$B js "__fx.resetStorage(); true"` then `$B goto` the URL again (localStorage on
`file://` persists across reloads, which is exactly what the persistence checks
rely on).

## Variants (query params)

| param | values | effect |
|---|---|---|
| `mode` | `fixed` (default) | `.ig-scroll` has inline `height:356px` (Instagram's fixed-height list) → feature3 must grow it itself ("fixed"). |
| | `flex` | no inline height; the card is `height:500px`, wrapper + scroll `flex:1 1 auto; min-height:0` → the list follows the card ("flex"). |
| | `window` | react-window shape: inline `height:356px`, a 3600px spacer, rows `position:absolute` — but only the rows in a fixed 480px band from `scrollTop` are ever mounted (8 rows), whatever the container's height. Grow it and the bottom stays blank → feature3 must roll back ("none"). |
| | `clip` | like `fixed`, but the scroll container sits in a 356px `overflow:hidden` flex-row wrapper (`.fx-clip`) → a grown list is clipped by an ancestor → rollback ("none"). |
| `title` | `following` (default) / `followers` | header text; `following` builds the Feature 2 panel (`renderSubsection`, 12 rows streamed via `addRow`, then `finish()` → "12 people don't follow you back"), `followers` builds the Feature 7 panel (`renderListSubsection("89 accounts no longer follow you", 12 users, {dataKey:"unfollowers", note})`). |
| `panel` | `1` (default) / `0` | inject the panel or not. |
| `centered` | `1` (default) / `0` | `0` pins the card top-left (`padding:40px`) → drag factor 1× instead of 2×. |
| `rows` | int (60) | native rows — must overflow the 356px list (feature3 needs `scrollHeight > clientHeight + 20`). |
| `panelRows` | int (12) | fake users in the panel. |
| `panelDelay` | ms (0) | insert the panel this long AFTER the dialog (mimics Feature 2's async scan landing after feature3 attached). |
| `cardpos` | `static` (default) / `relative` | the fixture card is deliberately `position:static`; feature3 must set `position:relative` itself so its `inset:0` handle layer anchors to the card. `relative` opts out of that test. |

## `window.__fx` API

Getters (live — they change after `reopen()`): `card`, `scroll`, `dialog`,
`overlay`, `clip` (mode=clip only), `panelRoot`, `panelApi` (the object
`renderSubsection`/`renderListSubsection` returned — drive `addRow`,
`finish`, `showError`, `setProgress` by hand), `panelReady` (Promise), `params`.

| call | returns |
|---|---|
| `rects()` | `{viewport, dialog, card{x,y,w,h,inlineWidth,inlineWidthPriority,inlineHeight,inlineHeightPriority,position,maxHeight,listMax (--bwi-list-max),classes}, scroll{…,scrollHeight,clientHeight,scrollTop,overflowY,inlineHeight,inlineHeightPriority,rowsMounted,lastRowBottomInScroll,emptyBandPx,coveredToBottom}, clip, panel{…,collapsed,listMaxHeight,listHeight,aboveList}, resize{layer,layerRect,handles,handleDirs,resizable,bigCard,widthOnly,bodyResizing}, storedSize}` |
| `toggleState()` | `{present, glyph, label, caretText, ariaExpanded, collapsed, listDisplay, listVisible, progressDisplay, caretTransform, glyphTransform, labelTransform, title, buttonTitle, panelHeight}` for the panel's `.bwi-section__toggle` |
| `clickToggle()` | clicks the toggle, returns `toggleState()` |
| `drag(dir, dx, dy, opts?)` → Promise | pointerdown at the `.bwi-resize-handle--{dir}` center, `steps` (6) pointermoves one frame apart, pointerup — all `PointerEvent`s dispatched ON the handle (`pointerId 1`, `button 0`, `buttons 1`, `bubbles`, `cancelable`, `isPrimary`, `pointerType mouse`, so window-capture listeners and a `setPointerCapture(1)` both behave). Waits `opts.settleMs` (default **1200** — feature3 verifies the grown list at ~800ms and saves after a 250ms debounce; use `{settleMs:50}` for the raw size only). Returns `{dir,dx,dy,steps,via,from,to,handleRect,duringDown{bodyResizing,cursor},expectedDragFactor,before,after,delta{cardW,cardH,scrollH,scrollClientH,panelListH},storedSize}`. Throws if the handle is missing or has no box (hidden). `opts.mouse:true` sends `MouseEvent`s instead. |
| `dblclickHandle(dir, opts?)` → Promise | dispatches `dblclick` on the handle; `{dir,before,after,storedSize}` (settle 300ms) |
| `reopen(overrides?, opts?)` → Promise | tears the modal down and builds a NEW `[role=dialog]` (like closing/reopening Instagram's modal), optionally with changed params, e.g. `reopen({mode:'flex'})`; resolves to `rects()` after settle (default 1200ms) |
| `resetSize(opts?)` → Promise | `BWI.modalResize.reset()` then `rects()` |
| `state()` | `{available, state}` — `BWI.modalResize.stateFor(dialog)` with DOM nodes made printable |
| `viewportInfo()` / `setViewportInfo()` | `{innerWidth, innerHeight, dpr, params, cardCenteredX, cardCenteredY, expectedDragFactor{x,y}}`; the `set…` variant also refreshes the on-screen badge (bottom-left) for screenshots |
| `scrollList(top)` → Promise | sets `scroll.scrollTop` (mode=window remounts rows), returns `rects().scroll` |
| `settle(ms?)` / `nextFrame()` | Promise helpers (2 rAF + `ms`, default 30) |
| `storage()` / `storedSize()` / `resetStorage()` | chrome.storage dump / the `bwi_modal_size` value / wipe |
| `errors` | array of `window.onerror` + `unhandledrejection` records (they still reach the console) |
| `ROW_H` 60, `LIST_H` 356, `WINDOW_BAND` 480, `FLEX_CARD_H` 500 | constants |

## Checklist (what `check.sh` asserts, and why)

Numbers assume viewport **1280x1100** and the default 12-row panel. `≈` means ±2px.

### A. `?mode=fixed` (title=following, centered)
1. **Attach** — `rects().resize`: `layer` true, `handles` 8 with `handleDirs` = n s e w ne nw se sw, card has `bwi-big-card` + `bwi-resizable`.
2. **Layer anchoring** — `card.lastElementChild` is `.bwi-resize-layer[data-bwi=resize]` and `layerRect` == card rect (±1). If the layer's rect is the whole viewport, feature3 forgot to make the card a containing block.
3. `rects().card.position !== 'static'` (fixture leaves the card static on purpose).
4. Native list still detected (`scroll.scrollHeight > clientHeight+20`) and `panel.aboveList` (panel above, not beside, the list — `insertAboveList` climbed past the flex-row wrapper).
5. **Toggle expanded** — `toggleState()`: `glyph '▴'`, `label 'Hide'`, `ariaExpanded 'true'`, `collapsed false`, `listDisplay !== 'none'`.
6. `clickToggle()` → `glyph '▾'`, `label 'Show'`, `ariaExpanded 'false'`, `collapsed true`, `listDisplay 'none'`, and `caretTransform/glyphTransform/labelTransform === 'none'` (regression: the old CSS rotated the caret and turned "Show" sideways). Screenshot.
7. `clickToggle()` again → back to ▴ Hide / true.
8. **Drag se (+60,+40), centered** — `delta.cardW ≈ 120`, `delta.cardH ≈ 80` (2× on a centered axis), `after.card.inlineWidthPriority/inlineHeightPriority === 'important'`, `storedSize` = `{w,h}` equal to the card's rendered size (persisted under `bwi_modal_size`).
9. **fixed mode** — `after.scroll.inlineHeight` is set and ≠ `356px`; `delta.scrollH > 0` and `delta.panelListH > 0` (feature3 hands the panel 40% of the height beyond the natural layout via `--bwi-list-max`, the list gets the rest) and `after.scroll.bottom <= after.card.bottom + 1` (nothing spills past the card).
10. `rects().card.listMax !== ''` (`--bwi-list-max` set on the card).
11. During the press `document.body` had `bwi-resizing` + `data-bwi-cursor`; after pointerup both are gone (`duringDown` vs `after.resize.bodyResizing`).
12. Drag n (0,−40) → height +80, width unchanged. 13. Drag w (−50,0) → width +100, height unchanged.
14. **Shrink** — drag se (−30,−20) → −60 × −40 (negative deltas; the card stays taller than its content).
15. **dblclick reset** — `dblclickHandle('se')` → card back to 400 × natural height (compare with a `rects().card` taken before any drag), `inlineWidth/inlineHeight === ''`.
16. `storedSize()` is `null/undefined` after the reset.
17. **Persist → next dialog** — drag se (+40,+30) then `await __fx.reopen()` → the new dialog's card has the stored size and a layer.
18. **Persist → reload** — `$B goto` the same URL again, `wait '.bwi-resize-layer'`, `rects()`: `card.w/h ≈ storedSize.w/h`. Screenshot.
19. `await __fx.resetSize()` (`BWI.modalResize.reset()`) → 400 wide, `inlineWidth ''`, `storedSize` gone.
20. **Idle** — a MutationObserver on the card counts < 20 records over 500ms (no observer feedback loop); `__fx.errors.length === 0`; `$B console --errors` empty.
21. **Min size WITH the panel — run this LAST in the session.** `drag('nw',800,800,{settleMs:50})` → width clamps to 320 immediately; the stored `h` is 300 but the rendered card is floored at header + search + panel + 120px list (~390 with the 12-row panel expanded) so the list never hangs below the card (`scroll.bottom <= card.bottom + 1`). Wait 1.5s: still NOT width-only (a card floored at its own content is not Instagram clipping the list) and `storedSize().h === 300`. Collapse the panel (`clickToggle()`) and the card drops to 300.

### B. `?mode=fixed&centered=0`
`viewportInfo()` says not centered on either axis; drag se (+60,+40) → +60 × +40; drag nw (−30,−20) → +30 × +20 (1× factor).

### C. `?mode=flex`
1. Attach; `scroll.inlineHeight === ''` and the list overflows. 2. Drag s (0,+90) → cardH +180 and `delta.scrollH + delta.panelListH ≈ 180` (the list flexed, panel took its share). 3. `after.scroll.inlineHeight === ''` still (feature3 never wrote a list height) and `state().state.mode === 'flex'`. 4. No `bwi-resize--width-only`, vertical handles visible.

### D. `?mode=window&panel=0` (windowing symptom → rollback)
1. Fixture sanity: `rowsMounted 8`, `scrollHeight >= 3600`. 2. Drag s (0,+150) with `{settleMs:1500}` (verify fires ~800ms after the drag): `after.resize.widthOnly` true, card height back to `before.card.h`, `scroll.inlineHeight === '356px'` (Instagram's own inline height restored), `card.inlineHeight === ''`, and never a blank band (`coveredToBottom || emptyBandPx <= 60`). If the vertical handle is already `display:none` when you get there (detection happened at attach), assert `widthOnly` directly. 3. n/s/ne/nw/sw handles `display:none`. 4. Drag e (+50,0) still → +100 wide, height unchanged. 5. `storedSize()` keeps `h` but with `hBlocked: true` (not re-applied on the next load; a new vertical drag after a reload retries and clears it). 6. `reopen()` → width restored, natural height, list still `356px`.
`?mode=window` WITH the panel (D7): drag s (0,+100) → either rolled back or the 8-row band still covers the list (`emptyBandPx <= 60`) — the invariant is "no blank band", not "always rollback" (a small growth is legitimately covered).
Why `panel=0` and +150 for the strong case: feature3 flags windowing when the last mounted row ends >60px above the list bottom, so the list must exceed 540px; with the panel taking 40% of the growth and the 95vh clamp, +150 without a panel is the clean way to get there.

### E. `?mode=clip` (clipping symptom → rollback)
1. `rects().clip.h ≈ 356`. 2. Drag s (0,+50) `{settleMs:1500}` → `widthOnly`, `scroll.inlineHeight '356px'`, card height back to natural. 3. `scroll.bottom <= clip.bottom + 1` (nothing sticks out under the clipping ancestor). 4. Drag e (+50,0) → +100 (the card's height is Instagram's own again — it may change as the wider panel note reflows).

### F. `?title=followers`
`panelRoot.dataset.bwi === 'unfollowers'`, `.bwi-section__note` present, 12 `.bwi-row`, `panel.aboveList`; same toggle contract (▴ Hide → ▾ Show collapsed → ▴ Hide); dialog titled **Followers** is resizable (drag se +30,+20 → +60 × +40).

### G. `?panel=0`
1. Attach with `rects().panel === null`. 2. Drag se (+60,+40) → +120 × +80 and `delta.scrollH ≈ 80` (no panel share). 3. **Min size (clean case)** — drag nw (+800,+800) → clamps to 320×300 (`MODAL_MIN_WIDTH_PX/HEIGHT_PX`), stays height-resizable (`!widthOnly`) and `scroll.bottom <= card.bottom` (300 − 43 − 52 = 205 ≥ `MIN_LIST_PX`, so the list fits). 4. dblclick → natural 400 × 451 (43 + 52 + 356).

### Extras worth a look (not in check.sh)
- `?cardpos=relative` — same as A; confirms feature3 doesn't fight an already-positioned card.
- `?panelDelay=800` — the panel arrives after feature3 attached; in fixed mode a later `syncListHeight` must absorb it (list shrinks, panel above it, `rects().panel.aboveList`).
- `?mode=clip&panel=0`, `?mode=window&title=followers`, `?rows=15` (list barely overflows).
- Collapse the panel then drag: in fixed mode the list should take the freed space on the next scan (`rects().scroll.h` grows when `clickToggle()` collapses).
- Screenshots: `$B screenshot /tmp/bwi-fx/x.png` (viewport) or `--selector '#fx-card'`; then **Read** the PNG.

## Gotchas
- **Timing.** feature3 applies on rAF, verifies the grown list ~800ms after a drag (that's when window/clip rollback happens) and persists `bwi_modal_size` after a 250ms debounce. `drag()`/`reopen()` default to a 1200ms settle for that reason; use `{settleMs:1500}` for the rollback assertions and `{settleMs:50}` if you only care about the immediate size.
- **Clamps.** feature3 clamps width to 95vw and height to 95vh — cumulative vertical drags in section A need the 1280x1100 viewport (12-row panel + 356 list ≈ 750px natural card). At 1280x720 the card is already at its max and height assertions will fail for the wrong reason.
- **300ms click swallow.** feature3 swallows the first `click` within 300ms after a drag ends (so a release over the backdrop can't close the modal). Don't `clickToggle()` inside that window (`drag()` already waits longer by default).
- **Double-press.** Two `pointerdown`s on the same handle within 400ms and <4px apart count as a reset — don't `drag()` the same handle twice back-to-back with `{settleMs:0}`.
- **Storage.** `chrome.storage.local` is a JSON blob in `localStorage` for the `file://` origin — it persists across `$B goto`s of any fixture URL. `__fx.resetStorage()` (or `__bwiResetStorage()`) wipes it; do that (then reload) before any section that assumes the natural size.
- **Layer visibility.** `$B wait '.bwi-resize-layer'` waits for a *visible* element; the layer is transparent but has a box, so it counts. If it times out, feature3 didn't attach — check `$B console --errors`, `BWI.config.RESIZABLE_MODALS`, and `__fx.rects().scroll` (the fixture list must overflow: `scrollHeight > clientHeight + 20`).
- The fixture never swallows errors: any throw from feature3/ui shows in `$B console` and in `__fx.errors`.
