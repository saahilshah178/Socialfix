// Better Web Insta — TikTok: bulk remove from your Liked / Favorites tabs.
// (FEATURE_FEASIBILITY_REPORT.md §3.6 / §3.7.)
//
// PURE DOM automation, deliberately NOT the private API. TikTok's item_list /
// digg endpoints work today without X-Bogus, but they're a documented
// kill-switch risk and need MAIN-world page state; driving the UI instead is
// robust against request-signing. On your own profile's Liked or Favorites tab
// we collect the grid tiles (by aweme id), then per item: open its video modal,
// click the like/favorite toggle to remove it, close the modal — each step
// through queue.js (throttle + caps + stop + own daily budget). DRY_RUN honored.
//
// Selectors use data-e2e (TikTok's semi-stable hook — acceptable, unlike the
// obfuscated class names) + aria-labels + visible text. TikTok obfuscates
// heavily, so these are the likeliest maintenance point.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const ui = BWI.ui;
  const queue = BWI.queue;
  const T = cfg.TIKTOK;

  if (!T.BULK_REMOVE) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let bar = null;
  let els = null;
  let running = false;
  let confirmPending = false;
  let confirmTimer = null;

  // Only on a profile page (/@handle). Others' Liked lists are hidden by
  // TikTok, so an active Liked/Favorites tab here is yours.
  function onProfile() {
    return /^\/@[^/]+\/?$/.test(location.pathname);
  }

  // Which tab (liked/favorites) is currently selected, if any.
  function activeTab() {
    for (const key of Object.keys(T.TABS)) {
      const def = T.TABS[key];
      const el =
        document.querySelector(`[data-e2e="${def.tabTestId}"]`) ||
        tabByText(def.tabText);
      if (el && isSelected(el)) return def;
    }
    return null;
  }

  function tabByText(txt) {
    const nodes = document.querySelectorAll('[role="tab"], p, span, a');
    for (const n of nodes) {
      if ((n.textContent || "").trim() === txt) {
        return n.closest('[role="tab"]') || n;
      }
    }
    return null;
  }

  function isSelected(el) {
    const t = el.closest('[role="tab"]') || el;
    if (t.getAttribute("aria-selected") === "true") return true;
    // data-e2e tabs mark the active one with an underline child; fall back to
    // checking aria-selected on any ancestor.
    return !!(el.closest('[aria-selected="true"]'));
  }

  function awemeIdOf(link) {
    const m = (link.getAttribute("href") || "").match(/\/video\/(\d+)/);
    return m ? m[1] : null;
  }

  // Grid tiles currently rendered under the active tab (each links to a video).
  function loadedTiles() {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('a[href*="/video/"]').forEach((a) => {
      const id = awemeIdOf(a);
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    });
    return out;
  }

  function findTile(id) {
    for (const a of document.querySelectorAll('a[href*="/video/"]')) {
      if (awemeIdOf(a) === id) return a;
    }
    return null;
  }

  // The toggle button inside the open video modal for this mode (like or
  // favorite). Matched by aria-label prefix; "pressed" means it's currently
  // liked/favorited, so a click removes it.
  function modalToggle(ariaPrefix) {
    const nodes = document.querySelectorAll("button[aria-label], [role='button'][aria-label]");
    for (const n of nodes) {
      const lbl = (n.getAttribute("aria-label") || "").toLowerCase();
      if (lbl.includes(ariaPrefix.toLowerCase())) return n;
    }
    return null;
  }

  function closeModal() {
    const close = document.querySelector(`[data-e2e="${T.LABELS.browseClose}"]`);
    if (close) close.click();
  }

  // ---- the queued removal action --------------------------------------------

  function makeAction(def) {
    return async function removeOne(item) {
      if (cfg.DRY_RUN) {
        console.log(`[BWI][DRY_RUN] TikTok remove ${item.pk} from ${def.name} (not clicked)`);
        return;
      }
      const tile = findTile(item.pk);
      if (!tile) throw new Error("tile not loaded: " + item.pk);
      tile.scrollIntoView({ block: "center" });
      tile.click(); // open the video modal

      // Wait for the modal's toggle to appear, then click it to remove.
      let toggle = null;
      for (let i = 0; i < 25 && !toggle; i++) {
        await sleep(150);
        toggle = modalToggle(def.toggleAria);
      }
      if (!toggle) {
        closeModal();
        throw new Error("toggle not found for " + item.pk);
      }
      // Only click if it's currently active (aria-pressed true / "un..." label);
      // otherwise we'd re-like it. If ambiguous, click once (it starts active on
      // the Liked/Favorites tab by definition).
      const pressed = toggle.getAttribute("aria-pressed");
      if (pressed === "false") {
        closeModal();
        return; // already removed / not active — skip, don't toggle on
      }
      toggle.click();
      await sleep(400);
      closeModal();
      await sleep(200);
    };
  }

  // ---- toolbar ----------------------------------------------------------------

  function build() {
    bar = document.createElement("div");
    bar.className = "bwi-x-toolbar bwi-tiktok-toolbar";
    bar.setAttribute("data-bwi", "tiktok-bulk");

    const label = document.createElement("span");
    label.className = "bwi-x-count";
    const goBtn = document.createElement("button");
    goBtn.className = "bwi-btn bwi-btn--primary";
    goBtn.addEventListener("click", onRemove);
    const stopBtn = document.createElement("button");
    stopBtn.className = "bwi-btn bwi-btn--danger";
    stopBtn.textContent = "Stop";
    stopBtn.style.display = "none";
    stopBtn.addEventListener("click", () => queue.stop());

    bar.appendChild(label);
    bar.appendChild(goBtn);
    bar.appendChild(stopBtn);
    document.body.appendChild(bar);
    els = { label, goBtn, stopBtn };
    sync();
  }

  function sync() {
    if (!els) return;
    const def = running ? null : activeTab();
    const n = running || !def ? null : loadedTiles().length;
    els.stopBtn.style.display = running ? "" : "none";
    els.goBtn.style.display = running ? "none" : "";
    if (!running && !confirmPending) {
      if (!def) {
        els.goBtn.disabled = true;
        els.goBtn.textContent = "Open Liked or Favorites";
        els.label.textContent = "TikTok bulk remove";
      } else {
        els.goBtn.disabled = n === 0;
        els.goBtn.textContent = n ? `Remove loaded (${n})` : "Nothing loaded";
        els.label.textContent = `Bulk remove — ${def.name}`;
      }
    }
  }

  function resetConfirm() {
    confirmPending = false;
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = null;
  }

  function onRemove() {
    if (running) return;
    const def = activeTab();
    if (!def) return;
    const ids = loadedTiles();
    if (!ids.length) return;
    if (!confirmPending) {
      confirmPending = true;
      els.goBtn.textContent = `Confirm — remove ${ids.length}?`;
      confirmTimer = setTimeout(() => {
        resetConfirm();
        sync();
      }, 4000);
      return;
    }
    resetConfirm();
    running = true;
    sync();
    if (cfg.DRY_RUN) ui.toast("DRY_RUN on — nothing will actually be removed");

    queue.onProgress((s) => {
      if (s.phase === "progress") {
        els.label.textContent = `Removing ${s.done + s.failed + 1}/${s.cap}…`;
      } else if (s.phase === "done-one" || s.phase === "fail-one") {
        els.label.textContent = `Removed ${s.done}/${s.cap}${s.failed ? ` · ${s.failed} missed` : ""}`;
      } else if (s.phase === "stopped") {
        const r = {
          user: "Stopped.",
          "daily-cap": `Daily cap reached (${T.REMOVE.DAILY_CAP}).`,
          "action-block": "TikTok is rate-limiting — stopped. Try later.",
        };
        ui.toast(r[s.reason] || "Stopped");
        finish();
      } else if (s.phase === "complete") {
        ui.toast(`Done — removed ${s.done}${s.failed ? `, ${s.failed} missed (scroll + retry)` : ""}`);
        finish();
      }
    });

    queue.run(ids.map((id) => ({ pk: id })), makeAction(def), {
      minDelay: T.REMOVE.MIN_DELAY_MS,
      maxDelay: T.REMOVE.MAX_DELAY_MS,
      sessionCap: T.REMOVE.SESSION_CAP,
      dailyCap: T.REMOVE.DAILY_CAP,
      dailyKey: T.REMOVE.DAILY_KEY,
    });
  }

  function finish() {
    running = false;
    sync();
  }

  // ---- lifecycle --------------------------------------------------------------

  function teardown() {
    if (bar) bar.remove();
    bar = null;
    els = null;
    running = false;
    resetConfirm();
  }

  function maybeInject() {
    if (!onProfile()) {
      if (bar) teardown();
      return;
    }
    if (bar && document.contains(bar)) {
      if (!running) sync();
      return;
    }
    build();
  }

  window.addEventListener("popstate", maybeInject);
  const observer = new MutationObserver(() => maybeInject());
  observer.observe(document.body, { childList: true, subtree: true });
  maybeInject();
})();
