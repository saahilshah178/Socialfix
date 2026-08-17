// Socialfix — shared config & namespace.
// Content scripts run in an isolated world and share `window`. We hang
// everything off a single `window.BWI` namespace to keep things explicit
// and avoid clashing with Instagram's own globals.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});

  BWI.config = {
    // Instagram's public web App ID (sent as X-IG-App-ID). Stable for years,
    // but if the private API ever rejects requests, this is the first knob.
    APP_ID: "936619743392459",
    ASBD_ID: "129477",

    // When true, every mutating API call (unfollow / remove follower) is
    // logged to the console instead of actually being sent. Use this to test
    // the wiring end-to-end without touching your real follow graph.
    DRY_RUN: false,

    // Bulk "Unfollow all" throttling. Instagram action-blocks accounts that
    // unfollow too fast (~20-40/hr is the community-observed danger zone), so
    // these defaults are deliberately conservative. Tune here if you accept
    // more risk.
    MIN_DELAY_MS: 20000, // 20s
    MAX_DELAY_MS: 45000, // 45s
    SESSION_CAP: 50, // max actions in one "Unfollow all" run
    DAILY_CAP: 150, // max actions per calendar day (persisted in storage)

    // Page size requested when paginating the followers/following lists.
    // Instagram caps the real page size server-side regardless (~100-ish) and
    // we always follow next_max_id, so asking for ~100 matches reality and
    // avoids edge-case 400s some accounts return on very large counts.
    PAGE_COUNT: 100,
    // Pause between list pages. These are read-only endpoints (far less
    // sensitive than writes), so we keep this at 0 for the fastest scan; bump
    // it up only if Instagram starts throttling the list reads.
    PAGE_DELAY_MS: 0,

    // Feature 3: widen Instagram's own Followers/Following modals so there's a
    // little more room for both the native list and our injected subsection.
    // DEFAULT OFF: Instagram's 2026 modal virtualizes its list with react-window,
    // and an earlier build that forced an explicit height on that scroll
    // container broke rendering (the native list went blank). This one-shot
    // widen never touches the list height, but it ships off — our panel is a
    // bounded, internally-scrolling section that already fits the native modal.
    // Set true to opt back into the wider card. (Height is handled by the
    // drag-resize below, which verifies the list still renders and rolls back
    // if it doesn't.)
    BIGGER_MODALS: false,
    MODAL_WIDTH_PX: 560, // target width of the widened modal card
    MODAL_HEIGHT_VH: 85, // unused since 2026-08-15 — height is user-driven (RESIZABLE_MODALS)

    // Feature 3 (cont.): drag-to-resize. Eight transparent handles sit on the
    // edges/corners of the Followers/Following modal card (any profile); drag
    // one to resize the modal both ways, double-click one to reset. The chosen
    // size is remembered in chrome.storage.local and applies to every list
    // modal, replacing the MODAL_WIDTH_PX default above once set. Width is
    // always safe. Height is kept only if Instagram's list actually renders into
    // the taller box — feature3.js checks that after the first resize and each
    // drag, and silently falls back to width-only (vertical handles hidden) when
    // it doesn't. See the mode notes at the top of that file.
    RESIZABLE_MODALS: true, // drag handles on the Followers/Following modal card
    MODAL_MIN_WIDTH_PX: 320, // a drag can't shrink the card narrower than this
    MODAL_MIN_HEIGHT_PX: 300, // …or shorter than this
    MODAL_SIZE_KEY: "bwi_modal_size", // chrome.storage.local key holding {w,h,hBlocked}

    // Feature 5: keyboard story navigation. While viewing a story, H jumps to
    // the PREVIOUS user's story and L jumps to the NEXT user's story (skipping
    // any remaining frames of the current person — unlike the arrow keys, which
    // step one frame at a time). Pure DOM, no API. Set to false to disable.
    STORY_NAV: true,
    STORY_NAV_PATH_PREFIX: "/stories/", // only active when pathname starts here
    STORY_NAV_KEYS: { prev: "h", next: "l" }, // matched against e.key (lowercased)

    // Bulk "Unsave" throttling. Unsaving is lower-risk than unfollowing, so the
    // delays are shorter and the caps higher. It still rides the shared queue.js
    // and uses its OWN daily budget (separate from unfollow) via DAILY_KEY.
    UNSAVE: {
      MIN_DELAY_MS: 3000, // 3s
      MAX_DELAY_MS: 6000, // 6s
      SESSION_CAP: 100, // max unsaves in one run
      DAILY_CAP: 300, // max unsaves per calendar day
      DAILY_KEY: "bwi_daily_unsave_",
    },

    // Feature 7: "See who unfollowed you recently". On your own Followers
    // modal we snapshot your follower set, then diff against the previous
    // snapshot to surface who left. Storage is capped (one snapshot + one
    // rolling log per account).
    SEE_UNFOLLOWERS: true,
    UNFOLLOWERS_MAX_LOG: 500, // cap the rolling "recently unfollowed" log
    UNFOLLOWERS_SNAPSHOT_KEY: "bwi_followers_snap_", // + ownId
    UNFOLLOWERS_LOG_KEY: "bwi_unfollowers_", // + ownId
    // Don't re-paginate the full follower list more than once per this window —
    // opening the Followers modal repeatedly shouldn't hammer the API. Within
    // the window we render from the cached snapshot + log instead of re-scanning.
    UNFOLLOWERS_MIN_SNAPSHOT_INTERVAL_MS: 6 * 60 * 60 * 1000, // 6 hours
    // Safety guard against a partial / rate-limited read fabricating mass false
    // unfollows: if a scan's follower count falls below this fraction of the
    // last snapshot (and the snapshot was non-trivial), distrust it — don't diff
    // and don't overwrite the snapshot.
    UNFOLLOWERS_MIN_TRUST_RATIO: 0.6,

    // ---- YouTube (youtube.com) --------------------------------------------
    // First non-Instagram platform module (PRD "multi-site expansion").
    // Loaded only on youtube.com (see manifest content_scripts). The global
    // DRY_RUN above applies here too: bulk removals log instead of clicking.
    YT: {
      // Feature toggles.
      BULK_PLAYLIST: true, // bulk-remove UI on Watch Later / Liked videos
      SHORTCUTS: true, // keyboard gap-fills on watch pages

      // Bulk-remove throttling. YouTube processes playlist deletions
      // asynchronously — firing too fast makes items reappear on refresh, so
      // proven tools sit at 5-8s between removals. Overdoing it earns 429
      // friction (not bans), but stay conservative anyway.
      MIN_DELAY_MS: 5000,
      MAX_DELAY_MS: 8000,
      SESSION_CAP: 200,
      DAILY_CAP: 500,

      // The two playlists the bulk UI activates on (?list=<id>), each with its
      // own remove-menu text and its own daily budget.
      PLAYLISTS: {
        WL: {
          name: "Watch Later",
          menuItem: "Remove from Watch later",
          dailyKey: "bwi_daily_wl_remove_",
        },
        LL: {
          name: "Liked videos",
          menuItem: "Remove from liked videos",
          dailyKey: "bwi_daily_unlike_yt_",
        },
      },

      // Visible-text / aria-label anchors (English, same caveat as LABELS
      // below). The ⋮ button and menu items are resolved by these — never by
      // YouTube's class names.
      LABELS: {
        actionMenu: "Action menu", // aria-label on a playlist row's ⋮ button
        moreActions: "More actions", // aria-label on the watch-page overflow ⋯
        select: "Select",
        cancelSelect: "Cancel",
        selectAll: "Select all",
        remove: "Remove",
        // Watch-page targets for the keyboard gap-fills. `like` is an
        // aria-label PREFIX ("like this video along with N other people");
        // the rest are exact visible text / aria-labels.
        likePrefix: "like this video",
        subscribe: "Subscribe",
        saveMenuItem: "Save",
        saveAria: "Save to playlist",
        commentPlaceholder: "Add a comment",
      },

      // Keyboard gap-fills (watch pages only). YouTube's native map is large
      // (k/j/l/f/m/c/t/i/0-9/arrows/Shift+N/P, </>, /), so these defaults
      // deliberately avoid every native binding. Matched against e.key
      // (lowercased) + shiftKey. Subscribe requires Shift so it can't fire by
      // accident.
      KEYS: {
        like: { key: "e", shift: false }, // toggle Like
        save: { key: "e", shift: true }, // open Save-to-playlist
        subscribe: { key: "u", shift: true }, // Subscribe
        commentFocus: { key: "n", shift: false }, // jump to comment box
      },
    },

    // ---- X / Twitter (x.com) ----------------------------------------------
    // Loaded only on x.com (see manifest). Selectors prefer data-testid (X's
    // semi-stable non-obfuscated hook, analogous to IG's ARIA) and visible
    // text; the private API is same-origin cookie-authed (no login code).
    // Global DRY_RUN applies to the bulk write actions.
    X: {
      // Feature toggles.
      BULK_UNLIKE: true, // toolbar on your /likes tab
      BULK_UNFOLLOW: true, // non-follower scan + bulk unfollow
      CHRONO_FEED: true, // force the chronological Following feed on Home
      CHRONO_FORCE_LATEST: true, // also try the "Latest/Recent" sort (Nov 2025+)
      HIDE_PROMOTED: true, // read-only ad/promoted filter
      SHORTCUTS: true, // keyboard actions on the hovered tweet

      // The public web app Bearer token. It ships in every x.com page load and
      // has been stable for years (it is NOT a per-user secret). If the private
      // API ever 401s, this is the first knob — re-grab it from a graphql/1.1
      // request in DevTools.
      BEARER:
        "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
      API_HOST: "https://x.com/i/api", // v1.1 lives at /i/api/1.1 (NOT api.x.com)

      // Bulk UNLIKE throttling (own /likes). Community-observed ~500 unlikes /
      // 15 min before a 429 (15-60 min block first offense) → stay well under.
      // Its own daily budget.
      UNLIKE: {
        MIN_DELAY_MS: 1500,
        MAX_DELAY_MS: 3500,
        SESSION_CAP: 200,
        DAILY_CAP: 500,
        DAILY_KEY: "bwi_daily_unlike_x_",
      },
      // Bulk UNFOLLOW throttling. X write-restricts aggressive unfollowing:
      // safe ceiling ~50-100/day; 400+/day → 24-72h restriction. Pacing matters
      // as much as volume, so delays are long. Do NOT reuse IG's caps.
      UNFOLLOW: {
        MIN_DELAY_MS: 4000,
        MAX_DELAY_MS: 9000,
        SESSION_CAP: 50,
        DAILY_CAP: 75,
        DAILY_KEY: "bwi_daily_unfollow_x_",
      },

      // Visible-text / marker anchors (English — localize here). X flips the
      // ad marker text periodically; that's the main maintenance point.
      LABELS: {
        adMarkers: ["Ad", "Promoted"], // a tweet containing one of these = promoted
        premiumNagAria: "Subscribe to Premium", // aria-label on the upsell aside
        followingTab: "Following", // Home tab text
        latestSort: ["Latest", "Recent"], // chronological sort option text
        unfollowConfirm: "Unfollow", // confirm-sheet button text (bulk unfollow)
        followsYouBadge: "Follows you", // per-row badge = they follow you back
      },

      // Keyboard actions on the HOVERED tweet (whichever article the mouse is
      // over). Matched against e.key (lowercased) + shiftKey. Chosen to sit
      // outside X's native single-key shortcuts and to require Shift for the
      // ones that mutate. No-op while typing.
      KEYS: {
        like: { key: "e", shift: false }, // toggle like on hovered tweet
        reply: { key: "r", shift: true }, // open reply composer
        downloadPhoto: { key: "d", shift: true }, // open full-res image(s)
        copyLink: { key: "c", shift: true }, // copy tweet URL
      },
    },

    // ---- Reddit (*.reddit.com) --------------------------------------------
    REDDIT: {
      BULK_UNSAVE: true, // toolbar on the saved-posts page
      HIDE_PROMOTED: true, // read-only promoted-post filter

      // Bulk unsave throttling (low risk; 429 only on rapid bursts).
      UNSAVE: {
        MIN_DELAY_MS: 900,
        MAX_DELAY_MS: 2200,
        SESSION_CAP: 200,
        DAILY_CAP: 1000,
        DAILY_KEY: "bwi_daily_unsave_reddit_",
      },

      LABELS: {
        // Promoted-post markers. Reddit's 2026 ad policy mandates a visible,
        // non-removable "Promoted" label — that's the stable hook.
        // (Bulk unsave no longer needs UI text: it posts to the legacy
        // /api/unsave endpoint directly — see reddit-unsave.js.)
        promotedMarkers: ["promoted", "Promoted"],
      },
    },

    // (TikTok support was removed entirely by user request, 2026-08 — do not
    // rebuild unless asked.)

    // Button label text we match on. Instagram's CSS classes are obfuscated
    // and change constantly, but the visible English text is stable. To
    // support another language, swap these for that locale's labels.
    LABELS: {
      following: "Following",
      followers: "Followers",
      unfollow: "Unfollow",
      remove: "Remove",
      cancel: "Cancel",
      select: "Select",
      cancelSelect: "Cancel",
      unsave: "Unsave",
      // Feature 5 fallback: the aria-label on Instagram's round story chevrons,
      // used only if the URL-shape lookup for adjacent users finds nothing.
      storyPrev: "Previous",
      storyNext: "Next",
    },
  };
})();
