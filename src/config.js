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

    // Page size used when paginating the followers/following lists.
    PAGE_COUNT: 50,
    // Small pause between list pages so we don't hammer the read endpoints.
    PAGE_DELAY_MS: 600,

    // Button label text we match on. Instagram's CSS classes are obfuscated
    // and change constantly, but the visible English text is stable. To
    // support another language, swap these for that locale's labels.
    LABELS: {
      following: "Following",
      followers: "Followers",
      unfollow: "Unfollow",
      remove: "Remove",
      cancel: "Cancel",
    },
  };
})();
