// Better Web Insta — Feature 3: bigger Followers/Following modals.
// Instagram's list modals are small. We enlarge BOTH (any profile) so there's
// room for the native list and the Feature 2 subsection.
//
// Why this is fiddly: [role="dialog"] is only a centering wrapper — the visible
// rounded "card" is a descendant, and the scrollable user list is virtualized
// (react-window) with its height set inline, which the virtualizer reads to
// decide how many rows to mount. So we must (a) find the real card by structure
// (the rounded/opaque box just inside the full-viewport overlay), (b) size the
// card AND the scroll container, and (c) re-apply when React strips our inline
// styles, dispatching resize so any AutoSizer recomputes.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const ui = BWI.ui;

  if (!cfg.BIGGER_MODALS) return;

  // dialog -> { card, scroll } so we don't re-run the expensive DOM scans on
  // every frame (the modal can hold hundreds of nodes).
  const sized = new WeakMap();

  function isListDialog(dialog) {
    return (
      ui.dialogTitleIs(dialog, cfg.LABELS.followers) ||
      ui.dialogTitleIs(dialog, cfg.LABELS.following)
    );
  }

  // The visible "card" is the rounded, opaque box that bounds the modal — not
  // [role="dialog"] (a transparent centering wrapper) and not the full-viewport
  // overlay. Climb from the scroll container toward the overlay and pick the
  // OUTERMOST element that still looks like a styled box (border-radius or an
  // opaque background). Sizing it makes transparent wrappers shrink-wrap to it.
  function findCard(dialog, scroll) {
    const overlayW = window.innerWidth * 0.9;
    let node = scroll ? scroll.parentElement : dialog;
    let best = null;
    let safety = 0;
    while (node && node !== document.body && safety++ < 40) {
      if (node.getBoundingClientRect().width >= overlayW) break; // hit the overlay
      const cs = getComputedStyle(node);
      const radius = parseFloat(cs.borderTopLeftRadius) || 0;
      const bg = cs.backgroundColor;
      const opaque = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
      if (radius >= 4 || opaque) best = node; // outermost styled box
      node = node.parentElement;
    }
    return best || (scroll && scroll.parentElement) || dialog;
  }

  function applySize(card, scroll) {
    const wPx = Math.min(cfg.MODAL_WIDTH_PX, Math.round(window.innerWidth * 0.95));
    const hPx = Math.round((window.innerHeight * cfg.MODAL_HEIGHT_VH) / 100);

    card.classList.add("bwi-big-card");
    card.style.setProperty("width", wPx + "px", "important");
    card.style.setProperty("max-width", "95vw", "important");
    card.style.setProperty("height", hPx + "px", "important");
    card.style.setProperty("max-height", "95vh", "important");
    card.style.setProperty("display", "flex", "important");
    card.style.setProperty("flex-direction", "column", "important");

    // Make the scroll list fill the rest of the taller card. flex:1 governs the
    // real height (so it shrinks to share space with our subsection); the
    // explicit height is the virtualizer's hint to mount more rows.
    scroll.classList.add("bwi-big-scroll");
    const offsetTop =
      scroll.getBoundingClientRect().top - card.getBoundingClientRect().top;
    const fill = Math.max(160, hPx - offsetTop - 8);
    scroll.style.setProperty("flex", "1 1 auto", "important");
    scroll.style.setProperty("min-height", "0", "important");
    scroll.style.setProperty("height", fill + "px", "important");
    scroll.style.setProperty("max-height", "none", "important");

    // Nudge any ResizeObserver/AutoSizer to recompute the visible row window.
    window.dispatchEvent(new Event("resize"));
  }

  function ensureBig(dialog) {
    const rec = sized.get(dialog);
    if (rec && rec.card.isConnected && rec.scroll.isConnected) {
      // Cheap path: only re-apply if React stripped our inline width.
      if (!rec.card.style.getPropertyValue("width")) applySize(rec.card, rec.scroll);
      return;
    }
    if (!isListDialog(dialog)) return;
    const scroll = ui.findScrollContainer(dialog);
    if (!scroll) return; // rows not mounted yet; a later scan will catch it
    const card = findCard(dialog, scroll);
    if (!card) return;
    sized.set(dialog, { card, scroll });
    applySize(card, scroll);
  }

  // Coalesce mutation bursts into one pass per frame.
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
  window.addEventListener("resize", schedule);
  schedule(); // catch a modal already open on load
})();
