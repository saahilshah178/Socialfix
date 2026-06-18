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

  // Cache the computed lists per open so DOM churn / refresh doesn't refetch
  // needlessly. Cleared when no following dialog is on screen.
  let cache = null; // { nonFollowers: [...] }

  api
    .getOwnUsername()
    .then((u) => {
      ownUsername = u;
      // The modal may already be open and settled before this resolved.
      maybeInject();
    })
    .catch(() => {});
  ownId = api.getOwnUserId();

  function isOwnFollowingPath() {
    if (!ownUsername) return false;
    const p = location.pathname.toLowerCase().replace(/\/+$/, "");
    return p === `/${ownUsername.toLowerCase()}/following`;
  }

  // Find the scrollable list container inside the dialog so we can insert our
  // panel just above it (below the modal header/search).
  function findScrollContainer(dialog) {
    const all = dialog.querySelectorAll("*");
    for (const el of all) {
      if (el.scrollHeight > el.clientHeight + 20) {
        const oy = getComputedStyle(el).overflowY;
        if (oy === "auto" || oy === "scroll") return el;
      }
    }
    return null;
  }

  // Resolve once the modal's row list exists (rows load async after open).
  function whenReady(dialog, cb, tries = 0) {
    if (dialog.dataset.bwiInjected) return;
    const hasRows = dialog.querySelector('a[href^="/"] img');
    const container = findScrollContainer(dialog);
    if (hasRows && container) {
      cb(container);
    } else if (tries < 50) {
      setTimeout(() => whenReady(dialog, cb, tries + 1), 120);
    }
  }

  async function computeNonFollowers() {
    if (cache) return cache.nonFollowers;
    const [following, followers] = await Promise.all([
      api.fetchAllFollowing(ownId),
      api.fetchAllFollowers(ownId),
    ]);
    const followerPks = new Set(followers.map((u) => u.pk));
    const nonFollowers = following.filter((u) => !followerPks.has(u.pk));
    cache = { nonFollowers };
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
      // Loading placeholder.
      const loading = document.createElement("div");
      loading.className = "bwi-section";
      loading.setAttribute("data-bwi", "loading");
      loading.textContent = "Better Web Insta — finding who doesn't follow you back…";
      container.parentNode.insertBefore(loading, container);

      let nonFollowers;
      try {
        nonFollowers = await computeNonFollowers();
      } catch (err) {
        loading.textContent =
          "Couldn't load lists (Instagram API error). Try Refresh.";
        console.warn("[BWI] computeNonFollowers failed", err);
        dialog.dataset.bwiInjected = "error";
        return;
      }

      const panel = ui.renderSubsection(nonFollowers, {
        onUnfollowOne: (u, row) => handlers.onUnfollowOne(u, row),
        onUnfollowAll: () => handlers.onUnfollowAll(),
        onStop: () => handlers.onStop(),
        onRefresh: () => handlers.onRefresh(),
      });
      const handlers = wireHandlers(panel, nonFollowers, dialog);

      loading.replaceWith(panel.root);
      dialog.dataset.bwiInjected = "done";
    });
  }

  function maybeInject() {
    if (!isOwnFollowingPath()) return;
    for (const dialog of ui.getDialogs()) {
      if (!dialog.dataset.bwiInjected) inject(dialog);
    }
  }

  const observer = new MutationObserver(() => {
    if (isOwnFollowingPath()) {
      maybeInject();
    } else {
      cache = null; // left the following modal — drop cached lists
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial check in case the modal is already open on load.
  maybeInject();
})();
