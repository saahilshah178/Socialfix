// Socialfix test fixture — builds a stand-in for Instagram's Followers/Following
// modal on a file:// page and exposes `window.__fx` so a headless browser can
// drive the injected panels (Feature 2 / Feature 7, built by the REAL
// src/ui.js) and their collapse toggle without an extension, a network, or a
// login.
//
// Runs AFTER config.js and ui.js (see ig-modal.html). Deliberately does NOT
// try/catch anything: a fixture bug or a ui.js exception must surface in the
// console (`$B console`), never be swallowed. window.__fx.errors additionally
// collects them (without preventDefault, so they still reach the console).
//
// Query params (all optional):
//   title=following|followers     modal title → which panel is built (default following)
//   panel=1|0                     inject the matching Feature 2 / Feature 7 panel (default 1)
//   rows=N                        native rows (default 60 — overflows the 356px list)
//   panelRows=N                   fake users in the panel (default 12)
//   panelDelay=ms                 insert the panel this long after the dialog (default 0;
//                                 mimics Feature 2's async scan landing later)
(function () {
  "use strict";

  const BWI = window.BWI;
  if (!BWI || !BWI.ui || !BWI.config) {
    throw new Error("[fixture] window.BWI.ui / BWI.config missing — check the script order in ig-modal.html");
  }
  const ui = BWI.ui;
  const cfg = BWI.config;

  // Geometry constants mirror Instagram's 2026 modal.
  const ROW_H = 60; // native row height
  const LIST_H = 356; // inline height Instagram gives the list scroller

  const TITLES = ["following", "followers"];

  // ---- params ---------------------------------------------------------------

  const qs = new URLSearchParams(location.search);

  function intParam(v, dflt, min, max) {
    if (v === null || v === undefined || v === "") return dflt;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`[fixture] bad numeric query param: ${v}`);
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  // `source.get(k)` → string|null (URLSearchParams, or an override wrapper).
  function parseParams(source) {
    const title = (source.get("title") || "following").toLowerCase();
    if (!TITLES.includes(title)) throw new Error(`[fixture] unknown title=${title} (want ${TITLES.join("|")})`);
    return {
      title,
      panel: intParam(source.get("panel"), 1, 0, 1),
      rows: intParam(source.get("rows"), 60, 1, 5000),
      panelRows: intParam(source.get("panelRows"), 12, 0, 500),
      panelDelay: intParam(source.get("panelDelay"), 0, 0, 60000),
    };
  }

  let params = parseParams(qs);

  // ---- error capture (observe only — never preventDefault) ------------------

  const errors = [];
  window.addEventListener("error", (e) => {
    errors.push({ kind: "error", message: e.message, source: e.filename, line: e.lineno, col: e.colno, t: Date.now() });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    errors.push({ kind: "unhandledrejection", message: r && r.message ? r.message : String(r), t: Date.now() });
  });

  // ---- tiny helpers -----------------------------------------------------------

  const round = (n) => Math.round(n * 10) / 10;

  function el(tag, className, style) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (style) for (const k of Object.keys(style)) node.style[k] = style[k];
    return node;
  }

  // Deterministic initials avatar as a data: URL — no network, no broken images.
  function avatarSvg(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    const initials = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44'>` +
      `<rect width='44' height='44' rx='22' fill='hsl(${h % 360},45%,52%)'/>` +
      `<text x='22' y='29' font-size='17' font-weight='600' font-family='Arial,Helvetica,sans-serif' ` +
      `fill='#fff' text-anchor='middle'>${initials}</text></svg>`;
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  // Two frames plus a short pause: enough for a DOM insert → layout round-trip.
  async function settle(extraMs) {
    await nextFrame();
    await nextFrame();
    await new Promise((r) => setTimeout(r, extraMs == null ? 30 : extraMs));
  }

  function rect(node) {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return {
      x: round(r.left),
      y: round(r.top),
      w: round(r.width),
      h: round(r.height),
      right: round(r.right),
      bottom: round(r.bottom),
    };
  }

  // ---- DOM: the modal ---------------------------------------------------------

  let overlay = null;
  let dialog = null;
  let card = null;
  let scroll = null;
  let panelRoot = null;
  let panelApi = null;
  let panelReady = null; // Promise<root|null>

  function rowLabel() {
    // Own Followers list rows say "Remove"; a Following list's rows say
    // "Following" — the same word as the modal title, which is exactly why
    // ui.dialogTitleIs must ignore text inside buttons. We nest the label in a
    // <div> inside the <button> to exercise that exclusion path.
    return params.title === "followers" ? "Remove" : cfg.LABELS.following;
  }

  function buildRow(i) {
    const uname = `user_${i + 1}`;
    const row = el("div", "fx-row");
    row.dataset.index = String(i);
    const picLink = el("a");
    picLink.href = `/${uname}/`;
    const img = el("img");
    img.src = avatarSvg(uname);
    img.width = 44;
    img.height = 44;
    img.alt = "";
    picLink.appendChild(img);
    const nameLink = el("a", "fx-row__name");
    nameLink.href = `/${uname}/`;
    nameLink.textContent = uname;
    const btn = el("button");
    btn.type = "button";
    const btnText = el("div");
    btnText.textContent = rowLabel();
    btn.appendChild(btnText);
    row.appendChild(picLink);
    row.appendChild(nameLink);
    row.appendChild(btn);
    return row;
  }

  function build() {
    overlay = el("div", "fx-overlay");
    overlay.id = "fx-overlay";

    dialog = el("div", "fx-dialog");
    dialog.id = "fx-dialog";
    dialog.setAttribute("role", "dialog");

    card = el("div", "fx-card");
    card.id = "fx-card";

    // Header: the title is a plain <div> (not in a button/link) — the thing
    // ui.dialogTitleIs looks for. The close button sits beside it.
    const header = el("div", "fx-header");
    const title = el("div", "fx-title");
    title.textContent = params.title === "followers" ? cfg.LABELS.followers : cfg.LABELS.following;
    const close = el("button", "fx-close");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.textContent = "✕";
    header.appendChild(title);
    header.appendChild(close);

    const search = el("div", "fx-search");
    const input = el("input");
    input.type = "text";
    input.placeholder = "Search";
    search.appendChild(input);

    const listwrap = el("div", "fx-listwrap");

    scroll = el("div", "ig-scroll");
    scroll.id = "fx-scroll";
    scroll.style.overflowY = "auto";
    scroll.style.height = LIST_H + "px"; // Instagram's fixed-height list
    for (let i = 0; i < params.rows; i++) scroll.appendChild(buildRow(i));
    listwrap.appendChild(scroll);

    card.appendChild(header);
    card.appendChild(search);
    card.appendChild(listwrap);
    dialog.appendChild(card);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  function teardown() {
    if (overlay) overlay.remove();
    overlay = dialog = card = scroll = null;
    panelRoot = null;
    panelApi = null;
  }

  // ---- DOM: the injected panel (real BWI.ui code) ---------------------------

  const NOTE =
    "“No longer following” is inferred from follower-list changes — it also " +
    "includes accounts that deactivated, were banned, blocked you, or went private.";

  function makeUsers(n, prefix, withSubtitles) {
    const users = [];
    for (let i = 1; i <= n; i++) {
      const username = `${prefix}${i}`;
      const u = {
        pk: String(900000 + i),
        username,
        full_name: i % 4 === 0 ? "" : `Fake Person ${i}`,
        profile_pic_url: avatarSvg(username),
      };
      if (withSubtitles && i % 3 === 0) u.subtitle = "Unfollowed you 2 days ago";
      users.push(u);
    }
    return users;
  }

  function mountPanel() {
    if (!scroll) throw new Error("[fixture] mountPanel before build");
    if (params.title === "followers") {
      const users = makeUsers(params.panelRows, "gone_user_", true);
      panelApi = ui.renderListSubsection("89 accounts no longer follow you", users, {
        dataKey: "unfollowers",
        note: NOTE,
        emptyText: "No changes detected since your last visit.",
      });
      panelRoot = panelApi.root;
      ui.insertAboveList(panelRoot, scroll);
    } else {
      const say = (name) => () => console.info(`[fixture] panel handler: ${name}`);
      panelApi = ui.renderSubsection({
        onUnfollowOne: say("onUnfollowOne"),
        onUnfollowAll: say("onUnfollowAll"),
        onStop: say("onStop"),
        onRefresh: say("onRefresh"),
      });
      panelRoot = panelApi.root;
      // Same order as feature2: insert the loading shell first, then stream
      // rows in, then finish().
      ui.insertAboveList(panelRoot, scroll);
      panelApi.setScanStatus("Scanning your lists… (fixture)");
      makeUsers(params.panelRows, "nf_user_", false).forEach((u) => panelApi.addRow(u));
      panelApi.finish();
    }
    return panelRoot;
  }

  function schedulePanel() {
    if (!params.panel) {
      panelReady = Promise.resolve(null);
      return;
    }
    if (params.panelDelay > 0) {
      panelReady = new Promise((resolve) => setTimeout(() => resolve(mountPanel()), params.panelDelay));
    } else {
      panelReady = Promise.resolve(mountPanel());
    }
  }

  // ---- introspection ------------------------------------------------------------

  function rects() {
    const sr = scroll.getBoundingClientRect();
    const panelList = panelRoot ? panelRoot.querySelector(".bwi-list") : null;
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      dialog: rect(dialog),
      card: Object.assign(rect(card), { classes: card.className }),
      scroll: Object.assign(rect(scroll), {
        scrollHeight: scroll.scrollHeight,
        clientHeight: scroll.clientHeight,
        scrollTop: scroll.scrollTop,
        overflowY: getComputedStyle(scroll).overflowY,
        inlineHeight: scroll.style.height,
        rowsMounted: scroll.querySelectorAll(".fx-row").length,
      }),
      panel: panelRoot
        ? Object.assign(rect(panelRoot), {
            collapsed: panelRoot.classList.contains("bwi-section--collapsed"),
            rows: panelRoot.querySelectorAll(".bwi-row").length,
            listMaxHeight: panelList ? getComputedStyle(panelList).maxHeight : null,
            listHeight: panelList ? round(panelList.getBoundingClientRect().height) : null,
            // The panel must sit ABOVE the list (insertAboveList), never beside it.
            aboveList: panelRoot.getBoundingClientRect().bottom <= sr.top + 1,
            // …and inside the card, as a preceding sibling of the list's wrapper.
            insideCard: card.contains(panelRoot),
          })
        : null,
    };
  }

  function toggleState() {
    if (!panelRoot) return { present: false, reason: "no panel (panel=0, or panelDelay not elapsed)" };
    const btn = panelRoot.querySelector(".bwi-section__toggle");
    const caret = btn ? btn.querySelector(".bwi-caret") : null;
    const glyph = btn ? btn.querySelector(".bwi-caret__glyph") : null;
    const label = btn ? btn.querySelector(".bwi-caret__label") : null;
    const list = panelRoot.querySelector(".bwi-list");
    const progress = panelRoot.querySelector(".bwi-progress");
    const titleEl = panelRoot.querySelector(".bwi-section__title");
    return {
      present: !!btn,
      glyph: glyph ? glyph.textContent : null,
      label: label ? label.textContent : null,
      caretText: caret ? caret.textContent.trim() : null,
      ariaExpanded: btn ? btn.getAttribute("aria-expanded") : null,
      collapsed: panelRoot.classList.contains("bwi-section--collapsed"),
      listDisplay: list ? getComputedStyle(list).display : null,
      listVisible: list ? list.getBoundingClientRect().height > 0 : null,
      progressDisplay: progress ? getComputedStyle(progress).display : null,
      // Regression guard: nothing in the toggle may be rotated/transformed
      // (the old CSS rotated the whole caret, turning "Show" sideways).
      caretTransform: caret ? getComputedStyle(caret).transform : null,
      glyphTransform: glyph ? getComputedStyle(glyph).transform : null,
      labelTransform: label ? getComputedStyle(label).transform : null,
      title: titleEl ? titleEl.textContent : null,
      buttonTitle: btn ? btn.title : null,
      panelHeight: round(panelRoot.getBoundingClientRect().height),
    };
  }

  function clickToggle() {
    if (!panelRoot) throw new Error("[fixture] clickToggle: no panel mounted");
    const btn = panelRoot.querySelector(".bwi-section__toggle");
    if (!btn) throw new Error("[fixture] clickToggle: no .bwi-section__toggle in panel");
    btn.click();
    return toggleState();
  }

  const badge = document.getElementById("fx-badge");
  function setBadge() {
    const c = card.getBoundingClientRect();
    const text =
      `fixture title=${params.title} panel=${params.panel} panelRows=${params.panelRows}\n` +
      `viewport ${window.innerWidth}x${window.innerHeight}  card ${round(c.width)}x${round(c.height)}`;
    // Idempotent write: only touch the DOM when the text actually changed.
    if (badge && badge.textContent !== text) badge.textContent = text;
  }

  // Tear the modal down and build a fresh one (new [role=dialog] element), like
  // closing and reopening Instagram's modal. `overrides` may change any query
  // param, e.g. reopen({title:"followers"}).
  async function reopen(overrides, opts) {
    const o = overrides || {};
    opts = opts || {};
    params = parseParams({
      get: (k) => (Object.prototype.hasOwnProperty.call(o, k) ? String(o[k]) : qs.get(k)),
    });
    teardown();
    build();
    schedulePanel();
    await panelReady;
    await settle(opts.settleMs == null ? 300 : Number(opts.settleMs));
    setBadge();
    return rects();
  }

  // ---- public API ---------------------------------------------------------------

  const fx = {
    ROW_H,
    LIST_H,
    errors,
    settle,
    nextFrame,
    rects,
    toggleState,
    clickToggle,
    reopen,
    setBadge,
    // A `bwi-` panel handle for driving addRow/finish/showError by hand.
    get panelApi() {
      return panelApi;
    },
    get panelReady() {
      return panelReady;
    },
    get params() {
      return Object.assign({}, params);
    },
    // Live element references (they change after reopen(), hence getters).
    get card() {
      return card;
    },
    get scroll() {
      return scroll;
    },
    get dialog() {
      return dialog;
    },
    get overlay() {
      return overlay;
    },
    get panelRoot() {
      return panelRoot;
    },
  };
  window.__fx = fx;

  // ---- go -----------------------------------------------------------------------

  build();
  schedulePanel();
  setBadge();
  let badgeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(setBadge, 250);
  });
  console.info(`[fixture] built title=${params.title} panel=${params.panel} rows=${params.rows}`);
})();
