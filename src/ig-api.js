// Better Web Insta — Instagram private web API helpers.
// Only Feature 2 (the non-follower subsection + bulk unfollow) uses these.
// All calls are same-origin to www.instagram.com, so cookies ride along
// automatically with credentials:'include' — no login handling needed.
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
        "X-IG-App-ID": cfg.APP_ID,
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

    const res = await fetch(ORIGIN + path, {
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
      if (!maxId) break;
      if (cfg.PAGE_DELAY_MS) await sleep(cfg.PAGE_DELAY_MS);
    }
    return out;
  }

  const fetchAllFollowing = (userId, onProgress, onPage) =>
    fetchAllList("following", userId, onProgress, onPage);
  const fetchAllFollowers = (userId, onProgress, onPage) =>
    fetchAllList("followers", userId, onProgress, onPage);

  // Resolve and cache the logged-in user's own username (needed to confirm
  // a Following modal belongs to *your* profile).
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
    const data = await igFetch(`/api/v1/users/${ownId}/info/`);
    const username = data && data.user && data.user.username;
    if (username) {
      try {
        await chrome.storage.local.set({ [cacheKey]: username });
      } catch (_) {}
    }
    return username || null;
  }

  async function postFriendship(action, pk) {
    if (cfg.DRY_RUN) {
      console.log(`[BWI][DRY_RUN] ${action} ${pk} (not sent)`);
      return { dry_run: true, status: "ok" };
    }
    return igFetch(`/api/v1/friendships/${action}/${pk}/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "",
    });
  }

  const unfollow = (pk) => postFriendship("destroy", pk);
  const removeFollower = (pk) => postFriendship("remove_follower", pk);

  BWI.api = {
    getCookie,
    getOwnUserId,
    getCsrf,
    getOwnUsername,
    fetchAllFollowing,
    fetchAllFollowers,
    unfollow,
    removeFollower,
    sleep,
    IgApiError,
  };
})();
