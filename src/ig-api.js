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

  // Paginate one of the friendship list endpoints to completion. `onProgress`
  // (optional) is called with the running total after each page so the UI can
  // show live load feedback.
  async function fetchAllList(kind, userId, onProgress) {
    const out = [];
    let maxId = null;
    // Hard ceiling so a pathological response can't loop forever.
    for (let page = 0; page < 2000; page++) {
      const params = new URLSearchParams({ count: String(cfg.PAGE_COUNT) });
      if (maxId) params.set("max_id", maxId);
      const data = await igFetch(
        `/api/v1/friendships/${userId}/${kind}/?${params.toString()}`
      );
      (data.users || []).forEach((u) => out.push(pickUser(u)));
      if (onProgress) onProgress(out.length);
      maxId = data.next_max_id ? String(data.next_max_id) : null;
      if (!maxId) break;
      if (cfg.PAGE_DELAY_MS) await sleep(cfg.PAGE_DELAY_MS);
    }
    return out;
  }

  const fetchAllFollowing = (userId, onProgress) =>
    fetchAllList("following", userId, onProgress);
  const fetchAllFollowers = (userId, onProgress) =>
    fetchAllList("followers", userId, onProgress);

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

  // ---- Bio links (Feature 6) ----------------------------------------------
  // Read the logged-in user's current bio links from the same /users/<id>/info/
  // response getOwnUsername already uses. Returns a normalized, ordered array of
  // { url, title, link_id } so the editor can pre-fill itself.
  async function getBioLinks() {
    const ownId = getOwnUserId();
    if (!ownId) return [];
    const data = await igFetch(`/api/v1/users/${ownId}/info/`);
    const raw = (data && data.user && data.user.bio_links) || [];
    return raw.map((l) => ({
      url: l.url || l.lynx_url || "",
      title: l.title || "",
      link_id: l.link_id != null ? String(l.link_id) : null,
    }));
  }

  // The multi-link bio manager is a mobile-only feature — the web client never
  // issues this request, so the path + body encoding below are the best-known
  // shape and should be CONFIRMED against a real captured request before relying
  // on them. Run with DRY_RUN:true first (the full payload is logged); if
  // Instagram rejects the live call, THIS is the one place to adjust the path
  // and how the link list is encoded.
  const EDIT_BIO_LINKS_PATH = "/api/v1/accounts/edit_bio_links/";

  function bioLinksBody(links) {
    // Send the full ordered list; Instagram replaces the existing set with it.
    const payload = (links || [])
      .map((l) => ({ url: (l.url || "").trim(), title: (l.title || "").trim() }))
      .filter((l) => l.url);
    return new URLSearchParams({ bio_links: JSON.stringify(payload) }).toString();
  }

  // Replace the account's bio links with `links` (array of { url, title }).
  // Mirrors the postFriendship/unsave write pattern: DRY_RUN guard, then a
  // same-origin credentialed POST through igFetch. Unlike those, the body is
  // non-empty. Lets IgApiError propagate so the UI can surface 400/429.
  async function setBioLinks(links) {
    const body = bioLinksBody(links);
    if (cfg.DRY_RUN) {
      console.log(
        `[BWI][DRY_RUN] setBioLinks -> POST ${EDIT_BIO_LINKS_PATH}`,
        body
      );
      return { dry_run: true, status: "ok" };
    }
    return igFetch(EDIT_BIO_LINKS_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  }

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

  // Fully remove a post from Saved (across all collections).
  async function unsave(mediaId) {
    if (cfg.DRY_RUN) {
      console.log(`[BWI][DRY_RUN] unsave ${mediaId} (not sent)`);
      return { dry_run: true, status: "ok" };
    }
    return igFetch(`/api/v1/media/${mediaId}/unsave/`, {
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
    getBioLinks,
    setBioLinks,
    shortcodeToMediaId,
    unsave,
    sleep,
    IgApiError,
  };
})();
