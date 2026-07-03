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

  // ---- Bio links (Feature 6) ----------------------------------------------
  // The multi-link bio manager (up to 5 links, each with a title) is gated to
  // the mobile app — the web "Links" field is greyed out — but the gate is
  // purely client-side. These are the real endpoints the app uses (confirmed
  // from instagrapi's current mixins/account.py); we call them same-origin from
  // the content script, which bypasses the web UI gate:
  //   POST /api/v1/accounts/update_bio_links/  — add / edit / reorder (full set)
  //   POST /api/v1/accounts/remove_bio_links/  — delete by link_id
  // Bodies use Instagram's signed_body=SIGNATURE.<urlencoded JSON> form encoding.
  // The "SIGNATURE." prefix is a constant — Instagram no longer verifies the
  // signature, so no real HMAC is needed. NOTE: instagrapi emulates the MOBILE
  // client, so the web-specific acceptance of _uuid / link_id / signed_body is
  // verified empirically (run DRY_RUN:true first — the full payload is logged).
  // If a live call is rejected, the obj shape + bioSignedBody here are the one
  // place to adjust.

  // Read the logged-in user's current bio links from the same /users/<id>/info/
  // response getOwnUsername already uses. Returns a normalized, ordered array of
  // { url, title, link_id, link_type } so the editor can pre-fill itself and so
  // edits/removals can reference each link by its id.
  async function getBioLinks() {
    const ownId = getOwnUserId();
    if (!ownId) return [];
    const data = await igFetch(`/api/v1/users/${ownId}/info/`);
    const raw = (data && data.user && data.user.bio_links) || [];
    return raw.map((l) => ({
      url: l.url || l.lynx_url || "",
      title: l.title || "",
      link_id: l.link_id != null ? String(l.link_id) : null,
      link_type: l.link_type || "external",
    }));
  }

  // Encode an object as Instagram's signed form body. URLSearchParams handles
  // the URL-encoding of the JSON value correctly.
  function bioSignedBody(obj) {
    return new URLSearchParams({
      signed_body: "SIGNATURE." + JSON.stringify(obj),
    }).toString();
  }

  // update_bio_links / remove_bio_links expect a device _uuid. The web client
  // has no native one, so we mint a stable UUID and persist it (same caching
  // pattern as getOwnUsername's username cache).
  async function getDeviceUuid() {
    const key = "bwi_device_uuid";
    try {
      const cached = await chrome.storage.local.get(key);
      if (cached && cached[key]) return cached[key];
    } catch (_) {
      /* storage may be unavailable in odd contexts; fall through */
    }
    const uuid =
      (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
      String(Date.now()) + "-" + Math.random().toString(16).slice(2);
    try {
      await chrome.storage.local.set({ [key]: uuid });
    } catch (_) {}
    return uuid;
  }

  // Add / edit / reorder: send the full ordered list. Array order = display
  // order; existing links carry their link_id so they're edited in place rather
  // than recreated. `updated_links` is a JSON string nested inside the outer
  // JSON object (double-encoded), per Instagram's wire format.
  async function updateBioLinks(links) {
    const mapped = (links || [])
      .map((l) => {
        const o = {
          url: (l.url || "").trim(),
          title: (l.title || "").trim(),
          link_type: l.link_type || "external",
        };
        if (l.link_id) o.link_id = String(l.link_id);
        return o;
      })
      .filter((l) => l.url);
    const obj = {
      updated_links: JSON.stringify(mapped),
      _uid: getOwnUserId(),
      _uuid: await getDeviceUuid(),
      _csrftoken: getCsrf(),
    };
    if (cfg.DRY_RUN) {
      console.log("[BWI][DRY_RUN] update_bio_links (not sent)", obj);
      return { dry_run: true, status: "ok" };
    }
    return igFetch("/api/v1/accounts/update_bio_links/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: bioSignedBody(obj),
    });
  }

  // Delete bio links by id.
  async function removeBioLinks(linkIds) {
    if (!linkIds || !linkIds.length) return { skipped: true };
    const obj = {
      _uid: getOwnUserId(),
      _uuid: await getDeviceUuid(),
      _csrftoken: getCsrf(),
      link_ids: linkIds.map(String),
    };
    if (cfg.DRY_RUN) {
      console.log("[BWI][DRY_RUN] remove_bio_links (not sent)", obj);
      return { dry_run: true, status: "ok" };
    }
    return igFetch("/api/v1/accounts/remove_bio_links/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: bioSignedBody(obj),
    });
  }

  // Save the editor's state: first delete any links the user removed (by id),
  // then push the full ordered list. Both writes are DRY_RUN-guarded inside
  // their helpers; IgApiError propagates so the UI can show the status code.
  async function setBioLinks(links, removedIds) {
    if (removedIds && removedIds.length) await removeBioLinks(removedIds);
    return updateBioLinks(links);
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
    updateBioLinks,
    removeBioLinks,
    setBioLinks,
    shortcodeToMediaId,
    unsave,
    sleep,
    IgApiError,
  };
})();
