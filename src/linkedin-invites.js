// Better Web Insta — LinkedIn: bulk-withdraw sent invitations.
// (FEATURE_FEASIBILITY_REPORT.md §3.15.)
//
// Pure DOM automation of LinkedIn's own UI (no fetch → no CSRF/Voyager). On the
// Sent-invitations page a floating toolbar withdraws pending invites one at a
// time through queue.js: click a row's "Withdraw", then the inline confirm
// popover's "Withdraw" (a native popover, NOT a blocking window.confirm).
//
// LinkedIn is the most automation-hostile host in this project, so this is
// deliberately slow (cfg.LINKEDIN.WITHDRAW: 3-7s, low daily cap) and it HARD
// STOPS the moment any restriction / CAPTCHA / "unusual activity" banner
// appears (cfg.LINKEDIN.LABELS.restrictionMarkers). All text-matched — never by
// LinkedIn's churning utility classes. DRY_RUN-first is wise.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const ui = BWI.ui;
  const queue = BWI.queue;
  const LI = cfg.LINKEDIN;
  const L = LI.LABELS;

  if (!LI.WITHDRAW_INVITES) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const restrict = L.restrictionMarkers.map((s) => s.toLowerCase());

  let bar = null;
  let els = null;
  let running = false;
  let confirmPending = false;
  let confirmTimer = null;

  function onSentPage() {
    return /\/mynetwork\/invitation-manage\/sent\/?$/.test(location.pathname);
  }

  // Abort signal: if LinkedIn shows any restriction/verification banner, stop
  // everything immediately (this is exactly the state we must not push into).
  function restrictionShowing() {
    const t = (document.body.innerText || "").toLowerCase();
    return restrict.some((m) => t.includes(m));
  }

  function buttonsByText(root, label) {
    const wanted = label.toLowerCase();
    const nodes = root.querySelectorAll('button, [role="button"], span');
    const out = [];
    for (const n of nodes) {
      // Use the button element itself (span matches roll up to their button).
      const btn = n.closest('button, [role="button"]') || n;
      if ((btn.textContent || "").trim().toLowerCase() === wanted) out.push(btn);
    }
    return out;
  }

  // Count the withdrawable rows currently rendered (each has a "Withdraw"
  // trigger). De-dup because span+button both match.
  function pendingWithdrawButtons() {
    const seen = new Set();
    return buttonsByText(document, L.withdraw).filter((b) => {
      // Skip a confirm-popover "Withdraw" (it lives in a dialog, not a row).
      if (b.closest('[role="dialog"], .artdeco-modal')) return false;
      if (seen.has(b)) return false;
      seen.add(b);
      return true;
    });
  }

  // ---- the queued withdraw action -------------------------------------------
  // Each "item" is just an index — we always act on the first still-present
  // Withdraw button, since withdrawing removes the row and the list re-flows.

  async function withdrawOne() {
    if (restrictionShowing()) throw makeBlock();

    if (cfg.DRY_RUN) {
      console.log("[BWI][DRY_RUN] LinkedIn withdraw (not clicked)");
      return;
    }

    const rowBtns = pendingWithdrawButtons();
    if (!rowBtns.length) throw new Error("no pending withdraw buttons");
    const btn = rowBtns[0];
    btn.scrollIntoView({ block: "center" });
    btn.click();

    // The inline confirm popover appears; click ITS "Withdraw".
    for (let tries = 0; tries < 20; tries++) {
      await sleep(150);
      if (restrictionShowing()) throw makeBlock();
      const confirm = buttonsByText(document, L.withdraw).find((b) =>
        b.closest('[role="dialog"], .artdeco-modal, .artdeco-modal__actionbar')
      );
      if (confirm) {
        confirm.click();
        await sleep(300);
        return;
      }
    }
    throw new Error("confirm popover not found");
  }

  function makeBlock() {
    // Shaped so queue.isActionBlock treats it as a hard stop.
    const e = new Error("LinkedIn restriction banner detected");
    e.status = 429;
    return e;
  }

  // ---- toolbar ----------------------------------------------------------------

  function build() {
    bar = document.createElement("div");
    bar.className = "bwi-x-toolbar bwi-li-toolbar";
    bar.setAttribute("data-bwi", "li-invites");

    const label = document.createElement("span");
    label.className = "bwi-x-count";
    const goBtn = document.createElement("button");
    goBtn.className = "bwi-btn bwi-btn--primary";
    goBtn.addEventListener("click", onWithdraw);
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
    const n = running ? null : pendingWithdrawButtons().length;
    els.stopBtn.style.display = running ? "" : "none";
    els.goBtn.style.display = running ? "none" : "";
    if (!running && !confirmPending) {
      els.goBtn.disabled = n === 0;
      els.goBtn.textContent = n ? `Withdraw loaded (${n})` : "Nothing loaded";
      els.label.textContent = "Bulk withdraw";
    }
  }

  function resetConfirm() {
    confirmPending = false;
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = null;
  }

  function onWithdraw() {
    if (running) return;
    const n = pendingWithdrawButtons().length;
    if (!n) return;
    if (restrictionShowing()) {
      ui.toast("LinkedIn is showing a restriction — not starting.");
      return;
    }
    if (!confirmPending) {
      confirmPending = true;
      els.goBtn.textContent = `Confirm — withdraw ${n}?`;
      confirmTimer = setTimeout(() => {
        resetConfirm();
        sync();
      }, 4000);
      return;
    }
    resetConfirm();
    running = true;
    sync();
    if (cfg.DRY_RUN) ui.toast("DRY_RUN on — nothing will actually be withdrawn");

    // One queue item per loaded row; the action always takes the first present.
    const items = Array.from({ length: n }, (_, i) => ({ pk: "row-" + i }));

    queue.onProgress((s) => {
      if (s.phase === "progress") {
        els.label.textContent = `Withdrawing ${s.done + s.failed + 1}/${s.cap}…`;
      } else if (s.phase === "done-one" || s.phase === "fail-one") {
        els.label.textContent = `Withdrew ${s.done}/${s.cap}${s.failed ? ` · ${s.failed} missed` : ""}`;
      } else if (s.phase === "stopped") {
        const r = {
          user: "Stopped.",
          "daily-cap": `Daily withdraw cap reached (${LI.WITHDRAW.DAILY_CAP}).`,
          "action-block": "LinkedIn restriction detected — stopped. Wait a while.",
        };
        ui.toast(r[s.reason] || "Stopped");
        finish();
      } else if (s.phase === "complete") {
        ui.toast(`Done — withdrew ${s.done}${s.failed ? `, ${s.failed} missed` : ""}`);
        finish();
      }
    });

    queue.run(items, withdrawOne, {
      minDelay: LI.WITHDRAW.MIN_DELAY_MS,
      maxDelay: LI.WITHDRAW.MAX_DELAY_MS,
      sessionCap: LI.WITHDRAW.SESSION_CAP,
      dailyCap: LI.WITHDRAW.DAILY_CAP,
      dailyKey: LI.WITHDRAW.DAILY_KEY,
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
    if (!onSentPage()) {
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
