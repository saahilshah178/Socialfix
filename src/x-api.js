// Socialfix — X (Twitter) private web API helper (follow-back check).
// Used by the bulk-unfollow feature (x-unfollow.js) for ONE thing: checking
// which of your following follow you back, via friendships/lookup.json. That
// v1.1 endpoint is same-origin to x.com's internal API (/i/api/1.1/...), so the
// session cookies ride along with credentials:'include' — no login/auth code.
// X's web client authenticates it with a static public Bearer token (present in
// every page load) plus the ct0 cookie echoed as x-csrf-token.
//
// NOTE (2026): X removed the v1.1 friends-list endpoints (friends/list.json and
// friends/ids.json now 404), so the following LIST and the unfollow ACTION are
// done purely in the DOM (x-unfollow.js), matching the x-unlike
// philosophy. friendships/lookup.json is the one v1.1 read that survives, so we
// keep it here for the cheap batched follow-back check. The churn-prone bits
// (Bearer token, API host) live in cfg.X.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;

  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }

  // ct0 is X's CSRF token cookie; echoed back as the x-csrf-token header.
  const getCsrf = () => getCookie("ct0");

  // twid cookie is "u=<numeric id>" (URL-encoded) — the logged-in user's id,
  // available without any network call.
  function getOwnUserId() {
    const raw = getCookie("twid"); // e.g. "u=1234567890"
    if (!raw) return null;
    const m = raw.match(/u=?(\d+)/);
    return m ? m[1] : null;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  class XApiError extends Error {
    constructor(message, status, body) {
      super(message);
      this.name = "XApiError";
      this.status = status;
      this.body = body;
    }
  }

  // Same-origin call to the v1.1 REST API. `path` is appended to cfg.X.API_HOST
  // (e.g. "/1.1/friendships/lookup.json"). GET params via opts.params.
  async function xFetch(path, opts = {}) {
    const csrf = getCsrf();
    if (!csrf) throw new XApiError("no ct0 cookie (not logged in?)", 0, null);

    let url = cfg.X.API_HOST + path;
    if (opts.params) {
      const qs = new URLSearchParams(opts.params).toString();
      url += (url.includes("?") ? "&" : "?") + qs;
    }

    const headers = {
      authorization: "Bearer " + cfg.X.BEARER,
      "x-csrf-token": csrf,
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
      "x-twitter-client-language": "en",
    };

    const res = await fetch(url, { method: "GET", headers, credentials: "include" });
    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = text;
    }
    if (!res.ok) {
      throw new XApiError(`X API ${res.status} for ${path}`, res.status, data);
    }
    return data;
  }

  // Given a following list (array of {pk, ...}), flag who doesn't follow back
  // using batched friendships/lookup.json (100 ids/call → "followed_by" in the
  // connections array means they follow you). Returns the non-follower subset
  // (same objects as the input, so DOM-scanned display fields are preserved).
  async function computeNonFollowers(following, onProgress) {
    const nonFollowers = [];
    for (let i = 0; i < following.length; i += 100) {
      const batch = following.slice(i, i + 100);
      const data = await xFetch("/1.1/friendships/lookup.json", {
        params: { user_id: batch.map((u) => u.pk).join(",") },
      });
      const connsById = new Map();
      (Array.isArray(data) ? data : []).forEach((r) => {
        connsById.set(String(r.id_str || r.id), r.connections || []);
      });
      batch.forEach((u) => {
        // Never surface someone we can't confirm; only list a clean "not
        // followed_by". Anyone missing from the lookup response (suspended /
        // deactivated) is skipped, and pending follow-requests to protected
        // accounts ("following_requested") are left alone.
        const conns = connsById.get(u.pk);
        if (!conns) return;
        if (conns.includes("followed_by")) return;
        if (conns.includes("following_requested")) return;
        nonFollowers.push(u);
      });
      if (onProgress) onProgress(Math.min(i + 100, following.length), following.length);
      await sleep(800);
    }
    return nonFollowers;
  }

  BWI.xApi = {
    getCookie,
    getCsrf,
    getOwnUserId,
    computeNonFollowers,
    sleep,
    XApiError,
  };
})();
