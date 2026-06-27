# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal, unpacked Manifest V3 Chrome extension that augments **instagram.com** with six features (see `README.md` for user-facing detail and `PRD.md` for the roadmap):

1. **Shift-click instant unfollow/remove** in the Following and Followers list modals.
2. A **"doesn't follow you back" subsection** injected into your own profile's Following modal, with throttled bulk unfollow.
3. **Bigger Followers/Following modals** — widened/heightened so there's room for both the native list and the Feature 2 subsection (toggle via `BIGGER_MODALS` in `src/config.js`).
4. **Bulk unsave on the Saved page** — an inline "Select" mode over the saved-post grid; toggle individual tiles, then "Unsave (n)" fully unsaves the selection through the throttled queue.
5. **Keyboard story navigation** — while viewing a story, `H` jumps to the previous user's story and `L` jumps to the next user's story, skipping any remaining frames of the current person (toggle via `STORY_NAV` in `src/config.js`).
6. **Edit bio links on web** — a multi-link manager injected into the `/accounts/edit/` page to add/edit/reorder/remove the bio links (up to 5, each with an optional title) that Instagram otherwise only lets you edit on mobile (toggle via `EDIT_BIO_LINKS` in `src/config.js`).

### Important correction: "Bulk unlike"

`PRD.md` lists **"Bulk unlike"** in the *Existing Features* table as "Shipped", and commit `bf16c09` reinforces this. **This is misleading.** Bulk unlike is a **native Instagram feature** (Settings → Your activity → Interactions → Likes, where you can multi-select and remove likes). It was **not built by this extension** — there is no bulk-unlike code anywhere in this repo. When the PRD says "same pattern as Bulk Unlike," read that as **"same pattern as bulk unfollow"** (`feature2.js` + `queue.js` + `ig-api.js`), which is the reference implementation for any new bulk action.

## Commands

There is **no build step, no package manager, and no test suite** — it's plain vanilla JS loaded directly as content scripts.

- **Syntax-check after edits:** `node --check src/<file>.js` (and `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"` for the manifest). This is the only automated check available.
- **Run / verify:** load unpacked at `chrome://extensions` (Developer mode → Load unpacked → repo root), then exercise on a live, logged-in instagram.com tab. Behavioral verification is manual — there is no way to test against Instagram's real DOM/API without a logged-in browser session.
- **Safe testing:** set `DRY_RUN: true` in `src/config.js` so every mutating call (unfollow/remove/unsave/set-bio-links) is logged to the console instead of sent.

## Architecture

Content scripts run in Chrome's **isolated world** and share one `window` object. Everything hangs off a single `window.BWI` namespace; each file does `const BWI = (window.BWI = window.BWI || {})` and attaches its exports (`BWI.config`, `BWI.api`, `BWI.queue`, `BWI.ui`, etc.).

**Load order is significant** and is fixed in `manifest.json` `content_scripts.js`: `config → ig-api → queue → ui → feature1 → feature2 → feature3 → feature4 → feature5 → feature6`. A file may only reference `BWI.*` symbols defined by an earlier file. If you add a file or a cross-file dependency, update this order. Shared DOM helpers used by more than one feature (e.g. `ui.dialogTitleIs`, `ui.findScrollContainer`) live in `src/ui.js`.

The features are deliberately built on **different strategies**:

- **Feature 1 (`src/feature1.js`) uses no API at all.** A capture-phase click listener flags a Shift+click on a row's trigger button, then a `MutationObserver` auto-clicks the destructive button in Instagram's *own* confirmation dialog once it appears (<100ms, looks instant). This rides Instagram's native flow, so it's the most resilient part. It never calls the private API.
- **Feature 2 (`src/feature2.js` + `src/ig-api.js`) uses Instagram's private web API.** `ig-api.js` calls `/api/v1/friendships/...` same-origin with `credentials: 'include'`, so the session cookies are sent automatically — there is no login/auth code. It paginates the full following + followers lists, computes the set difference, and unfollows. This is the fragile part: endpoint paths and required headers (`X-IG-App-ID`, `X-CSRFToken`, `X-IG-WWW-Claim`) are all isolated in `ig-api.js`. Detection does **not** depend on the URL changing to `/<user>/following/` (Instagram opens the list as a client-side modal and may not push that URL); it identifies the modal by ARIA role + title text and confirms ownership via the profile path segment.
- **Feature 3 (`src/feature3.js`) is pure CSS/DOM, no API.** It finds the Followers/Following list dialog (any profile) and tags it + its scroll container with `bwi-big-*` classes; `styles.css` does the resizing with `!important` so it survives React re-renders. Because Instagram virtualizes the list, it dispatches a `resize` event after tagging so the windowing recomputes visible rows.
- **Feature 4 (`src/feature4.js` + `src/ig-api.js`) uses the private API + the shared queue.** On your own Saved page it injects a toolbar above the post grid with a "Select" toggle. In select mode a capture-phase click listener intercepts tile clicks (blocking navigation) and tracks the selection **by post shortcode** (not DOM node — the grid is virtualized and recycles nodes on scroll, so overlays are re-applied on mutation). The numeric media id needed by `/api/v1/media/{id}/unsave/` is derived locally from the shortcode via `api.shortcodeToMediaId()` (base64 decode — no extra network read), and the unsave calls run through `queue.js`.
- **Feature 5 (`src/feature5.js`) is pure DOM, no API — closest in spirit to Feature 1.** A capture-phase `keydown` listener (active only when `location.pathname` starts with `STORY_NAV_PATH_PREFIX`, i.e. `/stories/`) maps `H`/`L` (from `STORY_NAV_KEYS`) to previous/next *user* and clicks Instagram's own on-screen control rather than reconstructing tray order. Per repo convention the control is resolved by stable URL shape first — the dimmed neighbor-story anchors `a[href^="/stories/"]` flanking the active story, picking the visible one nearest viewport center on the requested side — and falls back to the round chevron buttons by aria-label (`LABELS.storyPrev`/`storyNext`). It no-ops on modifier keys and when focus is in an input/textarea/contenteditable (so `H`/`L` in the story reply box are untouched), and toasts "No previous/next story" when no control is found. The keys deliberately differ from the arrow keys, which step one frame at a time. **`H`/`L` (not the PRD's originally-proposed `J`/`K`) are intentional** — horizontal left/right mirrors the spatial direction of story navigation.
- **Feature 6 (`src/feature6.js` + `src/ig-api.js`) uses the private API but NOT the queue.** On the web Edit Profile page (`location.pathname` starts with `/accounts/edit`) it injects a `bwi-` panel — anchored above Instagram's own edit form, located via `ui.findButtonByText(main, LABELS.editProfileSubmit)` with a `<main>` fallback — that manages the multi-link bio manager (up to `MAX_BIO_LINKS`, mobile-only on native IG). It pre-fills from `api.getBioLinks()` (the `bio_links` array on the same `/api/v1/users/{id}/info/` response `getOwnUsername` already reads) and supports add/edit/remove/reorder, with the link array held at module scope so it survives React re-renders (the panel re-injects itself via a `document.contains` check, exactly like Feature 4's toolbar). Saving goes through `api.setBioLinks(links, removedIds)` — therefore **no `queue.js`** (no throttle/caps; this is a one-shot low-frequency action, unlike the bulk features) — behind a two-click inline confirm. It deletes removed links via `POST /api/v1/accounts/remove_bio_links/` then pushes the full ordered set via `POST /api/v1/accounts/update_bio_links/` (the web "Links" field is greyed out, but that gate is client-side — we call the real app endpoints same-origin). Bodies use Instagram's `signed_body=SIGNATURE.<urlencoded JSON>` encoding (no real HMAC — IG stopped verifying), with `updated_links` double-encoded and a minted+persisted `_uuid` (`bwi_device_uuid`). **The write shape is the fragile part:** instagrapi (the source for these endpoints) emulates the *mobile* client, so the web-specific acceptance of `_uuid`/`link_id`/`signed_body` is verified empirically — **run `DRY_RUN: true` (payload is logged) before trusting the live call**, and adjust the obj shape / `bioSignedBody` in `ig-api.js` if Instagram rejects it.

**Bulk actions go through one place.** `src/queue.js` is a singleton queue — the only path for bulk actions. `run(items, action, opts)` takes `action` (a method name on `BWI.api`, e.g. `"unfollow"` / `"unsave"`) and an `opts` override for `minDelay`/`maxDelay`/`sessionCap`/`dailyCap`/`dailyKey`, so each action gets its own throttle and **its own daily budget** (unfollow → `bwi_daily_<date>`, unsave → `bwi_daily_unsave_<date>`); unset fields fall back to the conservative unfollow defaults in `config.js`. It enforces randomized inter-action delays plus session/daily caps (persisted in `chrome.storage.local`) and stops on Instagram action-blocks (429 / `feedback_required`). It emits progress events consumed by feature UIs and the popup. Do not add a second bulk path that bypasses these caps; account safety depends on this throttling.

## Conventions that matter

- **Never select by Instagram's CSS classes** — they are obfuscated and change constantly. Match on ARIA roles (`[role="dialog"]`), **button text**, and stable URL shapes (e.g. `a[href*="/p/"]`). All visible-text labels live in `LABELS` in `src/config.js` (English only); the confirm-dialog button text and the private-API shape are the two things most likely to break when Instagram changes, so keep them centralized there and in `ig-api.js`.
- **All tunables are in `src/config.js`**: `DRY_RUN`, throttle delays, session/daily caps (including per-action blocks like `UNSAVE`), app IDs, labels. Prefer adding knobs there over hardcoding.
- **Never trigger blocking dialogs** (`window.confirm/alert/prompt`) — they freeze the page. Use inline two-click confirms and `ui.toast` instead.
- Injected DOM/CSS is namespaced with a `bwi-` class prefix (`styles.css`, `src/ui.js`) to avoid colliding with Instagram.
- The popup (`popup.html`/`popup.js`) runs in a separate context and cannot touch `BWI.*`; it talks to the content script only via `chrome.tabs.sendMessage` (`{ type: "bwi-stop" }`) and reads the daily counter directly from `chrome.storage.local`. `DAILY_CAP` is duplicated in `popup.js` — keep it in sync with `config.js`.

## Non-goals

Web Store distribution, mobile/Firefox, stored credentials or a backend. Personal use, load-unpacked only.
