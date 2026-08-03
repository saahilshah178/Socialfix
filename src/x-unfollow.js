// Better Web Insta — X: find & bulk-unfollow accounts that don't follow back.
// (FEATURE_FEASIBILITY_REPORT.md §3.2.)
//
// A floating toolbar on your OWN Following page (x.com/<you>/following). It
// works on the rows currently loaded in the DOM — like bulk-unlike, scroll to
// load more and rescan. Design (2026): X removed the v1.1 friends-list
// endpoints, so this is DOM-first, matching x-unlike/tiktok:
//   • the following LIST comes from the loaded [data-testid="UserCell"] rows
//     (the row's Following button is [data-testid="<userId>-unfollow"], so the
//     numeric id is right there — no list API needed);
//   • follow-back is checked via the one surviving v1.1 read,
//     friendships/lookup.json (x-api.js computeNonFollowers);
//   • unfollow rides X's own Following button + confirmation sheet (no destroy
//     API) so we inherit whatever headers X needs and make no write call.
// Removals run through the shared queue.js with X-specific caps (do NOT reuse
// IG's) + its own daily budget, a two-click confirm, and Stop. Honors DRY_RUN.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const ui = BWI.ui;
  const queue = BWI.queue;
  const xApi = BWI.xApi;
  const X = cfg.X;
  const U = X.UNFOLLOW;

  if (!X.BULK_UNFOLLOW) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let bar = null;
  let els = null;
  let running = false;
  let confirmPending = false;
  let confirmTimer = null;
  let nonFollowers = []; // last scan result: [{pk, username, full_name, profile_pic_url}]

  // ---- own-Following-page detection ------------------------------------------

  // The logged-in user's @handle, needed to confirm we're on THEIR Following
  // page (not someone else's). Resolved from stable nav hooks.
  function ownHandle() {
    const tab = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    if (tab) {
      const h = (tab.getAttribute("href") || "").replace(/\//g, "");
      if (h) return h.toLowerCase();
    }
    const sw = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (sw) {
      const m = sw.textContent.match(/@([A-Za-z0-9_]+)/);
      if (m) return m[1].toLowerCase();
    }
    return null;
  }

  function onOwnFollowingPage() {
    const m = location.pathname.match(/^\/([^/]+)\/following\/?$/);
    if (!m) return false;
    const oh = ownHandle();
    // If we can't resolve our own handle, don't guess — better to no-op than to
    // offer bulk unfollow on someone else's list.
    return oh ? m[1].toLowerCase() === oh : false;
  }

  // ---- DOM scan of the loaded following rows ---------------------------------

  function loadedFollowing() {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('[data-testid="UserCell"]').forEach((cell) => {
      const btn = cell.querySelector('[data-testid$="-unfollow"]');
      if (!btn) return; // only rows you currently follow have an unfollow button
      const m = (btn.getAttribute("data-testid") || "").match(/^(\d+)-unfollow$/);
      if (!m) return;
      const pk = m[1];
      if (seen.has(pk)) return;
      seen.add(pk);
      const link = cell.querySelector('a[role="link"][href^="/"]') || cell.querySelector('a[href^="/"]');
      const username = link ? (link.getAttribute("href") || "").replace(/\//g, "") : pk;
      const img = cell.querySelector('img[src*="profile_images"]');
      out.push({
        pk,
        username,
        full_name: "",
        profile_pic_url: img ? img.src : "",
      });
    });
    return out;
  }

  // ---- the queued unfollow action (DOM click) --------------------------------

  async function unfollowOne(item) {
    if (cfg.DRY_RUN) {
      console.log(`[BWI][DRY_RUN] X unfollow ${item.pk} (@${item.username}) (not clicked)`);
      return;
    }
    const btn = document.querySelector(`[data-testid="${item.pk}-unfollow"]`);
    if (!btn) throw new Error("row scrolled out (not loaded): " + item.pk);
    // Refuse to act if a confirmation sheet is ALREADY open — it belongs to some
    // other action (X reuses confirmationSheetConfirm for block/delete/logout),
    // and clicking our button under it then confirming it would hit the wrong
    // account. Bail so the queue counts this item failed instead.
    if (document.querySelector('[data-testid="confirmationSheetConfirm"]')) {
      throw new Error("a confirmation sheet is already open — skipping " + item.pk);
    }
    btn.scrollIntoView({ block: "center" });
    await sleep(150);
    btn.click();
    // Wait for OUR confirm sheet, then verify it's the unfollow sheet (not a
    // stray block/delete sheet reusing the same testid) before clicking.
    let confirm = null;
    for (let i = 0; i < 25 && !confirm; i++) {
      await sleep(100);
      confirm = document.querySelector('[data-testid="confirmationSheetConfirm"]');
    }
    if (!confirm) throw new Error("confirm sheet not found: " + item.pk);
    if (confirm.textContent.trim() !== X.LABELS.unfollowConfirm) {
      throw new Error("unexpected confirmation sheet (not unfollow) — skipping " + item.pk);
    }
    confirm.click();
    // Verify the unfollow took: the row's button flips to "<pk>-follow" (or the
    // row unmounts). If the "-unfollow" button is still there after a beat, X
    // likely rejected it (write-restriction) — surface as a 429-shaped
    // action-block so queue.isActionBlock halts the run instead of the queue
    // burning the daily budget on silent no-op clicks.
    for (let i = 0; i < 12; i++) {
      await sleep(200);
      if (document.querySelector(`[data-testid="${item.pk}-follow"]`)) return; // flipped
      if (!document.querySelector(`[data-testid="${item.pk}-unfollow"]`)) return; // row gone
    }
    const err = new Error("unfollow did not take — X may have restricted the action");
    err.status = 429;
    throw err;
  }

  // ---- toolbar ---------------------------------------------------------------

  function build() {
    bar = document.createElement("div");
    bar.className = "bwi-x-toolbar";
    bar.setAttribute("data-bwi", "x-unfollow");

    const label = document.createElement("span");
    label.className = "bwi-x-count";

    const scanBtn = document.createElement("button");
    scanBtn.className = "bwi-btn bwi-btn--ghost";
    scanBtn.addEventListener("click", onScan);

    const unfollowBtn = document.createElement("button");
    unfollowBtn.className = "bwi-btn bwi-btn--danger";
    unfollowBtn.style.display = "none";
    unfollowBtn.addEventListener("click", onUnfollow);

    const stopBtn = document.createElement("button");
    stopBtn.className = "bwi-btn bwi-btn--danger";
    stopBtn.textContent = "Stop";
    stopBtn.style.display = "none";
    stopBtn.addEventListener("click", () => queue.stop());

    bar.appendChild(label);
    bar.appendChild(scanBtn);
    bar.appendChild(unfollowBtn);
    bar.appendChild(stopBtn);
    document.body.appendChild(bar);
    els = { label, scanBtn, unfollowBtn, stopBtn };
    resetIdle();
  }

  // Idempotent setters: all writes land in our toolbar, which sits in
  // document.body — the subtree the observer watches. Unconditional writes would
  // re-fire the observer on their own output (the freeze bug), so guard them.
  function setText(el, v) {
    if (el.textContent !== v) el.textContent = v;
  }
  function setDisplay(el, v) {
    if (el.style.display !== v) el.style.display = v;
  }

  function resetIdle() {
    if (!els || running) return;
    setDisplay(els.stopBtn, "none");
    setDisplay(els.scanBtn, "");
    els.scanBtn.disabled = false;
    setText(els.scanBtn, "Scan loaded");
    if (!confirmPending) {
      if (nonFollowers.length) {
        setDisplay(els.unfollowBtn, "");
        setText(els.unfollowBtn, `Unfollow ${nonFollowers.length} non-followers`);
        setText(els.label, `${nonFollowers.length} of loaded don't follow you back`);
      } else {
        setDisplay(els.unfollowBtn, "none");
        setText(els.label, "Non-followers");
      }
    }
  }

  function resetConfirm() {
    confirmPending = false;
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  }

  async function onScan() {
    if (running) return;
    resetConfirm();
    const following = loadedFollowing();
    if (!following.length) {
      setText(els.label, "No rows loaded — scroll your Following list, then Scan");
      return;
    }
    els.scanBtn.disabled = true;
    setDisplay(els.unfollowBtn, "none");
    setText(els.label, `Checking follow-back for ${following.length} loaded…`);
    try {
      nonFollowers = await xApi.computeNonFollowers(following, (done, total) => {
        setText(els.label, `Checking follow-back… ${done}/${total}`);
      });
      resetIdle();
      if (!nonFollowers.length) {
        setText(els.label, "Everyone loaded follows you back 🎉 (scroll for more)");
      }
    } catch (err) {
      console.warn("[BWI] X non-follower check failed", err);
      setText(
        els.label,
        xApi.XApiError && err instanceof xApi.XApiError && err.status === 429
          ? "X is rate-limiting — wait a few minutes and rescan"
          : "Couldn't check follow-back (X API error) — try again"
      );
      els.scanBtn.disabled = false;
    }
  }

  function onUnfollow() {
    if (running || !nonFollowers.length) return;
    if (!confirmPending) {
      confirmPending = true;
      setText(els.unfollowBtn, `Confirm — unfollow ${nonFollowers.length}?`);
      confirmTimer = setTimeout(() => {
        resetConfirm();
        resetIdle();
      }, 4000);
      return;
    }
    resetConfirm();
    running = true;
    setDisplay(els.scanBtn, "none");
    setDisplay(els.unfollowBtn, "none");
    setDisplay(els.stopBtn, "");
    if (cfg.DRY_RUN) ui.toast("DRY_RUN on — nothing will actually be unfollowed");

    const items = nonFollowers.slice();

    queue.onProgress((s) => {
      if (s.phase === "progress") {
        setText(els.label, `Unfollowing ${s.done + s.failed + 1}/${s.cap}…`);
      } else if (s.phase === "done-one" || s.phase === "fail-one") {
        setText(els.label, `Unfollowed ${s.done}/${s.cap}${s.failed ? ` · ${s.failed} missed` : ""}`);
      } else if (s.phase === "stopped") {
        const r = {
          user: "Stopped.",
          "daily-cap": `Daily unfollow cap reached (${U.DAILY_CAP}). Continue tomorrow.`,
          "action-block": "X restricted the action — stopped. Try later.",
        };
        ui.toast(r[s.reason] || "Stopped");
        finish();
      } else if (s.phase === "complete") {
        ui.toast(`Done — unfollowed ${s.done}${s.failed ? `, ${s.failed} missed (scroll + rescan)` : ""}`);
        finish();
      }
    });

    queue.run(items, unfollowOne, {
      minDelay: U.MIN_DELAY_MS,
      maxDelay: U.MAX_DELAY_MS,
      sessionCap: U.SESSION_CAP,
      dailyCap: U.DAILY_CAP,
      dailyKey: U.DAILY_KEY,
    });
  }

  function finish() {
    running = false;
    nonFollowers = []; // force a rescan of the now-changed list
    resetIdle();
  }

  // ---- lifecycle (SPA) -------------------------------------------------------

  function teardown() {
    // If a bulk run is in flight, stop it FIRST. Otherwise an SPA navigation off
    // /following tears down the toolbar (and its Stop button) while the singleton
    // queue keeps calling unfollowOne — whose global [data-testid="<pk>-unfollow"]
    // lookup would then match the profile-header Following button on whatever page
    // the user landed on, unfollowing the wrong account invisibly.
    if (running) queue.stop();
    if (bar) bar.remove();
    bar = null;
    els = null;
    running = false;
    nonFollowers = [];
    resetConfirm();
  }

  function maybeInject() {
    if (!onOwnFollowingPage()) {
      if (bar) teardown();
      return;
    }
    if (bar && document.contains(bar)) {
      return;
    }
    build();
  }

  // Coalesce the virtualized list's constant mutations, and ignore mutations
  // that come only from our own toolbar (same freeze-safety as x-unlike).
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
