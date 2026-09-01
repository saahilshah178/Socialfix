// Socialfix — throttled bulk-action queue.
// The single path for ALL bulk actions on every platform. Enforces randomized
// delays plus session and daily caps, and stops on action-blocks. Progress is
// pushed to a listener so the feature UIs (and popup) can render live status.
//
// Platform-agnostic: on Instagram, `action` is a method name on BWI.api (which
// ig-api.js defines); on hosts without an API layer (e.g. YouTube DOM
// automation), `action` is a function — see run() below. BWI.api is therefore
// resolved lazily, never at load.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const DEFAULT_DAILY_KEY = "bwi_daily_";
  const todayKey = (prefix = DEFAULT_DAILY_KEY) =>
    prefix + new Date().toISOString().slice(0, 10);

  // Per-key mutex chains to serialize concurrent getDailyCount/bumpDailyCount
  // and reserveDailySlot calls. Prevents concurrent callers from stomping each
  // other's read-modify-write on the same daily counter.
  const mutexChains = {};
  function getMutexChain(prefix) {
    if (!mutexChains[prefix]) {
      mutexChains[prefix] = Promise.resolve();
    }
    return mutexChains[prefix];
  }
  function setMutexChain(prefix, promise) {
    mutexChains[prefix] = promise;
  }

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

  // Atomically check if a daily slot is available and reserve it.
  // Serializes concurrent callers via a per-prefix mutex so they don't stomp
  // each other's reads or writes to the daily counter. Returns true if a slot
  // was reserved (current < cap), false if the cap is already met. On success,
  // the daily count is atomically incremented by 1.
  async function reserveDailySlot(prefix = DEFAULT_DAILY_KEY, cap = cfg.DAILY_CAP) {
    const chain = getMutexChain(prefix);
    let result = false;

    const newChain = chain.then(async () => {
      try {
        const key = todayKey(prefix);
        const res = await chrome.storage.local.get(key);
        const current = (res && res[key]) || 0;
        if (current < cap) {
          await chrome.storage.local.set({ [key]: current + 1 });
          result = true;
        }
      } catch (_) {
        result = false;
      }
    });

    setMutexChain(prefix, newChain);
    await newChain;
    return result;
  }

  const rand = (min, max) => Math.floor(min + Math.random() * (max - min));

  // Detect a "stop now" rate-limit / action-block signal from an API error.
  // Covers both Instagram and X (Twitter); 429 is the universal case.
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
        // challenge/checkpoint/consent/login walls mean every subsequent write
        // will silently fail too — stop the run, don't burn the queue.
        if (/block|spam|wait|challenge|checkpoint|consent|login_required/i.test(b.message)) {
          return true;
        }
      }
      // X returns an errors:[{code}] array: 88 rate-limit, 326 locked/verify,
      // 64 suspended, 261 write-restricted. Any of these means stop.
      if (Array.isArray(b.errors)) {
        const codes = new Set([88, 326, 64, 261]);
        if (b.errors.some((e) => e && codes.has(Number(e.code)))) return true;
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

    // Is a bulk run already in flight? The queue is a SINGLETON: run() silently
    // no-ops when busy and onProgress() has one listener slot, so a second
    // feature starting a run would both do nothing AND hijack the first run's
    // progress events (rendering its counts as its own). Every feature must
    // call this before touching onProgress/run — see the guard in each UI.
    isBusy() {
      return this.running;
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

    // items: [{ pk, ... }], action: either a method name on BWI.api
    // ("unfollow" | "removeFollower" | "unsave" — Instagram) or an async
    // FUNCTION (item) => Promise (platforms driven by DOM automation, e.g.
    // YouTube; the function must honor cfg.DRY_RUN itself). opts overrides the
    // throttle/caps so each action can have its own delays, limits, and daily
    // budget; unset fields fall back to the conservative unfollow defaults in
    // config.js.
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
          this.running = false;
          this.stopRequested = false;
          this.emit({ phase: "stopped", reason: "user", total, done, failed });
          return;
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
          // Function actions get the whole item; BWI.api method-name actions
          // get (pk, item) — the 2nd arg lets actions read per-item extras.
          if (typeof action === "function") {
            await action(item);
          } else {
            await BWI.api[action](item.pk, item);
          }
          done++;
          // A DRY_RUN rehearsal performs no real action, so it must not spend
          // the real daily budget (that would block the live run afterwards).
          if (!cfg.DRY_RUN) await bumpDailyCount(dailyKey, 1);
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
          console.warn("[BWI] action failed for", item.username || item.pk, err);
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
          await sleep(rand(minDelay, maxDelay));
        }
      }

      this.running = false;
      this.stopRequested = false;
      this.emit({ phase: "complete", total, cap, done, failed });
    },
  };

  BWI.queue = queue;
  // getDailyCount / bumpDailyCount / reserveDailySlot / isActionBlock are
  // exported so callers that don't drive the bulk queue directly (e.g. Feature
  // 2's per-row unfollow) can still share the same per-action daily-budget +
  // action-block conventions. reserveDailySlot atomically checks and increments
  // the daily counter, preventing race conditions on concurrent calls.
  BWI.queueUtil = { getDailyCount, bumpDailyCount, reserveDailySlot, isActionBlock };

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
