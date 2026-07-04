// Better Web Insta — X (Twitter) private web API helpers.
// Used by the bulk-unfollow feature (x-unfollow.js). All calls are same-origin
// to x.com's internal v1.1 REST API (/i/api/1.1/...), so the session cookies
// ride along with credentials:'include' — no login/auth code. X's web client
// authenticates these with a static public Bearer token (in every page load)
// plus the ct0 cookie echoed as x-csrf-token; that's all reproduced here.
//
// The churn-prone bits (Bearer token, API host) live in cfg.X. v1.1 does NOT
// validate x-client-transaction-id, so — unlike GraphQL — we don't need to
// reproduce it. Bulk UNLIKE deliberately uses no API (x-unlike.js clicks the
// native heart), so there are no GraphQL query-ids to maintain here.
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
  // (e.g. "/1.1/friends/list.json"). GET params via opts.params; POST form body
  // via opts.form.
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
    const init = { method: opts.method || "GET", headers, credentials: "include" };
    if (opts.form) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      init.body = new URLSearchParams(opts.form).toString();
    }

    const res = await fetch(url, init);
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

  function pickUser(u) {
    return {
      pk: String(u.id_str || u.id),
      username: u.screen_name || "",
      full_name: u.name || "",
      // profile_image_url_https is the tiny "_normal" variant; bump to a bigger
      // one for a crisp avatar.
      profile_pic_url: (u.profile_image_url_https || "").replace("_normal", "_bigger"),
    };
  }

  // Paginate the authenticating user's full following list (friends/list.json).
  // GUARANTEE (mirrors ig-api): returns a COMPLETE list or throws — a partial
  // read never silently yields a truncated diff.
  async function fetchAllFollowing(onProgress) {
    const out = [];
    let cursor = "-1";
    for (let page = 0; page < 400; page++) {
      const data = await xFetch("/1.1/friends/list.json", {
        params: { count: "200", cursor, skip_status: "true", include_user_entities: "false" },
      });
      (data.users || []).forEach((u) => out.push(pickUser(u)));
      if (onProgress) onProgress(out.length);
      cursor = data.next_cursor_str != null ? String(data.next_cursor_str) : "0";
      if (cursor === "0" || cursor === "") return out; // clean end
      await sleep(1200); // friends/list is ~15 req/15min — pace the reads
    }
    throw new XApiError("following list did not reach end (cursor ceiling hit)", 0, null);
  }

  // Given the full following list, flag who doesn't follow back using batched
  // friendships/lookup.json (100 ids/call → "followed_by" in connections means
  // they follow you). Avoids paging the entire follower list. Returns the
  // non-follower subset of `following` (same user shape).
  async function computeNonFollowers(following, onProgress) {
    const nonFollowers = [];
    for (let i = 0; i < following.length; i += 100) {
      const batch = following.slice(i, i + 100);
      const data = await xFetch("/1.1/friendships/lookup.json", {
        params: { user_id: batch.map((u) => u.pk).join(",") },
      });
      const followsBack = new Set();
      (Array.isArray(data) ? data : []).forEach((r) => {
        const conns = r.connections || [];
        if (conns.includes("followed_by")) followsBack.add(String(r.id_str || r.id));
      });
      batch.forEach((u) => {
        // Never surface someone we can't confirm; only list a clean "not
        // followed_by". (Pending follow-requests to protected accounts show
        // "following_requested" and are left alone.)
        if (!followsBack.has(u.pk)) nonFollowers.push(u);
      });
      if (onProgress) onProgress(Math.min(i + 100, following.length), following.length);
      await sleep(800);
    }
    return nonFollowers;
  }

  // Unfollow one account (friendships/destroy.json). Honors DRY_RUN.
  async function destroyFollow(userId) {
    if (cfg.DRY_RUN) {
      console.log(`[BWI][DRY_RUN] X unfollow ${userId} (not sent)`);
      return { dry_run: true };
    }
    return xFetch("/1.1/friendships/destroy.json", {
      method: "POST",
      form: { user_id: String(userId) },
    });
  }

  BWI.xApi = {
    getCookie,
    getCsrf,
    getOwnUserId,
    fetchAllFollowing,
    computeNonFollowers,
    destroyFollow,
    sleep,
    XApiError,
  };
})();
