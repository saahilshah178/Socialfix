// Socialfix — Feature 1: shift-click instant unfollow / remove.
// We don't fight Instagram's React handlers or call private APIs here. We let
// Instagram open its own confirmation UI as usual, then instantly click its
// destructive button. Resolves in well under 100ms, so it looks instant — and
// it's maximally resilient because it rides Instagram's own flow.
//
// Hardened after the Aug 3 audit ("unfollowing from insta menu not working").
// Instagram's confirm UI now varies: it can open a NEW dialog, swap the
// confirm INTO the already-open list dialog, or show an options sheet
// ("Add to favorites / Mute / Restrict / Unfollow") with no Cancel button —
// sometimes chaining into a second "Unfollow?" confirm. We handle all of
// those: scan added nodes AND their enclosing dialog, accept alertdialogs,
// accept Cancel-less sheets under strict safety guards, allow one chained
// second click, and never touch buttons inside our own [data-bwi] panels.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const ui = BWI.ui;
  const LABELS = cfg.LABELS;

  const DIALOG_SEL = '[role="dialog"], [role="alertdialog"]';

  // Set briefly when the user shift-clicks a row's trigger button. `expect` is
  // the destructive label we then auto-click in Instagram's confirmation UI.
  // `chained` allows ONE follow-up click: an options-sheet "Unfollow" can lead
  // to a second, classic "Unfollow?" confirm. That follow-up is deliberately
  // narrow — see tryAutoConfirm.
  let pending = null; // { expect, at, chained: boolean, toasted: boolean }
  const PENDING_TTL_MS = 2500;
  // The chained follow-up must arrive promptly (it's the same interaction), and
  // it must be a classic Cancel-bearing confirm. A generous window here is what
  // let an ordinary un-shifted click on ANOTHER row get auto-confirmed.
  const CHAIN_TTL_MS = 1200;

  // True while WE are clicking a button, so our own synthetic click events
  // don't look like user clicks to the disarm logic below.
  let selfClicking = false;

  function pendingActive() {
    if (!pending) return false;
    const ttl = pending.chained ? CHAIN_TTL_MS : PENDING_TTL_MS;
    if (Date.now() - pending.at >= ttl) {
      pending = null;
      return false;
    }
    return true;
  }

  // Is `el` a row trigger button ("Following" or "Remove") inside a list
  // dialog? Returns the destructive label to confirm, or null.
  function triggerLabelFor(el) {
    const btn = el.closest && el.closest('button, [role="button"]');
    if (!btn) return null;
    if (!btn.closest(DIALOG_SEL)) return null; // only inside list modals
    if (btn.closest("[data-bwi]")) return null; // never our own injected UI
    const t = ui.text(btn);
    if (t === LABELS.following) return LABELS.unfollow; // following list
    if (t === LABELS.remove) return LABELS.remove; // followers list
    return null;
  }

  // Capture phase so we see the click before Instagram's own handler runs.
  document.addEventListener(
    "click",
    (e) => {
      if (selfClicking) return; // our own auto-confirm click, not the user's
      if (!e.shiftKey) {
        // ANY ordinary click disarms us. Without this, a still-armed window
        // from a previous shift-click would auto-confirm the options sheet
        // that a later PLAIN click opens on a different row — an unfollow the
        // user never asked for.
        pending = null;
        return;
      }
      const expect = triggerLabelFor(e.target);
      if (!expect) return;
      // Don't preventDefault — we want IG to open its confirm UI.
      pending = { expect, at: Date.now(), chained: false, toasted: false };
    },
    true
  );

  // Everything in `root` whose exact visible text is `label` and is clickable.
  // Prefers real buttons; falls back to exact-text leaf nodes (IG sometimes
  // builds sheet items from plain divs) climbed to their clickable ancestor.
  // Our own injected panels ([data-bwi]) also contain "Unfollow" buttons —
  // those are always excluded.
  function collectMatches(root, label) {
    const out = new Set();
    for (const b of root.querySelectorAll('button, [role="button"]')) {
      if (b.closest("[data-bwi]")) continue;
      if (ui.text(b) === label) out.add(b);
    }
    if (!out.size) {
      for (const el of root.querySelectorAll("div, span")) {
        if (el.childElementCount) continue; // leaves only
        if (ui.text(el) !== label) continue;
        const btn = el.closest('button, [role="button"], [tabindex]');
        if (btn && !btn.closest("[data-bwi]")) out.add(btn);
      }
    }
    return Array.from(out);
  }

  // Find the destructive button to auto-click inside `dialog`, or null. The
  // destructive text must match EXACTLY ONE element (both the classic confirm
  // and the options sheet have exactly one; the followers LIST modal has one
  // "Remove" per row and must never be mistaken for a confirm), and the dialog
  // must look like a confirm: either it has a Cancel button (classic) or it
  // has no text input (options sheet — the list modal always has its search
  // box, a Cancel-less sheet never has an input).
  //
  // `chained` = this is the follow-up click after we already dismissed an
  // options sheet. Only the CLASSIC (Cancel-bearing) confirm is accepted then;
  // accepting a second Cancel-less sheet is how an un-asked-for unfollow slips
  // through, and the real chained dialog always has a Cancel.
  function findConfirmButton(dialog, expectLabel, chained) {
    const matches = collectMatches(dialog, expectLabel);
    if (matches.length !== 1) return null;
    if (ui.findButtonByText(dialog, LABELS.cancel)) return matches[0];
    if (chained) return null;
    if (!dialog.querySelector("input")) return matches[0];
    return null;
  }

  function tryAutoConfirm(dialogs) {
    if (!pendingActive()) return;
    for (const dialog of dialogs) {
      const btn = findConfirmButton(dialog, pending.expect, pending.chained);
      if (!btn) continue;
      const wasRemove = pending.expect === LABELS.remove;
      const toasted = pending.toasted;
      const hadCancel = !!ui.findButtonByText(dialog, LABELS.cancel);
      // A Cancel-bearing dialog IS the final confirm — disarm. A Cancel-less
      // options sheet may chain into one, so arm exactly one short follow-up.
      if (hadCancel || pending.chained) {
        pending = null;
      } else {
        pending = { ...pending, at: Date.now(), chained: true, toasted: true };
      }
      selfClicking = true;
      try {
        btn.click();
      } finally {
        selfClicking = false;
      }
      if (!toasted) ui.toast(wasRemove ? "Follower removed" : "Unfollowed");
      return;
    }
  }

  const observer = new MutationObserver((mutations) => {
    if (!pendingActive()) return;
    const dialogs = new Set();
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        // A whole new dialog (or a subtree containing one)…
        if (node.matches && node.matches(DIALOG_SEL)) dialogs.add(node);
        if (node.querySelectorAll) {
          node.querySelectorAll(DIALOG_SEL).forEach((d) => dialogs.add(d));
        }
        // …or new content swapped INTO an already-open dialog (IG often
        // reuses the dialog container instead of mounting a fresh one).
        const host = node.closest && node.closest(DIALOG_SEL);
        if (host) dialogs.add(host);
      }
    }
    if (dialogs.size) tryAutoConfirm(Array.from(dialogs));
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
