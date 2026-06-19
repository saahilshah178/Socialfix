# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal, unpacked Manifest V3 Chrome extension that augments **instagram.com** with three features (see `README.md` for user-facing detail):

1. **Shift-click instant unfollow/remove** in the Following and Followers list modals.
2. A **"doesn't follow you back" subsection** injected into your own profile's Following modal, with throttled bulk unfollow.
3. **Bigger Followers/Following modals** — widened/heightened so there's room for both the native list and the Feature 2 subsection (toggle via `BIGGER_MODALS` in `src/config.js`).

## Commands

There is **no build step, no package manager, and no test suite** — it's plain vanilla JS loaded directly as content scripts.

- **Syntax-check after edits:** `node --check src/<file>.js` (and `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"` for the manifest). This is the only automated check available.
- **Run / verify:** load unpacked at `chrome://extensions` (Developer mode → Load unpacked → repo root), then exercise on a live, logged-in instagram.com tab. Behavioral verification is manual — there is no way to test against Instagram's real DOM/API without a logged-in browser session.
- **Safe testing:** set `DRY_RUN: true` in `src/config.js` so every unfollow/remove is logged to the console instead of sent.

## Architecture

Content scripts run in Chrome's **isolated world** and share one `window` object. Everything hangs off a single `window.BWI` namespace; each file does `const BWI = (window.BWI = window.BWI || {})` and attaches its exports (`BWI.config`, `BWI.api`, `BWI.queue`, `BWI.ui`, etc.).

**Load order is significant** and is fixed in `manifest.json` `content_scripts.js`: `config → ig-api → queue → ui → feature1 → feature2 → feature3`. A file may only reference `BWI.*` symbols defined by an earlier file. If you add a file or a cross-file dependency, update this order. Shared DOM helpers used by more than one feature (e.g. `ui.dialogTitleIs`, `ui.findScrollContainer`) live in `src/ui.js`.

The two features are deliberately built on **different strategies**:

- **Feature 1 (`src/feature1.js`) uses no API at all.** A capture-phase click listener flags a Shift+click on a row's trigger button, then a `MutationObserver` auto-clicks the destructive button in Instagram's *own* confirmation dialog once it appears (<100ms, looks instant). This rides Instagram's native flow, so it's the most resilient part. It never calls the private API.
- **Feature 2 (`src/feature2.js` + `src/ig-api.js`) uses Instagram's private web API.** `ig-api.js` calls `/api/v1/friendships/...` same-origin with `credentials: 'include'`, so the session cookies are sent automatically — there is no login/auth code. It paginates the full following + followers lists, computes the set difference, and unfollows. This is the fragile part: endpoint paths and required headers (`X-IG-App-ID`, `X-CSRFToken`, `X-IG-WWW-Claim`) are all isolated in `ig-api.js`. Detection does **not** depend on the URL changing to `/<user>/following/` (Instagram opens the list as a client-side modal and may not push that URL); it identifies the modal by ARIA role + title text and confirms ownership via the profile path segment.
- **Feature 3 (`src/feature3.js`) is pure CSS/DOM, no API.** It finds the Followers/Following list dialog (any profile) and tags it + its scroll container with `bwi-big-*` classes; `styles.css` does the resizing with `!important` so it survives React re-renders. Because Instagram virtualizes the list, it dispatches a `resize` event after tagging so the windowing recomputes visible rows.

**Bulk actions go through one place.** `src/queue.js` is a singleton queue — the only path for "Unfollow all." It enforces randomized inter-action delays plus session/daily caps (daily count persisted in `chrome.storage.local`), and stops on Instagram action-blocks (429 / `feedback_required`). It emits progress events consumed by the subsection UI and the popup. Do not add a second bulk path that bypasses these caps; account safety depends on this throttling.

## Conventions that matter

- **Never select by Instagram's CSS classes** — they are obfuscated and change constantly. Match on ARIA roles (`[role="dialog"]`) and **button text**. All visible-text labels live in `LABELS` in `src/config.js` (English only); the confirm-dialog button text and the private-API shape are the two things most likely to break when Instagram changes, so keep them centralized there and in `ig-api.js`.
- **All tunables are in `src/config.js`**: `DRY_RUN`, throttle delays, session/daily caps, app IDs, labels. Prefer adding knobs there over hardcoding.
- Injected DOM/CSS is namespaced with a `bwi-` class prefix (`styles.css`, `src/ui.js`) to avoid colliding with Instagram.
- The popup (`popup.html`/`popup.js`) runs in a separate context and cannot touch `BWI.*`; it talks to the content script only via `chrome.tabs.sendMessage` (`{ type: "bwi-stop" }`) and reads the daily counter directly from `chrome.storage.local`. `DAILY_CAP` is duplicated in `popup.js` — keep it in sync with `config.js`.
