// Better Web Insta — YouTube: bulk-remove from Watch Later / Liked videos.
// (FEATURE_FEASIBILITY_REPORT.md §3.12 / §3.13.)
//
// Pure DOM automation in the spirit of IG Feature 1: on /playlist?list=WL or
// ?list=LL we inject a Select-mode toolbar over the playlist rows; each queued
// removal opens the row's own ⋮ menu and clicks YouTube's native
// "Remove from ..." item, so we ride YouTube's real flow (no InnerTube calls,
// no SAPISIDHASH). Every removal goes through the shared queue.js with
// deliberately slow 5-8s delays: YouTube processes deletions asynchronously
// and firing faster makes items reappear on refresh.
//
// Selectors: semantic custom-element TAG names (ytd-playlist-video-renderer,
// ytd-menu-service-item-renderer — stable for years, unlike class names),
// aria-labels, and visible menu text from cfg.YT.LABELS. Selection is tracked
// by videoId (parsed from each row's /watch?v= link), not by DOM node.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const ui = BWI.ui;
  const queue = BWI.queue;
  const YT = cfg.YT;
  const L = YT.LABELS;

  if (!YT.BULK_PLAYLIST) return;

  const ROW_TAG = "ytd-playlist-video-renderer";
  const MENU_ITEM_TAG = "ytd-menu-service-item-renderer";

  let toolbar = null;
  let els = null; // { selectBtn, selectAllBtn, removeBtn, stopBtn, progress }
  let selecting = false;
  let running = false;
  const selected = new Set(); // videoIds
  let confirmPending = false;
  let confirmTimer = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- page detection --------------------------------------------------------

  // The playlist definition ({name, menuItem, dailyKey}) for the current URL,
  // or null when not on a supported playlist page.
  function activePlaylist() {
    if (location.pathname !== "/playlist") return null;
    const id = new URLSearchParams(location.search).get("list");
    return (id && YT.PLAYLISTS[id]) || null;
  }

  // ---- row helpers -------------------------------------------------------------

  function allRows() {
    return Array.from(document.querySelectorAll(ROW_TAG));
  }

  function videoIdOfRow(row) {
    const a = row.querySelector('a[href*="watch?v="]');
    if (!a) return null;
    const href = a.getAttribute("href") || "";
    const q = href.split("?")[1] || "";
    return new URLSearchParams(q).get("v");
  }

  function rowForVideoId(vid) {
    for (const row of allRows()) {
      if (videoIdOfRow(row) === vid) return row;
    }
    return null;
  }

  function findByAria(root, label) {
    const nodes = root.querySelectorAll("button[aria-label], [role='button'][aria-label]");
    for (const n of nodes) {
      if ((n.getAttribute("aria-label") || "").trim() === label) return n;
    }
    return null;
  }

  // ---- the queued removal action ----------------------------------------------
  // One item = one row: open its ⋮ menu, click the native "Remove from ..."
  // item, wait for YouTube to drop the row. Throws on any miss so queue.js
  // counts it as failed and moves on.

  async function removeOne(item, menuItemText) {
    if (cfg.DRY_RUN) {
      console.log(`[BWI][DRY_RUN] YT remove ${item.pk} via "${menuItemText}" (not clicked)`);
      return;
    }

    const row = rowForVideoId(item.pk);
    if (!row) throw new Error("row not found for " + item.pk);
    row.scrollIntoView({ block: "center" });

    // Open the row's ⋮ menu. Exact aria-label first; fall back to the only
    // button inside the row's menu renderer.
    const menuBtn =
      findByAria(row, L.actionMenu) ||
      row.querySelector("ytd-menu-renderer button, ytd-menu-renderer [role='button']");
    if (!menuBtn) throw new Error("action-menu button not found");
    menuBtn.click();

    // The dropdown renders into a top-level popup container a beat later.
    const target = menuItemText.toLowerCase();
    let clicked = false;
    for (let tries = 0; tries < 20 && !clicked; tries++) {
      await sleep(120);
      const items = document.querySelectorAll(MENU_ITEM_TAG + ", tp-yt-paper-item");
      for (const el of items) {
        const t = (el.textContent || "").trim().toLowerCase();
        if (t && (t === target || t.includes(target))) {
          el.click();
          clicked = true;
          break;
        }
      }
    }
    if (!clicked) {
      // Close the abandoned dropdown so it doesn't swallow the next open.
      document.body.click();
      throw new Error(`menu item "${menuItemText}" not found`);
    }

    // Best-effort: wait for YouTube to detach the row (confirms the removal
    // registered). Not fatal if it lingers — deletions are processed async.
    for (let tries = 0; tries < 25 && row.isConnected; tries++) await sleep(200);
  }

  // ---- selection UI --------------------------------------------------------------

  function setRowClass(row, on) {
    row.classList.toggle("bwi-yt-selected", on);
  }

  function reapplyOverlays() {
    allRows().forEach((row) => {
      const vid = videoIdOfRow(row);
      setRowClass(row, !!vid && selected.has(vid));
    });
  }

  function clearSelection() {
    selected.clear();
    allRows().forEach((row) => setRowClass(row, false));
  }

  // Capture-phase click interception while selecting (same pattern as IG
  // Feature 4): a click anywhere in a row toggles it instead of navigating.
  document.addEventListener(
    "click",
    (e) => {
      if (!selecting || running) return;
      if (!activePlaylist()) return;
      if (toolbar && toolbar.contains(e.target)) return; // toolbar buttons work normally
      const row = e.target.closest(ROW_TAG);
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      const vid = videoIdOfRow(row);
      if (!vid) return;
      if (selected.has(vid)) selected.delete(vid);
      else selected.add(vid);
      setRowClass(row, selected.has(vid));
      resetConfirm();
      syncControls();
    },
    true
  );

  // ---- toolbar ----------------------------------------------------------------------

  function buildToolbar(def) {
    const bar = document.createElement("div");
    bar.className = "bwi-yt-toolbar";
    bar.setAttribute("data-bwi", "yt-bulk");

    const title = document.createElement("span");
    title.className = "bwi-yt-title";
    title.textContent = `Bulk remove — ${def.name}`;

    const progress = document.createElement("span");
    progress.className = "bwi-saved-progress";

    const selectBtn = document.createElement("button");
    selectBtn.className = "bwi-btn bwi-btn--ghost";
    selectBtn.textContent = L.select;
    selectBtn.addEventListener("click", () => {
      if (running) return;
      selecting = !selecting;
      if (!selecting) clearSelection();
      resetConfirm();
      document.documentElement.classList.toggle("bwi-yt-selecting", selecting);
      syncControls();
    });

    const selectAllBtn = document.createElement("button");
    selectAllBtn.className = "bwi-btn bwi-btn--ghost";
    selectAllBtn.textContent = L.selectAll;
    selectAllBtn.addEventListener("click", () => {
      if (!selecting || running) return;
      allRows().forEach((row) => {
        const vid = videoIdOfRow(row);
        if (vid) selected.add(vid);
      });
      reapplyOverlays();
      resetConfirm();
      syncControls();
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "bwi-btn bwi-btn--primary";
    removeBtn.style.display = "none";
    removeBtn.addEventListener("click", () => onRemove(def));

    const stopBtn = document.createElement("button");
    stopBtn.className = "bwi-btn bwi-btn--danger";
    stopBtn.textContent = "Stop";
    stopBtn.style.display = "none";
    stopBtn.addEventListener("click", () => queue.stop());

    bar.appendChild(title);
    bar.appendChild(progress);
    bar.appendChild(selectBtn);
    bar.appendChild(selectAllBtn);
    bar.appendChild(removeBtn);
    bar.appendChild(stopBtn);

    els = { selectBtn, selectAllBtn, removeBtn, stopBtn, progress };
    return bar;
  }

  function syncControls() {
    if (!els) return;
    els.selectBtn.textContent = selecting ? L.cancelSelect : L.select;
    els.selectBtn.style.display = running ? "none" : "";
    els.selectAllBtn.style.display = selecting && !running ? "" : "none";
    els.stopBtn.style.display = running ? "" : "none";
    if (selecting && !running) {
      els.removeBtn.style.display = "";
      els.removeBtn.disabled = selected.size === 0;
      if (!confirmPending) {
        els.removeBtn.textContent =
          selected.size > 0 ? `${L.remove} (${selected.size})` : L.remove;
      }
    } else {
      els.removeBtn.style.display = "none";
    }
  }

  function setProgress(msg) {
    if (els) els.progress.textContent = msg || "";
  }

  function resetConfirm() {
    confirmPending = false;
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  }

  // ---- run ---------------------------------------------------------------------------

  function onRemove(def) {
    if (running || selected.size === 0) return;

    // Two-click inline confirm (no window.confirm — it would freeze the page).
    if (!confirmPending) {
      confirmPending = true;
      els.removeBtn.textContent = `Confirm remove (${selected.size})?`;
      confirmTimer = setTimeout(() => {
        resetConfirm();
        syncControls();
      }, 4000);
      return;
    }
    resetConfirm();

    const items = Array.from(selected).map((vid) => ({ pk: vid }));
    running = true;
    syncControls();
    if (cfg.DRY_RUN) ui.toast("DRY_RUN on — nothing will actually be removed");

    queue.onProgress((s) => {
      if (s.phase === "progress") {
        setProgress(`Removing… ${s.done + s.failed + 1}/${s.cap}`);
      } else if (s.phase === "done-one" || s.phase === "fail-one") {
        setProgress(`Removed ${s.done}/${s.cap}${s.failed ? ` · ${s.failed} failed` : ""}`);
        if (s.phase === "done-one" && s.current) selected.delete(s.current.pk);
      } else if (s.phase === "stopped") {
        const reasons = {
          user: "Stopped.",
          "daily-cap": `Daily cap reached (${YT.DAILY_CAP}). Try tomorrow.`,
          "action-block": "YouTube is throttling — stopped. Try later.",
        };
        ui.toast(reasons[s.reason] || "Stopped");
        finishRun(s);
      } else if (s.phase === "complete") {
        finishRun(s);
      }
    });

    queue.run(items, (item) => removeOne(item, def.menuItem), {
      minDelay: YT.MIN_DELAY_MS,
      maxDelay: YT.MAX_DELAY_MS,
      sessionCap: YT.SESSION_CAP,
      dailyCap: YT.DAILY_CAP,
      dailyKey: def.dailyKey,
    });
  }

  function finishRun(s) {
    running = false;
    setProgress(
      s.done ? `Done — removed ${s.done}${s.failed ? `, ${s.failed} failed` : ""}` : ""
    );
    reapplyOverlays();
    syncControls();
  }

  // ---- lifecycle (YouTube is a SPA) ----------------------------------------------

  function teardown() {
    if (toolbar) toolbar.remove();
    toolbar = null;
    els = null;
    selecting = false;
    running = false;
    clearSelection();
    resetConfirm();
    document.documentElement.classList.remove("bwi-yt-selecting");
  }

  function maybeInject() {
    const def = activePlaylist();
    if (!def) {
      if (toolbar) teardown();
      return;
    }
    if (toolbar && document.contains(toolbar)) {
      // Continuation rows load as you scroll; retag them — but only when a
      // selection exists (this runs on every body mutation).
      if (selected.size) reapplyOverlays();
      return;
    }
    // Anchor above the playlist rows. The list custom element is the stable
    // container; bail quietly until it exists (page still rendering).
    const firstRow = document.querySelector(ROW_TAG);
    if (!firstRow) return;
    const list = firstRow.closest("ytd-playlist-video-list-renderer") || firstRow.parentElement;
    if (!list || !list.parentElement) return;
    toolbar = buildToolbar(def);
    list.parentElement.insertBefore(toolbar, list);
    syncControls();
  }

  window.addEventListener("yt-navigate-finish", () => {
    teardown();
    maybeInject();
  });
  const observer = new MutationObserver(() => maybeInject());
  observer.observe(document.body, { childList: true, subtree: true });
  maybeInject();
})();
