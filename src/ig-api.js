// Better Web Insta — Instagram private web API helpers.
// Shared by Feature 2 (non-follower subsection + bulk unfollow), Feature 4
// (bulk unsave), Feature 7 (see-who-unfollowed, read-only), and Feature 9
// (story composer upload/configure). All calls are same-origin to
// www.instagram.com, so cookies ride along automatically with
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

    // opts.absolute lets callers pass a full URL (e.g. the rupload_igphoto
    // upload host) instead of a path appended to the www origin.
    const url = opts.absolute ? path : ORIGIN + path;
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
    return igFetch(`/api/v1/media/${mediaId}/unsave/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "",
    });
  }

  // ---- Story upload core (Feature 9 composer) -----------------------------
  // Two-step: rupload_igphoto (binary) then configure. The WEB story-create
  // flow posts a PLAIN urlencoded body to /create/configure_to_story/ — the
  // same path the mobile-web PWA's own "Add to story" uses, reproducible from a
  // cookie-authed content script.

  // rupload_igphoto — upload JPEG bytes; returns the upload_id string.
  async function ruploadPhoto(bytes, dims) {
    const uploadId = String(Date.now());
    const name = "fb_uploader_" + uploadId;
    const params = {
      media_type: 1,
      upload_id: uploadId,
      upload_media_height: (dims && dims.height) || cfg.STORY.CANVAS_H,
      upload_media_width: (dims && dims.width) || cfg.STORY.CANVAS_W,
    };
    const len = bytes.byteLength != null ? bytes.byteLength : bytes.size;
    if (cfg.DRY_RUN) {
      console.log(
        "[BWI][DRY_RUN] rupload_igphoto (not sent)",
        name,
        params,
        "bytes:",
        len
      );
      return uploadId;
    }
    await igFetch(cfg.STORY.RUPLOAD_HOST + "/rupload_igphoto/" + name, {
      absolute: true,
      method: "POST",
      headers: {
        "X-Entity-Name": name,
        "X-Entity-Length": String(len),
        Offset: "0",
        "X-Instagram-Rupload-Params": JSON.stringify(params),
        "X-Entity-Type": "image/jpeg",
        "Content-Type": "application/octet-stream",
      },
      body: bytes,
    });
    return uploadId;
  }

  // Configure an uploaded photo as a story — WEB plain-form path. The composer
  // burns all its content (text + freehand drawing) into the JPEG before
  // upload, so the body is just upload_id + empties.
  async function configureToStory({ uploadId, caption = "" } = {}) {
    const form = {
      upload_id: uploadId,
      caption: caption || "",
      usertags: "",
      custom_accessibility_caption: "",
      retry_timeout: "",
    };
    if (cfg.DRY_RUN) {
      console.log("[BWI][DRY_RUN] configure_to_story (not sent)", form);
      return { dry_run: true, status: "ok" };
    }
    return igFetch(cfg.STORY.CONFIGURE_PATH_WEB, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
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
    ruploadPhoto,
    configureToStory,
    sleep,
    IgApiError,
  };
})();
