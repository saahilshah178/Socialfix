// Better Web Insta — Feature 2: "doesn't follow you back" subsection.
// Only fires on YOUR OWN profile's Following modal. Fetches the complete
// following + followers lists via Instagram's private web API, computes the
// set difference, and injects a subsection with per-row unfollow plus a
// throttled "Unfollow all".
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const api = BWI.api;
  const ui = BWI.ui;
  const queue = BWI.queue;

  let ownUsername = null;
  let ownId = null;

  // In-memory cache of the computed list for the current session so DOM churn
  // / refresh doesn't refetch needlessly. Cleared when no following dialog is
  // on screen.
  let cache = null; // { nonFollowers: [...] }

  // Persisted cache so REOPENING the modal is instant instead of re-scanning
  // your whole graph every time (the slow part). Survives across page loads;
  // invalidated by age (TTL) or an explicit Refresh.
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
  const storageKey = () => "bwi_nonfollowers_" + ownId;

  async function loadStoredNonFollowers() {
    try {
      const key = storageKey();
      const res = await chrome.storage.local.get(key);
      const entry = res && res[key];
      if (
        entry &&
        Array.isArray(entry.nonFollowers) &&
        entry.ts &&
        Date.now() - entry.ts < CACHE_TTL_MS
      ) {
        return entry.nonFollowers;
      }
    } catch (_) {
      /* storage may be unavailable; treat as a cache miss */
    }
    return null;
  }

  function saveStoredNonFollowers(nonFollowers) {
    try {
      chrome.storage.local.set({
        [storageKey()]: { ts: Date.now(), nonFollowers },
      });
    } catch (_) {}
  }

  function clearStoredNonFollowers() {
    try {
      chrome.storage.local.remove(storageKey());
    } catch (_) {}
  }

  api
    .getOwnUsername()
    .then((u) => {
      ownUsername = u;
      // The modal may already be open and settled before this resolved.
      maybeInject();
    })
    .catch(() => {});
  ownId = api.getOwnUserId();

  // First path segment of the current URL, e.g. "/jane/following/" -> "jane".
  function firstPathSegment() {
    return location.pathname.toLowerCase().split("/").filter(Boolean)[0] || null;
  }

  // Are we currently viewing OUR OWN profile (with or without a /following/
  // suffix)? Opening the list is a client-side modal and Instagram does not
  // reliably push "/following/" into the URL, so we must NOT depend on that
  // suffix — only on the profile owner matching us.
  function isOnOwnProfile() {
    return !!ownUsername && firstPathSegment() === ownUsername.toLowerCase();
  }

  // True only when the URL explicitly carries the /<own>/following/ suffix.
  function urlSaysFollowing() {
    if (!ownUsername) return false;
    const segs = location.pathname.toLowerCase().split("/").filter(Boolean);
    return segs[0] === ownUsername.toLowerCase() && segs[1] === "following";
  }

  // Locate the dialog that is OUR following list. Identify it positively
  // (URL suffix OR title === "Following") and skip the followers modal so we
  // never inject the wrong list.
  function findOwnFollowingDialog() {
    if (!isOnOwnProfile()) return null;
    const urlFollowing = urlSaysFollowing();
    for (const d of ui.getDialogs()) {
      if (ui.dialogTitleIs(d, cfg.LABELS.followers)) continue; // not the followers list
      if (urlFollowing || ui.dialogTitleIs(d, cfg.LABELS.following)) return d;
    }
    return null;
  }

  // Resolve once the modal's row list exists (rows load async after open).
  function whenReady(dialog, cb, tries = 0) {
    // Stop polling if the modal closed or our section is already built. (Don't
    // bail on the "loading" marker that inject() set — that's us, mid-flight.)
    if (!dialog.isConnected) return;
    if (dialog.querySelector('[data-bwi="subsection"]')) return;
    const hasRows = dialog.querySelector('a[href^="/"] img');
    const container = ui.findScrollContainer(dialog);
    if (hasRows && container) {
      cb(container);
    } else if (tries < 50) {
      setTimeout(() => whenReady(dialog, cb, tries + 1), 120);
    }
  }

  // Resolve the non-follower list. Streams each result to `onRow` as it's found
  // (live or from cache) and reports paging progress to `onProgress`. `force`
  // bypasses both caches for an explicit Refresh.
  async function computeNonFollowers({ onProgress, onRow, force } = {}) {
    if (!force && cache) {
      cache.nonFollowers.forEach((u) => onRow && onRow(u));
      return cache.nonFollowers;
    }
    if (!force) {
      const stored = await loadStoredNonFollowers();
      if (stored) {
        cache = { nonFollowers: stored };
        stored.forEach((u) => onRow && onRow(u));
        return stored;
      }
    }

    let nFollowing = 0;
    let nFollowers = 0;
    const report = () => onProgress && onProgress(nFollowing, nFollowers);

    // Fetch the full followers list first so we have the complete membership
    // set, then page through following and emit each non-follower the moment
    // it's seen — so rows appear progressively instead of after one long wait.
    const followers = await api.fetchAllFollowers(ownId, (n) => {
      nFollowers = n;
      report();
    });
    const followerPks = new Set(followers.map((u) => u.pk));

    const nonFollowers = [];
    await api.fetchAllFollowing(
      ownId,
      (n) => {
        nFollowing = n;
        report();
      },
      (pageUsers) => {
        for (const u of pageUsers) {
          if (!followerPks.has(u.pk)) {
            nonFollowers.push(u);
            if (onRow) onRow(u);
          }
        }
      }
    );

    cache = { nonFollowers };
    saveStoredNonFollowers(nonFollowers);
    return nonFollowers;
  }

  function wireHandlers(panel, nonFollowers, dialog) {
    async function unfollowOne(u, row) {
      panel.markRow(u.pk, "pending");
      try {
        await api.unfollow(u.pk);
        panel.markRow(u.pk, "done");
      } catch (err) {
        if (BWI.queueUtil.isActionBlock(err)) {
          ui.toast("Instagram action-blocked — slow down and try later");
        }
        panel.markRow(u.pk, "fail");
      }
    }

    function remaining() {
      // Only rows not already unfollowed.
      return nonFollowers.filter((u) => {
        const row = panel.root.querySelector(`.bwi-row[data-pk="${u.pk}"]`);
        return row && !row.classList.contains("bwi-row--done");
      });
    }

    function onUnfollowAll() {
      const items = remaining().map((u) => ({ pk: u.pk, username: u.username }));
      if (items.length === 0) return;
      if (cfg.DRY_RUN) ui.toast("DRY_RUN on — nothing will actually be sent");

      queue.onProgress((s) => {
        if (s.phase === "start") {
          if (s.cap < items.length) {
            ui.toast(
              `Capped at ${s.cap} this run (daily/session limit). Run again later for the rest.`
            );
          }
          panel.setProgress(`Unfollowing 0/${s.cap}…`, { busy: true });
        } else if (s.phase === "progress") {
          panel.markRow(s.current.pk, "pending");
        } else if (s.phase === "done-one") {
          panel.markRow(s.current.pk, "done");
          panel.setProgress(`Unfollowed ${s.done}/${s.cap}…`, { busy: true });
        } else if (s.phase === "fail-one") {
          panel.markRow(s.current.pk, "fail");
        } else if (s.phase === "stopped") {
          const reasons = {
            user: "Stopped.",
            "daily-cap": "Daily limit reached — try again tomorrow.",
            "action-block":
              "Instagram action-blocked the account — stopped. Wait a while before retrying.",
          };
          panel.setProgress(
            `${reasons[s.reason] || "Stopped."} Unfollowed ${s.done}.`,
            { busy: false }
          );
          ui.toast(reasons[s.reason] || "Stopped");
        } else if (s.phase === "complete") {
          panel.setProgress(
            `Done — unfollowed ${s.done}${s.failed ? `, ${s.failed} failed` : ""}.`,
            { busy: false }
          );
        }
      });

      queue.run(items, "unfollow");
    }

    return {
      onUnfollowOne: unfollowOne,
      onUnfollowAll,
      onStop: () => queue.stop(),
      onRefresh: () => {
        cache = null;
        clearStoredNonFollowers();
        const old = dialog.querySelector('[data-bwi="subsection"]');
        dialog.dataset.bwiInjected = "";
        if (old) old.remove();
        inject(dialog);
      },
    };
  }

  function inject(dialog) {
    if (dialog.dataset.bwiInjected) return;
    dialog.dataset.bwiInjected = "loading";

    whenReady(dialog, async (container) => {
      // Build the panel shell immediately (in its loading state) and insert it
      // above the native list, so the user sees the section right away and
      // rows stream in as the scan finds them — no blank multi-second wait.
      let handlers;
      const panel = ui.renderSubsection({
        onUnfollowOne: (u, row) => handlers.onUnfollowOne(u, row),
        onUnfollowAll: () => handlers.onUnfollowAll(),
        onStop: () => handlers.onStop(),
        onRefresh: () => handlers.onRefresh(),
      });
      ui.insertAboveList(panel.root, container);

      let nonFollowers;
      try {
        nonFollowers = await computeNonFollowers({
          onProgress: (fwing, fwers) => {
            panel.setScanStatus(
              `Scanning your lists… ${fwing} following, ${fwers} followers`
            );
          },
          onRow: (u) => panel.addRow(u),
        });
      } catch (err) {
        console.warn("[BWI] computeNonFollowers failed", err);
        handlers = wireHandlers(panel, [], dialog);
        panel.showError("Instagram API error. Tap Refresh to retry.");
        dialog.dataset.bwiInjected = "error";
        return;
      }

      handlers = wireHandlers(panel, nonFollowers, dialog);
      panel.finish();
      dialog.dataset.bwiInjected = "done";
    });
  }

  function maybeInject() {
    if (!ownUsername) return;
    const dialogs = ui.getDialogs();
    if (dialogs.length === 0) {
      cache = null; // every modal closed — drop cached lists
      return;
    }
    // Already handled this modal — avoid re-scanning on every mutation.
    if (dialogs.some((d) => d.dataset.bwiInjected)) return;
    const dialog = findOwnFollowingDialog();
    if (dialog) inject(dialog);
  }

  const observer = new MutationObserver(() => maybeInject());
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial check in case the modal is already open on load.
  maybeInject();
})();
