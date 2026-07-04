// Better Web Insta — LinkedIn: hide promoted feed posts.
// (FEATURE_FEASIBILITY_REPORT.md §3.17 — FRAGILE, read-only.)
//
// Pure read-only DOM filter — nothing is sent to LinkedIn, so zero account
// risk. FRAGILE by nature: LinkedIn has no stable semantic hook for feed items
// and actively fights ad-blockers — the "Promoted" label is split across spans,
// sprinkled with zero-width characters, and localized. So we match it with
// ROBUST text inspection (strip zero-width chars, collapse whitespace) rather
// than a brittle exact selector, then hide the enclosing feed unit. Expect to
// touch up cfg.LINKEDIN.LABELS.promotedMarkers periodically.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const LI = cfg.LINKEDIN;

  if (!LI.HIDE_PROMOTED) return;

  const MARK = "data-bwi-hidden";
  const markers = LI.LABELS.promotedMarkers.map((s) => normalize(s));

  // Strip zero-width / bidi characters LinkedIn injects to defeat text matching,
  // collapse whitespace, lowercase.
  // Zero-width space/joiners, LRM/RLM, bidi embeds/overrides, word-joiner, BOM.
  // Built from escapes so the source stays ASCII and unambiguous.
  var ZERO_WIDTH = new RegExp(
    "[\\u200B-\\u200F\\u202A-\\u202E\\u2060\\uFEFF]",
    "g"
  );
  function normalize(s) {
    return (s || "")
      .replace(ZERO_WIDTH, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function hide(el) {
    if (!el || el.hasAttribute(MARK)) return;
    el.setAttribute(MARK, "1");
    el.style.setProperty("display", "none", "important");
  }

  // The feed unit wrapping a node. LinkedIn's feed items are div.feed-shared-
  // update-v2 (utility classes churn, but this data-ish structural class has
  // been stable); fall back to a reasonable ancestor.
  function feedUnit(node) {
    return (
      node.closest(".feed-shared-update-v2") ||
      node.closest('[data-id^="urn:li:activity"]') ||
      node.closest("li.feed-shared-update-v2, div.occludable-update") ||
      null
    );
  }

  function sweep() {
    // Scan short text nodes for a normalized "Promoted" match. Scoping to small
    // elements avoids hiding a real post that merely discusses promotions.
    const candidates = document.querySelectorAll(
      ".update-components-actor__description, .update-components-actor__sub-description, span"
    );
    for (const el of candidates) {
      if (el.childElementCount > 2) continue; // leaf-ish only
      const t = normalize(el.textContent);
      if (t.length > 24) continue;
      if (markers.some((m) => t === m || t.startsWith(m))) {
        const unit = feedUnit(el);
        if (unit) hide(unit);
      }
    }
  }

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
