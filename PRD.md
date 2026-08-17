# Socialfix (formerly Better Web Insta) — Product Requirements Document

## Vision

Socialfix is a Chrome extension that fills the gaps Instagram (and other social platforms) leave for power users. The core principle: every feature should feel like it *should have been there all along* — obvious UX fixes, missing keyboard shortcuts, and bulk actions that platforms deliberately omit to drive engagement.

Instagram is the initial platform. The extension's architecture expanded to **additional sites** (YouTube, Twitter/X, Reddit) with platform-specific modules loaded only when the matching host is active.

**Distribution (changed 2026-08):** what started as a personal load-unpacked tool is now being published to the **Chrome Web Store** — hence the rename from "Better Web Insta" (trademark exposure) to **Socialfix**. `PUBLISHING.md` is the submission guide. Two product constraints follow from that and are now binding: the extension must keep a **single coherent purpose** (cleaning up your own activity on sites you're logged into) and must stay **zero-collection** (no analytics, no telemetry, no network call to any non-platform host) to match its published privacy disclosures.

---

## Platform: Instagram Web

### Existing Features

| Feature | Status |
|---|---|
| Shift-click instant unfollow/remove | Shipped |
| "Doesn't follow you back" subsection + bulk unfollow | Shipped — **fixed 2026-08 (Aug 4 audit)**: unfollows appeared to succeed but didn't apply. Instagram answers 200 `{status:"ok"}` while still reporting the follow edge, so writes are now validated (`friendshipApplied`), retried on the `/web/` endpoint, and unfollowed users are purged from the 6h cache |
| Resizable Followers/Following modals | Shipped — **rebuilt 2026-08-15** as drag-to-resize (any edge/corner, size remembered, double-click resets). Height is verified after each drag and rolls back to width-only if Instagram's list can't grow. `BIGGER_MODALS` (default off) is now only the initial width |
| Bulk unsave on the Saved page | Shipped |
| Keyboard story navigation (H / L between users) | Shipped |
| Bulk unlike | Native IG feature (not built here — see CLAUDE.md) |
| See who unfollowed you recently | Shipped |
| Enhanced story composer (text + drawing + fit) | **Removed — dropped by user request (2026-08)** (shipped scope-reduced, then deleted along with the `ig-api.js` story-upload core) |
| Bulk unsave by collection | **Removed — impossible** (per-collection removal is mobile-app-only; web silently full-unsaves) |
| Repost people's stories | **Removed — impossible** (web ships no story-create call; finalize endpoint is mobile-tier + flags web sessions) |
| Reorder carousel images | **Removed — native** (Instagram web now reorders carousels itself) |
| Story composer link/poll stickers | **Removed — impossible** (web configure endpoint silently drops them) |

---

### Planned Features

---

#### 1. See Who Unfollowed You Recently — ✅ Shipped (Feature 7)

**Problem:** Instagram provides no native way to see who has unfollowed you.

**Solution:** Snapshot the user's follower list to `chrome.storage.local` on each visit to their own profile. On subsequent visits, diff the current followers against the last snapshot and surface a "Recently unfollowed you" subsection in the Followers modal — same UI pattern as the existing non-follower subsection.

**Acceptance criteria:**
- Subsection appears in the user's own Followers modal (not on other profiles)
- Lists accounts that were in the previous snapshot but not the current one
- Each entry shows when the drop-off was first noticed
- Storage capped to prevent unbounded growth (one snapshot + one rolling log per account)

**Hardening shipped (per `FEATURE_FEASIBILITY_REPORT.md` §2.1):**
- **Min-interval re-scan** (`UNFOLLOWERS_MIN_SNAPSHOT_INTERVAL_MS`) so opening the modal repeatedly doesn't re-paginate the whole follower list; within the window it renders cached results.
- **Partial-read guard:** `ig-api` throws on an incomplete paginate (never returns a truncated list), and a proportional-drop check (`UNFOLLOWERS_MIN_TRUST_RATIO`) ignores an implausibly small scan — so a rate-limited read can't fabricate mass false unfollows.
- **Honest labeling:** the UI says "no longer follows you", never "unfollowed", with a note that drop-offs also include deactivated / banned / blocked / went-private accounts.

---

#### 2. Bulk Delete from Saved — ✅ Shipped (Feature 4 extension)

**Update (v1):** The inline Select → Unsave (full unsave) is shipped and stays. The attempted **collections** extension — a dropdown, Select-all, and a **Remove from this collection only** scope toggle (`removed_collection_ids`) — was **removed**: per-collection removal is a mobile-app-only action that the web endpoint silently ignores or turns into a full unsave (see `FEATURE_FEASIBILITY_REPORT.md` §2.5). Do not re-attempt scoped removal.

**Problem:** Instagram has no multi-select for removing saved posts. Unsaving a large collection requires visiting each post individually.

**Solution:** Same pattern as Bulk Unlike — a panel that fetches saved collections via the private API, renders posts with checkboxes, and queues unsave calls through the throttle system.

**Acceptance criteria:**
- Supports "All Saved" and individual named collections
- Per-item and select-all controls
- Queued through queue.js
- Dry-run support

---

#### 3. Repost People's Stories — 🚫 Removed — impossible on web

> **Removed (built, then cut).** There is no web story-*create* API call — the only story finalize endpoint is mobile-app-tier and rejects/flags cookie-authed web sessions (documented failure mode: the session gets checkpointed/logged out, not a clean 400). Reposting someone else's frame this way is not achievable from a content script. See `FEATURE_FEASIBILITY_REPORT.md` §2.3. Do not re-attempt.

**Problem (original):** Instagram removed native story resharing for posts you aren't tagged in.

**Solution (original):** Add a "Repost to Story" action to story viewer controls. Captures the current story frame (respecting that this is for personal use on a load-unpacked extension), lets the user optionally add a caption sticker, and submits via the stories creation API.

**Acceptance criteria:**
- Action visible on story viewer for any public/following account's story
- Preview before posting
- Posts to the user's own story
- No action taken in dry-run mode; logs intent instead

---

#### 4. Story Creation Tools — 🚫 Removed — dropped by user request (2026-08)

> **Removed (shipped scope-reduced, then dropped entirely).** The text + freehand-drawing + fit/fill composer shipped as `feature9.js` (the **interactive link/poll stickers** had already been cut — the plain web `configure_to_story` endpoint silently drops `tap_models`/`story_sticker_ids` (mobile-app-only), so they'd post an image with no sticker; see `FEATURE_FEASIBILITY_REPORT.md` §2.2). In **2026-08 the whole feature was removed by user request**: `feature9.js` was deleted and the story-upload core (`ruploadPhoto`/`configureToStory`) was stripped from `ig-api.js`, along with the `STORY` config block, `STORY_CREATE_TOOLS` toggle, story styles, and the popup's stories counter. Do not rebuild unless asked.

**Problem:** The web story creator is minimal compared to mobile — no text stickers, no drawing tools, limited media options.

**Solution:** An enhanced story creation overlay injected at the story upload entry point, adding:

- **Text sticker** with font/color picker
- **Link sticker** (add a tappable URL)
- **Poll sticker** (binary options)
- **Basic drawing layer** (freehand brush, color, size)
- **Media fit controls** (fit vs. fill background)

**Acceptance criteria:**
- Overlay activates when the user initiates story creation on web
- Sticker data is encoded in the API payload for the story upload endpoint
- Drawing layer is rasterized and merged into the image before upload
- Each tool can be independently toggled; removing the overlay leaves IG's native flow intact

---

#### 5. Reorder Images When Creating a Post — 🚫 Removed — now native on web

> **Removed (built, then cut).** Instagram web now provides native drag-to-reorder in the carousel composer, so the MAIN-world `configure_sidecar` interception was redundant and risky (client-side tampering with the publish request can flag the account). `feature10.js` + `mainworld.js` were deleted. See `FEATURE_FEASIBILITY_REPORT.md` §2.4.

**Problem:** After selecting multiple images for a carousel post, Instagram web gives no way to reorder them — the only option is to deselect and restart.

**Solution:** Intercept the post creation flow after image selection and inject a drag-and-drop reorder step before the caption/share screen.

**Acceptance criteria:**
- Drag-and-drop reorder panel appears after multi-image selection, before the next step
- Updated order is passed to Instagram's own post-creation flow (not a custom upload)
- Single-image selections are unaffected

---

#### 6. Keyboard Shortcuts for Story Navigation — ✅ Shipped (Feature 5)

**Problem:** Instagram web has no keyboard shortcuts for navigating stories. Users have to click left/right arrows or use mouse gestures.

**Solution:** Bind `H` (previous user's story) and `L` (next user's story) when a story viewer is open. **The originally-proposed `J`/`K` were intentionally changed to `H`/`L`** so the keys map to the *horizontal* (left/right) spatial direction of story navigation rather than the vertical Gmail/Vim model. Unlike the arrow keys, which step one frame at a time, `H`/`L` skip any remaining frames of the current person and move a whole user. Implemented in `src/feature5.js` (pure DOM — clicks Instagram's own neighbor-story controls, no API).

**Acceptance criteria:**
- `L` advances to the next user's story; `H` goes back to the previous user's story
- Keys are active only on `/stories/...` paths (no-op elsewhere)
- Keys do not fire when focus is in a text input or with a modifier held
- Toggleable via `STORY_NAV` in `src/config.js`

---

## Beyond Instagram: Multi-Site Expansion

The extension will evolve into a **platform-agnostic power-user toolkit**. Instagram is the proving ground; the architecture will be generalized so each supported site gets its own module loaded only when that host is active.

**Candidate platforms and feature directions:**

| Platform | Feature directions |
|---|---|
| **Twitter / X** | ✅ **Shipped** — bulk unlike (`x-unlike.js`), bulk unfollow non-followers (`x-api.js` + `x-unfollow.js` — **rebuilt DOM-first 2026-08** after X removed the v1.1 friends-list endpoints (404): it now scans loaded rows on your own Following page and clicks X's own unfollow flow; only the batched follow-back lookup still uses the API), chronological Following feed (`x-feed.js`), keyboard shortcuts on the hovered tweet (`x-keys.js`), hide promoted content (`x-hide.js`) |
| **Reddit** | ✅ **Shipped** — bulk unsave (`reddit-unsave.js` — **rebuilt 2026-08**: the DOM-click build silently did nothing, so it now posts to Reddit's own long-stable `/api/unsave` with a modhash and uses the page only to read item ids; select-mode + unsave-all-loaded), hide promoted (`reddit-hide.js`). ~~Keyboard post nav~~ (native — do not build). |
| **YouTube** | ✅ **Shipped** — bulk-remove Watch Later + bulk unlike Liked videos (`src/yt-bulk.js`), keyboard gap-fills for Like/Save/Subscribe/comment (`src/yt-keys.js`). Only the genuine gaps were added; YouTube's large native shortcut set was not rebuilt. |
| **TikTok** | 🚫 **Removed (2026-08)** — dropped by user request. `tiktok-bulk.js` (bulk remove from Liked/Favorites via DOM automation of the browse modal), the `TIKTOK` config block, and the manifest entry were deleted. The private-API bulk-unlike that was deferred here is moot. Do not rebuild unless asked. |
| **LinkedIn** | 🚫 **Removed (2026-08)** — LinkedIn support was dropped by user request. `linkedin-invites.js` (bulk-withdraw sent invitations) and `linkedin-hide.js` (hide promoted) were deleted, along with the `LINKEDIN` config block and the manifest entry. The hostility analysis in `FEATURE_FEASIBILITY_REPORT.md` §3.15–3.17 stands as the record; do not rebuild unless asked. |

Platform modules follow the same conventions as the Instagram implementation
(the YouTube module is the reference for new platforms):
- No CSS-class selectors — ARIA roles, visible text, and semantic custom-element
  tag names (`ytd-*` etc.) only
- All bulk actions through the shared `src/queue.js` (it accepts a function
  action for DOM-automation platforms) with per-platform caps and daily keys
- All tunables (delays, caps, labels, keys) in a platform config block in
  `src/config.js` (see `YT`)
- `DRY_RUN` applies globally across all platforms
- Each platform gets its own `content_scripts` entry in `manifest.json`, loaded
  only on that host

### Deliberately deferred (feasible, but not shipped blind)

**Nothing is currently deferred.** Both entries that lived here became moot when
their platforms were dropped by user request in 2026-08: TikTok bulk-unlike via
the private `commit/item/digg` API (§3.6) and LinkedIn bulk-remove 1st-degree
connections (§3.16). The feasibility analysis for both stands in
`FEATURE_FEASIBILITY_REPORT.md` as the record.


---

## Non-Goals

- ~~Chrome Web Store distribution~~ — **this is now a goal** (2026-08). See
  `PUBLISHING.md`. Load-unpacked remains supported for development.
- Analytics, telemetry, error reporting, or any network request to a host other
  than the four supported platforms — the store listing's privacy answers
  promise zero collection, and shipping any of these would make them false.
- Mobile or Firefox support
- Any feature that requires storing credentials or a backend server
- Automating content creation (captions, images) — tools assist creation, not replace it
- **Story reposting, per-collection unsave, and carousel reorder (removed).**
  Proven not achievable / not needed from web (2026-07 feasibility research,
  `FEATURE_FEASIBILITY_REPORT.md`): story-create is mobile-tier and flags web
  sessions; per-collection removal is mobile-app-only (web silently full-
  unsaves); carousel reorder is now native on web. Interactive link/poll story
  stickers are likewise mobile-app-only (web drops them). Do not re-attempt any
  of these — they are platform limits, not code bugs.
- **Editing bio links from web (removed).** Instagram gates the multi-link bio
  manager to the mobile app. The `update_bio_links` / `remove_bio_links`
  endpoints are mobile app-tier and reject a cookie-authenticated web session
  (intermittent 500 "Oops, an error occurred." with no persistence), so there is
  no reliable web path. Feature 6 was built, proven unfixable, and removed.
- **Emoji Pong (removed).** Instagram's DM emoji games are native mobile-app
  features — the web client ships no game code and exposes no API to launch or
  join a game session, so instagram.com cannot be "linked" to the mobile game's
  shared single-player score. A separate local-only clone was explicitly not
  wanted, so Feature 11 was removed.

---

## Technical Constraints

- All API calls are same-origin with `credentials: 'include'` — no auth tokens to manage
- Bulk actions **must** go through queue.js; no secondary bulk path, and every
  entry point checks `queue.isBusy()` first (the queue is a singleton with one
  progress-listener slot)
- **Every mutating action must verify it actually applied** and throw otherwise
  (`err.status = 429` when throttling is the likely cause). A click-and-assume
  action reports success, spends the daily budget, and hides rate-limits from
  the queue's stop-on-block — the worst failure mode in this codebase
- New files added to load order in `manifest.json` content_scripts
- DOM injection namespaced with `bwi-` prefix
- Syntax check: `node --check src/<file>.js` after every edit
- Store packaging: `./scripts/package.sh` builds `dist/socialfix-<version>.zip`
  from the live tree; bump `manifest.json` `version` (strictly increasing)
  before every upload
