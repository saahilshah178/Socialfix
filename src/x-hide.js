// Socialfix — X: hide promoted / algorithmic clutter.
// (FEATURE_FEASIBILITY_REPORT.md §3.5.)
//
// Read-only DOM filter — nothing is sent to X, so zero ban / rate-limit
// exposure and no queue. Removing ads is otherwise gated behind X Premium, so
// this is a genuine value-add. We hide:
//   • promoted tweets (the data-testid="placementTracking" wrapper)
//   • any tweet article that contains the "Ad"/"Promoted" disclosure text
//   • the "Subscribe to Premium" upsell aside
// Deliberately CONSERVATIVE: we do NOT touch who-to-follow suggestions or
// trends, to avoid nuking legitimate content on a false positive.
//
// Hooks are data-testid (X's semi-stable, non-obfuscated attribute — the
// analog of IG's ARIA) + the marker text in cfg.X.LABELS (the one thing X
// flips/localizes, so it's centralized).
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const L = cfg.X.LABELS;

  if (!cfg.X.HIDE_PROMOTED) return;

  const MARK = "data-bwi-hidden";

  function hide(el) {
    if (!el || el.hasAttribute(MARK)) return;
    el.setAttribute(MARK, "1");
    el.style.setProperty("display", "none", "important");
  }

  // A tweet is promoted if it wraps a placementTracking node, or shows the
  // ad-disclosure text as a standalone label (short exact match so we don't
  // catch a tweet that merely mentions the word "Ad").
  function isPromotedTweet(article) {
    if (article.querySelector('[data-testid="placementTracking"]')) return true;
    // The disclosure renders as its own small text node near the tweet header.
    const spans = article.querySelectorAll("span, div");
    for (const s of spans) {
      const t = (s.textContent || "").trim();
      if (t.length <= 10 && L.adMarkers.includes(t)) return true;
    }
    return false;
  }

  function sweep() {
    // Promoted tweets in the timeline.
    document.querySelectorAll('article[data-testid="tweet"]').forEach((art) => {
      if (art.hasAttribute(MARK)) return;
      if (isPromotedTweet(art)) {
        // Hide the whole cell so no empty gap remains.
        hide(art.closest('[data-testid="cellInnerDiv"]') || art);
      }
    });

    // Promoted wrappers that aren't inside a tweet article (rare layouts).
    document.querySelectorAll('[data-testid="placementTracking"]').forEach((w) => {
      hide(w.closest('[data-testid="cellInnerDiv"]') || w.closest("article") || w);
    });

    // The Premium upsell aside.
    document
      .querySelectorAll(`aside[aria-label="${L.premiumNagAria}"]`)
      .forEach((a) => hide(a));
  }

  // Throttle sweeps to once per animation frame — the timeline mutates a lot.
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      sweep();
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("scroll", schedule, { passive: true });
  sweep();
})();
