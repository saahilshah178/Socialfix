// Socialfix — X: bulk unlike on your own /likes tab.
// (FEATURE_FEASIBILITY_REPORT.md §3.1 — DOM-click primary.)
//
// A floating toolbar on x.com/<you>/likes with a SELECT mode (Aug 3 audit: the
// old build unliked everything loaded with no way to choose). "Select" turns
// tweet clicks into selection toggles (same capture-phase interception as IG
// Feature 4 / yt-bulk); "Select all" grabs every currently-loaded liked tweet;
// "Unlike (n)" then runs ONLY the chosen tweets by clicking each one's native
// heart (data-testid="unlike") — riding X's own client code, so we inherit
// whatever CSRF / transaction-id headers X needs and make no API call.
// Removals run through the shared queue.js with conservative X-specific delays
// + its own daily budget, a two-click confirm (mass irreversible action), and
// Stop.
//
// X's timeline is virtualized, so "loaded" = whatever is in the DOM now; scroll
// to load more, keep selecting. Selection is by tweet id (not DOM node —
// recycled nodes can't cause a mis-click) and the highlight class is re-applied
// on every mutation because the virtualizer constantly remounts rows.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const ui = BWI.ui;
  const queue = BWI.queue;
  const U = cfg.X.UNLIKE;

  if (!cfg.X.BULK_UNLIKE) return;

  let bar = null;
  let els = null;
  let selecting = false;
  let running = false;
  const selected = new Set(); // tweet ids
  let confirmPending = false;
  let confirmTimer = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Own /likes only. Others' likes are hidden by X, so /<user>/likes is yours.
  function onLikesPage() {
    return /^\/[^/]+\/likes\/?$/.test(location.pathname);
  }

  function tweetIdOf(article) {
    const a = article.querySelector('a[href*="/status/"]');
    const m = a && (a.getAttribute("href") || "").match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  // Currently-rendered liked tweets (those still showing an "unlike" heart).
  function loadedLiked() {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('article[data-testid="tweet"]').forEach((art) => {
      if (!art.querySelector('[data-testid="unlike"]')) return;
      const id = tweetIdOf(art);
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    });
    return out;
  }

  function articleById(id) {
    for (const art of document.querySelectorAll('article[data-testid="tweet"]')) {
      if (tweetIdOf(art) === id) return art;
    }
    return null;
  }

  // ---- selection ---------------------------------------------------------------

  // The timeline virtualizer recycles article nodes as you scroll, so the
  // highlight class must be re-derived from the id set on every pass.
  function reapplyOverlays() {
    document.querySelectorAll('article[data-testid="tweet"]').forEach((art) => {
      const id = tweetIdOf(art);
      art.classList.toggle("bwi-x-selected", !!id && selected.has(id));
    });
  }

  function clearSelection() {
    selected.clear();
    reapplyOverlays();
  }

  function setSelecting(on) {
    selecting = on;
    if (!on) clearSelection();
    document.documentElement.classList.toggle("bwi-x-selecting", on);
    resetConfirm();
    sync();
  }

  // Capture-phase click interception while selecting (same pattern as IG
  // Feature 4 / yt-bulk): a click anywhere in a tweet toggles it instead of
  // opening it.
  document.addEventListener(
    "click",
    (e) => {
      if (!selecting || running) return;
      if (!onLikesPage()) return;
      if (bar && bar.contains(e.target)) return; // toolbar buttons work normally
      const art = e.target.closest('article[data-testid="tweet"]');
      if (!art) return;
      e.preventDefault();
      e.stopPropagation();
      const id = tweetIdOf(art);
      if (!id) return;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      art.classList.toggle("bwi-x-selected", selected.has(id));
      resetConfirm();
      sync();
    },
    true
  );

  // Queue action: unlike one tweet by id. Honors DRY_RUN. Throws if the tweet
  // scrolled out of the DOM or its heart is gone (queue counts it failed).
  async function unlikeOne(item) {
    if (cfg.DRY_RUN) {
      console.log(`[BWI][DRY_RUN] X unlike ${item.pk} (not clicked)`);
      return;
    }
    const art = articleById(item.pk);
    if (!art) throw new Error("tweet not loaded: " + item.pk);
    art.scrollIntoView({ block: "center" });
    await sleep(150);
    const btn = art.querySelector('[data-testid="unlike"]');
    if (!btn) throw new Error("unlike button gone: " + item.pk);
    if (!art.isConnected) throw new Error("tweet detached: " + item.pk);
    btn.click();
    // Verify X registered it — the heart must flip to "like" (or the article
    // unmounts). Returning normally on a timeout would report every item as
    // unliked once X starts rate-limiting, burn the daily budget on no-ops, and
    // hide the block from queue.isActionBlock. Surface it 429-shaped instead so
    // the queue halts (same contract as x-unfollow.js).
    let flipped = false;
    for (let i = 0; i < 20 && !flipped; i++) {
      await sleep(120);
      if (!art.isConnected) return; // row recycled/unmounted — treat as done
      flipped = !art.querySelector('[data-testid="unlike"]');
    }
    if (flipped) {
      // X flips the heart OPTIMISTICALLY, before its server answers — so the
      // flip alone doesn't prove acceptance. If the write is rejected the heart
      // reverts a moment later, which would otherwise sail through as success.
      // Let it settle, then confirm it stayed flipped.
      await sleep(700);
      if (!art.isConnected || !art.querySelector('[data-testid="unlike"]')) return;
    }
    const err = new Error("unlike did not take — X may be rate-limiting");
    err.status = 429;
    throw err;
  }

  // ---- toolbar ----------------------------------------------------------------

  function build() {
    bar = document.createElement("div");
    bar.className = "bwi-x-toolbar";
    bar.setAttribute("data-bwi", "x-unlike");

    const label = document.createElement("span");
    label.className = "bwi-x-count";

    const selectBtn = document.createElement("button");
    selectBtn.className = "bwi-btn bwi-btn--ghost";
    selectBtn.addEventListener("click", () => {
      if (running) return;
      setSelecting(!selecting);
    });

    const selectAllBtn = document.createElement("button");
    selectAllBtn.className = "bwi-btn bwi-btn--ghost";
    selectAllBtn.textContent = "Select all";
    selectAllBtn.style.display = "none";
    selectAllBtn.addEventListener("click", () => {
      if (!selecting || running) return;
      loadedLiked().forEach((id) => selected.add(id));
      reapplyOverlays();
      resetConfirm();
      sync();
    });

    const unlikeBtn = document.createElement("button");
    unlikeBtn.className = "bwi-btn bwi-btn--primary";
    unlikeBtn.style.display = "none";
    unlikeBtn.addEventListener("click", onUnlike);

    const stopBtn = document.createElement("button");
    stopBtn.className = "bwi-btn bwi-btn--danger";
    stopBtn.textContent = "Stop";
    stopBtn.style.display = "none";
    stopBtn.addEventListener("click", () => queue.stop());

    bar.appendChild(label);
    bar.appendChild(selectBtn);
    bar.appendChild(selectAllBtn);
    bar.appendChild(unlikeBtn);
    bar.appendChild(stopBtn);
    document.body.appendChild(bar);
    els = { label, selectBtn, selectAllBtn, unlikeBtn, stopBtn };
    sync();
  }

  // Idempotent DOM setters: every write below lands inside our toolbar, which
  // lives in document.body — the subtree the MutationObserver watches. Writing
  // unconditionally would re-fire the observer on its own output and spin
  // forever (this is exactly what froze the Likes page), so only write on change.
  function setText(el, v) {
    if (el.textContent !== v) el.textContent = v;
  }
  function setDisplay(el, v) {
    if (el.style.display !== v) el.style.display = v;
  }

  function sync() {
    if (!els) return;
    setDisplay(els.stopBtn, running ? "" : "none");
    setDisplay(els.selectBtn, running ? "none" : "");
    setDisplay(els.selectAllBtn, selecting && !running ? "" : "none");
    setDisplay(els.unlikeBtn, selecting && !running ? "" : "none");
    if (running) return;
    setText(els.selectBtn, selecting ? "Cancel" : "Select");
    els.unlikeBtn.disabled = selected.size === 0;
    if (!confirmPending) {
      setText(els.unlikeBtn, `Unlike (${selected.size})`);
      setText(
        els.label,
        selecting
          ? `${selected.size} of ${loadedLiked().length} loaded`
          : "Bulk unlike"
      );
    }
  }

  function resetConfirm() {
    confirmPending = false;
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  }

  function onUnlike() {
    if (running || !selecting) return;
    const ids = Array.from(selected);
    if (!ids.length) return;
    // Singleton queue — a second run no-ops and steals the live run's events.
    if (queue.isBusy()) {
      ui.toast("Another bulk action is still running — stop it first");
      return;
    }

    if (!confirmPending) {
      confirmPending = true;
      els.unlikeBtn.textContent = `Confirm — unlike ${ids.length}?`;
      confirmTimer = setTimeout(() => {
        resetConfirm();
        sync();
      }, 4000);
      return;
    }
    resetConfirm();

    running = true;
    sync();
    if (cfg.DRY_RUN) ui.toast("DRY_RUN on — nothing will actually be unliked");

    queue.onProgress((s) => {
      if (s.phase === "progress") {
        els.label.textContent = `Unliking ${s.done + s.failed + 1}/${s.cap}…`;
      } else if (s.phase === "done-one" || s.phase === "fail-one") {
        if (s.phase === "done-one" && s.current) selected.delete(s.current.pk);
        els.label.textContent = `Unliked ${s.done}/${s.cap}${s.failed ? ` · ${s.failed} missed` : ""}`;
      } else if (s.phase === "stopped") {
        const r = {
          user: "Stopped.",
          "daily-cap": `Daily unlike cap reached (${U.DAILY_CAP}).`,
          "action-block": "X is rate-limiting — stopped. Try later.",
        };
        ui.toast(r[s.reason] || "Stopped");
        finish();
      } else if (s.phase === "complete") {
        ui.toast(`Done — unliked ${s.done}${s.failed ? `, ${s.failed} missed (scroll + retry)` : ""}`);
        finish();
      }
    });

    queue.run(ids.map((id) => ({ pk: id })), unlikeOne, {
      minDelay: U.MIN_DELAY_MS,
      maxDelay: U.MAX_DELAY_MS,
      sessionCap: U.SESSION_CAP,
      dailyCap: U.DAILY_CAP,
      dailyKey: U.DAILY_KEY,
    });
  }

  function finish() {
    running = false;
    reapplyOverlays();
    sync();
  }

  // ---- lifecycle (SPA) --------------------------------------------------------

  function teardown() {
    // Stop any in-flight run first: teardown fires when we navigate off /likes,
    // and the queue would otherwise keep calling unlikeOne — whose global
    // article[data-testid="tweet"] lookup could match liked tweets on the page
    // the user navigated to (e.g. Home) and unlike them.
    if (running) queue.stop();
    if (bar) bar.remove();
    bar = null;
    els = null;
    running = false;
    selecting = false;
    selected.clear();
    document.documentElement.classList.remove("bwi-x-selecting");
    resetConfirm();
  }

  function maybeInject() {
    if (!onLikesPage()) {
      if (bar) teardown();
      return;
    }
    if (bar && document.contains(bar)) {
      if (!running) {
        if (selected.size) reapplyOverlays(); // recycled nodes lose the class
        sync(); // counts update as you scroll
      }
      return;
    }
    build();
  }

  // Coalesce the virtualized timeline's constant mutations into one injection
  // check per frame, and ignore mutations that come only from our own toolbar
  // (defense-in-depth on top of the idempotent setters in sync()).
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      maybeInject();
    });
  }

  window.addEventListener("popstate", maybeInject);
  const observer = new MutationObserver((muts) => {
    if (bar && muts.every((m) => bar.contains(m.target))) return;
    schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  maybeInject();
})();
