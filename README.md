# Better Web Insta (Socialfix)

A personal, unpacked **Manifest V3** Chrome extension that adds the power-user
tools six major social sites leave out of their web clients — bulk
unfollow/unlike/unsave/withdraw, feed cleanup, promoted-content filters, and
the keyboard shortcuts that should have shipped by default.

Every mutating action runs through **one shared, throttled queue** with
randomized delays and per-action daily budgets, so bulk operations stay within
each platform's safe rate limits. There is **no build step, no backend, and no
stored credentials** — it's vanilla JS loaded as content scripts that reuse
your existing logged-in session.

**Supported sites:** Instagram · YouTube · X (Twitter) · Reddit · LinkedIn · TikTok
*(each site's module loads only on that host).*

---

## Features at a glance

| Site | Feature | Type |
|---|---|---|
| **Instagram** | Shift-click instant unfollow / remove | DOM (rides IG's own dialog) |
| | "Doesn't follow you back" panel + bulk unfollow | Private API + queue |
| | Bigger Followers / Following modals | CSS/DOM |
| | Bulk unsave on the Saved page (multi-select) | Private API + queue |
| | Keyboard story navigation (`H` / `L` between users) | DOM |
| | See who dropped off your followers | Private API (read-only) |
| | Enhanced story composer (text + drawing + fit/fill) | Private write API + queue |
| **YouTube** | Bulk-remove Watch Later / Liked videos | DOM automation + queue |
| | Keyboard gap-fills (`E`, `Shift+E`, `Shift+U`, `N`) | DOM |
| **X (Twitter)** | Bulk unlike your Likes | DOM + queue |
| | Unfollow people who don't follow you back | Private API + queue |
| | Force the chronological Following feed | DOM (read-only) |
| | Hide promoted content | DOM (read-only) |
| | Keyboard shortcuts on the hovered tweet | DOM |
| **Reddit** | Bulk unsave | DOM + queue |
| | Hide promoted posts | DOM (read-only) |
| **LinkedIn** | Bulk-withdraw sent invitations | DOM + queue |
| | Hide promoted content | DOM (read-only) |
| **TikTok** | Bulk remove from Liked / Favorites | DOM + queue |

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
   **Unfollow all** button (throttled through the queue).
3. **Bigger Followers/Following modals** — the list modals are widened and
   heightened so the native list and the injected subsections both fit
   comfortably. Toggle with `BIGGER_MODALS` in `src/config.js`.
4. **Bulk unsave on the Saved page** — on your own Saved page, click **Select**
   to enter an inline multi-select mode over the post grid, tap the tiles you
   want, then **Unsave (n)** to remove them all through the throttled queue.
   Selection is tracked by post shortcode, so it survives the virtualized grid
   recycling nodes as you scroll.
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
7. **Enhanced story composer** — the **＋ Enhanced story** button opens a canvas
   composer with movable **text**, freehand **drawing**, and **fit/fill**
   background control. Everything is rasterized into the image and posted through
   the private story-upload API, with its own low daily budget. Toggle with
   `STORY_CREATE_TOOLS`.

> ⚠️ The story composer drives Instagram's undocumented private **write**
> endpoint. **Set `DRY_RUN: true` in `src/config.js` and confirm the logged
> payload first** before trusting the live call.
>
> Some once-planned features were removed because they're **impossible on the
> web platform** (not code bugs) — story reposting, per-collection unsave,
> carousel reorder, bio-link editing, and interactive link/poll story stickers.
> See `FEATURE_FEASIBILITY_REPORT.md` for the full analysis and what *is* worth
> building next.

## YouTube

1. **Bulk-remove from Watch Later / Liked videos** — on
   `youtube.com/playlist?list=WL` (or `list=LL`), a **Select** toolbar appears
   above the playlist. Tap rows to select them (or **Select all**), then
   **Remove (n)**. Each removal clicks YouTube's own per-row ⋮ → "Remove from …"
   menu item through the shared queue, with deliberately slow **5–8 s** delays —
   YouTube processes deletions asynchronously and going faster makes videos
   reappear. Separate daily budgets per playlist; **Stop** anytime. Toggle with
   `YT.BULK_PLAYLIST`.
2. **Keyboard shortcut gap-fills** — on watch pages, the shortcuts YouTube's big
   native set omits: **E** toggles Like, **Shift+E** opens Save-to-playlist,
   **Shift+U** subscribes, **N** jumps to the comment box. Keys avoid every
   native binding, never fire while typing, and are remappable in `YT.KEYS`.
   Toggle with `YT.SHORTCUTS`.

Both are pure DOM automation riding YouTube's own UI (no private API calls).
`DRY_RUN` applies: bulk removals log to the console instead of clicking.

## X (Twitter)

1. **Bulk unlike** — on your own **Likes** tab (`x.com/<you>/likes`), a floating
   toolbar shows **Unlike loaded (n)**. It unlikes the currently-loaded tweets
   by clicking each native heart through the queue (1.5–3.5 s apart); scroll to
   load more and run again. Two-click confirm, **Stop** anytime. Toggle with
   `X.BULK_UNLIKE`.
2. **Unfollow people who don't follow you back** — a floating **Non-followers**
   button opens a panel; **Scan** paginates your following and checks follow-back
   in batches, then lists everyone who doesn't follow you. Unfollow individually
   or **Unfollow all**, queued with conservative X-specific limits. Toggle with
   `X.BULK_UNFOLLOW`.
3. **Chronological Following feed** — on Home, auto-switches from the algorithmic
   "For You" tab to **Following** (and tries the Latest/Recent sort), once per
   visit so it won't fight you. Toggle with `X.CHRONO_FEED`.
4. **Hide promoted content** — read-only filter that removes promoted tweets and
   the Premium upsell. Nothing is sent to X. Toggle with `X.HIDE_PROMOTED`.
5. **Keyboard shortcuts** — act on the tweet **under your mouse** (X's native
   keys need keyboard focus): **E** like/unlike, **Shift+R** reply, **Shift+D**
   open full-res photo(s), **Shift+C** copy link. Toggle with `X.SHORTCUTS`.

Bulk unlike/unfollow use the private web API (same-origin, cookie-authed via the
public web Bearer token — no per-user secret) through `queue.js` with
X-specific caps and their own daily budgets. Feed, hide, and shortcuts are pure
DOM (no API, no writes).

## Reddit

1. **Bulk unsave** — on your Saved page (best on **old.reddit.com/prefs/saved**;
   new/shreddit Reddit supported best-effort via shadow-DOM piercing), a floating
   toolbar unsaves the currently-loaded items through the queue. Scroll to load
   more, run again. Toggle with `REDDIT.BULK_UNSAVE`.
2. **Hide promoted posts** — read-only filter using Reddit's mandated "Promoted"
   label and the `shreddit-ad-post` element. Toggle with `REDDIT.HIDE_PROMOTED`.

## LinkedIn

1. **Bulk-withdraw sent invitations** — on
   **linkedin.com/mynetwork/invitation-manage/sent/**, a toolbar withdraws your
   pending invites one at a time (Withdraw → confirm popover), through the queue
   with **deliberately slow, low caps** — LinkedIn flags activity bursts. It
   **stops immediately** if any restriction/CAPTCHA banner appears. Toggle with
   `LINKEDIN.WITHDRAW_INVITES`. *Try `DRY_RUN: true` first.*
2. **Hide promoted content** — read-only filter with robust text matching that
   defeats LinkedIn's zero-width-character obfuscation of the "Promoted" label.
   Fragile by nature — expect occasional label upkeep. Toggle with
   `LINKEDIN.HIDE_PROMOTED`.

## TikTok

1. **Bulk remove from Liked / Favorites** — on your own profile's **Liked** or
   **Favorites** tab, a toolbar removes the loaded videos: for each, it opens
   the video, clicks the like/favorite toggle off, and closes — through the
   queue. Pure DOM (no private API / no request-signing), so it's robust against
   TikTok's anti-automation. Toggle with `TIKTOK.BULK_REMOVE`.

> **Two feasible-but-risky features were intentionally left for a supervised
> pass** (see `FEATURE_FEASIBILITY_REPORT.md`): **LinkedIn bulk-remove
> connections** (destructive, no undo, highest account-restriction risk) and
> **TikTok bulk-unlike via the private API** (kill-switch fragile). The DOM
> TikTok remover above covers Likes safely instead.

---

## Install (load unpacked)

1. Go to `chrome://extensions`.
2. Toggle **Developer mode** (top-right) on.
3. Click **Load unpacked** and select this folder (`Socialfix`).
4. Open one of the supported sites, make sure you're logged in, and use the
   features above.

The toolbar popup shows how many unfollows and stories you've done today (with
progress bars) and has a global **Stop** button for bulk runs.

---

## ⚠️ Account-safety notes (read this)

Social platforms **action-block** accounts that mutate too fast. For Instagram,
community testing puts the unfollow danger zone around **20–40 unfollows/hour**
and **~100–150/day**; a block typically lasts 24–48 hours. Every other platform
has its own limits, encoded in its `src/config.js` block.

To protect your account, all bulk actions are deliberately throttled through the
shared queue:

- **Randomized delays** between each action (e.g. 20–45 s for IG unfollow, 5–8 s
  for YouTube removals, 3–7 s for LinkedIn withdrawals).
- A **per-run cap** and a **per-day cap**, each action with its **own daily
  budget** persisted in `chrome.storage.local`.
- It **stops automatically** if the platform returns an action-block (IG 429 /
  `feedback_required`, X 429 / codes 88/326/64/261, LinkedIn restriction banner),
  and you can hit **Stop** anytime.

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

This is for **personal, load-unpacked use** only — it is not hardened or
intended for the Chrome Web Store, mobile, or Firefox.

---

## Project structure

```
manifest.json          MV3 manifest — per-host content_scripts + load order
popup.html / popup.js  toolbar popup: daily counters + global Stop
styles.css             bwi-namespaced injected styles
src/
  config.js            all tunables, toggles, labels, caps (+ BWI namespace)
  queue.js             shared throttled bulk-action queue (every platform)
  ui.js                shared DOM helpers, toasts, dialog/scroll utilities
  ig-api.js            Instagram private web API (friendships, media, story upload)
  feature1–5,7,9.js    Instagram features (see numbered list above)
  yt-bulk.js/yt-keys.js      YouTube
  x-api.js/x-*.js            X (Twitter)
  reddit-unsave.js/reddit-hide.js
  linkedin-invites.js/linkedin-hide.js
  tiktok-bulk.js
```

See `CLAUDE.md` for the full architecture notes, `PRD.md` for the roadmap, and
`FEATURE_FEASIBILITY_REPORT.md` for why certain features were removed as
platform-impossible rather than built.
