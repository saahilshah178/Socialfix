// Better Web Insta — Feature 7 (PRD "See who unfollowed you recently").
// Only fires on YOUR OWN Followers modal. Each visit we snapshot your complete
// follower set to chrome.storage.local; on later visits we diff the current set
// against the previous snapshot and inject a "recently unfollowed you"
// subsection (same modal-detection pattern as Feature 2, read-only UI).
//
// Storage is capped: exactly one snapshot + one rolling log per account. We
// ONLY overwrite the snapshot on a clean full read, so a truncated/errored
// fetch can never fabricate false "unfollowed" entries.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const api = BWI.api;
  const ui = BWI.ui;

  if (!cfg.SEE_UNFOLLOWERS) return;

  let ownUsername = null;
  let ownId = null;

  api
    .getOwnUsername()
    .then((u) => {
      ownUsername = u;
      maybeInject();
    })
    .catch(() => {});
  ownId = api.getOwnUserId();

  // ---- modal detection (mirrors feature2, but for the Followers list) ------

  function firstPathSegment() {
    return location.pathname.toLowerCase().split("/").filter(Boolean)[0] || null;
  }
  function isOnOwnProfile() {
    return !!ownUsername && firstPathSegment() === ownUsername.toLowerCase();
  }
  function urlSaysFollowers() {
    if (!ownUsername) return false;
    const segs = location.pathname.toLowerCase().split("/").filter(Boolean);
    return segs[0] === ownUsername.toLowerCase() && segs[1] === "followers";
  }
  function findOwnFollowersDialog() {
    if (!isOnOwnProfile()) return null;
    const urlFollowers = urlSaysFollowers();
    for (const d of ui.getDialogs()) {
      if (ui.dialogTitleIs(d, cfg.LABELS.following)) continue; // not the following list
      if (urlFollowers || ui.dialogTitleIs(d, cfg.LABELS.followers)) return d;
    }
    return null;
  }
  function whenReady(dialog, cb, tries = 0) {
    if (!dialog.isConnected) return;
    if (dialog.querySelector('[data-bwi="unfollowers"]')) return;
    const hasRows = dialog.querySelector('a[href^="/"] img');
    const container = ui.findScrollContainer(dialog);
    if (hasRows && container) cb(container);
    else if (tries < 50) setTimeout(() => whenReady(dialog, cb, tries + 1), 120);
  }

  // ---- storage -------------------------------------------------------------

  const snapKey = () => cfg.UNFOLLOWERS_SNAPSHOT_KEY + ownId;
  const logKey = () => cfg.UNFOLLOWERS_LOG_KEY + ownId;

  async function getStored(key) {
    try {
      const r = await chrome.storage.local.get(key);
      return (r && r[key]) || null;
    } catch (_) {
      return null;
    }
  }
  async function setStored(key, val) {
    try {
      await chrome.storage.local.set({ [key]: val });
    } catch (_) {}
  }

  function relTime(ts) {
    const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    const days = Math.floor(secs / 86400);
    if (days >= 1) return `unfollowed ${days} day${days === 1 ? "" : "s"} ago`;
    const hrs = Math.floor(secs / 3600);
    if (hrs >= 1) return `unfollowed ${hrs} hour${hrs === 1 ? "" : "s"} ago`;
    const mins = Math.floor(secs / 60);
    if (mins >= 1) return `unfollowed ${mins} min${mins === 1 ? "" : "s"} ago`;
    return "unfollowed just now";
  }

  // ---- inject --------------------------------------------------------------

  function inject(dialog) {
    if (dialog.dataset.bwiUnfollowers) return;
    dialog.dataset.bwiUnfollowers = "loading";

    whenReady(dialog, async (container) => {
      const loading = document.createElement("div");
      loading.className = "bwi-section bwi-loading";
      loading.setAttribute("data-bwi", "unfollowers");
      const loadingText = document.createElement("span");
      loadingText.textContent = "Checking who unfollowed you…";
      loading.appendChild(loadingText);
      container.parentNode.insertBefore(loading, container);

      let followers;
      try {
        followers = await api.fetchAllFollowers(ownId, (n) => {
          loadingText.textContent = `Scanning your followers… ${n}`;
        });
      } catch (err) {
        loading.classList.remove("bwi-loading");
        loading.textContent = "Couldn't load followers (Instagram API error).";
        console.warn("[BWI] fetchAllFollowers failed", err);
        dialog.dataset.bwiUnfollowers = "error";
        return;
      }

      const prev = await getStored(snapKey());
      const currentPks = new Set(followers.map((u) => u.pk));

      // If a previously-populated snapshot suddenly reads as empty, treat the
      // fetch as untrustworthy: don't diff and don't overwrite the snapshot.
      const looksTruncated =
        prev && prev.pks && prev.pks.length > 20 && followers.length === 0;

      let logEntries = (await getStored(logKey())) || [];

      if (prev && prev.pks && !looksTruncated) {
        const gone = prev.pks.filter((pk) => !currentPks.has(pk));
        if (gone.length) {
          const now = Date.now();
          const seen = new Set(logEntries.map((e) => e.pk));
          gone.forEach((pk) => {
            if (seen.has(pk)) return; // keep earliest detection time
            const info = (prev.users && prev.users[pk]) || {};
            logEntries.unshift({
              pk,
              username: info.username || pk,
              full_name: info.full_name || "",
              profile_pic_url: info.profile_pic_url || "",
              detectedAt: now,
            });
          });
          logEntries = logEntries.slice(0, cfg.UNFOLLOWERS_MAX_LOG);
          await setStored(logKey(), logEntries);
        }
      }

      // Refresh the snapshot only on a clean read.
      if (!looksTruncated) {
        const users = {};
        followers.forEach((u) => {
          users[u.pk] = {
            username: u.username,
            full_name: u.full_name,
            profile_pic_url: u.profile_pic_url,
          };
        });
        await setStored(snapKey(), {
          ts: Date.now(),
          pks: followers.map((u) => u.pk),
          users,
        });
      }

      const rows = logEntries.map((e) => {
        // Someone in the log who is back in your current followers has
        // refollowed — keep showing them, but tag it (per your preference)
        // instead of pretending they're still gone.
        const refollowed = currentPks.has(e.pk);
        return {
          pk: e.pk,
          username: e.username,
          full_name: e.full_name,
          profile_pic_url: e.profile_pic_url,
          subtitle: refollowed
            ? `${relTime(e.detectedAt)} · refollowed you ✓`
            : relTime(e.detectedAt),
          refollowed,
        };
      });
      // Refollowers shouldn't inflate the "recently unfollowed" headline count.
      const activeCount = rows.filter((r) => !r.refollowed).length;

      const title = !prev
        ? "Baseline saved — revisit later to see who unfollowed you"
        : activeCount
        ? `${activeCount} recently unfollowed you`
        : "Recently unfollowed you";

      const panel = ui.renderListSubsection(title, rows, {
        dataKey: "unfollowers",
        emptyText: prev
          ? "No unfollows detected since your last visit."
          : "Saved your current followers as a baseline.",
      });

      loading.replaceWith(panel.root);
      dialog.dataset.bwiUnfollowers = "done";
    });
  }

  function maybeInject() {
    if (!ownUsername || !ownId) return;
    const dialogs = ui.getDialogs();
    if (dialogs.length === 0) return;
    if (dialogs.some((d) => d.dataset.bwiUnfollowers)) return;
    const dialog = findOwnFollowersDialog();
    if (dialog) inject(dialog);
  }

  const observer = new MutationObserver(() => maybeInject());
  observer.observe(document.body, { childList: true, subtree: true });

  maybeInject();
})();
