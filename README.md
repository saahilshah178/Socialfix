# Better Web Insta

A personal Chrome extension (Manifest V3) with power-user tools for
**instagram.com** and **youtube.com** (each site's module loads only on that
site).

## Instagram

1. **Shift-click instant remove** — hold **Shift** and click a row's
   **Following** button (in any Following list) or **Remove** button (in any
   Followers list) to skip Instagram's confirmation dialog and act immediately.
   Works on every row, no exceptions. Plain clicks behave normally.
2. **"Doesn't follow you back" subsection** — open **your own** profile's
   Following list and a panel appears at the top showing everyone you follow who
   doesn't follow you back. Each has an instant **Unfollow** button, plus an
   **Unfollow all** button.
3. **Bigger Followers/Following modals** — the list modals are widened and
   heightened so the native list and the non-follower subsection both fit
   comfortably. Toggle with `BIGGER_MODALS` in `src/config.js`.
4. **Bulk unsave on the Saved page** — on your own Saved page, click **Select**
   to enter an inline multi-select mode over the post grid, tap the tiles you
   want, then **Unsave (n)** to remove them all through the throttled queue.
5. **Keyboard story navigation** — while viewing a story, press **H** to jump to
   the **previous** user's story and **L** to jump to the **next** user's story.
   Unlike the arrow keys (which step one frame at a time), `H`/`L` skip any
   remaining frames of the current person and move a whole user at once. The keys
   are ignored while you're typing (e.g. in the story reply box). Toggle with
   `STORY_NAV` in `src/config.js`.
6. **See who dropped off your followers** — open **your own** Followers list and
   a panel appears at the top listing accounts that **no longer follow you**,
   each with the time it was first noticed. It snapshots your followers and
   diffs on later visits (re-scanning at most once every few hours to stay light
   on the API), and it's careful never to fabricate results from a partial read.
   Labeling is honest: a drop-off can be a real unfollow *or* a deactivated /
   banned / blocked / went-private account, so it never claims "unfollowed" as
   fact. Toggle with `SEE_UNFOLLOWERS` in `src/config.js`.
7. **Enhanced story composer** — the **＋ Enhanced story** button opens a
   canvas composer with movable **text**, freehand **drawing**, and **fit/fill**
   background control. Everything is rasterized into the image and posted through
   the private story-upload API. Toggle with `STORY_CREATE_TOOLS`.

> ⚠️ The story composer (feature 7) drives Instagram's undocumented private
> write endpoint. **Set `DRY_RUN: true` in `src/config.js` and confirm the
> logged payload first** before trusting the live call.
>
> Some once-planned features were removed because they're **impossible on the
> web platform** (not code bugs) — story reposting, per-collection unsave, and
> carousel reorder. See `FEATURE_FEASIBILITY_REPORT.md` for the full analysis
> and the list of what *is* worth building next (on Instagram and other sites).

## YouTube

1. **Bulk-remove from Watch Later / Liked videos** — on `youtube.com/playlist?list=WL`
   (or `list=LL`), a **Select** toolbar appears above the playlist. Tap rows to
   select them (or **Select all**), then **Remove (n)**. Each removal clicks
   YouTube's own per-row ⋮ → "Remove from …" menu item through the shared
   throttled queue, with deliberately slow **5–8 s** delays — YouTube processes
   deletions asynchronously and going faster makes videos reappear. Separate
   daily budgets per playlist; **Stop** anytime. Toggle with `YT.BULK_PLAYLIST`
   in `src/config.js`.
2. **Keyboard shortcut gap-fills** — on watch pages, the shortcuts YouTube's
   big native set omits: **E** toggles Like, **Shift+E** opens Save-to-playlist,
   **Shift+U** subscribes, **N** jumps to the comment box. Keys avoid every
   native binding, never fire while typing, and are remappable in `YT.KEYS`.
   Toggle with `YT.SHORTCUTS`.

Both are pure DOM automation riding YouTube's own UI (no private API calls).
The global `DRY_RUN` flag applies: bulk removals log to the console instead of
clicking.

## X (Twitter)

1. **Bulk unlike** — on your own **Likes** tab (`x.com/<you>/likes`), a floating
   toolbar shows **Unlike loaded (n)**. It unlikes the currently-loaded tweets
   by clicking each native heart through the throttled queue (1.5–3.5 s apart);
   scroll to load more and run again. Two-click confirm, **Stop** anytime.
   Toggle with `X.BULK_UNLIKE`.
2. **Unfollow people who don't follow you back** — a floating **Non-followers**
   button opens a panel; **Scan** paginates your following and checks follow-back
   in batches, then lists everyone who doesn't follow you. Unfollow individually
   or **Unfollow all**, queued with conservative X limits (X restricts fast
   unfollowing). Toggle with `X.BULK_UNFOLLOW`.
3. **Chronological Following feed** — on Home, auto-switches from the algorithmic
   "For You" tab to **Following** (and tries the Latest/Recent sort), once per
   visit so it won't fight you. Toggle with `X.CHRONO_FEED`.
4. **Hide promoted content** — read-only filter that removes promoted tweets and
   the Premium upsell (otherwise only gone behind X Premium). Nothing is sent to
   X. Toggle with `X.HIDE_PROMOTED`.
5. **Keyboard shortcuts** — act on the tweet **under your mouse** (X's native
   keys need keyboard focus): **E** like/unlike, **Shift+R** reply, **Shift+D**
   open full-res photo(s), **Shift+C** copy link. Toggle with `X.SHORTCUTS`.

Bulk unlike and unfollow ride `queue.js` with X-specific caps and their own
daily budgets; `DRY_RUN` logs instead of acting. The feed, hide, and shortcut
features are pure DOM (no API, no writes).

## Reddit

1. **Bulk unsave** — on your Saved page (best on **old.reddit.com/prefs/saved**;
   new Reddit supported best-effort via shadow-DOM), a floating toolbar unsaves
   the currently-loaded items through the throttled queue. Scroll to load more,
   run again. Toggle with `REDDIT.BULK_UNSAVE`.
2. **Hide promoted posts** — read-only filter using Reddit's mandated "Promoted"
   label and the `shreddit-ad-post` element. Toggle with `REDDIT.HIDE_PROMOTED`.

## LinkedIn

1. **Bulk-withdraw sent invitations** — on
   **linkedin.com/mynetwork/invitation-manage/sent/**, a toolbar withdraws your
   pending invites one at a time (click Withdraw → confirm popover), through the
   queue with **deliberately slow, low caps** — LinkedIn flags activity bursts.
   It **stops immediately** if any restriction/CAPTCHA banner appears. Toggle
   with `LINKEDIN.WITHDRAW_INVITES`. *Try `DRY_RUN: true` first.*
2. **Hide promoted content** — read-only filter with robust text matching (it
   defeats LinkedIn's zero-width-character obfuscation of the "Promoted" label).
   Fragile by nature — expect occasional label upkeep. Toggle with
   `LINKEDIN.HIDE_PROMOTED`.

## TikTok

1. **Bulk remove from Liked / Favorites** — on your own profile's **Liked** or
   **Favorites** tab, a toolbar removes the loaded videos: for each, it opens
   the video, clicks the like/favorite toggle off, and closes — through the
   throttled queue. Pure DOM (no private API / no request-signing, so it's
   robust against TikTok's anti-automation). Toggle with `TIKTOK.BULK_REMOVE`.

> **Two feasible-but-risky features were intentionally left for a supervised
> pass** (see `FEATURE_FEASIBILITY_REPORT.md`): **LinkedIn bulk-remove
> connections** (destructive, no undo, highest account-restriction risk) and
> **TikTok bulk-unlike via the private API** (kill-switch fragile). The DOM
> TikTok remover above covers Likes safely instead.

All Reddit/LinkedIn/TikTok bulk actions ride the same `queue.js` throttle with
per-platform caps and their own daily budgets; `DRY_RUN` logs instead of acting.
The hide-promoted filters are read-only (no writes, no account risk).

## Install (load unpacked)

1. Go to `chrome://extensions`.
2. Toggle **Developer mode** (top-right) on.
3. Click **Load unpacked** and select this folder (`Socialfix`).
4. Open `https://www.instagram.com`, make sure you're logged in, and use the
   features above.

The toolbar popup shows how many unfollows you've done today and has a global
**Stop** button for bulk runs.

## ⚠️ Account-safety notes (read this)

Instagram **action-blocks** accounts that unfollow too fast — community
testing puts the danger zone around **20–40 unfollows/hour** and
**~100–150/day**. A block typically lasts 24–48 hours.

To protect your account, **Unfollow all** is deliberately throttled:

- A randomized **20–45 second** delay between each unfollow.
- A **per-run cap** (50) and a **per-day cap** (150).
- It **stops automatically** if Instagram returns an action-block, and you can
  hit **Stop** anytime.

If a run is capped, just run it again later/tomorrow to continue.

### Test safely first

Open `src/config.js` and set `DRY_RUN: true`. In dry-run mode every unfollow /
remove is **logged to the console instead of actually sent**, so you can verify
the UI and flow without touching your real follow graph. Set it back to `false`
for real use.

All throttle values, caps, and the `DRY_RUN` flag live at the top of
`src/config.js`.

## How it works / limitations

- **Feature 1** doesn't call any private API — it lets Instagram open its own
  confirmation dialog and instantly clicks the confirm button. This is the most
  resilient approach because it rides Instagram's own flow.
- **Feature 2** uses Instagram's private web API (`/api/v1/friendships/...`)
  from the content script (same-origin, so your session cookies are used
  automatically) to fetch the complete following/followers lists and to
  unfollow.
- Selectors match on **ARIA roles and button text**, never Instagram's
  obfuscated CSS classes. Button text is assumed **English** — to use another
  language, edit `LABELS` in `src/config.js`.
- Instagram changes its DOM and private endpoints periodically. If Feature 2
  ever stops working, the API details are isolated in `src/ig-api.js`.
- This is for personal, load-unpacked use; it is not hardened for the Chrome
  Web Store.
