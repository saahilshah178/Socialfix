# Publishing Socialfix to the Chrome Web Store

Everything needed to go from this repo to a live store listing. Facts below
were verified against developer.chrome.com in August 2026; anything marked
_(unofficial)_ is corroborated but not printed in Google's docs.

---

## 0. What's already prepared in this repo

| Thing | Where | Status |
|---|---|---|
| MV3 manifest with icons, name, ≤132-char description, version 2.1.0 | `manifest.json` | ✅ ready |
| Toolbar icon set 16/32/48/128 | `icons/` (`scripts/gen-icons.js` regenerates) | ✅ ready |
| Store-listing icon (96×96 glyph + 16px padding in a 128×128 canvas, per Google's spec) | `store-assets/store-icon-128.png` | ✅ ready |
| Small promo tile 440×280 (required) + marquee 1400×560 (optional) | `store-assets/` (`scripts/gen-promo.py` regenerates) | ✅ ready |
| Privacy policy | `PRIVACY.md` | ✅ written — **you must host it at a public URL** (see step 2) |
| Upload zip builder | `scripts/package.sh` → `dist/socialfix-<version>.zip` | ✅ ready |
| Screenshots (min 1, max 5, 1280×800 preferred) | — | ❌ **you must take these** (see step 3) |
| Google developer account with 2FA + $5 fee | — | ❌ you must register |

---

## 1. One-time account setup

1. Turn on **2-Step Verification** for the Google account you'll publish from
   (mandatory — publishing is blocked without it): myaccount.google.com/security.
2. Register at the **Chrome Web Store Developer Dashboard**:
   <https://chrome.google.com/webstore/devconsole> — sign in, accept the
   developer agreement, pay the **one-time $5 registration fee** _(unofficial
   amount; stable since 2010)_, and verify your contact email.
   ⚠️ The account email is **permanent** — pick the Google account you're
   comfortable keeping this under forever.
3. **Trader declaration (EU DSA):** the dashboard forces a choice. As an
   individual publishing a free tool outside any trade or business, declare
   **non-trader**. (Trader status requires identity + SMS-verified phone
   shown to EU users — not for a free hobby extension.)

## 2. Host the privacy policy

The store requires a privacy-policy URL for anything that "handles user data"
— and Google explicitly counts data "processed or stored locally", which
includes this extension's locally-cached follower usernames (Instagram
panels). Easiest path since this repo is on GitHub:

- Push `PRIVACY.md` and use the GitHub blob URL
  (`https://github.com/<you>/<repo>/blob/main/PRIVACY.md`) — accepted by CWS —
  or serve it via GitHub Pages if you want it prettier.

## 3. Take screenshots (the only asset you must produce by hand)

Minimum 1, maximum 5, **1280×800** (or 640×400). Square corners, no device
frames needed. They must show the real product. Suggested set, in order:

1. Instagram Following modal with the **"doesn't follow you back" panel** open.
2. YouTube Liked videos with the **Select toolbar** and a few rows selected.
3. X Likes page in **Select mode** with tweets outlined + the floating toolbar.
4. Reddit Saved page with the **bulk unsave toolbar** visible.
5. The popup (daily counter + Stop button) over any supported site.

Tip: set your Chrome window to exactly 1280×800 before capturing
(on macOS: `open -a "Google Chrome" --args --window-size=1280,800`, or just
crop). Blur/crop your own username where you care.

## 4. Build the upload zip

> ⚠️ **Delete the stale build first.** `Socialfix-extension.zip` and the
> `Socialfix-extension/` folder in the repo root are the **pre-rename Aug 3
> build**: name "Better Web Insta", version 2.0.0, a 176-char description
> (over the 132 limit), **no icons**, and a TikTok content-script entry for the
> platform you removed. Uploading it would fail validation or ship removed
> features and re-introduce fixed bugs. I left them in place rather than
> deleting files I didn't create — remove them yourself so they can't be
> picked by mistake:
> ```sh
> rm -rf Socialfix-extension Socialfix-extension.zip
> ```
> The only correct artifact is `dist/socialfix-<version>.zip` from the script
> below.

```sh
./scripts/package.sh        # → dist/socialfix-2.1.0.zip
```

The zip contains only runtime files (`manifest.json` at the zip root, `src/`,
`popup.*`, `styles.css`, `icons/`) — no docs, PDFs, or git metadata. Max
allowed is 2 GB; ours is ~50 KB.

## 5. Create the listing (dashboard → "New item")

Upload the zip, then fill the tabs. Ready-to-paste copy:

### Store listing tab

- **Title** (from manifest): `Socialfix`
- **Summary** (from manifest, 132-char max — this is 129):
  `Bulk unfollow, unlike and unsave with built-in rate limits, plus feed cleanup and shortcuts for Instagram, YouTube, X and Reddit.`
- **Category:** Tools (alternative: Social & Communications)
- **Language:** English
- **Store icon:** upload `store-assets/store-icon-128.png` (the padded one —
  the manifest's `icons/icon128.png` fills its canvas, which is correct for the
  toolbar but oversized as a listing tile)
- **Promo tile:** `store-assets/promo-small-440x280.png`
  (marquee `promo-marquee-1400x560.png` optional)
- **Detailed description:**

```
Socialfix adds the cleanup tools social sites leave out of their web apps —
so you can manage your own follows, likes, and saved posts in bulk, safely.

WHAT IT DOES

Instagram
• See who doesn't follow you back, and unfollow individually or in bulk
• See who recently dropped off your followers
• Shift-click any Following/Remove button for instant one-click action
• Multi-select bulk unsave on your Saved posts
• H/L keyboard navigation between stories

YouTube
• Multi-select bulk remove from Watch Later and Liked videos
• Keyboard shortcuts YouTube forgot: E to like, Shift+E save to playlist,
  Shift+U subscribe, N jump to comment box

X (Twitter)
• Multi-select bulk unlike on your Likes tab
• Find and unfollow accounts that don't follow you back
• Always land on the chronological Following feed
• Hide promoted posts
• Keyboard actions on the tweet under your cursor

Reddit
• Multi-select bulk unsave of your saved posts (old and new Reddit)
• Hide promoted posts

BUILT FOR ACCOUNT SAFETY

Every bulk action runs through one shared queue with randomized delays,
per-action session caps, and daily budgets, and it stops immediately if a
site starts rate-limiting. Actions only ever run when you trigger them.

PRIVATE BY DESIGN

No account, no server, no analytics. The extension works entirely inside
your browser using your existing logged-in sessions. Nothing is ever sent
to us — see the privacy policy.

HONEST LIMITS

Bulk actions are deliberately throttled (e.g. YouTube removals run 5–8
seconds apart because YouTube processes deletions asynchronously — faster
makes videos reappear). Automating actions on your own account may be
against some platforms' terms of service and heavy use can trigger
temporary action blocks; the built-in caps exist to keep you well under
those thresholds, but use bulk features at your own discretion.

Socialfix is an independent project and is not affiliated with, endorsed
by, or sponsored by Instagram/Meta, YouTube/Google, X Corp., or Reddit.
```

### Privacy tab

- **Single purpose description:**
  `Socialfix has one purpose: letting users clean up their own activity (follows, likes, saved posts) on the social sites they use, by adding bulk-action tools with built-in rate limiting, plus small quality-of-life aids (promoted-post filters and keyboard shortcuts) on those same sites.`
- **Permission justifications:**
  - `storage` — "Stores daily action counters (to enforce the extension's
    built-in rate-limit budgets) and local caches of the user's own
    follower/following lists so the Instagram panels don't re-scan on every
    open. All data stays on-device."
  - (No other API permissions are requested. If the form lists the four sites
    as host permissions because of the content-script match patterns, use the
    per-site justifications below.)
  - Host `www.instagram.com` — "Injects the extension's panels/buttons into
    Instagram pages and performs the user-initiated unfollow/unsave actions
    via the user's own logged-in session."
  - Host `www.youtube.com` — "Injects the bulk-remove toolbar on Watch
    Later/Liked videos and adds keyboard shortcuts on watch pages."
  - Host `x.com` — "Injects the bulk unlike/unfollow toolbars, promoted-post
    filter, and keyboard shortcuts."
  - Host `*.reddit.com` — "Injects the bulk-unsave toolbar on the user's
    Saved page and the promoted-post filter (both old.reddit.com and
    www.reddit.com)."
- **Remote code:** No. (All code ships in the package; nothing is fetched or
  eval'd. This is true — keep it true.)
- **Data usage form:** check **"Personally identifiable information"** (the
  locally-cached usernames) and **"Website content"** (the follower-list data
  read from pages/APIs). Then check all three certifications (no
  sale/transfer, no unrelated use, no creditworthiness use) — all true since
  nothing leaves the device.
- **Privacy policy URL:** the hosted `PRIVACY.md` URL from step 2.

### Distribution tab

- **Visibility:** your call —
  - **Public**: discoverable in search.
  - **Unlisted**: install-by-link only. Same review, same requirements, but
    not searchable — meaningfully lowers the odds of a Meta/X trademark
    sweep noticing it, and you can still share the link anywhere. Given the
    risk profile (below), **unlisted is the pragmatic starting point**; you
    can flip to public later.
- Regions: all.

## 6. Submit and wait

- Click **Submit for review**. Typical reviews are days, but per an official
  April 2026 Chrome Web Store PSA the queue has been running **up to ~4
  weeks** for new items. **Don't withdraw and resubmit** — it resets your queue position.
- After approval you get **30 days** to hit Publish before it reverts to
  draft (or enable auto-publish on approval).
- Updates later: bump `version` in `manifest.json` (must strictly increase),
  re-run `scripts/package.sh`, upload the new zip — every update goes through
  the same review.

---

## Legal & policy reality check

Plain-language, not legal advice:

1. **Trademarks are the #1 takedown vector for tools like this.** Meta has
   filed trademark complaints that removed extensions for using "Insta"/
   "Instagram"/IG branding in names — including one that stayed down after a
   rename. That's why the extension is now named **Socialfix** (was "Better
   Web Insta") with a neutral icon. Platform names appear only factually in
   the description ("works on…"), which the metadata rules tolerate. Don't
   use platform logos, gradients, or names in the title, icon, or promo art.
2. **Platform ToS vs. you (not vs. Chrome).** Instagram's and X's terms
   prohibit automated access; Reddit and YouTube are more permissive but not
   unconditional. There is **no Chrome Web Store policy that outright bans
   automating a user's own account** — similar bulk-unfollow extensions are
   live on the store — but adjacent policies (single purpose, deceptive
   behavior, unauthorized-access) give reviewers discretion, and the
   platforms can action-block or (in theory) suspend *user accounts* that
   automate. The listing copy above discloses this honestly, which both
   protects users and reads well in review.
3. **Single-purpose policy is the most likely rejection reason.** Four
   platforms × many features can read as a "feature bundle." The
   single-purpose statement above frames it as one purpose (clean up your own
   social activity) — if rejected on this ground, the fallback is splitting
   per-platform extensions, but try the appeal/reframe first.
4. **Privacy/data rules are satisfied** as prepared: local-only storage is
   still "user data" per Google's FAQ (hence the policy URL + PII/website-
   content disclosure), the Limited Use certifications are genuinely true
   (nothing leaves the device), and the July 2026 policy update's "strictly
   necessary" bar is met (caches exist only to power the visible panels).
5. **EU DSA:** declare non-trader (free, personal project). If you ever
   monetize, that flips to trader with identity + phone verification.
6. **License:** MIT (`LICENSE`), added so a public repo alongside a published
   extension has unambiguous terms. Its "as is, no warranty" clause is also
   the right posture for a tool that automates account actions.
7. **Liability posture:** the description's "at your own discretion" line +
   the no-affiliation line + honest rate-limit framing is the right posture:
   no guarantees, no impersonation, no hidden behavior.

## Things people commonly overlook (checked for you)

- ✅ Manifest has no `key` field (store rejects manifests that include one).
- ✅ Manifest description 129 chars (limit 132, with margin); name ≤75.
- ✅ No remote code, no eval, no obfuscation/minification (review-friendly).
- ✅ Minimal permissions: **`storage` is the only entry in `permissions`**, and
  there is no `host_permissions` block at all — site access comes purely from
  the four `content_scripts` match patterns. Notably the extension does **not**
  request `tabs`: the popup's Stop button just messages the active tab and
  treats a rejection as "not a supported site", instead of reading `tab.url`
  (which would have required `tabs` or host permissions). Fewer permissions =
  faster review.
- ✅ Version format valid (`2.1.0`).
- ✅ Zip has `manifest.json` at its root.
- ⚠️ `DRY_RUN` must be `false` in the shipped zip (it is).
- ⚠️ Chrome sync is off for these caches (`storage.local`, not `sync`) — no
  cross-device data movement.
- ⚠️ If you later add analytics, error reporting, or any network call to a
  non-platform host, the privacy form, policy, and Limited Use answers all
  change. Keep it zero-collection.
