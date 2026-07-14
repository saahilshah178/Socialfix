// Better Web Insta — X: chronological "Following" feed enforcer.
// (FEATURE_FEASIBILITY_REPORT.md §3.3.)
//
// Pure DOM, no API, no queue. On Home, X resets to the algorithmic "For You"
// tab on every load; this clicks the "Following" tab back (and, best-effort,
// the "Latest/Recent" sort — since Nov 2025 the Following feed is itself ranked
// by default). We switch at most ONCE per navigation so we never fight a user
// who deliberately taps back to "For You".
//
// Tabs are resolved by role="tab" + visible text (cfg.X.LABELS), never by
// class names.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const L = cfg.X.LABELS;

  if (!cfg.X.CHRONO_FEED) return;

  let actedForPath = null; // pathname we last auto-switched on

  const text = (el) => (el && el.textContent ? el.textContent.trim() : "");

  function onHome() {
    return location.pathname === "/home";
  }

  function tabs() {
    return Array.from(document.querySelectorAll('[role="tab"]'));
  }

  function findFollowingTab() {
    return tabs().find((t) => text(t) === L.followingTab) || null;
  }

  function isSelected(tab) {
    return tab && tab.getAttribute("aria-selected") === "true";
  }

  // Best-effort chronological sort. The sort control is an icon button near the
  // tabs that opens a small menu with a "Latest"/"Recent" item. We open it and
  // click that item if present; silently no-op otherwise (markup varies and
  // this is a bonus on top of the Following switch).
  function tryForceLatest() {
    const sortBtn =
      document.querySelector('button[aria-label*="timeline options" i]') ||
      document.querySelector('[data-testid="ScreenNameTimeLineOptions"]') ||
      document.querySelector('button[aria-label*="Timeline options" i]');
    if (!sortBtn) return;
    sortBtn.click();
    setTimeout(() => {
      const items = document.querySelectorAll('[role="menuitem"]');
      for (const it of items) {
        const t = text(it);
        if (L.latestSort.some((s) => t === s || t.startsWith(s))) {
          it.click();
          return;
        }
      }
      // Nothing matched — close the menu we opened so it doesn't linger.
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          which: 27,
          bubbles: true,
        })
      );
    }, 250);
  }

  function enforce() {
    if (!onHome()) {
      actedForPath = null; // reset so returning to Home switches again
      return;
    }
    if (actedForPath === location.pathname) return;

    const following = findFollowingTab();
    if (!following) return; // tabs not rendered yet
    actedForPath = location.pathname; // one attempt per Home visit

    if (!isSelected(following)) {
      following.click();
      if (cfg.X.CHRONO_FORCE_LATEST !== false) setTimeout(tryForceLatest, 400);
    }
  }

  window.addEventListener("popstate", enforce);
  const observer = new MutationObserver(() => enforce());
  observer.observe(document.body, { childList: true, subtree: true });
  enforce();
})();
