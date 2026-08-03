// Better Web Insta — Feature 4: bulk unsave on the Saved page.
// Only fires on YOUR OWN Saved page (/<you>/saved/...). Injects a "Select"
// control above the post grid; in select mode the user clicks individual saved
// tiles to toggle them, then "Unsave (n)" fully unsaves the selection through
// the throttled queue. No dependence on Instagram's obfuscated CSS classes —
// tiles are found by their /p/<shortcode>/ links and the numeric media id is
// derived locally from the shortcode (see api.shortcodeToMediaId).
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const api = BWI.api;
  const ui = BWI.ui;
  const queue = BWI.queue;
  const L = cfg.LABELS;

  const TILE_SEL =
    'a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]';
  // Same selector, but each alternative scoped to <main> (a plain
  // "main " + TILE_SEL prefix would only scope the FIRST alternative, letting
  // off-grid reel/tv links leak in and throw off the grid walk-up).
  const MAIN_TILE_SEL = TILE_SEL.split(",")
    .map((s) => "main " + s.trim())
    .join(", ");

  let ownUsername = null;

  // Selection state lives at module scope so it survives Instagram's React
  // re-renders (which can replace the grid / toolbar nodes under us).
  const selected = new Set(); // shortcodes
  let selecting = false;
  let running = false;

  // Live references to the currently-injected pieces.
  let grid = null;
  let toolbar = null;
  let els = null; // { selectBtn, unsaveBtn, stopBtn, progress }
  let confirmPending = false;
  let confirmTimer = null;

  api
    .getOwnUsername()
    .then((u) => {
      ownUsername = u;
      maybeInject();
    })
    .catch(() => {});

  function isOwnSavedPath() {
    if (!ownUsername) return false;
    const p = location.pathname.toLowerCase().replace(/\/+$/, "");
    return p === `/${ownUsername.toLowerCase()}/saved` ||
      p.startsWith(`/${ownUsername.toLowerCase()}/saved/`);
  }

  function shortcodeFromHref(href) {
    if (!href) return null;
    const m = href.match(/\/(?:p|reel|tv)\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  // The smallest ancestor that contains every saved-post tile = the grid.
  function findGrid() {
    const anchors = document.querySelectorAll(MAIN_TILE_SEL);
    if (anchors.length < 1) return null;
    let el = anchors[0].parentElement;
    while (el && el !== document.body) {
      if (el.querySelectorAll(TILE_SEL).length >= anchors.length) return el;
      el = el.parentElement;
    }
    return null;
  }

  // Instagram's Saved page has two shapes: the collections INDEX
  // (/<you>/saved/) whose tiles are collection folders (links to
  // /<you>/saved/<collection>/, no /p/ posts), and a specific collection or
  // "All posts" (/<you>/saved/all-posts/) which shows the actual saved-post
  // grid. Bulk unsave only has posts to act on in the latter, so on the bare
  // index we show a one-time hint instead of a dead toolbar.
  function onCollectionsIndex() {
    if (!ownUsername) return false;
    const p = location.pathname.toLowerCase().replace(/\/+$/, "");
    return p === `/${ownUsername.toLowerCase()}/saved`;
  }
  let indexHintShown = false;

  function tileAnchors() {
    return grid ? Array.from(grid.querySelectorAll(TILE_SEL)) : [];
  }

  function findTile(shortcode) {
    return tileAnchors().find(
      (a) => shortcodeFromHref(a.getAttribute("href")) === shortcode
    );
  }

  // ---- Toolbar -------------------------------------------------------------

  function buildToolbar() {
    const bar = document.createElement("div");
    bar.className = "bwi-saved-toolbar";
    bar.setAttribute("data-bwi", "saved-toolbar");

    const progress = document.createElement("span");
    progress.className = "bwi-saved-progress";

    const selectBtn = document.createElement("button");
    selectBtn.className = "bwi-btn bwi-btn--ghost";
    selectBtn.textContent = L.select;

    const unsaveBtn = document.createElement("button");
    unsaveBtn.className = "bwi-btn bwi-btn--danger";
    unsaveBtn.textContent = L.unsave;
    unsaveBtn.style.display = "none";

    const stopBtn = document.createElement("button");
    stopBtn.className = "bwi-btn bwi-btn--ghost";
    stopBtn.textContent = "Stop";
    stopBtn.style.display = "none";

    selectBtn.addEventListener("click", onToggleSelect);
    unsaveBtn.addEventListener("click", onUnsave);
    stopBtn.addEventListener("click", () => queue.stop());

    bar.appendChild(progress);
    bar.appendChild(selectBtn);
    bar.appendChild(unsaveBtn);
    bar.appendChild(stopBtn);

    return { bar, selectBtn, unsaveBtn, stopBtn, progress };
  }

  function ensureToolbar() {
    const g = findGrid();
    if (!g) return;

    // Re-inject if the grid changed or our toolbar got torn out by a re-render.
    if (g === grid && toolbar && document.contains(toolbar)) return;

    // The grid node was replaced but our old toolbar may have survived the
    // re-render — remove it so we never show two toolbars.
    if (toolbar && toolbar.parentNode) toolbar.remove();

    grid = g;
    const built = buildToolbar();
    toolbar = built.bar;
    els = built;

    grid.parentNode.insertBefore(toolbar, grid);

    // Restore visual state across re-injection.
    setSelectingClass();
    syncControls();
    reapplyOverlays();
  }

  function setSelectingClass() {
    if (grid) grid.classList.toggle("bwi-selecting", selecting);
  }

  // Reflect current state onto the toolbar buttons.
  function syncControls() {
    if (!els) return;
    els.selectBtn.textContent = selecting ? L.cancelSelect : L.select;
    els.selectBtn.style.display = running ? "none" : "";
    els.stopBtn.style.display = running ? "" : "none";

    if (selecting && !running) {
      els.unsaveBtn.style.display = "";
      els.unsaveBtn.disabled = selected.size === 0;
      if (!confirmPending) {
        els.unsaveBtn.textContent =
          selected.size > 0 ? `${L.unsave} (${selected.size})` : L.unsave;
      }
    } else {
      els.unsaveBtn.style.display = "none";
    }
  }

  function setProgress(msg) {
    if (els) els.progress.textContent = msg || "";
  }

  // ---- Selection -----------------------------------------------------------

  function onToggleSelect() {
    selecting = !selecting;
    if (!selecting) clearSelection();
    setSelectingClass();
    resetConfirm();
    syncControls();
    reapplyOverlays();
  }

  function clearSelection() {
    selected.clear();
    tileAnchors().forEach(stripOverlay);
  }

  // Capture-phase so we intercept the click before Instagram's delegated
  // navigation handler (and the anchor's own default) ever run.
  function onGridClick(e) {
    if (!selecting || running || !grid) return;
    const a = e.target.closest(TILE_SEL);
    if (!a || !grid.contains(a)) return;
    const sc = shortcodeFromHref(a.getAttribute("href"));
    if (!sc) return;
    e.preventDefault();
    e.stopPropagation();
    if (selected.has(sc)) {
      selected.delete(sc);
    } else {
      selected.add(sc);
    }
    reapplyOverlays();
    resetConfirm();
    syncControls();
  }

  function addOverlay(a) {
    a.classList.add("bwi-tile", "bwi-tile--selected");
    if (!a.querySelector(".bwi-tile-check")) {
      const check = document.createElement("div");
      check.className = "bwi-tile-check";
      check.textContent = "✓";
      a.appendChild(check);
    }
  }

  function stripOverlay(a) {
    a.classList.remove("bwi-tile--selected", "bwi-tile--done");
    const check = a.querySelector(".bwi-tile-check");
    if (check) check.remove();
  }

  // Sync overlays to the selected set. Needed because Instagram virtualizes the
  // grid — DOM nodes get recycled to show different posts as you scroll, so a
  // node's overlay must follow the shortcode it currently shows, not the node.
  function reapplyOverlays() {
    if (!grid) return;
    tileAnchors().forEach((a) => {
      if (selecting) a.classList.add("bwi-tile");
      else a.classList.remove("bwi-tile");
      const sc = shortcodeFromHref(a.getAttribute("href"));
      if (selecting && sc && selected.has(sc)) addOverlay(a);
      else stripOverlay(a);
    });
  }

  // ---- Unsave --------------------------------------------------------------

  function resetConfirm() {
    confirmPending = false;
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  }

  function onUnsave() {
    if (running || selected.size === 0) return;

    // Two-click inline confirm (no window.confirm — it would block the page).
    if (!confirmPending) {
      confirmPending = true;
      els.unsaveBtn.textContent = `Confirm unsave (${selected.size})?`;
      confirmTimer = setTimeout(() => {
        resetConfirm();
        syncControls();
      }, 4000);
      return;
    }
    resetConfirm();

    const items = [];
    let dropped = 0;
    selected.forEach((sc) => {
      const pk = api.shortcodeToMediaId(sc);
      if (pk) items.push({ pk, shortcode: sc });
      else dropped++;
    });
    if (dropped) ui.toast(`Skipped ${dropped} post(s) — couldn't resolve id`);
    if (items.length === 0) {
      syncControls();
      return;
    }
    if (cfg.DRY_RUN) ui.toast("DRY_RUN on — nothing will actually be sent");

    running = true;
    syncControls();

    queue.onProgress((s) => {
      if (s.phase === "start") {
        if (s.cap < items.length) {
          ui.toast(
            `Capped at ${s.cap} this run (daily/session limit). Run again later for the rest.`
          );
        }
        setProgress(`Unsaving 0/${s.cap}…`);
      } else if (s.phase === "done-one") {
        const sc = s.current.shortcode;
        selected.delete(sc);
        const a = findTile(sc);
        if (a) {
          a.classList.add("bwi-tile--done");
          addOverlay(a);
        }
        setProgress(`Unsaved ${s.done}/${s.cap}…`);
      } else if (s.phase === "fail-one") {
        // leave it selected so the user can retry
      } else if (s.phase === "stopped") {
        const reasons = {
          user: "Stopped.",
          "daily-cap": "Daily limit reached — try again tomorrow.",
          "action-block":
            "Instagram action-blocked the account — stopped. Wait a while before retrying.",
        };
        finishRun(`${reasons[s.reason] || "Stopped."} Unsaved ${s.done}.`);
        ui.toast(reasons[s.reason] || "Stopped");
      } else if (s.phase === "complete") {
        finishRun(
          `Done — unsaved ${s.done}${s.failed ? `, ${s.failed} failed` : ""}.`
        );
        if (s.done === 0 && s.failed > 0) {
          ui.toast("All unsaves failed — Instagram may have changed the unsave API");
        }
      }
    });

    queue.run(items, "unsave", {
      minDelay: cfg.UNSAVE.MIN_DELAY_MS,
      maxDelay: cfg.UNSAVE.MAX_DELAY_MS,
      sessionCap: cfg.UNSAVE.SESSION_CAP,
      dailyCap: cfg.UNSAVE.DAILY_CAP,
      dailyKey: cfg.UNSAVE.DAILY_KEY,
    });
  }

  function finishRun(msg) {
    running = false;
    setProgress(msg);
    syncControls();
    reapplyOverlays();
  }

  // ---- Lifecycle -----------------------------------------------------------

  function maybeInject() {
    if (!isOwnSavedPath()) {
      teardown();
      return;
    }
    // On the bare collections index there's no post grid to act on — point the
    // user at "All posts" (or a collection) once, rather than sitting silent.
    if (onCollectionsIndex() && !findGrid()) {
      teardown();
      if (!indexHintShown) {
        indexHintShown = true;
        ui.toast('Open "All posts" (or a collection) to bulk-unsave saved posts');
      }
      return;
    }
    ensureToolbar();
    reapplyOverlays();
  }

  function teardown() {
    if (!toolbar && !grid) return;
    if (grid) {
      grid.classList.remove("bwi-selecting");
      tileAnchors().forEach(stripOverlay);
    }
    if (toolbar && toolbar.parentNode) toolbar.parentNode.removeChild(toolbar);
    selecting = false;
    running = false;
    selected.clear();
    resetConfirm();
    grid = null;
    toolbar = null;
    els = null;
  }

  // One capture-phase listener at the document level routes to whatever grid is
  // current, so it keeps working even when the grid node is replaced.
  document.addEventListener("click", onGridClick, true);

  const observer = new MutationObserver(() => maybeInject());
  observer.observe(document.body, { childList: true, subtree: true });

  // Catch SPA navigations that don't mutate <body> immediately.
  window.addEventListener("popstate", maybeInject);

  maybeInject();
})();
