// Better Web Insta — Feature 5: keyboard story navigation (H / L).
// While viewing a story, H jumps to the PREVIOUS user's story and L jumps to the
// NEXT user's story — skipping any remaining frames of the current person. The
// arrow keys already step one frame at a time (rolling into the next person at
// the edges); this gives a one-key way to skip a whole user.
//
// Pure DOM, like Feature 1: we click Instagram's own on-screen control rather
// than reconstructing the tray order. Per repo convention we resolve that
// control by stable URL shape first (the dimmed neighbor-story anchors flanking
// the active story) and fall back to the round chevron buttons by aria-label.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const ui = BWI.ui;

  if (!cfg.STORY_NAV) return;

  const LABELS = cfg.LABELS;
  const KEYS = cfg.STORY_NAV_KEYS;

  // The username segment of a /stories/<user>/... path, or null.
  function storyUserFromPath(path) {
    const segs = path.split("/").filter(Boolean);
    if (segs[0] !== "stories") return null;
    return segs[1] || null;
  }

  function currentStoryUser() {
    return storyUserFromPath(location.pathname.toLowerCase());
  }

  // True when focus is in something the user might be typing into — so plain
  // "h"/"l" in the story reply box, search, etc. are left untouched.
  function isTyping() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    return el.isContentEditable === true;
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Primary lookup: among the neighbor-story anchors flanking the active story,
  // return the one on the requested side (nearest the center). `dir` is -1 for
  // the previous (left) user, +1 for the next (right) user.
  function findAdjacentAnchor(dir, currentUser) {
    const center = window.innerWidth / 2;
    let best = null;
    let bestDist = Infinity;
    const anchors = document.querySelectorAll('a[href^="/stories/"]');
    for (const a of anchors) {
      const user = storyUserFromPath(a.getAttribute("href").toLowerCase());
      if (!user || user === currentUser) continue;
      if (!isVisible(a)) continue;
      const r = a.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const side = cx < center ? -1 : 1; // left vs right of viewport center
      if (side !== dir) continue;
      const dist = Math.abs(cx - center);
      if (dist < bestDist) {
        bestDist = dist;
        best = a;
      }
    }
    return best;
  }

  // Fallback: Instagram's round chevron buttons, matched by aria-label.
  function findChevron(label) {
    const btns = document.querySelectorAll("[aria-label]");
    for (const b of btns) {
      if (b.getAttribute("aria-label") === label && isVisible(b)) return b;
    }
    return null;
  }

  // Resolve the clickable control for a direction. `dir` is -1 (prev) / +1 (next).
  function resolveControl(dir, currentUser) {
    const anchor = findAdjacentAnchor(dir, currentUser);
    if (anchor) return anchor;
    const label = dir < 0 ? LABELS.storyPrev : LABELS.storyNext;
    return findChevron(label);
  }

  // Capture phase so we see the key before Instagram's own handlers.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!location.pathname.toLowerCase().startsWith(cfg.STORY_NAV_PATH_PREFIX))
        return;
      if (isTyping()) return;

      const key = e.key.toLowerCase();
      let dir;
      if (key === KEYS.prev) dir = -1;
      else if (key === KEYS.next) dir = 1;
      else return;

      const currentUser = currentStoryUser();
      if (!currentUser) return;

      e.preventDefault();
      e.stopPropagation();

      const control = resolveControl(dir, currentUser);
      if (control) {
        control.click();
      } else {
        ui.toast(dir < 0 ? "No previous story" : "No next story");
      }
    },
    true
  );
})();
