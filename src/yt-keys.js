// Better Web Insta — YouTube: keyboard shortcut gap-fills.
// (FEATURE_FEASIBILITY_REPORT.md §3.14.)
//
// YouTube ships a big native shortcut set (K/J/L/F/M/C/T/I, 0-9, arrows,
// Shift+N/P, </> speed, / search) but omits shortcuts for Like, Save-to-
// playlist, Subscribe, and jumping to the comment box. This fills exactly
// those gaps and nothing else — identical in spirit to IG Feature 5: a
// capture-phase keydown listener that clicks YouTube's own on-screen buttons,
// resolved by aria-label / visible text (never class names). Single actions on
// your own account → no queue, no DRY_RUN needed (nothing bulk or destructive;
// Subscribe requires Shift so it can't fire by accident).
//
// The default keys (E, Shift+E, Shift+U, N — see cfg.YT.KEYS) deliberately
// avoid every native binding. All keys no-op while typing (inputs, textareas,
// contenteditable — so comments and search are untouched) and when
// Ctrl/Alt/Meta is held.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const ui = BWI.ui;
  const YT = cfg.YT;
  const L = YT.LABELS;

  if (!YT.SHORTCUTS) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function onWatchPage() {
    return location.pathname === "/watch";
  }

  function isTypingContext(el) {
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    // Guard el.closest: a keydown target is normally an Element, but be safe if
    // it's ever a text node / document (which have no .closest) so we never throw
    // out of the listener and silently drop the shortcut.
    return !!(
      el.isContentEditable ||
      (el.closest && el.closest("[contenteditable='true']"))
    );
  }

  // The watch page's own metadata block — scoping keeps us off look-alike
  // buttons in recommendations/playlists.
  function watchMeta() {
    return document.querySelector("ytd-watch-metadata") || document;
  }

  function findByAriaPrefix(root, prefix) {
    const p = prefix.toLowerCase();
    const nodes = root.querySelectorAll("button[aria-label], [role='button'][aria-label]");
    for (const n of nodes) {
      if ((n.getAttribute("aria-label") || "").trim().toLowerCase().startsWith(p)) return n;
    }
    return null;
  }

  function findByExactText(root, label) {
    const nodes = root.querySelectorAll("button, [role='button']");
    for (const n of nodes) {
      if ((n.textContent || "").trim() === label) return n;
    }
    return null;
  }

  // ---- the four actions ------------------------------------------------------

  function doLike() {
    const btn = findByAriaPrefix(watchMeta(), L.likePrefix);
    if (!btn) {
      ui.toast("Like button not found");
      return;
    }
    const wasPressed = btn.getAttribute("aria-pressed") === "true";
    btn.click();
    ui.toast(wasPressed ? "Like removed" : "Liked ✓");
  }

  async function doSave() {
    const meta = watchMeta();
    // The Save button is visible on wide layouts…
    const direct =
      findByAriaPrefix(meta, L.saveAria) || findByExactText(meta, L.saveMenuItem);
    if (direct) {
      direct.click();
      return;
    }
    // …otherwise it lives in the ⋯ overflow menu.
    const more = findByAriaPrefix(meta, L.moreActions);
    if (!more) {
      ui.toast("Save button not found");
      return;
    }
    more.click();
    const target = L.saveMenuItem.toLowerCase();
    for (let tries = 0; tries < 15; tries++) {
      await sleep(100);
      const items = document.querySelectorAll(
        "ytd-menu-service-item-renderer, tp-yt-paper-item"
      );
      for (const el of items) {
        const t = (el.textContent || "").trim().toLowerCase();
        if (t === target || t.startsWith(target + " ")) {
          el.click();
          return;
        }
      }
    }
    document.body.click(); // close the abandoned menu
    ui.toast("Save menu item not found");
  }

  function doSubscribe() {
    const btn = findByExactText(watchMeta(), L.subscribe);
    if (!btn) {
      // No "Subscribe" button usually means you're already subscribed (the
      // button reads "Subscribed"). Don't click that — it opens unsubscribe.
      ui.toast("Already subscribed (or button not found)");
      return;
    }
    btn.click();
    ui.toast("Subscribed ✓");
  }

  function doCommentFocus() {
    const comments = document.querySelector("ytd-comments");
    if (!comments) {
      ui.toast("Comments not available");
      return;
    }
    comments.scrollIntoView({ block: "center", behavior: "smooth" });
    // The real click target is the placeholder CONTAINER (#placeholder-area) —
    // clicking the inner "Add a comment…" text node alone doesn't open the
    // editor. Prefer the container; fall back to the text node's clickable
    // ancestor if YouTube renames the id.
    const area = comments.querySelector("#placeholder-area");
    if (area) {
      area.click();
      return;
    }
    const nodes = comments.querySelectorAll("div, span, yt-formatted-string");
    for (const n of nodes) {
      const t = (n.textContent || "").trim();
      if (t.startsWith(L.commentPlaceholder) && t.length < 40) {
        (n.closest("#placeholder-area, ytd-comment-simplebox-renderer, button, [role='button']") || n).click();
        return;
      }
    }
    // Placeholder may still be below the fold / lazy — the scroll alone helps.
  }

  // ---- dispatch ------------------------------------------------------------------

  const ACTIONS = {
    like: doLike,
    save: doSave,
    subscribe: doSubscribe,
    commentFocus: doCommentFocus,
  };

  document.addEventListener(
    "keydown",
    (e) => {
      if (!onWatchPage()) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (isTypingContext(e.target)) return;

      const key = (e.key || "").toLowerCase();
      for (const name of Object.keys(ACTIONS)) {
        const b = YT.KEYS[name];
        if (!b || key !== b.key || e.shiftKey !== !!b.shift) continue;
        e.preventDefault();
        e.stopPropagation();
        ACTIONS[name]();
        return;
      }
    },
    true
  );
})();
