// Better Web Insta — Feature 1: shift-click instant unfollow / remove.
// We don't fight Instagram's React handlers or call private APIs here. We let
// Instagram open its own confirmation dialog as usual, then instantly click
// that dialog's destructive button. Resolves in well under 100ms, so it looks
// instant — and it's maximally resilient because it rides Instagram's own flow.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const ui = BWI.ui;
  const LABELS = cfg.LABELS;

  // Set briefly when the user shift-clicks a row's trigger button. `expect`
  // is the destructive label we then auto-click in the confirmation dialog.
  let pending = null; // { expect: string, at: number }
  const PENDING_TTL_MS = 2000;

  function pendingActive() {
    return pending && Date.now() - pending.at < PENDING_TTL_MS;
  }

  // Is `el` a row trigger button ("Following" or "Remove") inside a list
  // dialog? Returns the destructive label to confirm, or null.
  function triggerLabelFor(el) {
    const btn = el.closest && el.closest('button, [role="button"]');
    if (!btn) return null;
    if (!btn.closest('[role="dialog"]')) return null; // only inside list modals
    const t = ui.text(btn);
    if (t === LABELS.following) return LABELS.unfollow; // following list
    if (t === LABELS.remove) return LABELS.remove; // followers list
    return null;
  }

  // Capture phase so we see the click before Instagram's own handler runs.
  document.addEventListener(
    "click",
    (e) => {
      if (!e.shiftKey) return;
      const expect = triggerLabelFor(e.target);
      if (!expect) return;
      // Don't preventDefault — we want IG to open its confirm dialog.
      pending = { expect, at: Date.now() };
    },
    true
  );

  // A dialog that contains both a destructive-text button and a Cancel button
  // is the confirmation dialog (the list modal has the row buttons but no
  // Cancel button).
  function findConfirmButton(dialog, expectLabel) {
    const destructive = ui.findButtonByText(dialog, expectLabel);
    const cancel = ui.findButtonByText(dialog, LABELS.cancel);
    if (destructive && cancel) return destructive;
    return null;
  }

  function tryAutoConfirm(node) {
    if (!pendingActive()) return;
    const dialogs =
      node.matches && node.matches('[role="dialog"]')
        ? [node]
        : node.querySelectorAll
        ? Array.from(node.querySelectorAll('[role="dialog"]'))
        : [];
    for (const dialog of dialogs) {
      const btn = findConfirmButton(dialog, pending.expect);
      if (btn) {
        const wasRemove = pending.expect === LABELS.remove;
        pending = null;
        btn.click();
        ui.toast(wasRemove ? "Follower removed" : "Unfollowed");
        return;
      }
    }
  }

  const observer = new MutationObserver((mutations) => {
    if (!pendingActive()) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) tryAutoConfirm(node);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
