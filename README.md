# Socialfix

A personal, unpacked **Manifest V3** Chrome extension that adds the power-user
tools four major social sites leave out of their web clients — bulk
unfollow/unlike/unsave, feed cleanup, promoted-content filters, and
the keyboard shortcuts that should have shipped by default.

Every mutating action runs through **one shared, throttled queue** with
randomized delays and per-action daily budgets, so bulk operations stay within
each platform's safe rate limits. There is **no build step, no backend, and no
stored credentials** — it's vanilla JS loaded as content scripts that reuse
your existing logged-in session.

**Supported sites:** Instagram · YouTube · X (Twitter) · Reddit
*(each site's module loads only on that host).*

---

## Features at a glance

| Site | Feature | Type |
|---|---|---|
| **Instagram** | Shift-click instant unfollow / remove | DOM (rides IG's own dialog) |
| | "Doesn't follow you back" panel + bulk unfollow | Private API + queue |
| | Bigger Followers / Following modals (opt-in) | CSS/DOM |
| | Bulk unsave on the Saved page (multi-select) | Private API + queue |
| | Keyboard story navigation (`H` / `L` between users) | DOM |
| | See who dropped off your followers | Private API (read-only) |
| **YouTube** | Bulk-remove Watch Later / Liked videos | DOM automation + queue |
| | Keyboard gap-fills (`E`, `Shift+E`, `Shift+U`, `N`) | DOM |
| **X (Twitter)** | Bulk unlike your Likes (multi-select) | DOM + queue |
| | Unfollow people who don't follow you back | DOM + API follow-back check + queue |
| | Force the chronological Following feed | DOM (read-only) |
| | Hide promoted content | DOM (read-only) |
| | Keyboard shortcuts on the hovered tweet | DOM |
| **Reddit** | Bulk unsave (multi-select or all-loaded) | Legacy API + queue |
| | Hide promoted posts | DOM (read-only) |

Every toggle lives in `src/config.js`. The global `DRY_RUN` flag turns every
mutating action into a console log instead of a real write.

---

## Instagram

1. **Shift-click instant remove** — hold **Shift** and click a row's
   **Following** button (in any Following list) or **Remove** button (in any
   Followers list) to skip Instagram's confirmation dialog and act immediately.
   Works on every row. Plain clicks behave normally.
2. **"Doesn't follow you back" subsection** — open **your own** profile's
   Following list and a panel appears at the top showing everyone you follow who
   doesn't follow you back. Each has an instant **Unfollow** button, plus an
   **Unfollow all** button (throttled through the queue). The panel has a
   **▴ Hide / ▾ Show** toggle (same control as the Followers panel below).
3. **Bigger Followers/Following modals** — optionally widens the list modals so
   the native list and the injected subsections both fit comfortably. Widen-only
   (forcing a height on Instagram's virtualized list broke its rendering) and
   **off by default** — the injected panels are compact, internally-scrolling
   sections that already fit the native modal. Opt in with `BIGGER_MODALS` in
   `src/config.js`.
4. **Bulk unsave on the Saved page** — on your own Saved page, click **Select**
   to enter an inline multi-select mode over the post grid, tap the tiles you
   want, then **Unsave (n)** to remove them all through the throttled queue.
   Selection is tracked by post shortcode, so it survives the virtualized grid
   recycling nodes as you scroll. Works inside **All posts**
   (`/<you>/saved/all-posts/`) or any collection; the bare `/<you>/saved/`
   collections index has no post grid, so a one-time hint points you to
   "All posts". (Removal is always a full unsave — per-collection removal is
   mobile-app-only.)
5. **Keyboard story navigation** — while viewing a story, press **H** to jump to
   the **previous** user's story and **L** to jump to the **next** user's story.
   Unlike the arrow keys (which step one frame at a time), `H`/`L` skip any
   remaining frames of the current person and move a whole user at once. Ignored
   while you're typing (e.g. in the story reply box). Toggle with `STORY_NAV`.
6. **See who dropped off your followers** — open **your own** Followers list and
   a panel lists accounts that **no longer follow you**, each with the time it
   was first noticed. It snapshots your followers and diffs on later visits
   (re-scanning at most once every few hours), and never fabricates results from
   a partial/rate-limited read. Labeling is honest: a drop-off can be a real
   unfollow *or* a deactivated / banned / blocked / went-private account, so it
   never claims "unfollowed" as fact. Toggle with `SEE_UNFOLLOWERS`.

> Some once-planned features were removed because they're **impossible on the
> web platform** (not code bugs) — story reposting, per-collection unsave,
> carousel reorder, bio-link editing, and interactive link/poll story stickers.
> See `FEATURE_FEASIBILITY_REPORT.md` for the full analysis. The **enhanced
> story composer** (text/drawing stories) shipped for a while and was removed
> by user request (2026-08).

## YouTube

1. **Bulk-remove from Watch Later / Liked videos** — on
   `youtube.com/playlist?list=WL` (or `list=LL`), a **Select** toolbar appears
   above the playlist. Tap rows to select them (or **Select all**), then
   **Remove (n)**. Each removal clicks YouTube's own per-row ⋮ → "Remove from …"
   menu item through the shared queue, with deliberately slow **5–8 s** delays —
   YouTube processes deletions asynchronously and going faster makes videos
   reappear. Separate daily budgets per playlist; **Stop** anytime. Toggle with
   `YT.BULK_PLAYLIST`.
2. **Keyboard shortcut gap-fills** — YouTube already ships a large native
   shortcut set (`k`/`j`/`l` play-pause-seek, `f` fullscreen, `m` mute, `c`
   captions, arrow keys, `0–9` seek-to-percent, `Shift+N`/`Shift+P`
   next/previous video, and more), but has **no shortcut at all** for four
   everyday actions. On watch pages this adds exactly those four — and nothing
   that overlaps a native key: **E** toggles Like on the current video,
   **Shift+E** opens the Save-to-playlist dialog, **Shift+U** subscribes to the
   channel, and **N** jumps to and focuses the comment box. They never fire
   while you're typing in a text field, and are remappable in `YT.KEYS`. That's
   the whole feature — it fills the gaps YouTube's own shortcut set leaves.
   Toggle with `YT.SHORTCUTS`.

Both are pure DOM automation riding YouTube's own UI (no private API calls).
`DRY_RUN` applies: bulk removals log to the console instead of clicking.

## X (Twitter)

1. **Bulk unlike** — on your own **Likes** tab (`x.com/<you>/likes`), a floating
   toolbar with a **Select** mode: click tweets to pick exactly the ones you
   want gone (or **Select all** for everything loaded), then **Unlike (n)**
   clicks each native heart through the queue (1.5–3.5 s apart). Scroll to load
   more and keep selecting. Two-click confirm, **Stop** anytime. Toggle with
   `X.BULK_UNLIKE`.
2. **Unfollow people who don't follow you back** — on your own **Following**
   page (`x.com/<you>/following`), a floating **Non-followers** button opens a
   panel; **Scan** reads the currently-loaded rows from the DOM, checks
   follow-back in batches (the one surviving v1.1 API read), and lists the
   non-followers among them. Unfollow individually or **Unfollow all** — each
   unfollow clicks X's own Following button and confirmation, queued with
   conservative X-specific limits. Like bulk unlike, it works on **loaded
   rows**: scroll to load more, then rescan. Toggle with `X.BULK_UNFOLLOW`.
3. **Chronological Following feed** — on Home, auto-switches from the algorithmic
   "For You" tab to **Following** (and tries the Latest/Recent sort), once per
   visit so it won't fight you. Toggle with `X.CHRONO_FEED`.
4. **Hide promoted content** — read-only filter that removes promoted tweets and
   the Premium upsell. Nothing is sent to X. Toggle with `X.HIDE_PROMOTED`.
5. **Keyboard shortcuts** — act on the tweet **under your mouse** (X's native
   keys need keyboard focus): **E** like/unlike, **Shift+R** reply, **Shift+D**
   open full-res photo(s), **Shift+C** copy link. Toggle with `X.SHORTCUTS`.

Bulk unlike and bulk unfollow are DOM-driven — they click X's own buttons —
through `queue.js` with X-specific caps and their own daily budgets. The only
private-API call left is the read-only follow-back check (same-origin,
cookie-authed via the public web Bearer token — no per-user secret); X removed
its v1.1 friends-list endpoints in 2026, which is why the scan is DOM-based.
Feed, hide, and shortcuts are pure DOM (no API, no writes).

## Reddit

1. **Bulk unsave** — on your Saved page (old.reddit.com **or** new Reddit), a
   floating toolbar with two ways to run: **Select** to pick individual saved
   items (plus **Select all**), or **Unsave all loaded** to clear everything
   currently on screen. Both go through the throttled queue with a two-click
   confirm. The page is only used to read each item's id; the unsave itself
   goes through Reddit's own long-stable `/api/unsave` endpoint (session cookie
   + modhash), so it works the same on both designs. Unsaved items fade in
   place; scroll to load more, run again. Toggle with `REDDIT.BULK_UNSAVE`.
2. **Hide promoted posts** — read-only filter using Reddit's mandated "Promoted"
   label and the `shreddit-ad-post` element. Toggle with `REDDIT.HIDE_PROMOTED`.


---

## Install (load unpacked)

1. Go to `chrome://extensions`.
2. Toggle **Developer mode** (top-right) on.
3. Click **Load unpacked** and select this folder (`Socialfix`).
4. Open one of the supported sites, make sure you're logged in, and use the
   features above.

Publishing to the Chrome Web Store instead? See **`PUBLISHING.md`** for the
full submission guide (assets, listing copy, privacy answers, policy notes);
`./scripts/package.sh` builds the upload zip.

The toolbar popup is a compact **features & shortcuts cheat sheet** — one tab
per site listing every feature with how to trigger it and its keybinds (read
live from `src/config.js`, so they can't drift) — plus how many Instagram
unfollows you've done today (with a progress bar — other actions have their
own separate daily budgets) and a global **Stop** button for bulk runs.

---

## ⚠️ Account-safety notes (read this)

Social platforms **action-block** accounts that mutate too fast. For Instagram,
community testing puts the unfollow danger zone around **20–40 unfollows/hour**
and **~100–150/day**; a block typically lasts 24–48 hours. Every other platform
has its own limits, encoded in its `src/config.js` block.

To protect your account, all bulk actions are deliberately throttled through the
shared queue:

- **Randomized delays** between each action (e.g. 20–45 s for IG unfollow, 5–8 s
  for YouTube removals, 1.5–3.5 s for X unlikes).
- A **per-run cap** and a **per-day cap**, each action with its **own daily
  budget** persisted in `chrome.storage.local`.
- It **stops automatically** if the platform returns an action-block (IG 429 /
  `feedback_required`, X 429 / codes 88/326/64/261), and you can hit **Stop**
  anytime.

If a run is capped, just run it again later/tomorrow to continue.

### Test safely first

Open `src/config.js` and set `DRY_RUN: true`. In dry-run mode every mutating
action is **logged to the console instead of actually sent**, so you can verify
the UI and flow without touching your real account. Set it back to `false` for
real use. All throttle values, caps, labels, and the `DRY_RUN` flag live in
`src/config.js`.

---

## How it works

- **No build, no package manager, no backend.** Plain vanilla JS content scripts
  loaded directly. Syntax-check with `node --check src/<file>.js`.
- **One namespace, shared state.** Content scripts run in Chrome's isolated
  world and share one `window.BWI` object. Load order per host is fixed in
  `manifest.json` — each file only references `BWI.*` symbols defined earlier.
- **Same-origin private APIs, no auth code.** Where a private web API is used
  (Instagram `/api/v1/…`, X `/i/api/1.1/…`), calls are same-origin with
  `credentials: 'include'`, so your existing session cookies authenticate them
  automatically. There are no stored tokens.
- **Resilient selectors.** Nothing keys off a site's obfuscated CSS classes.
  Selectors match **ARIA roles**, **visible button text**, stable **URL shapes**
  (`a[href*="/p/"]`, `watch?v=`), and semantic custom-element tags (`ytd-*`).
  All visible-text labels are centralized in `src/config.js` (English; localize
  there), and the fragile private-API shapes live in `src/ig-api.js` / `src/x-api.js`.
- **One bulk path.** `src/queue.js` is the single throttled queue every bulk
  action flows through, enforcing delays, caps, and action-block detection. No
  feature bypasses it — account safety depends on this.
- **Every write is verified.** An action that clicks and assumes is the worst
  failure mode here: it would report success, spend the daily budget, and hide
  a rate-limit from the queue's stop-on-block. So each mutating action confirms
  the effect actually landed (the row disappears, the button flips *and stays
  flipped* — X reverts optimistic UI when it rejects a write; Instagram is
  asked whether the follow edge really changed) and fails loudly otherwise.

Runs **load-unpacked** for development, and is packaged for the **Chrome Web
Store** with `./scripts/package.sh` — see `PUBLISHING.md`. Mobile and Firefox
are out of scope.

---

## Project structure

```
manifest.json          MV3 manifest — per-host content_scripts + load order
popup.html / popup.js  toolbar popup: per-site feature/shortcut cheat sheet + IG daily counter + global Stop
                       (loads src/config.js so keybinds and caps come from one place)
styles.css             bwi-namespaced injected styles
icons/                 extension icons 16/32/48/128 (generated)
src/
  config.js            all tunables, toggles, labels, caps (+ BWI namespace)
  queue.js             shared throttled bulk-action queue (every platform)
  ui.js                shared DOM helpers, toasts, dialog/scroll utilities
  ig-api.js            Instagram private web API (friendships, media)
  feature1–5,7.js      Instagram features (see numbered list above)
  yt-bulk.js/yt-keys.js      YouTube
  x-api.js/x-*.js            X (Twitter)
  reddit-unsave.js/reddit-hide.js
scripts/
  package.sh           builds dist/socialfix-<version>.zip for the Web Store
  gen-icons.js         regenerates icons/ + the padded store-listing icon
  gen-promo.py         regenerates the store promo tiles
store-assets/          store-listing icon + promo tiles (generated)
```

See `CLAUDE.md` for the full architecture notes, `PRD.md` for the roadmap,
`PUBLISHING.md` for the Chrome Web Store submission guide, `PRIVACY.md` for the
privacy policy, and `FEATURE_FEASIBILITY_REPORT.md` for why certain features
were removed as platform-impossible rather than built.
