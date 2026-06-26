// Better Web Insta — throttled bulk-action queue.
// Single path for "Unfollow all". Enforces randomized delays plus session
// and daily caps, and stops on Instagram action-blocks. Progress is pushed
// to a listener so the subsection UI (and popup) can render live status.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const api = BWI.api;

  const DEFAULT_DAILY_KEY = "bwi_daily_";
  const todayKey = (prefix = DEFAULT_DAILY_KEY) =>
    prefix + new Date().toISOString().slice(0, 10);

  async function getDailyCount(prefix = DEFAULT_DAILY_KEY) {
    try {
      const key = todayKey(prefix);
      const res = await chrome.storage.local.get(key);
      return (res && res[key]) || 0;
    } catch (_) {
      return 0;
    }
  }

  async function bumpDailyCount(prefix = DEFAULT_DAILY_KEY, n = 1) {
    try {
      const key = todayKey(prefix);
      const current = await getDailyCount(prefix);
      await chrome.storage.local.set({ [key]: current + n });
    } catch (_) {}
  }

  const rand = (min, max) => Math.floor(min + Math.random() * (max - min));

  // Detect Instagram's "action blocked" signal from an API error.
  function isActionBlock(err) {
    if (!err) return false;
    if (err.status === 429) return true;
    const b = err.body;
    if (b && typeof b === "object") {
      // Instagram's action-block most commonly comes back as HTTP 400 with
      // message:"feedback_required" and/or spam:true (status varies, so the
      // body is the reliable signal — not the HTTP code alone).
      if (b.spam === true || b.feedback_required) return true;
      if (typeof b.message === "string") {
        if (b.message === "feedback_required") return true;
        if (/block|spam|wait/i.test(b.message)) return true;
      }
    }
    return false;
  }

  // The queue is a singleton: only one bulk run at a time.
  const queue = {
    running: false,
    stopRequested: false,
    listener: null, // (state) => void

    onProgress(fn) {
      this.listener = fn;
    },

    emit(state) {
      if (this.listener) {
        try {
          this.listener(state);
        } catch (_) {}
      }
    },

    stop() {
      this.stopRequested = true;
    },

    // items: [{ pk, ... }], action: a method name on BWI.api ("unfollow" |
    // "removeFollower" | "unsave"). opts overrides the throttle/caps so each
    // action can have its own delays, limits, and daily budget; unset fields
    // fall back to the conservative unfollow defaults in config.js.
    async run(items, action = "unfollow", opts = {}) {
      if (this.running) return;
      this.running = true;
      this.stopRequested = false;

      const minDelay = opts.minDelay != null ? opts.minDelay : cfg.MIN_DELAY_MS;
      const maxDelay = opts.maxDelay != null ? opts.maxDelay : cfg.MAX_DELAY_MS;
      const sessionCap =
        opts.sessionCap != null ? opts.sessionCap : cfg.SESSION_CAP;
      const dailyCap = opts.dailyCap != null ? opts.dailyCap : cfg.DAILY_CAP;
      const dailyKey = opts.dailyKey || DEFAULT_DAILY_KEY;

      const total = items.length;
      let done = 0;
      let failed = 0;
      const dailyStart = await getDailyCount(dailyKey);
      const dailyRemaining = Math.max(0, dailyCap - dailyStart);
      const cap = Math.min(items.length, sessionCap, dailyRemaining);

      this.emit({ phase: "start", total, cap, done, failed });

      if (cap <= 0) {
        this.running = false;
        this.emit({
          phase: "stopped",
          reason: "daily-cap",
          total,
          done,
          failed,
        });
        return;
      }

      for (let i = 0; i < cap; i++) {
        if (this.stopRequested) {
          this.emit({ phase: "stopped", reason: "user", total, done, failed });
          break;
        }

        const item = items[i];
        this.emit({
          phase: "progress",
          current: item,
          total,
          cap,
          done,
          failed,
        });

        try {
          await api[action](item.pk);
          done++;
          await bumpDailyCount(dailyKey, 1);
          this.emit({
            phase: "done-one",
            current: item,
            total,
            cap,
            done,
            failed,
          });
        } catch (err) {
          if (isActionBlock(err)) {
            this.emit({
              phase: "stopped",
              reason: "action-block",
              total,
              done,
              failed,
            });
            this.running = false;
            this.stopRequested = false;
            return;
          }
          failed++;
          console.warn("[BWI] action failed for", item.username, err);
          this.emit({
            phase: "fail-one",
            current: item,
            total,
            cap,
            done,
            failed,
          });
        }

        // Jittered delay before the next action (skip after the last one).
        if (i < cap - 1 && !this.stopRequested) {
          await api.sleep(rand(minDelay, maxDelay));
        }
      }

      this.running = false;
      this.stopRequested = false;
      this.emit({ phase: "complete", total, cap, done, failed });
    },
  };

  BWI.queue = queue;
  BWI.queueUtil = { getDailyCount, isActionBlock };

  // Let the popup remotely stop a running bulk job.
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === "bwi-stop") {
        queue.stop();
        sendResponse({ ok: true, running: queue.running });
      }
      return true;
    });
  } catch (_) {}
})();
