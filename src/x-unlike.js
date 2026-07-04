// Better Web Insta — X: bulk unlike on your own /likes tab.
// (FEATURE_FEASIBILITY_REPORT.md §3.1 — DOM-click primary.)
//
// A floating toolbar on x.com/<you>/likes. It unlikes the currently-loaded
// liked tweets by clicking each one's native heart (data-testid="unlike") —
// riding X's own client code, so we inherit whatever CSRF / transaction-id
// headers X needs and make no API call. Removals run through the shared
// queue.js with conservative X-specific delays + its own daily budget, a
// two-click confirm (mass irreversible action), and Stop.
//
// X's timeline is virtualized, so "loaded" = whatever is in the DOM now; unlike
// what's visible, scroll to load more, run again. Selection is by tweet id so a
// recycled DOM node can't cause a mis-click.
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
  let running = false;
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
    btn.click();
    // Confirm X registered it (heart flips to "like") before moving on.
    for (let i = 0; i < 15 && art.querySelector('[data-testid="unlike"]'); i++) {
      await sleep(120);
    }
  }

  // ---- toolbar ----------------------------------------------------------------

  function build() {
    bar = document.createElement("div");
    bar.className = "bwi-x-toolbar";
    bar.setAttribute("data-bwi", "x-unlike");

    const label = document.createElement("span");
    label.className = "bwi-x-count";

    const unlikeBtn = document.createElement("button");
    unlikeBtn.className = "bwi-btn bwi-btn--primary";
    unlikeBtn.addEventListener("click", onUnlike);

    const stopBtn = document.createElement("button");
    stopBtn.className = "bwi-btn bwi-btn--danger";
    stopBtn.textContent = "Stop";
    stopBtn.style.display = "none";
    stopBtn.addEventListener("click", () => queue.stop());

    bar.appendChild(label);
    bar.appendChild(unlikeBtn);
    bar.appendChild(stopBtn);
    document.body.appendChild(bar);
    els = { label, unlikeBtn, stopBtn };
    sync();
  }

  function sync() {
    if (!els) return;
    const n = running ? null : loadedLiked().length;
    els.stopBtn.style.display = running ? "" : "none";
    els.unlikeBtn.style.display = running ? "none" : "";
    if (!running && !confirmPending) {
      els.unlikeBtn.disabled = n === 0;
      els.unlikeBtn.textContent = n ? `Unlike loaded (${n})` : "Nothing loaded";
      els.label.textContent = "Bulk unlike";
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
    if (running) return;
    const ids = loadedLiked();
    if (!ids.length) return;

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
    sync();
  }

  // ---- lifecycle (SPA) --------------------------------------------------------

  function teardown() {
    if (bar) bar.remove();
    bar = null;
    els = null;
    running = false;
    resetConfirm();
  }

  function maybeInject() {
    if (!onLikesPage()) {
      if (bar) teardown();
      return;
    }
    if (bar && document.contains(bar)) {
      if (!running) sync(); // count updates as you scroll
      return;
    }
    build();
  }

  window.addEventListener("popstate", maybeInject);
  const observer = new MutationObserver(() => maybeInject());
  observer.observe(document.body, { childList: true, subtree: true });
  maybeInject();
})();
