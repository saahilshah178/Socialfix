// Better Web Insta — X: find & bulk-unfollow accounts that don't follow back.
// (FEATURE_FEASIBILITY_REPORT.md §3.2.)
//
// A floating "Non-followers" launcher on x.com opens a panel that: paginates
// your following (friends/list.json), checks follow-back in batches
// (friendships/lookup.json — cheaper than paging all followers), lists everyone
// who doesn't follow you back, and unfollows via friendships/destroy.json —
// each destroy through the shared queue.js with X-specific caps (do NOT reuse
// IG's) + its own daily budget, two-click confirm, and Stop. All API detail is
// isolated in x-api.js. Honors DRY_RUN.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const ui = BWI.ui;
  const queue = BWI.queue;
  const xApi = BWI.xApi;
  const U = cfg.X.UNFOLLOW;

  if (!cfg.X.BULK_UNFOLLOW) return;

  let launcher = null;
  let overlay = null;
  let els = null;
  let nonFollowers = []; // [{pk, username, full_name, profile_pic_url}]
  const rowByPk = new Map();
  let scanned = false;
  let running = false;
  let confirmPending = false;
  let confirmTimer = null;

  // ---- launcher --------------------------------------------------------------

  function ensureLauncher() {
    if (overlay) {
      if (launcher) launcher.style.display = "none";
      return;
    }
    if (launcher && document.contains(launcher)) {
      launcher.style.display = "";
      return;
    }
    launcher = document.createElement("button");
    launcher.className = "bwi-x-launch";
    launcher.type = "button";
    launcher.textContent = "Non-followers";
    launcher.addEventListener("click", openPanel);
    document.body.appendChild(launcher);
  }

  // ---- panel -----------------------------------------------------------------

  function openPanel() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "bwi-x-overlay";
    overlay.setAttribute("data-bwi", "x-unfollow");

    const card = document.createElement("div");
    card.className = "bwi-x-card";

    const header = document.createElement("div");
    header.className = "bwi-x-header";
    const title = document.createElement("div");
    title.className = "bwi-x-titletext";
    title.textContent = "Accounts that don't follow you back";
    const closeBtn = document.createElement("button");
    closeBtn.className = "bwi-btn bwi-btn--ghost";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", closePanel);
    header.appendChild(title);
    header.appendChild(closeBtn);

    const status = document.createElement("div");
    status.className = "bwi-x-status";

    const actions = document.createElement("div");
    actions.className = "bwi-x-actions";
    const scanBtn = document.createElement("button");
    scanBtn.className = "bwi-btn bwi-btn--primary";
    scanBtn.textContent = "Scan";
    scanBtn.addEventListener("click", onScan);
    const unfollowAllBtn = document.createElement("button");
    unfollowAllBtn.className = "bwi-btn bwi-btn--primary";
    unfollowAllBtn.style.display = "none";
    unfollowAllBtn.addEventListener("click", onUnfollowAll);
    const stopBtn = document.createElement("button");
    stopBtn.className = "bwi-btn bwi-btn--danger";
    stopBtn.textContent = "Stop";
    stopBtn.style.display = "none";
    stopBtn.addEventListener("click", () => queue.stop());
    actions.appendChild(scanBtn);
    actions.appendChild(unfollowAllBtn);
    actions.appendChild(stopBtn);

    const list = document.createElement("div");
    list.className = "bwi-x-list bwi-list";

    card.appendChild(header);
    card.appendChild(status);
    card.appendChild(actions);
    card.appendChild(list);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    els = { status, scanBtn, unfollowAllBtn, stopBtn, list };
    if (launcher) launcher.style.display = "none";
  }

  function closePanel() {
    if (running) return; // don't close mid-run
    if (overlay) overlay.remove();
    overlay = null;
    els = null;
    nonFollowers = [];
    rowByPk.clear();
    scanned = false;
    resetConfirm();
    ensureLauncher();
  }

  function setStatus(msg) {
    if (els) els.status.textContent = msg || "";
  }

  // ---- scan ------------------------------------------------------------------

  async function onScan() {
    if (running) return;
    els.scanBtn.disabled = true;
    els.list.innerHTML = "";
    rowByPk.clear();
    setStatus("Loading your following…");
    try {
      const following = await xApi.fetchAllFollowing((n) =>
        setStatus(`Loading your following… ${n}`)
      );
      setStatus(`Checking follow-back for ${following.length}…`);
      nonFollowers = await xApi.computeNonFollowers(following, (done, total) =>
        setStatus(`Checking follow-back… ${done}/${total}`)
      );
      scanned = true;
      renderList();
    } catch (err) {
      console.warn("[BWI] X non-follower scan failed", err);
      setStatus(
        xApi.XApiError && err instanceof xApi.XApiError && err.status === 429
          ? "X is rate-limiting the read. Wait a few minutes and rescan."
          : "Couldn't load your following (X API error). Try again."
      );
      els.scanBtn.disabled = false;
    }
  }

  function renderList() {
    els.list.innerHTML = "";
    rowByPk.clear();
    if (!nonFollowers.length) {
      const empty = document.createElement("div");
      empty.className = "bwi-section__empty";
      empty.textContent = "Everyone you follow follows you back. 🎉";
      els.list.appendChild(empty);
      setStatus("");
      els.scanBtn.style.display = "none";
      return;
    }
    nonFollowers.forEach((u) => {
      const row = ui.buildUserRow(u);
      const btn = document.createElement("button");
      btn.className = "bwi-btn bwi-btn--row";
      btn.textContent = "Unfollow";
      btn.addEventListener("click", () => unfollowOne(u, btn));
      row.appendChild(btn);
      els.list.appendChild(row);
      rowByPk.set(u.pk, row);
    });
    setStatus(`${nonFollowers.length} not following you back`);
    els.scanBtn.textContent = "Rescan";
    els.scanBtn.disabled = false;
    els.unfollowAllBtn.style.display = "";
    els.unfollowAllBtn.textContent = `Unfollow all (${nonFollowers.length})`;
  }

  // ---- unfollow (single + all) ----------------------------------------------

  const action = (item) => xApi.destroyFollow(item.pk);

  function markRowDone(pk) {
    const row = rowByPk.get(pk);
    if (row) {
      row.classList.add("bwi-row--done");
      const btn = row.querySelector("button");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Unfollowed";
      }
    }
  }

  function unfollowOne(u, btn) {
    if (running) return;
    if (btn.dataset.confirm !== "1") {
      btn.dataset.confirm = "1";
      btn.textContent = "Confirm?";
      setTimeout(() => {
        if (btn.dataset.confirm === "1") {
          btn.dataset.confirm = "";
          btn.textContent = "Unfollow";
        }
      }, 3000);
      return;
    }
    btn.dataset.confirm = "";
    runQueue([u]);
  }

  function onUnfollowAll() {
    if (running || !nonFollowers.length) return;
    if (!confirmPending) {
      confirmPending = true;
      els.unfollowAllBtn.textContent = `Confirm — unfollow ${nonFollowers.length}?`;
      confirmTimer = setTimeout(() => {
        resetConfirm();
        els.unfollowAllBtn.textContent = `Unfollow all (${nonFollowers.length})`;
      }, 4000);
      return;
    }
    resetConfirm();
    runQueue(nonFollowers.slice());
  }

  function runQueue(items) {
    running = true;
    els.scanBtn.style.display = "none";
    els.unfollowAllBtn.style.display = "none";
    els.stopBtn.style.display = "";
    if (cfg.DRY_RUN) ui.toast("DRY_RUN on — nothing will actually be unfollowed");

    queue.onProgress((s) => {
      if (s.phase === "progress") {
        setStatus(`Unfollowing ${s.done + s.failed + 1}/${s.cap}…`);
      } else if (s.phase === "done-one") {
        if (s.current) markRowDone(s.current.pk);
        setStatus(`Unfollowed ${s.done}/${s.cap}${s.failed ? ` · ${s.failed} failed` : ""}`);
      } else if (s.phase === "fail-one") {
        setStatus(`Unfollowed ${s.done}/${s.cap} · ${s.failed} failed`);
      } else if (s.phase === "stopped") {
        const r = {
          user: "Stopped.",
          "daily-cap": `Daily unfollow cap reached (${U.DAILY_CAP}). Continue tomorrow.`,
          "action-block": "X restricted the action — stopped. Try later.",
        };
        ui.toast(r[s.reason] || "Stopped");
        finishRun();
      } else if (s.phase === "complete") {
        ui.toast(`Done — unfollowed ${s.done}${s.failed ? `, ${s.failed} failed` : ""}`);
        finishRun();
      }
    });

    queue.run(items, action, {
      minDelay: U.MIN_DELAY_MS,
      maxDelay: U.MAX_DELAY_MS,
      sessionCap: U.SESSION_CAP,
      dailyCap: U.DAILY_CAP,
      dailyKey: U.DAILY_KEY,
    });
  }

  function finishRun() {
    running = false;
    // Drop unfollowed accounts from the working set.
    nonFollowers = nonFollowers.filter((u) => {
      const row = rowByPk.get(u.pk);
      return !(row && row.classList.contains("bwi-row--done"));
    });
    els.stopBtn.style.display = "none";
    els.scanBtn.style.display = "";
    if (nonFollowers.length) {
      els.unfollowAllBtn.style.display = "";
      els.unfollowAllBtn.textContent = `Unfollow all (${nonFollowers.length})`;
    }
  }

  function resetConfirm() {
    confirmPending = false;
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  }

  // ---- lifecycle -------------------------------------------------------------

  const observer = new MutationObserver(() => ensureLauncher());
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("popstate", ensureLauncher);
  ensureLauncher();
})();
