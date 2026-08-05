// Socialfix — Reddit: bulk unsave.
// (FEATURE_FEASIBILITY_REPORT.md §3.9; rebuilt from scratch after the Aug 3
// audit — the DOM-click build did nothing; select-mode added per the Aug 4
// audit: pick individual items, with unsave-all still one button away.)
//
// A floating toolbar on your Saved page. Two ways to run:
//   • "Unsave all loaded (n)" — everything currently in the DOM (the original
//     flow, kept per the Aug 4 audit).
//   • "Select" — clicks on saved items toggle selection (capture-phase
//     interception, same pattern as IG Feature 4 / yt-bulk / x-unlike), plus
//     "Select all"; then "Unsave (k)" runs just the chosen items.
// Both run through the shared queue.js (randomized delay + caps +
// stop-on-block) with a two-click confirm.
//
// The DOM is used ONLY to collect item fullnames (t3_/t1_ ids); the unsave
// itself is Reddit's legacy JSON API — POST /api/unsave with the session
// cookie + modhash CSRF, the exact same-origin request old.reddit's own
// "unsave" link makes. That endpoint has been stable for over a decade and is
// served identically on old.reddit.com and www.reddit.com, which makes it far
// more robust than driving either UI (old-reddit anchor clicks and shreddit's
// shadow-DOM overflow menus both proved fragile). The modhash comes from
// /api/me.json once per page load, with an old-reddit page-config scrape as
// fallback. Unsaved items are faded in place (.bwi-unsaved) since Reddit won't
// drop them from the listing until a reload.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const ui = BWI.ui;
  const queue = BWI.queue;
  const R = cfg.REDDIT;

  if (!R.BULK_UNSAVE) return;

  const isOld = location.hostname.startsWith("old.");

  let bar = null;
  let els = null;
  let selecting = false;
  let running = false;
  const selected = new Set(); // fullnames chosen in select mode
  let confirmTarget = null; // which button is mid two-click confirm
  let confirmTimer = null;
  const done = new Set(); // fullnames unsaved this page load

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

  // Shreddit hosts: posts are <shreddit-post> (fullname in id / post-id);
  // saved comments carry their t1_ fullname in one of a few attributes
  // depending on the shell version — probe them all.
  const SHREDDIT_SEL = "shreddit-post, shreddit-comment, shreddit-profile-comment";
  const ITEM_SEL = isOld ? ".thing[data-fullname]" : SHREDDIT_SEL;
  const FULLNAME_RE = /^t\d_[a-z0-9]+$/i;

  function fullnameOf(el) {
    const cands = [
      el.id,
      el.getAttribute("post-id"),
      el.getAttribute("thingid"),
      el.getAttribute("comment-id"),
      el.getAttribute("data-fullname"),
    ];
    for (const c of cands) {
      if (c && FULLNAME_RE.test(c)) return c;
    }
    return null;
  }

  function savedElements() {
    if (isOld) {
      return Array.from(document.querySelectorAll(ITEM_SEL));
    }
    // Prefer a plain light-DOM query (cheap); only fall back to the
    // shadow-piercing walk if shreddit renders items inside shadow roots.
    const light = document.querySelectorAll(SHREDDIT_SEL);
    return light.length ? Array.from(light) : deepQueryAll(SHREDDIT_SEL);
  }

  function loadedFullnames() {
    const out = [];
    const seen = new Set();
    savedElements().forEach((el) => {
      const fn = fullnameOf(el);
      if (fn && !done.has(fn) && !seen.has(fn)) {
        seen.add(fn);
        out.push(fn);
      }
    });
    return out;
  }

  function elementFor(fn) {
    return savedElements().find((el) => fullnameOf(el) === fn) || null;
  }

  // ---- selection ---------------------------------------------------------------

  function reapplyOverlays() {
    savedElements().forEach((el) => {
      const fn = fullnameOf(el);
      el.classList.toggle("bwi-reddit-selected", !!fn && selected.has(fn));
    });
  }

  function setSelecting(on) {
    selecting = on;
    if (!on) {
      selected.clear();
      reapplyOverlays();
    }
    document.documentElement.classList.toggle("bwi-reddit-selecting", on);
    resetConfirm();
    sync();
  }

  // Capture-phase click interception while selecting: a click anywhere in a
  // saved item toggles it instead of navigating.
  document.addEventListener(
    "click",
    (e) => {
      if (!selecting || running) return;
      if (!onSavedPage()) return;
      if (bar && bar.contains(e.target)) return; // toolbar buttons work normally
      const item = e.target.closest(ITEM_SEL);
      if (!item) return;
      const fn = fullnameOf(item);
      if (!fn || done.has(fn)) return;
      e.preventDefault();
      e.stopPropagation();
      if (selected.has(fn)) selected.delete(fn);
      else selected.add(fn);
      item.classList.toggle("bwi-reddit-selected", selected.has(fn));
      resetConfirm();
      sync();
    },
    true
  );

  // ---- the legacy JSON API ----------------------------------------------------

  // Errors carry .status so queue.isActionBlock() stops the run on a 429.
  function mkErr(msg, status) {
    const e = new Error(msg);
    e.status = status;
    return e;
  }

  let modhash = null;

  // Old reddit embeds the modhash in its inline page config — a no-network
  // fallback if /api/me.json ever stops returning one.
  function scrapeModhash() {
    for (const s of document.querySelectorAll("script")) {
      const m = (s.textContent || "").match(/["']modhash["']\s*:\s*["']([^"']+)["']/);
      if (m) return m[1];
    }
    return null;
  }

  async function getModhash() {
    if (modhash) return modhash;
    try {
      const res = await fetch("/api/me.json", {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const mh = data && data.data && data.data.modhash;
        if (mh) {
          modhash = mh;
          return mh;
        }
      }
    } catch (_) {
      /* fall through to the scrape */
    }
    const scraped = scrapeModhash();
    if (scraped) {
      modhash = scraped;
      return scraped;
    }
    throw mkErr("no modhash — is this session logged in?", 403);
  }

  async function apiUnsave(fn) {
    const uh = await getModhash();
    const res = await fetch("/api/unsave", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Modhash": uh,
      },
      body: new URLSearchParams({ id: fn, uh }).toString(),
    });
    if (!res.ok) throw mkErr(`unsave ${res.status} for ${fn}`, res.status);
    // The legacy API can 200 with an errors array (e.g. RATELIMIT) — surface
    // rate limits with a 429 status so the queue stops instead of plowing on.
    const data = await res.json().catch(() => null);
    const errs = data && data.json && data.json.errors;
    if (Array.isArray(errs) && errs.length) {
      const rateLimited = errs.some((e) => Array.isArray(e) && e[0] === "RATELIMIT");
      throw mkErr(`unsave rejected for ${fn}: ${JSON.stringify(errs)}`, rateLimited ? 429 : 400);
    }
  }

  // ---- the queued unsave action ---------------------------------------------

  async function unsaveOne(item) {
    const fn = item.pk;
    if (cfg.DRY_RUN) {
      console.log(`[BWI][DRY_RUN] Reddit unsave ${fn} (not sent)`);
      return;
    }
    await apiUnsave(fn);
    done.add(fn);
    // Best-effort visual feedback — reddit keeps the row until a reload.
    const el = elementFor(fn);
    if (el) {
      el.classList.remove("bwi-reddit-selected");
      el.classList.add("bwi-unsaved");
    }
  }

  // ---- toolbar ----------------------------------------------------------------

  function build() {
    bar = document.createElement("div");
    bar.className = "bwi-x-toolbar bwi-reddit-toolbar";
    bar.setAttribute("data-bwi", "reddit-unsave");

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
      loadedFullnames().forEach((fn) => selected.add(fn));
      reapplyOverlays();
      resetConfirm();
      sync();
    });

    // Select mode: unsave just the chosen items.
    const unsaveSelBtn = document.createElement("button");
    unsaveSelBtn.className = "bwi-btn bwi-btn--primary";
    unsaveSelBtn.style.display = "none";
    unsaveSelBtn.addEventListener("click", () => {
      startRun(Array.from(selected), unsaveSelBtn);
    });

    // Direct mode: unsave everything currently loaded (kept per Aug 4 audit).
    const unsaveAllBtn = document.createElement("button");
    unsaveAllBtn.className = "bwi-btn bwi-btn--primary";
    unsaveAllBtn.addEventListener("click", () => {
      startRun(loadedFullnames(), unsaveAllBtn);
    });

    const stopBtn = document.createElement("button");
    stopBtn.className = "bwi-btn bwi-btn--danger";
    stopBtn.textContent = "Stop";
    stopBtn.style.display = "none";
    stopBtn.addEventListener("click", () => queue.stop());

    bar.appendChild(label);
    bar.appendChild(selectBtn);
    bar.appendChild(selectAllBtn);
    bar.appendChild(unsaveSelBtn);
    bar.appendChild(unsaveAllBtn);
    bar.appendChild(stopBtn);
    document.body.appendChild(bar);
    els = { label, selectBtn, selectAllBtn, unsaveSelBtn, unsaveAllBtn, stopBtn };
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
    setDisplay(els.stopBtn, running ? "" : "none");
    setDisplay(els.selectBtn, running ? "none" : "");
    setDisplay(els.selectAllBtn, selecting && !running ? "" : "none");
    setDisplay(els.unsaveSelBtn, selecting && !running ? "" : "none");
    setDisplay(els.unsaveAllBtn, !selecting && !running ? "" : "none");
    if (running) return;
    setText(els.selectBtn, selecting ? "Cancel" : "Select");
    const n = loadedFullnames().length;
    if (selecting) {
      els.unsaveSelBtn.disabled = selected.size === 0;
      if (confirmTarget !== els.unsaveSelBtn) {
        setText(els.unsaveSelBtn, `Unsave (${selected.size})`);
      }
      setText(els.label, `${selected.size} of ${n} loaded`);
    } else {
      els.unsaveAllBtn.disabled = n === 0;
      if (confirmTarget !== els.unsaveAllBtn) {
        setText(els.unsaveAllBtn, n ? `Unsave all loaded (${n})` : "Nothing loaded");
      }
      setText(els.label, "Bulk unsave");
    }
  }

  function resetConfirm() {
    confirmTarget = null;
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = null;
  }

  function startRun(fns, btn) {
    if (running || !fns.length) return;
    // Singleton queue — a second run no-ops and steals the live run's events.
    if (queue.isBusy()) {
      ui.toast("Another bulk action is still running — stop it first");
      return;
    }
    // Two-click inline confirm (no window.confirm — it would freeze the page).
    if (confirmTarget !== btn) {
      resetConfirm();
      confirmTarget = btn;
      btn.textContent = `Confirm — unsave ${fns.length}?`;
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
        if (s.phase === "done-one" && s.current) selected.delete(s.current.pk);
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
        ui.toast(`Done — unsaved ${s.done}${s.failed ? `, ${s.failed} missed` : ""}`);
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
    reapplyOverlays();
    sync();
  }

  // ---- lifecycle --------------------------------------------------------------

  function teardown() {
    if (running) queue.stop();
    if (bar) bar.remove();
    bar = null;
    els = null;
    running = false;
    selecting = false;
    selected.clear();
    document.documentElement.classList.remove("bwi-reddit-selecting");
    resetConfirm();
  }

  function maybeInject() {
    if (!onSavedPage()) {
      if (bar) teardown();
      return;
    }
    if (bar && document.contains(bar)) {
      if (!running) {
        if (selected.size) reapplyOverlays(); // shreddit re-renders lose the class
        sync();
      }
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
