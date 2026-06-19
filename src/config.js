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

    // Page size used when paginating the followers/following lists. Larger
    // pages = fewer round-trips = the non-follower list loads faster. Instagram
    // may cap/ignore very large counts, so we still follow next_max_id.
    PAGE_COUNT: 200,
    // Small pause between list pages. These are read-only endpoints (far less
    // sensitive than writes), so a short delay keeps loading snappy.
    PAGE_DELAY_MS: 150,

    // Feature 3: enlarge Instagram's own Followers/Following modals so there's
    // room for both the native list and our injected subsection. Set to false
    // to leave Instagram's modals at their default size.
    BIGGER_MODALS: true,
    MODAL_WIDTH_PX: 680, // target width of the enlarged modal card
    MODAL_HEIGHT_VH: 85, // target height as a percentage of viewport height

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
