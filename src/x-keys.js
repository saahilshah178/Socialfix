// Socialfix — X: keyboard shortcut gap-fills.
// (FEATURE_FEASIBILITY_REPORT.md §3.4.)
//
// X ships single-key shortcuts (l like, r reply, t retweet, …) but they act on
// the *keyboard-focused* tweet, which is awkward with a mouse. These act on the
// tweet the MOUSE IS OVER — a real ergonomic gap — by clicking X's own inline
// buttons (so X fires its own signed requests; we never call the API). Bindings
// avoid X's native map and require Shift for anything that leaves the page.
//
//   E         → like / unlike hovered tweet
//   Shift+R   → reply to hovered tweet
//   Shift+D   → open full-res photo(s) of hovered tweet in new tab(s)
//   Shift+C   → copy hovered tweet's link
//
// Video download is intentionally out of scope (HLS/MSE behind blob: URLs).
// No queue — single user-initiated clicks, no ban risk. No-op while typing.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const ui = BWI.ui;
  const X = cfg.X;
  const K = X.KEYS;

  if (!X.SHORTCUTS) return;

  // Track the tweet under the pointer.
  let hovered = null;
  document.addEventListener(
    "mousemove",
    (e) => {
      const art = e.target.closest && e.target.closest('article[data-testid="tweet"]');
      if (art) hovered = art;
    },
    { passive: true, capture: true }
  );

  function isTyping(el) {
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return true;
    return !!(el.isContentEditable || (el.closest && el.closest('[contenteditable="true"]')));
  }

  // The tweet to act on: the hovered one if still connected, else the primary
  // tweet on a status-detail page.
  function targetTweet() {
    if (hovered && hovered.isConnected) return hovered;
    if (/\/status\/\d+/.test(location.pathname)) {
      return document.querySelector('article[data-testid="tweet"]');
    }
    return null;
  }

  function clickTestId(article, ids) {
    for (const id of ids) {
      const btn = article.querySelector(`[data-testid="${id}"]`);
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  function tweetUrl(article) {
    const a = article.querySelector('a[href*="/status/"]');
    if (!a) return null;
    const href = a.getAttribute("href") || "";
    return href.startsWith("http") ? href : "https://x.com" + href;
  }

  // ---- actions --------------------------------------------------------------

  function doLike(article) {
    // "unlike" testid present == already liked → clicking it unlikes.
    if (clickTestId(article, ["unlike", "like"])) return;
    ui.toast("Like button not found");
  }

  function doReply(article) {
    if (!clickTestId(article, ["reply"])) ui.toast("Reply button not found");
  }

  function doDownloadPhoto(article) {
    const imgs = article.querySelectorAll('img[src*="pbs.twimg.com/media"]');
    if (!imgs.length) {
      ui.toast("No photo on this tweet");
      return;
    }
    const seen = new Set();
    let opened = 0;
    imgs.forEach((img) => {
      // Rebuild the URL at full resolution: ...?format=jpg&name=orig
      try {
        const u = new URL(img.src);
        u.searchParams.set("name", "orig");
        const key = u.pathname + u.searchParams.get("format");
        if (seen.has(key)) return;
        seen.add(key);
        window.open(u.toString(), "_blank", "noopener");
        opened++;
      } catch (_) {}
    });
    ui.toast(opened ? `Opened ${opened} image${opened === 1 ? "" : "s"} (right-click → Save)` : "No photo on this tweet");
  }

  function doCopyLink(article) {
    const url = tweetUrl(article);
    if (!url) {
      ui.toast("Couldn't find tweet link");
      return;
    }
    const done = () => ui.toast("Link copied ✓");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => ui.toast(url));
    } else {
      ui.toast(url);
    }
  }

  const ACTIONS = {
    like: doLike,
    reply: doReply,
    downloadPhoto: doDownloadPhoto,
    copyLink: doCopyLink,
  };

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (isTyping(e.target)) return;

      const key = (e.key || "").toLowerCase();
      for (const name of Object.keys(ACTIONS)) {
        const b = K[name];
        if (!b || key !== b.key || e.shiftKey !== !!b.shift) continue;
        const article = targetTweet();
        if (!article) {
          ui.toast("Hover a tweet first");
        } else {
          e.preventDefault();
          e.stopPropagation();
          ACTIONS[name](article);
        }
        return;
      }
    },
    true
  );
})();
