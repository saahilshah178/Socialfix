// Popup: a features-at-a-glance cheat sheet (with the live keybinds from
// src/config.js), today's Instagram unfollow count, and a Stop button for a
// running bulk job.
//
// This page runs in the extension context, NOT in a content script, so it
// cannot see the in-page BWI runtime (queue/api/ui). It does load src/config.js
// though — the same IIFE the content scripts use — so caps and key bindings
// come from one source of truth instead of being duplicated here.
//
// Everything chrome.* is guarded: the cheat sheet must still render when the
// APIs are unavailable (e.g. the file opened outside the extension, or a test
// harness with a stub), so we render synchronously first and refresh async.
(function () {
  "use strict";

  const ext = typeof chrome !== "undefined" ? chrome : null;
  const cfg = (window.BWI && window.BWI.config) || {};
  const YT = cfg.YT || {};
  const X = cfg.X || {};
  const REDDIT = cfg.REDDIT || {};

  const DAILY_CAP = Number(cfg.DAILY_CAP) || 150; // fallback mirrors config.js
  const TAB_STORE_KEY = "bwi_popup_tab";

  const $ = (id) => document.getElementById(id);

  // ---- key formatting -------------------------------------------------------
  // Config bindings are either { key: "e", shift: true } (YT / X) or a bare
  // string ("h" — Instagram story nav). Rendered as "Shift+E" / "H".
  function fmtKey(binding, fallback) {
    const fb =
      typeof fallback === "string" ? { key: fallback, shift: false } : fallback;
    let key = fb.key;
    let shift = !!fb.shift;
    if (binding && typeof binding === "object") {
      if (typeof binding.key === "string" && binding.key) key = binding.key;
      shift = !!binding.shift;
    } else if (typeof binding === "string" && binding) {
      key = binding;
      shift = false;
    }
    const label = key.length === 1 ? key.toUpperCase() : key;
    return (shift ? "Shift+" : "") + label;
  }

  // A feature toggle that is missing from config counts as ON (e.g. a knob
  // added to a newer config.js than the one loaded here).
  function on(v) {
    return v !== false;
  }

  // ---- cheat-sheet data -----------------------------------------------------
  // `how` is a list of parts: plain strings become text, { kbd } becomes a key
  // chip. All keys are pulled from config so the sheet can't drift from the
  // real bindings.
  const kbd = (text) => ({ kbd: text });

  const storyKeys = cfg.STORY_NAV_KEYS || {};
  const ytKeys = YT.KEYS || {};
  const xKeys = X.KEYS || {};

  const SITES = [
    {
      id: "instagram",
      label: "Instagram",
      features: [
        {
          name: "Instant unfollow / remove",
          enabled: true,
          how: [
            kbd("Shift"),
            "+click a Following or Remove button in any list — skips the confirm",
          ],
        },
        {
          name: "Doesn't follow you back",
          enabled: true,
          how: [
            "Your own Following list → panel at the top; Unfollow per row or Unfollow all (throttled)",
          ],
        },
        {
          name: "Who dropped off",
          enabled: on(cfg.SEE_UNFOLLOWERS),
          how: [
            "Your own Followers list → panel of accounts that no longer follow you",
          ],
        },
        {
          name: "Bulk unsave",
          enabled: true,
          how: [
            "Saved → All posts (or a collection) → Select → tap posts → Unsave (n)",
          ],
        },
        {
          name: "Story navigation",
          enabled: on(cfg.STORY_NAV),
          how: [
            kbd(fmtKey(storyKeys.prev, "h")),
            " previous user · ",
            kbd(fmtKey(storyKeys.next, "l")),
            " next user while viewing a story",
          ],
        },
        {
          name: "Wider Followers / Following window",
          // Ships off (BIGGER_MODALS: false in src/config.js) — widen-only,
          // opt-in; the injected panels already fit the native modal.
          enabled: cfg.BIGGER_MODALS === true,
          how: [
            "Opt-in: set BIGGER_MODALS to true in src/config.js to widen the list window",
          ],
        },
      ],
    },
    {
      id: "youtube",
      label: "YouTube",
      features: [
        {
          name: "Bulk remove",
          enabled: on(YT.BULK_PLAYLIST),
          how: [
            "Watch Later or Liked videos playlist → Select → tap rows → Remove (n) · deliberately 5–8 s apart",
          ],
        },
        {
          name: "Watch-page shortcuts",
          enabled: on(YT.SHORTCUTS),
          how: [
            kbd(fmtKey(ytKeys.like, { key: "e" })),
            " like · ",
            kbd(fmtKey(ytKeys.save, { key: "e", shift: true })),
            " save to playlist · ",
            kbd(fmtKey(ytKeys.subscribe, { key: "u", shift: true })),
            " subscribe · ",
            kbd(fmtKey(ytKeys.commentFocus, { key: "n" })),
            " jump to comment box",
          ],
        },
      ],
    },
    {
      id: "x",
      label: "X",
      features: [
        {
          name: "Bulk unlike",
          enabled: on(X.BULK_UNLIKE),
          how: [
            "Your Likes tab → Select → tap tweets (or Select all) → Unlike (n)",
          ],
        },
        {
          name: "Non-followers",
          enabled: on(X.BULK_UNFOLLOW),
          how: [
            "Your Following page → Non-followers → Scan loaded → Unfollow / Unfollow all",
          ],
        },
        {
          name: "Chronological feed",
          enabled: on(X.CHRONO_FEED),
          how: ["Home auto-switches to the Following tab"],
        },
        {
          name: "Hide promoted posts",
          enabled: on(X.HIDE_PROMOTED),
          how: ["Automatic, read-only"],
        },
        {
          name: "Hovered-tweet shortcuts",
          enabled: on(X.SHORTCUTS),
          how: [
            kbd(fmtKey(xKeys.like, { key: "e" })),
            " like · ",
            kbd(fmtKey(xKeys.reply, { key: "r", shift: true })),
            " reply · ",
            kbd(fmtKey(xKeys.downloadPhoto, { key: "d", shift: true })),
            " open photo · ",
            kbd(fmtKey(xKeys.copyLink, { key: "c", shift: true })),
            " copy link",
          ],
        },
      ],
    },
    {
      id: "reddit",
      label: "Reddit",
      features: [
        {
          name: "Bulk unsave",
          enabled: on(REDDIT.BULK_UNSAVE),
          how: [
            "Saved page → Select items (or Unsave all loaded) → confirm",
          ],
        },
        {
          name: "Hide promoted posts",
          enabled: on(REDDIT.HIDE_PROMOTED),
          how: ["Automatic, read-only"],
        },
      ],
    },
  ];

  // ---- rendering ------------------------------------------------------------
  // Built with createElement/textContent only — never innerHTML from data.
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function renderFeature(f) {
    const row = el("div", "feat" + (f.enabled ? "" : " off"));
    const name = el("div", "feat-name", f.name);
    if (!f.enabled) name.appendChild(el("span", "tag", "off"));
    row.appendChild(name);
    const how = el("div", "feat-how");
    for (const part of f.how) {
      if (part && typeof part === "object" && "kbd" in part) {
        how.appendChild(el("kbd", null, part.kbd));
      } else {
        how.appendChild(document.createTextNode(String(part)));
      }
    }
    row.appendChild(how);
    return row;
  }

  function loadTab() {
    try {
      return window.localStorage.getItem(TAB_STORE_KEY);
    } catch (_) {
      return null;
    }
  }
  function saveTab(id) {
    try {
      window.localStorage.setItem(TAB_STORE_KEY, id);
    } catch (_) {}
  }

  function renderSheet() {
    const tabs = $("tabs");
    const panels = $("panels");
    if (!tabs || !panels) return;

    const stored = loadTab();
    let activeId = SITES.some((s) => s.id === stored) ? stored : SITES[0].id;

    const tabEls = new Map();
    const panelEls = new Map();

    function select(id, focus) {
      activeId = id;
      for (const s of SITES) {
        const isActive = s.id === id;
        const t = tabEls.get(s.id);
        t.setAttribute("aria-selected", isActive ? "true" : "false");
        t.tabIndex = isActive ? 0 : -1;
        panelEls.get(s.id).hidden = !isActive;
      }
      panels.scrollTop = 0;
      if (focus) tabEls.get(id).focus();
      saveTab(id);
    }

    for (const site of SITES) {
      const tab = el("button", "tab", site.label);
      tab.type = "button";
      tab.id = "tab-" + site.id;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "panel-" + site.id);
      tab.addEventListener("click", () => select(site.id, false));
      tabs.appendChild(tab);
      tabEls.set(site.id, tab);

      const panel = el("div", "panel");
      panel.id = "panel-" + site.id;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tab.id);
      for (const f of site.features) panel.appendChild(renderFeature(f));
      panels.appendChild(panel);
      panelEls.set(site.id, panel);
    }

    // Roving focus: ←/→ (and Home/End) move between tabs, per the WAI-ARIA
    // tabs pattern, so the segmented control is keyboard-usable.
    tabs.addEventListener("keydown", (e) => {
      const ids = SITES.map((s) => s.id);
      const i = ids.indexOf(activeId);
      let next = null;
      if (e.key === "ArrowRight") next = ids[(i + 1) % ids.length];
      else if (e.key === "ArrowLeft") next = ids[(i - 1 + ids.length) % ids.length];
      else if (e.key === "Home") next = ids[0];
      else if (e.key === "End") next = ids[ids.length - 1];
      if (!next) return;
      e.preventDefault();
      select(next, true);
    });

    select(activeId, false);
  }

  function renderVersion() {
    const node = $("version");
    if (!node) return;
    let v = "";
    try {
      if (ext && ext.runtime && typeof ext.runtime.getManifest === "function") {
        const m = ext.runtime.getManifest();
        if (m && m.version) v = "v" + m.version;
      }
    } catch (_) {}
    node.textContent = v;
  }

  // ---- daily counter --------------------------------------------------------
  function dayStamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }
  function todayKey() {
    return "bwi_daily_" + dayStamp();
  }

  function paintCount(count) {
    const n = Number(count) || 0;
    $("count").textContent = String(n);
    $("cap").textContent = String(DAILY_CAP);
    $("barfill").style.width =
      Math.min(100, Math.round((n / DAILY_CAP) * 100)) + "%";
  }

  async function refresh() {
    paintCount(0);
    if (!ext || !ext.storage || !ext.storage.local) return;
    try {
      const key = todayKey();
      const res = await ext.storage.local.get(key);
      paintCount(res && res[key]);
    } catch (_) {
      // Storage unavailable — leave the zeroed counter in place.
    }
  }

  // ---- stop button ----------------------------------------------------------
  // We deliberately do NOT inspect tab.url here. Reading a tab's URL requires
  // the "tabs" permission (or a host permission), and this extension asks for
  // neither — it only declares content scripts. Instead we just send the
  // message: the content script exists only on supported sites, so sendMessage
  // rejects everywhere else, which is exactly the signal we need.
  function wireStop() {
    const stop = $("stop");
    const status = $("status");
    if (!stop) return;
    stop.addEventListener("click", async () => {
      if (!ext || !ext.tabs || !ext.tabs.query || !ext.tabs.sendMessage) {
        status.textContent = "No Socialfix run on this tab.";
        return;
      }
      let tab;
      try {
        [tab] = await ext.tabs.query({ active: true, currentWindow: true });
      } catch (_) {}
      if (!tab) {
        status.textContent = "No Socialfix run on this tab.";
        return;
      }
      try {
        await ext.tabs.sendMessage(tab.id, { type: "bwi-stop" });
        status.textContent = "Stop signal sent.";
      } catch (_) {
        // No content script on this tab — not a supported site.
        status.textContent = "No Socialfix run on this tab.";
      }
    });
  }

  // Synchronous first paint (cheat sheet + version + zeroed counter), then the
  // async storage read fills in today's count.
  renderVersion();
  renderSheet();
  wireStop();
  refresh();
})();
