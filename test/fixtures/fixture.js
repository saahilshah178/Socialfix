// Socialfix test fixture — builds a stand-in for Instagram's Followers/Following
// modal on a file:// page and exposes `window.__fx` so a headless browser can
// drive feature3's drag-to-resize and the panel collapse toggle without an
// extension, a network, or a login.
//
// Runs AFTER chrome-shim.js, config.js, ui.js and feature3.js (see
// ig-modal.html). Deliberately does NOT try/catch anything: a fixture bug or a
// feature3 exception must surface in the console (`$B console`), never be
// swallowed. window.__fx.errors additionally collects them (without
// preventDefault, so they still reach the console).
//
// Query params (all optional):
//   mode=fixed|flex|window|clip   how the native list is sized (default fixed)
//   title=following|followers     modal title → which panel is built (default following)
//   panel=1|0                     inject the matching Feature 2 / Feature 7 panel (default 1)
//   centered=1|0                  card centered in the viewport (1) or pinned top-left (0)
//   rows=N                        native rows (default 60 — must overflow the 356px list)
//   panelRows=N                   fake users in the panel (default 12)
//   panelDelay=ms                 insert the panel this long after the dialog (default 0)
//   cardpos=static|relative       CSS position of the card (default static — feature3
//                                 must make the card a containing block itself)
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
  const WINDOW_BAND = 480; // mode=window: react-window keeps ~8 rows mounted (356px + overscan)
  const FLEX_CARD_H = 500; // mode=flex: explicit card height the list flexes inside

  const MODES = ["fixed", "flex", "window", "clip"];
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
    const mode = (source.get("mode") || "fixed").toLowerCase();
    const title = (source.get("title") || "following").toLowerCase();
    if (!MODES.includes(mode)) throw new Error(`[fixture] unknown mode=${mode} (want ${MODES.join("|")})`);
    if (!TITLES.includes(title)) throw new Error(`[fixture] unknown title=${title} (want ${TITLES.join("|")})`);
    const cardpos = source.get("cardpos") || "static";
    if (cardpos !== "static" && cardpos !== "relative") {
      throw new Error(`[fixture] unknown cardpos=${cardpos} (want static|relative)`);
    }
    return {
      mode,
      title,
      panel: intParam(source.get("panel"), 1, 0, 1),
      centered: intParam(source.get("centered"), 1, 0, 1),
      rows: intParam(source.get("rows"), 60, 1, 5000),
      panelRows: intParam(source.get("panelRows"), 12, 0, 500),
      panelDelay: intParam(source.get("panelDelay"), 0, 0, 60000),
      cardpos,
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
  // feature3 works off MutationObserver + rAF; two frames plus a short pause is
  // enough for a mutation → schedule → scan → apply round-trip to land.
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
  let clipEl = null;
  let spacer = null; // mode=window only
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

  function buildRow(i, absolute) {
    const uname = `user_${i + 1}`;
    const row = el("div", "fx-row" + (absolute ? " fx-row--abs" : ""));
    row.dataset.index = String(i);
    if (absolute) {
      // Inline, like react-window does it (some detectors read el.style).
      row.style.position = "absolute";
      row.style.left = "0px";
      row.style.top = i * ROW_H + "px";
      row.style.height = ROW_H + "px";
      row.style.width = "100%";
    }
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

  // mode=window: mount only the rows inside a fixed 480px band starting at
  // scrollTop — regardless of how tall the container currently is. That is the
  // stale-height react-window behaviour feature3 must detect: grow the
  // container and the extra area stays empty until Instagram re-measures.
  function renderWindow() {
    const top = scroll.scrollTop;
    const first = Math.max(0, Math.floor(top / ROW_H));
    const last = Math.min(params.rows - 1, Math.ceil((top + WINDOW_BAND) / ROW_H) - 1);
    const existing = new Map();
    for (const r of Array.from(spacer.children)) existing.set(Number(r.dataset.index), r);
    for (const [i, r] of existing) if (i < first || i > last) r.remove();
    for (let i = first; i <= last; i++) if (!existing.has(i)) spacer.appendChild(buildRow(i, true));
  }

  function build() {
    overlay = el("div", "fx-overlay" + (params.centered ? "" : " fx-overlay--topleft"));
    overlay.id = "fx-overlay";

    dialog = el("div", "fx-dialog");
    dialog.id = "fx-dialog";
    dialog.setAttribute("role", "dialog");

    card = el("div", "fx-card" + (params.cardpos === "relative" ? " fx-card--relative" : ""));
    card.id = "fx-card";
    if (params.mode === "flex") card.style.height = FLEX_CARD_H + "px";

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

    const listwrap = el("div", "fx-listwrap" + (params.mode === "flex" ? " fx-listwrap--flex" : ""));

    scroll = el("div", "ig-scroll");
    scroll.id = "fx-scroll";
    scroll.style.overflowY = "auto";
    if (params.mode === "flex") {
      // No inline height: the list grows/shrinks with the card.
      scroll.style.flex = "1 1 auto";
      scroll.style.minHeight = "0";
    } else {
      scroll.style.height = LIST_H + "px";
    }
    if (params.mode === "window") scroll.style.willChange = "transform";

    clipEl = null;
    spacer = null;
    if (params.mode === "window") {
      spacer = el("div", "fx-spacer");
      spacer.style.height = params.rows * ROW_H + "px";
      scroll.appendChild(spacer);
      renderWindow();
      scroll.addEventListener("scroll", renderWindow);
    } else {
      for (let i = 0; i < params.rows; i++) scroll.appendChild(buildRow(i, false));
    }

    if (params.mode === "clip") {
      clipEl = el("div", "fx-clip");
      clipEl.appendChild(scroll);
      listwrap.appendChild(clipEl);
    } else {
      listwrap.appendChild(scroll);
    }

    card.appendChild(header);
    card.appendChild(search);
    card.appendChild(listwrap);
    dialog.appendChild(card);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  function teardown() {
    if (overlay) overlay.remove();
    overlay = dialog = card = scroll = clipEl = spacer = null;
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

  function storageDump() {
    return typeof window.__bwiStorageDump === "function" ? window.__bwiStorageDump() : null;
  }

  function sizeKey() {
    return cfg.MODAL_SIZE_KEY || "bwi_modal_size";
  }

  function storedSize() {
    const dump = storageDump();
    return dump ? dump[sizeKey()] : undefined;
  }

  function rects() {
    const layer = card.querySelector(".bwi-resize-layer");
    const mounted = scroll.querySelectorAll(".fx-row");
    const sr = scroll.getBoundingClientRect();
    // Bottom-most mounted row (max over all rows — in mode=window DOM order is
    // mount order, not index order).
    let lastRowBottom = null;
    for (const row of mounted) {
      const b = row.getBoundingClientRect().bottom - sr.top;
      if (lastRowBottom == null || b > lastRowBottom) lastRowBottom = b;
    }
    if (lastRowBottom != null) lastRowBottom = round(lastRowBottom);
    const cardCs = getComputedStyle(card);
    const panelList = panelRoot ? panelRoot.querySelector(".bwi-list") : null;
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      dialog: rect(dialog),
      card: Object.assign(rect(card), {
        inlineWidth: card.style.width,
        inlineWidthPriority: card.style.getPropertyPriority("width"),
        inlineHeight: card.style.height,
        inlineHeightPriority: card.style.getPropertyPriority("height"),
        position: cardCs.position,
        maxHeight: cardCs.maxHeight,
        listMax: cardCs.getPropertyValue("--bwi-list-max").trim(),
        classes: card.className,
      }),
      scroll: Object.assign(rect(scroll), {
        scrollHeight: scroll.scrollHeight,
        clientHeight: scroll.clientHeight,
        scrollTop: scroll.scrollTop,
        overflowY: getComputedStyle(scroll).overflowY,
        inlineHeight: scroll.style.height,
        inlineHeightPriority: scroll.style.getPropertyPriority("height"),
        rowsMounted: mounted.length,
        // Bottom of the last mounted row relative to the scroller's top. In
        // mode=window this stays at ~480 however tall the scroller gets, so
        // `coveredToBottom` false + emptyBandPx > 0 == the windowing symptom.
        lastRowBottomInScroll: lastRowBottom,
        emptyBandPx: lastRowBottom == null ? null : round(scroll.clientHeight - lastRowBottom),
        coveredToBottom: lastRowBottom == null ? null : lastRowBottom >= scroll.clientHeight - 1,
      }),
      clip: clipEl ? rect(clipEl) : null,
      panel: panelRoot
        ? Object.assign(rect(panelRoot), {
            collapsed: panelRoot.classList.contains("bwi-section--collapsed"),
            listMaxHeight: panelList ? getComputedStyle(panelList).maxHeight : null,
            listHeight: panelList ? round(panelList.getBoundingClientRect().height) : null,
            // The panel must sit ABOVE the list (insertAboveList), never beside it.
            aboveList: panelRoot.getBoundingClientRect().bottom <= sr.top + 1,
          })
        : null,
      resize: {
        layer: !!layer,
        layerRect: rect(layer),
        handles: card.querySelectorAll(".bwi-resize-handle").length,
        handleDirs: Array.from(card.querySelectorAll(".bwi-resize-handle")).map((h) => h.dataset.dir || null),
        resizable: card.classList.contains("bwi-resizable"),
        bigCard: card.classList.contains("bwi-big-card"),
        widthOnly: card.classList.contains("bwi-resize--width-only"),
        bodyResizing: document.body.classList.contains("bwi-resizing"),
      },
      storedSize: storedSize(),
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

  function viewportInfo() {
    const c = card.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardCenteredX = Math.abs((c.left + c.right) / 2 - vw / 2) <= 2;
    const cardCenteredY = Math.abs((c.top + c.bottom) / 2 - vh / 2) <= 2;
    return {
      innerWidth: vw,
      innerHeight: vh,
      dpr: window.devicePixelRatio,
      params: Object.assign({}, params),
      cardCenteredX,
      cardCenteredY,
      // Per the contract, a drag on a centered axis changes the size by 2× the
      // pointer delta (the card grows both ways), 1× otherwise.
      expectedDragFactor: { x: cardCenteredX ? 2 : 1, y: cardCenteredY ? 2 : 1 },
    };
  }

  const badge = document.getElementById("fx-badge");
  function setViewportInfo() {
    const info = viewportInfo();
    const c = card.getBoundingClientRect();
    const text =
      `fixture mode=${params.mode} title=${params.title} panel=${params.panel} centered=${params.centered}\n` +
      `viewport ${info.innerWidth}x${info.innerHeight}  card ${round(c.width)}x${round(c.height)}` +
      `  factor x${info.expectedDragFactor.x}/y${info.expectedDragFactor.y}`;
    // Idempotent write: only touch the DOM (and so feature3's observer) when
    // the text actually changed.
    if (badge && badge.textContent !== text) badge.textContent = text;
    return info;
  }

  // Replace DOM nodes / functions in feature3's state object with printable
  // stand-ins so `$B js` can JSON.stringify it.
  function printable(v, depth) {
    depth = depth || 0;
    if (v == null || typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "function") return "[fn]";
    if (v instanceof Element) {
      return `<${v.tagName.toLowerCase()}${v.id ? "#" + v.id : ""}${v.className ? "." + String(v.className).trim().replace(/\s+/g, ".") : ""}>`;
    }
    if (depth >= 4) return "[…]";
    if (Array.isArray(v)) return v.map((x) => printable(x, depth + 1));
    if (typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v)) out[k] = printable(v[k], depth + 1);
      return out;
    }
    return String(v);
  }

  function state() {
    const mr = BWI.modalResize;
    if (!mr || typeof mr.stateFor !== "function") {
      return { available: false, reason: "BWI.modalResize.stateFor not present" };
    }
    return { available: true, state: printable(mr.stateFor(dialog)) };
  }

  // ---- interaction ---------------------------------------------------------------

  function handleFor(dir) {
    const h = card.querySelector(`.bwi-resize-handle--${dir}`);
    if (!h) {
      throw new Error(
        `[fixture] no .bwi-resize-handle--${dir} inside the card — feature3 has not attached its resize layer ` +
          `(RESIZABLE_MODALS off, dialog not detected, or not settled yet — await __fx.settle())`
      );
    }
    return h;
  }

  function fire(type, target, x, y, extra, useMouse) {
    const init = Object.assign(
      {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
      },
      extra || {}
    );
    let ev;
    if (useMouse) {
      ev = new MouseEvent(type.replace("pointer", "mouse"), init);
    } else {
      // pointerId 1 == Chromium's always-registered mouse pointer, so a
      // handler's setPointerCapture(1) does not throw NotFoundError (it just
      // doesn't capture, which is fine: we dispatch every event on the handle).
      ev = new PointerEvent(
        type,
        Object.assign({ pointerId: 1, pointerType: "mouse", isPrimary: true, pressure: 0.5, width: 1, height: 1 }, init)
      );
    }
    target.dispatchEvent(ev);
    return ev;
  }

  // Drag the `dir` handle by (dx, dy) CSS px from its center, in `steps`
  // intermediate pointermoves (one frame apart, so a rAF-throttled resize
  // handler gets to apply progressively). Resolves after everything settled.
  // opts: { steps=6, mouse=false (MouseEvent instead of PointerEvent),
  //         settleMs=1200 } — the wait after pointerup before measuring.
  // The default is long on purpose: feature3 verifies the grown list ~800ms
  // after a drag (and may roll back to width-only then) and persists {w,h}
  // after a 250ms debounce, so a shorter wait shows a state that is still
  // changing. Pass {settleMs: 50} when only the immediate size matters.
  const DRAG_SETTLE_MS = 1200;
  async function drag(dir, dx, dy, opts) {
    opts = opts || {};
    const steps = Math.max(1, Number(opts.steps) || 6);
    const useMouse = !!opts.mouse;
    const settleMs = opts.settleMs == null ? DRAG_SETTLE_MS : Number(opts.settleMs);
    dx = Number(dx) || 0;
    dy = Number(dy) || 0;
    const h = handleFor(dir);
    const hr = h.getBoundingClientRect();
    if (hr.width === 0 && hr.height === 0) {
      throw new Error(`[fixture] handle ${dir} has no box (display:none — width-only mode hides the vertical handles?)`);
    }
    const x0 = hr.left + hr.width / 2;
    const y0 = hr.top + hr.height / 2;
    const before = rects();
    const info = viewportInfo();

    fire("pointerdown", h, x0, y0, null, useMouse);
    const duringDown = { bodyResizing: document.body.classList.contains("bwi-resizing"), cursor: document.body.getAttribute("data-bwi-cursor") };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      fire("pointermove", h, x0 + dx * t, y0 + dy * t, null, useMouse);
      await nextFrame();
    }
    fire("pointerup", h, x0 + dx, y0 + dy, { buttons: 0, pressure: 0 }, useMouse);
    await settle(settleMs);
    const after = rects();
    return {
      dir,
      dx,
      dy,
      steps,
      via: useMouse ? "MouseEvent" : "PointerEvent",
      from: { x: round(x0), y: round(y0) },
      to: { x: round(x0 + dx), y: round(y0 + dy) },
      handleRect: rect(h),
      duringDown,
      expectedDragFactor: info.expectedDragFactor,
      before,
      after,
      delta: {
        cardW: round(after.card.w - before.card.w),
        cardH: round(after.card.h - before.card.h),
        scrollH: round(after.scroll.h - before.scroll.h),
        scrollClientH: after.scroll.clientHeight - before.scroll.clientHeight,
        panelListH: after.panel && before.panel ? round(after.panel.listHeight - before.panel.listHeight) : null,
      },
      storedSize: storedSize(),
    };
  }

  async function dblclickHandle(dir, opts) {
    opts = opts || {};
    const h = handleFor(dir);
    const hr = h.getBoundingClientRect();
    const x = hr.left + hr.width / 2;
    const y = hr.top + hr.height / 2;
    const before = rects();
    h.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: x, clientY: y, detail: 2 })
    );
    // Reset removes the stored size synchronously and re-lays out on the next
    // scan; 300ms is plenty.
    await settle(opts.settleMs == null ? 300 : Number(opts.settleMs));
    return { dir, before, after: rects(), storedSize: storedSize() };
  }

  async function scrollList(top) {
    scroll.scrollTop = Number(top) || 0;
    await settle();
    return rects().scroll;
  }

  // Tear the modal down and build a fresh one (new [role=dialog] element), like
  // closing and reopening Instagram's modal — the way to check that feature3
  // re-applies the persisted size on the NEXT dialog without a page reload.
  // `overrides` may change any query param, e.g. reopen({mode:"flex"}).
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
    // Long default for the same reason as drag(): the new dialog re-runs mode
    // detection + the 800ms verify before its state is final.
    await settle(opts.settleMs == null ? DRAG_SETTLE_MS : Number(opts.settleMs));
    setViewportInfo();
    return rects();
  }

  async function resetSize(opts) {
    opts = opts || {};
    const mr = BWI.modalResize;
    if (!mr || typeof mr.reset !== "function") throw new Error("[fixture] BWI.modalResize.reset not present");
    const r = mr.reset();
    if (r && typeof r.then === "function") await r;
    await settle(opts.settleMs == null ? 300 : Number(opts.settleMs));
    return rects();
  }

  // ---- public API ---------------------------------------------------------------

  const fx = {
    // constants the README refers to
    ROW_H,
    LIST_H,
    WINDOW_BAND,
    FLEX_CARD_H,
    errors,
    settle,
    nextFrame,
    rects,
    toggleState,
    clickToggle,
    viewportInfo,
    setViewportInfo,
    state,
    drag,
    dblclickHandle,
    scrollList,
    reopen,
    resetSize,
    storage: storageDump,
    storedSize,
    resetStorage: () => window.__bwiResetStorage(),
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
    get clip() {
      return clipEl;
    },
    get panelRoot() {
      return panelRoot;
    },
  };
  window.__fx = fx;

  // ---- go -----------------------------------------------------------------------

  build();
  schedulePanel();
  setViewportInfo();
  // Keep the badge current after `$B viewport WxH` (debounced; the write is
  // idempotent so it can't feed feature3's observer a loop).
  let badgeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(setViewportInfo, 250);
  });
  console.info(
    `[fixture] built mode=${params.mode} title=${params.title} panel=${params.panel} centered=${params.centered} rows=${params.rows}`
  );
})();
