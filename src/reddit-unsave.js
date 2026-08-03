// Better Web Insta — Reddit: bulk unsave.
// (FEATURE_FEASIBILITY_REPORT.md §3.9.)
//
// A floating toolbar on your Saved page unsaves the currently-loaded items
// through the shared queue.js (randomized delay + caps + stop-on-block). Two
// surfaces:
//   • old.reddit.com (recommended, flat text-selector surface): each saved
//     "thing" has data-fullname + an action anchor whose text is "unsave"
//     ("delete from saved" for comments). We click that — no API, no modhash.
//   • new/shreddit Reddit: "Remove from saved" lives in the post overflow menu
//     inside shadow DOM, so we pierce shadow roots (best-effort).
// Items are re-located by post fullname after each action (Feature-4 discipline
// for the virtualized new-Reddit listing). Labels live in cfg.REDDIT.LABELS.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const ui = BWI.ui;
  const queue = BWI.queue;
  const R = cfg.REDDIT;
  const L = R.LABELS;

  if (!R.BULK_UNSAVE) return;

  const isOld = location.hostname.startsWith("old.");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let bar = null;
  let els = null;
  let running = false;
  let confirmPending = false;
  let confirmTimer = null;

  // Only activate on a saved listing (own prefs/saved or /user/<me>/saved).
  function onSavedPage() {
    return /\/saved\/?$/.test(location.pathname) || location.pathname === "/prefs/saved";
  }

  // Pierce shadow roots (new Reddit is web components). Only custom elements
  // (hyphenated tag names) can host a shadow root, so we skip the shadowRoot
  // probe on the thousands of plain elements a query returns.
  function deepQueryAll(selector, root = document, out = []) {
    root.querySelectorAll(selector).forEach((el) => out.push(el));
    root.querySelectorAll("*").forEach((el) => {
      if (el.tagName.includes("-") && el.shadowRoot) {
        deepQueryAll(selector, el.shadowRoot, out);
      }
    });
    return out;
  }

  // ---- collect currently-loaded saved items (by fullname) --------------------

  function loadedFullnames() {
    const out = [];
    const seen = new Set();
    if (isOld) {
      document.querySelectorAll(".thing[data-fullname]").forEach((t) => {
        const fn = t.getAttribute("data-fullname");
        // Only ones that still show an "unsave" affordance.
        const hasUnsave = Array.from(t.querySelectorAll("a")).some((a) => {
          const x = (a.textContent || "").trim().toLowerCase();
          return x === L.unsave || x === L.unsaveComment;
        });
        if (fn && hasUnsave && !seen.has(fn)) {
          seen.add(fn);
          out.push(fn);
        }
      });
    } else {
      // Prefer a plain light-DOM query (cheap); only fall back to the
      // shadow-piercing walk if shreddit renders posts inside shadow roots.
      const light = document.querySelectorAll("shreddit-post");
      const posts = light.length ? Array.from(light) : deepQueryAll("shreddit-post");
      posts.forEach((p) => {
        const fn = p.id || p.getAttribute("id") || p.getAttribute("post-id");
        if (fn && !seen.has(fn)) {
          seen.add(fn);
          out.push(fn);
        }
      });
    }
    return out;
  }

  // ---- the queued unsave action ---------------------------------------------

  async function unsaveOne(item) {
    const fn = item.pk;
    if (cfg.DRY_RUN) {
      console.log(`[BWI][DRY_RUN] Reddit unsave ${fn} (not clicked)`);
      return;
    }
    if (isOld) {
      const thing = document.querySelector(`.thing[data-fullname="${fn}"]`);
      if (!thing) throw new Error("thing not loaded: " + fn);
      const link = Array.from(thing.querySelectorAll("a")).find((a) => {
        const x = (a.textContent || "").trim().toLowerCase();
        return x === L.unsave || x === L.unsaveComment;
      });
      if (!link) throw new Error("unsave link gone: " + fn);
      link.scrollIntoView({ block: "center" });
      link.click();
      await sleep(200);
      return;
    }

    // shreddit: open the post overflow menu, then click "Remove from saved".
    const post = deepQueryAll("shreddit-post").find(
      (p) => (p.id || p.getAttribute("id") || p.getAttribute("post-id")) === fn
    );
    if (!post) throw new Error("post not loaded: " + fn);
    post.scrollIntoView({ block: "center" });
    const moreBtn =
      deepQueryAll('button[aria-label*="more options" i]', post)[0] ||
      deepQueryAll('button[aria-label*="action menu" i]', post)[0] ||
      deepQueryAll('[aria-haspopup="menu"]', post)[0];
    if (!moreBtn) throw new Error("overflow button not found: " + fn);
    moreBtn.click();

    const target = L.removeFromSaved.toLowerCase();
    for (let tries = 0; tries < 20; tries++) {
      await sleep(120);
      const items = deepQueryAll('[role="menuitem"], button, li');
      const hit = items.find((el) => (el.textContent || "").trim().toLowerCase() === target);
      if (hit) {
        hit.click();
        await sleep(150);
        return;
      }
    }
    document.body.click(); // close the menu we opened
    throw new Error("'Remove from saved' not found: " + fn);
  }

  // ---- toolbar ----------------------------------------------------------------

  function build() {
    bar = document.createElement("div");
    bar.className = "bwi-x-toolbar bwi-reddit-toolbar";
    bar.setAttribute("data-bwi", "reddit-unsave");

    const label = document.createElement("span");
    label.className = "bwi-x-count";
    const unsaveBtn = document.createElement("button");
    unsaveBtn.className = "bwi-btn bwi-btn--primary";
    unsaveBtn.addEventListener("click", onUnsave);
    const stopBtn = document.createElement("button");
    stopBtn.className = "bwi-btn bwi-btn--danger";
    stopBtn.textContent = "Stop";
    stopBtn.style.display = "none";
    stopBtn.addEventListener("click", () => queue.stop());

    bar.appendChild(label);
    bar.appendChild(unsaveBtn);
    bar.appendChild(stopBtn);
    document.body.appendChild(bar);
    els = { label, unsaveBtn, stopBtn };
    sync();
  }

  // Only write to the DOM when a value actually changes. Every textContent /
  // style write here lands inside our toolbar, which sits in document.body —
  // the same subtree the MutationObserver watches. An unconditional write would
  // therefore re-fire the observer on its own output and spin forever, so all
  // writes go through these idempotent setters.
  function setText(el, v) {
    if (el.textContent !== v) el.textContent = v;
  }
  function setDisplay(el, v) {
    if (el.style.display !== v) el.style.display = v;
  }

  function sync() {
    if (!els) return;
    const n = running ? null : loadedFullnames().length;
    setDisplay(els.stopBtn, running ? "" : "none");
    setDisplay(els.unsaveBtn, running ? "none" : "");
    if (!running && !confirmPending) {
      els.unsaveBtn.disabled = n === 0;
      setText(els.unsaveBtn, n ? `Unsave loaded (${n})` : "Nothing loaded");
      setText(els.label, "Bulk unsave");
    }
  }

  function resetConfirm() {
    confirmPending = false;
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = null;
  }

  function onUnsave() {
    if (running) return;
    const fns = loadedFullnames();
    if (!fns.length) return;
    if (!confirmPending) {
      confirmPending = true;
      els.unsaveBtn.textContent = `Confirm — unsave ${fns.length}?`;
      confirmTimer = setTimeout(() => {
        resetConfirm();
        sync();
      }, 4000);
      return;
    }
    resetConfirm();
    running = true;
    sync();
    if (cfg.DRY_RUN) ui.toast("DRY_RUN on — nothing will actually be unsaved");

    queue.onProgress((s) => {
      if (s.phase === "progress") {
        els.label.textContent = `Unsaving ${s.done + s.failed + 1}/${s.cap}…`;
      } else if (s.phase === "done-one" || s.phase === "fail-one") {
        els.label.textContent = `Unsaved ${s.done}/${s.cap}${s.failed ? ` · ${s.failed} missed` : ""}`;
      } else if (s.phase === "stopped") {
        const r = {
          user: "Stopped.",
          "daily-cap": `Daily cap reached (${R.UNSAVE.DAILY_CAP}).`,
          "action-block": "Reddit is rate-limiting — stopped. Try later.",
        };
        ui.toast(r[s.reason] || "Stopped");
        finish();
      } else if (s.phase === "complete") {
        ui.toast(`Done — unsaved ${s.done}${s.failed ? `, ${s.failed} missed (scroll + retry)` : ""}`);
        finish();
      }
    });

    queue.run(fns.map((fn) => ({ pk: fn })), unsaveOne, {
      minDelay: R.UNSAVE.MIN_DELAY_MS,
      maxDelay: R.UNSAVE.MAX_DELAY_MS,
      sessionCap: R.UNSAVE.SESSION_CAP,
      dailyCap: R.UNSAVE.DAILY_CAP,
      dailyKey: R.UNSAVE.DAILY_KEY,
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
    if (!onSavedPage()) {
      if (bar) teardown();
      return;
    }
    if (bar && document.contains(bar)) {
      if (!running) sync();
      return;
    }
    build();
  }

  // Coalesce bursts of mutations into one injection check per frame-ish, and
  // ignore mutations that originate entirely inside our own toolbar (belt-and-
  // braces on top of the idempotent setters in sync()).
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      maybeInject();
    }, 250);
  }

  window.addEventListener("popstate", maybeInject);
  const observer = new MutationObserver((muts) => {
    if (bar && muts.every((m) => bar.contains(m.target))) return;
    schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  maybeInject();
})();
