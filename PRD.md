# Better Web Insta — Product Requirements Document

## Vision

Better Web Insta is a personal Chrome extension that fills the gaps Instagram (and other social platforms) leave for power users. The core principle: every feature should feel like it *should have been there all along* — obvious UX fixes, missing keyboard shortcuts, and bulk actions that platforms deliberately omit to drive engagement.

Instagram is the initial platform. The extension's architecture will expand to support **additional sites** (Twitter/X, TikTok, Reddit, etc.) with platform-specific modules loaded only when the matching host is active.

---

## Platform: Instagram Web

### Existing Features

| Feature | Status |
|---|---|
| Shift-click instant unfollow/remove | Shipped |
| "Doesn't follow you back" subsection + bulk unfollow | Shipped |
| Bigger Followers/Following modals | Shipped |
| Bulk unsave on the Saved page | Shipped |
| Keyboard story navigation (H / L between users) | Shipped |
| Bulk unlike | Shipped |

---

### Planned Features

---

#### 1. Edit Links in Bio

**Problem:** Instagram limits link-in-bio editing to the mobile app. The web profile editor either omits the field entirely or hides it behind friction.

**Solution:** Inject a fully editable link field (or multi-link manager) into the web profile edit page. On save, submit the update via the private API the same way ig-api.js handles social graph calls.

**Acceptance criteria:**
- User can add, edit, and remove bio links from the desktop web editor
- Changes persist to the account (or dry-run logs the payload when `DRY_RUN: true`)
- Field is injected non-destructively; Instagram's own editor still works normally

---

#### 2. See Who Unfollowed You Recently

**Problem:** Instagram provides no native way to see who has unfollowed you.

**Solution:** Snapshot the user's follower list to `chrome.storage.local` on each visit to their own profile. On subsequent visits, diff the current followers against the last snapshot and surface a "Recently unfollowed you" subsection in the Followers modal — same UI pattern as the existing non-follower subsection.

**Acceptance criteria:**
- Subsection appears in the user's own Followers modal (not on other profiles)
- Lists accounts that were in the previous snapshot but not the current one
- Timestamps stored per snapshot so the UI can show "unfollowed since [date]"
- Storage capped to prevent unbounded growth (store only the delta + last N snapshots)

---

#### 3. Bulk Delete from Saved

**Problem:** Instagram has no multi-select for removing saved posts. Unsaving a large collection requires visiting each post individually.

**Solution:** Same pattern as Bulk Unlike — a panel that fetches saved collections via the private API, renders posts with checkboxes, and queues unsave calls through the throttle system.

**Acceptance criteria:**
- Supports "All Saved" and individual named collections
- Per-item and select-all controls
- Queued through queue.js
- Dry-run support

---

#### 4. Repost People's Stories

**Problem:** Instagram removed native story resharing for posts you aren't tagged in.

**Solution:** Add a "Repost to Story" action to story viewer controls. Captures the current story frame (respecting that this is for personal use on a load-unpacked extension), lets the user optionally add a caption sticker, and submits via the stories creation API.

**Acceptance criteria:**
- Action visible on story viewer for any public/following account's story
- Preview before posting
- Posts to the user's own story
- No action taken in dry-run mode; logs intent instead

---

#### 5. Story Creation Tools

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

#### 6. Reorder Images When Creating a Post

**Problem:** After selecting multiple images for a carousel post, Instagram web gives no way to reorder them — the only option is to deselect and restart.

**Solution:** Intercept the post creation flow after image selection and inject a drag-and-drop reorder step before the caption/share screen.

**Acceptance criteria:**
- Drag-and-drop reorder panel appears after multi-image selection, before the next step
- Updated order is passed to Instagram's own post-creation flow (not a custom upload)
- Single-image selections are unaffected

---

#### 7. Keyboard Shortcuts for Story Navigation — ✅ Shipped (Feature 5)

**Problem:** Instagram web has no keyboard shortcuts for navigating stories. Users have to click left/right arrows or use mouse gestures.

**Solution:** Bind `H` (previous user's story) and `L` (next user's story) when a story viewer is open. **The originally-proposed `J`/`K` were intentionally changed to `H`/`L`** so the keys map to the *horizontal* (left/right) spatial direction of story navigation rather than the vertical Gmail/Vim model. Unlike the arrow keys, which step one frame at a time, `H`/`L` skip any remaining frames of the current person and move a whole user. Implemented in `src/feature5.js` (pure DOM — clicks Instagram's own neighbor-story controls, no API).

**Acceptance criteria:**
- `L` advances to the next user's story; `H` goes back to the previous user's story
- Keys are active only on `/stories/...` paths (no-op elsewhere)
- Keys do not fire when focus is in a text input or with a modifier held
- Toggleable via `STORY_NAV` in `src/config.js`

---

#### 8. Emoji Pong

**Problem:** Sometimes you just need to play Pong with emojis on Instagram.

**Solution:** A hidden easter egg — a keyboard shortcut (e.g., `Shift+P` while on any IG page outside a story/composer) opens a fullscreen Pong overlay rendered in a `<canvas>`, where the ball is a randomly-selected emoji and paddles are `🫱`/`🫲`. Press `Escape` to close.

**Acceptance criteria:**
- Playable two-player or single-player (vs. a CPU paddle) Pong
- Score tracked until someone reaches 7
- Emoji ball changes each round
- Closes cleanly on Escape; no state bleeds into the page

---

## Beyond Instagram: Multi-Site Expansion

The extension will evolve into a **platform-agnostic power-user toolkit**. Instagram is the proving ground; the architecture will be generalized so each supported site gets its own module loaded only when that host is active.

**Candidate platforms and feature directions:**

| Platform | Feature directions |
|---|---|
| **Twitter / X** | Bulk unlike, bulk unfollow non-followers, chronological feed enforcer, keyboard shortcuts parity, hide algorithmic content |
| **TikTok** | Bulk unlike, see mutual follows, bulk remove from favorites |
| **Reddit** | Bulk unsave, hide promoted posts, keyboard-driven post navigation |
| **YouTube** | Bulk remove from Watch Later, bulk unlike, keyboard shortcut improvements |
| **LinkedIn** | Bulk withdraw pending connection requests, bulk remove connections, hide promoted content |

Platform modules will follow the same conventions as the Instagram implementation:
- No CSS-class selectors — ARIA roles and visible text only
- All bulk actions through a shared `queue.js`-equivalent with per-platform caps
- All tunables (delays, caps, labels) in a platform config block in `src/config.js`
- `DRY_RUN` applies globally across all platforms

---

## Non-Goals

- Chrome Web Store distribution (personal use, load-unpacked only)
- Mobile or Firefox support
- Any feature that requires storing credentials or a backend server
- Automating content creation (captions, images) — tools assist creation, not replace it

---

## Technical Constraints

- All API calls are same-origin with `credentials: 'include'` — no auth tokens to manage
- Bulk actions **must** go through queue.js; no secondary bulk path
- New files added to load order in `manifest.json` content_scripts
- DOM injection namespaced with `bwi-` prefix
- Syntax check: `node --check src/<file>.js` after every edit
