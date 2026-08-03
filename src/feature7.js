// Better Web Insta — Feature 7 (PRD "See who unfollowed you recently").
// Only fires on YOUR OWN Followers modal. We snapshot your complete follower
// set to chrome.storage.local; on later visits we diff the current set against
// the previous snapshot and inject a read-only "who dropped off" subsection
// (same modal-detection pattern as Feature 2).
//
// Three safety properties, so the list is never misleading:
//   • Storage is capped: exactly one snapshot + one rolling log per account.
//   • We ONLY overwrite the snapshot on a clean, trusted full read — a
//     truncated read (ig-api throws on an incomplete paginate) or an
//     implausibly large drop is ignored, so it can't fabricate false entries.
//   • We re-scan at most once per UNFOLLOWERS_MIN_SNAPSHOT_INTERVAL_MS; within
//     the window we render the cached results without re-paginating.
//
// Labeling is deliberately honest: a drop off your follower list can be a real
// unfollow OR a deactivated / banned / blocked / went-private account, so the
// UI says "no longer follows you", never asserts "unfollowed".
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

  // Neutral elapsed-time label. We deliberately DON'T say "unfollowed" here:
  // a drop off your follower list can be a real unfollow, a deactivated /
  // banned / blocked account, or someone who went private. The panel note
  // carries that caveat; each row just states when we first noticed.
  function relTime(ts) {
    const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    const days = Math.floor(secs / 86400);
    if (days >= 1) return `${days} day${days === 1 ? "" : "s"} ago`;
    const hrs = Math.floor(secs / 3600);
    if (hrs >= 1) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
    const mins = Math.floor(secs / 60);
    if (mins >= 1) return `${mins} min${mins === 1 ? "" : "s"} ago`;
    return "just now";
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
      loadingText.textContent = "Checking who dropped off…";
      loading.appendChild(loadingText);
      ui.insertAboveList(loading, container);

      const prev = await getStored(snapKey());
      let logEntries = (await getStored(logKey())) || [];

      // Fix #1 (min-interval): don't re-paginate the whole follower list on
      // every modal open. If we scanned within the window, render the cached
      // log against the last snapshot instead of re-scanning.
      const freshEnough =
        prev &&
        prev.ts &&
        Date.now() - prev.ts < cfg.UNFOLLOWERS_MIN_SNAPSHOT_INTERVAL_MS;

      // "current followers" used to flag refollows. Defaults to the last
      // snapshot; a trusted fresh scan replaces it below.
      let currentPks = new Set((prev && prev.pks) || []);
      let scanFailed = false;
      let distrusted = false;

      if (!freshEnough) {
        let followers = null;
        try {
          followers = await api.fetchAllFollowers(ownId, (n) => {
            loadingText.textContent = `Scanning your followers… ${n}`;
          });
        } catch (err) {
          // fetchAllFollowers throws on any error INCLUDING an incomplete read
          // (see ig-api fetchAllList) — so a partial list never reaches here.
          console.warn("[BWI] fetchAllFollowers failed", err);
          scanFailed = true;
        }

        if (followers) {
          // Fix #3 (partial-fetch guard): a trusted read is a complete list
          // (guaranteed by ig-api) that didn't lose an implausibly large slice
          // of a non-trivial prior snapshot. A big sudden drop is far more
          // likely a rate-limited/partial read than real mass unfollows.
          const prevCount = (prev && prev.pks && prev.pks.length) || 0;
          const suspiciousDrop =
            prevCount >= 30 &&
            followers.length < prevCount * cfg.UNFOLLOWERS_MIN_TRUST_RATIO;

          if (suspiciousDrop) {
            distrusted = true; // keep currentPks = prev snapshot; don't diff/save
          } else {
            currentPks = new Set(followers.map((u) => u.pk));

            // Diff against the previous snapshot → append newly-gone accounts.
            if (prev && prev.pks) {
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

            // Refresh the snapshot only on a clean, trusted read.
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
        }
      }

      // No baseline AND no usable scan → nothing to show but an error.
      if (!prev && scanFailed) {
        loading.classList.remove("bwi-loading");
        loading.textContent =
          "Couldn't load your followers (Instagram API error). Reopen to retry.";
        dialog.dataset.bwiUnfollowers = "error";
        return;
      }

      const rows = logEntries.map((e) => {
        // Someone back in your current followers has refollowed — keep showing
        // them, tagged, instead of pretending they're still gone.
        const refollowed = currentPks.has(e.pk);
        return {
          pk: e.pk,
          username: e.username,
          full_name: e.full_name,
          profile_pic_url: e.profile_pic_url,
          subtitle: refollowed
            ? `${relTime(e.detectedAt)} · following you again ✓`
            : relTime(e.detectedAt),
          refollowed,
        };
      });
      // Refollowers shouldn't inflate the headline count.
      const activeCount = rows.filter((r) => !r.refollowed).length;

      // Fix #2 (honest labeling): never assert "unfollowed" as fact.
      const title = !prev
        ? "Baseline saved — revisit later to see who drops off"
        : activeCount === 1
        ? "1 account no longer follows you"
        : activeCount
        ? `${activeCount} accounts no longer follow you`
        : "Who dropped off your followers";

      const noteParts = [
        "“No longer following” is inferred from follower-list changes — it also " +
          "includes accounts that deactivated, were banned, blocked you, or went private.",
      ];
      if (scanFailed && prev) {
        noteParts.push("Couldn’t refresh just now — showing your last saved results.");
      } else if (distrusted) {
        noteParts.push(
          "This scan looked incomplete (likely rate-limited), so it was ignored — showing your last saved results."
        );
      } else if (freshEnough) {
        noteParts.push("Recently scanned — reopen later for a fresh check.");
      }

      const panel = ui.renderListSubsection(title, rows, {
        dataKey: "unfollowers",
        emptyText: prev
          ? "No changes detected since your last visit."
          : "Saved your current followers as a baseline.",
        note: noteParts.join(" "),
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
