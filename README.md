# Better Web Insta

A personal Chrome extension (Manifest V3) that makes follow-management on
**instagram.com** faster:

1. **Shift-click instant remove** — hold **Shift** and click a row's
   **Following** button (in any Following list) or **Remove** button (in any
   Followers list) to skip Instagram's confirmation dialog and act immediately.
   Works on every row, no exceptions. Plain clicks behave normally.
2. **"Doesn't follow you back" subsection** — open **your own** profile's
   Following list and a panel appears at the top showing everyone you follow who
   doesn't follow you back. Each has an instant **Unfollow** button, plus an
   **Unfollow all** button.

## Install (load unpacked)

1. Go to `chrome://extensions`.
2. Toggle **Developer mode** (top-right) on.
3. Click **Load unpacked** and select this folder
   (`InstaChromeExtension`).
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
