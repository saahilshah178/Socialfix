// Better Web Insta — Feature 3: bigger Followers/Following modals.
// Instagram's followers/following list modals are small, which leaves little
// room once Feature 2 injects its subsection. This widens and heightens BOTH
// list modals (any profile, not just your own) by tagging the dialog + its
// scroll container with our classes; the actual sizing lives in styles.css so
// it survives Instagram's React re-renders better than inline styles would.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const ui = BWI.ui;

  if (!cfg.BIGGER_MODALS) return;

  // Expose the configured size to CSS via custom properties.
  const docEl = document.documentElement;
  docEl.style.setProperty("--bwi-modal-w", cfg.MODAL_WIDTH_PX + "px");
  docEl.style.setProperty("--bwi-modal-h", cfg.MODAL_HEIGHT_VH + "vh");

  function isListDialog(dialog) {
    return (
      ui.dialogTitleIs(dialog, cfg.LABELS.followers) ||
      ui.dialogTitleIs(dialog, cfg.LABELS.following)
    );
  }

  function ensureBig(dialog) {
    // Fully tagged already — cheap exit so we don't rescan every mutation.
    if (
      dialog.classList.contains("bwi-big-dialog") &&
      dialog.querySelector(".bwi-big-scroll")
    ) {
      return;
    }
    if (!isListDialog(dialog)) return;

    dialog.classList.add("bwi-big-dialog");
    // The scrollable list may not exist yet on first paint; a later scan will
    // catch it once rows render.
    const scroll = ui.findScrollContainer(dialog);
    if (scroll) {
      scroll.classList.add("bwi-big-scroll");
      // Nudge any ResizeObserver/AutoSizer (Instagram virtualizes the list) to
      // recompute how many rows fit in the now-taller viewport.
      window.dispatchEvent(new Event("resize"));
    }
  }

  // Coalesce bursts of mutations into one scan per frame.
  let scheduled = false;
  function scan() {
    scheduled = false;
    for (const d of ui.getDialogs()) ensureBig(d);
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  schedule(); // catch a modal that's already open on load
})();
