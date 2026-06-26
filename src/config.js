// Better Web Insta — shared config & namespace.
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

    // Feature 3: enlarge Instagram's own Followers/Following modals so there's
    // room for both the native list and our injected subsection. Set to false
    // to leave Instagram's modals at their default size.
    BIGGER_MODALS: true,
    MODAL_WIDTH_PX: 680, // target width of the enlarged modal card
    MODAL_HEIGHT_VH: 85, // target height as a percentage of viewport height

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
