// Socialfix — Reddit: hide promoted posts.
// (FEATURE_FEASIBILITY_REPORT.md §3.10.)
//
// Read-only DOM filter — no mutation, no API, works logged-out, zero ban risk.
// Reddit's 2026 ad policy mandates a visible, non-removable "Promoted" label,
// and new Reddit tags ads with the semantic <shreddit-ad-post> element — those
// are the stable hooks (NOT the obfuscated .promotedlink class or
// data-google-query-id, which churn). Marker text lives in cfg.REDDIT.LABELS.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const R = cfg.REDDIT;

  if (!R.HIDE_PROMOTED) return;

  const MARK = "data-bwi-hidden";
  const markers = R.LABELS.promotedMarkers.map((s) => s.toLowerCase());

  function hide(el) {
    if (!el || el.hasAttribute(MARK)) return;
    el.setAttribute(MARK, "1");
    el.style.setProperty("display", "none", "important");
  }

  function sweep() {
    // New Reddit (shreddit): semantic ad element.
    document.querySelectorAll("shreddit-ad-post").forEach((el) => {
      hide(el.closest("article") || el.closest("shreddit-post") || el);
    });

    // Any post container carrying a short standalone "Promoted" label. We scope
    // to plausible post containers and require an exact/short match so a comment
    // merely using the word "promoted" isn't hidden.
    const containers = document.querySelectorAll(
      'shreddit-post, article, .thing, div[data-testid="post-container"]'
    );
    containers.forEach((c) => {
      if (c.hasAttribute(MARK)) return;
      const spans = c.querySelectorAll("span, a, p, small");
      for (const s of spans) {
        const t = (s.textContent || "").trim().toLowerCase();
        if (t.length <= 12 && markers.includes(t)) {
          hide(c.closest("article") || c);
          break;
        }
      }
    });
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
