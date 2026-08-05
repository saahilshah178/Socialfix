// Socialfix — Instagram private web API helpers.
// Shared by Feature 2 (non-follower subsection + bulk unfollow), Feature 4
// (bulk unsave), and Feature 7 (see-who-unfollowed, read-only). All calls are
// same-origin to www.instagram.com, so cookies ride along automatically with
// credentials:'include' — no login handling needed.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const ORIGIN = "https://www.instagram.com";

  function getCookie(name) {
    const match = document.cookie.match(
      new RegExp("(?:^|;\\s*)" + name + "=([^;]*)")
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  function getOwnUserId() {
    return getCookie("ds_user_id");
  }

  function getCsrf() {
    return getCookie("csrftoken");
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Instagram's WWW-Claim handshake: send "0" initially, then echo back
  // whatever the server returns in X-IG-Set-WWW-Claim on later requests.
  let wwwClaim = "0";

  // Thrown for non-2xx responses so callers can inspect `.status`
  // (e.g. 429 / 400 action-block).
  class IgApiError extends Error {
    constructor(message, status, body) {
      super(message);
      this.name = "IgApiError";
      this.status = status;
      this.body = body;
    }
  }

  async function igFetch(path, opts = {}) {
    const headers = Object.assign(
      {
        // Per-call X-IG-App-ID override (opts.appId); defaults to the web APP_ID.
        "X-IG-App-ID": opts.appId || cfg.APP_ID,
        "X-ASBD-ID": cfg.ASBD_ID,
        "X-CSRFToken": getCsrf() || "",
        "X-Requested-With": "XMLHttpRequest",
        // The real web client sends a WWW-Claim that starts at "0" and is then
        // echoed back from the server's X-IG-Set-WWW-Claim response header.
        // "0" is the safe default and is enough for same-origin credentialed
        // requests; some friendships responses 4xx without it.
        "X-IG-WWW-Claim": wwwClaim,
      },
      opts.headers || {}
    );

    const url = ORIGIN + path;
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers,
      body: opts.body,
      credentials: "include",
    });

    const setClaim = res.headers.get("x-ig-set-www-claim");
    if (setClaim) wwwClaim = setClaim;

    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = text;
    }

    if (!res.ok) {
      throw new IgApiError(
        `Instagram API ${res.status} for ${path}`,
        res.status,
        data
      );
    }
    return data;
  }

  // Normalize a raw user object from the list endpoints.
  function pickUser(u) {
    return {
      pk: String(u.pk),
      username: u.username,
      full_name: u.full_name || "",
      profile_pic_url: u.profile_pic_url || "",
      is_verified: !!u.is_verified,
    };
  }

  // Paginate one of the friendship list endpoints to completion.
  //   onProgress(total)   — optional; called with the running total after each
  //                         page so the UI can show live load feedback.
  //   onPage(pageUsers)   — optional; called with just that page's normalized
  //                         users so the caller can stream results in as they
  //                         arrive instead of waiting for the whole list.
  // GUARANTEE: resolves only with a COMPLETE list (paginated until Instagram
  // stops returning a next_max_id). If the hard page ceiling is hit while more
  // pages remain, it throws rather than returning a silently-truncated list —
  // callers that diff snapshots (Feature 7) rely on this so a partial read can
  // never fabricate false unfollows.
  async function fetchAllList(kind, userId, onProgress, onPage) {
    const out = [];
    let maxId = null;
    // Hard ceiling so a pathological response can't loop forever.
    for (let page = 0; page < 2000; page++) {
      const params = new URLSearchParams({ count: String(cfg.PAGE_COUNT) });
      if (maxId) params.set("max_id", maxId);
      const data = await igFetch(
        `/api/v1/friendships/${userId}/${kind}/?${params.toString()}`
      );
      const pageUsers = (data.users || []).map(pickUser);
      pageUsers.forEach((u) => out.push(u));
      if (onPage) onPage(pageUsers);
      if (onProgress) onProgress(out.length);
      maxId = data.next_max_id ? String(data.next_max_id) : null;
      if (!maxId) return out; // reached a clean end-of-list terminator
      if (cfg.PAGE_DELAY_MS) await sleep(cfg.PAGE_DELAY_MS);
    }
    // Fell out of the loop with more pages pending → incomplete read.
    throw new IgApiError(
      `${kind} list did not reach end of list (pagination ceiling hit)`,
      0,
      null
    );
  }

  const fetchAllFollowing = (userId, onProgress, onPage) =>
    fetchAllList("following", userId, onProgress, onPage);
  const fetchAllFollowers = (userId, onProgress, onPage) =>
    fetchAllList("followers", userId, onProgress, onPage);

  // Resolve and cache the logged-in user's own username (needed to confirm
  // a Following modal belongs to *your* profile).
  // Scrape the logged-in username from the page as a last resort, so a rejected
  // /users/{id}/info/ (which Instagram has started 400'ing for some web
  // sessions) doesn't silently disable Features 2/4/7. CRITICAL: scope this to
  // navigation landmarks only. Instagram's own-profile link ("/<username>/" with
  // a "profile picture" avatar) shares its exact shape with every feed-post
  // header and suggested-user card, so a document-wide scan would happily return
  // a STRANGER'S username. We look only inside <nav>/[role=navigation]/tablist.
  function scrapeOwnUsername() {
    const roots = document.querySelectorAll('nav, [role="navigation"], [role="tablist"]');
    for (const root of roots) {
      const imgs = root.querySelectorAll('img[alt*="profile picture" i]');
      for (const img of imgs) {
        const a = img.closest('a[href^="/"]');
        if (!a) continue;
        const segs = (a.getAttribute("href") || "").split("/").filter(Boolean);
        if (segs.length === 1 && /^[A-Za-z0-9._]+$/.test(segs[0])) return segs[0];
      }
    }
    return null;
  }

  async function getOwnUsername() {
    const ownId = getOwnUserId();
    if (!ownId) return null;
    const cacheKey = "bwi_username_" + ownId;
    try {
      const cached = await chrome.storage.local.get(cacheKey);
      if (cached && cached[cacheKey]) return cached[cacheKey];
    } catch (_) {
      /* storage may be unavailable in odd contexts; fall through */
    }
    let username = null;
    let fromApi = false;
    try {
      const data = await igFetch(`/api/v1/users/${ownId}/info/`);
      username = (data && data.user && data.user.username) || null;
      fromApi = !!username;
    } catch (err) {
      // Don't let a single rejected endpoint silently kill the features — log it
      // and fall back to scraping the page.
      console.warn("[BWI] getOwnUsername: /users/info/ failed", err && err.status, err && err.body);
    }
    if (!username) username = scrapeOwnUsername();
    // Only PERSIST an API-confirmed username. A scraped value is best-effort and
    // could be wrong; caching a wrong value would make it win forever (the
    // cache-first read above), permanently mis-targeting the features. Scraped
    // values are used for this page load only.
    if (username && fromApi) {
      try {
        await chrome.storage.local.set({ [cacheKey]: username });
      } catch (_) {}
    } else if (!username) {
      console.warn("[BWI] getOwnUsername: could not resolve own username (API + DOM both failed)");
    }
    return username || null;
  }

  // Did a friendships write actually apply? Instagram can answer 200 with a
  // failure body (status:"fail"), or 200 with an HTML page (redirected consent/
  // login wall — parsed as a string), or even 200 {status:"ok"} while the
  // friendship_status it echoes back shows the edge STILL in place. The Aug 4
  // audit hit exactly this: the panel marked rows "Unfollowed" while nothing
  // changed server-side. Never trust the HTTP code alone.
  function friendshipApplied(action, data) {
    if (!data || typeof data !== "object" || data.status !== "ok") return false;
    const fs = data.friendship_status;
    if (fs) {
      if (action === "destroy" && fs.following === true) return false;
      if (action === "remove_follower" && fs.followed_by === true) return false;
    }
    return true;
  }

  async function postFriendship(action, pk) {
    if (cfg.DRY_RUN) {
      console.log(`[BWI][DRY_RUN] ${action} ${pk} (not sent)`);
      return { dry_run: true, status: "ok" };
    }
    // Body + header shaped like Instagram's own web client (an empty body is
    // accepted by some server revisions and silently ignored by others).
    const post = (path) =>
      igFetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Instagram-AJAX": "1",
        },
        body: new URLSearchParams({
          user_id: String(pk),
          container_module: "self_unified_follow_lists",
        }).toString(),
      });

    const webAction = action === "destroy" ? "unfollow" : action;
    const webPath = `/api/v1/web/friendships/${pk}/${webAction}/`;

    let primary = null;
    try {
      primary = await post(`/api/v1/friendships/${action}/${pk}/`);
      if (friendshipApplied(action, primary)) return primary;
      // 200 but the write didn't apply — fall through to the /web/ variant.
    } catch (err) {
      // Endpoint-gone (404/405, the /media/unsave/ precedent) → try the /web/
      // variant. Anything else (400/429/…) is an action-block signal or a real
      // failure and must propagate untouched.
      if (!(err instanceof IgApiError) || (err.status !== 404 && err.status !== 405)) {
        throw err;
      }
    }

    // The fallback's errors propagate untouched: swallowing one here would hide
    // a 429 / feedback_required from queue.isActionBlock, and the queue would
    // keep writing to an action-blocked account instead of stopping.
    const fallback = await post(webPath);
    if (friendshipApplied(action, fallback)) return fallback;
    throw new IgApiError(`${action} ${pk} did not apply`, 200, fallback || primary);
  }

  const unfollow = (pk) => postFriendship("destroy", pk);
  const removeFollower = (pk) => postFriendship("remove_follower", pk);

  // Instagram media shortcodes (the /p/<code>/ slug) are the media's numeric pk
  // base64-encoded with this alphabet. Decoding locally avoids an extra network
  // round-trip just to turn a saved-grid tile into the id /unsave/ needs.
  const SHORTCODE_ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

  function shortcodeToMediaId(shortcode) {
    if (!shortcode) return null;
    let id = 0n;
    for (const ch of shortcode) {
      const idx = SHORTCODE_ALPHABET.indexOf(ch);
      if (idx === -1) return null; // unexpected char — bail rather than guess
      id = id * 64n + BigInt(idx);
    }
    return id.toString();
  }

  // Remove a post from Saved entirely (across every collection). Removing from
  // a single collection only is NOT supported: that's a mobile-app-tier action
  // the web endpoint silently ignores or turns into a full unsave (see
  // FEATURE_FEASIBILITY_REPORT.md §2.5), so we don't offer it.
  async function unsave(mediaId) {
    if (cfg.DRY_RUN) {
      console.log(`[BWI][DRY_RUN] unsave ${mediaId} (not sent)`);
      return { dry_run: true, status: "ok" };
    }
    // 2026: Instagram removed the app-tier /api/v1/media/{id}/unsave/ endpoint
    // (now 404) — the surviving web path is /api/v1/web/save/{id}/unsave/, the
    // same one the web client's own bookmark toggle hits. Verified live with a
    // net-zero unsave→save round-trip (both 200 {status:"ok"}).
    return igFetch(`/api/v1/web/save/${mediaId}/unsave/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "",
    });
  }

  BWI.api = {
    getCookie,
    getOwnUserId,
    getCsrf,
    getOwnUsername,
    fetchAllFollowing,
    fetchAllFollowers,
    unfollow,
    removeFollower,
    shortcodeToMediaId,
    unsave,
    sleep,
    IgApiError,
  };
})();
