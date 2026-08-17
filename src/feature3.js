// Socialfix — Feature 3: modal sizing — bigger + drag-resizable
// Followers/Following modals (any profile).
//
// Two things live here, both keyed on Instagram's Followers/Following list
// dialog:
//   • BIGGER_MODALS    — the legacy one-shot widen to MODAL_WIDTH_PX (default
//                        off; see config.js).
//   • RESIZABLE_MODALS — eight transparent drag handles appended INSIDE the
//                        modal card (Instagram's "click outside closes" logic
//                        must keep seeing the pointer inside the card). Drag an
//                        edge/corner to resize both ways; the chosen {w,h} is
//                        remembered in chrome.storage.local; double-click any
//                        handle to reset.
//
// Why this is fiddly: [role="dialog"] is only a centering wrapper — the visible
// rounded "card" is a descendant, and the scrollable user list is virtualized
// (react-window). WIDTH is layout-safe: the list simply gets wider. HEIGHT is
// not: Instagram's list container may (a) flex with the card, (b) have a fixed
// pixel height we have to grow ourselves, or (c) be a virtualizer with a fixed
// viewport that will not render into a taller box whatever we do. So height
// goes through three modes, decided at runtime per dialog:
//   "flex"  — after we set the card height the scroll container grew by
//             itself → we don't touch the list height (a flex verdict that
//             doesn't hold at verify time is re-run once as "fixed").
//   "fixed" — it didn't → we set the list height to fill the card below the
//             header (and any panel Feature 2/7 injected above the list), then
//             VERIFY ~800ms later (and again after every drag) that rows really
//             render down to the bottom and that nothing clips the grown list.
//   "none"  — verification failed (or the card refused to change height at
//             all across 5 probes, "card-locked") → roll every height back,
//             remember it for the page session, hide the vertical handles
//             (width-only) and tell the user once. Never a blank band, never
//             unreachable rows.
// History: an earlier build forced card + list heights unconditionally and was
// reverted after the native list rendered blank ("widen-only, default-off").
// The detection + verification above is what makes height safe to try again.
//
// Idempotency is load-bearing: the MutationObserver watches style (and class)
// attributes because React strips/rewrites inline styles — and our own writes
// fire it too — so every setter compares first and writes only on a change.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const ui = BWI.ui;

  if (!cfg.BIGGER_MODALS && !cfg.RESIZABLE_MODALS) return;

  const RESIZABLE = !!cfg.RESIZABLE_MODALS;
  const DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
  const VERIFY_DELAY_MS = 800; // let the virtualizer settle before judging the taller box
  const SAVE_DEBOUNCE_MS = 250;
  const CENTER_TOLERANCE_PX = 4;
  const MIN_LIST_PX = 120;
  const MIN_W = cfg.MODAL_MIN_WIDTH_PX || 320;
  const MIN_H = cfg.MODAL_MIN_HEIGHT_PX || 300;
  const SIZE_KEY = cfg.MODAL_SIZE_KEY || "bwi_modal_size";
  // Every inline property we may write on Instagram's own elements — listed so
  // reset/rollback undo exactly that and nothing else.
  const CARD_PROPS = [
    "width",
    "max-width",
    "height",
    "max-height",
    "position",
    "box-sizing",
    "--bwi-list-max",
  ];
  const SCROLL_PROPS = ["height", "max-height"];
  // position:relative is what anchors the handle layer, not a "size" — reset
  // keeps it (applyLayout would re-add it on the next scan anyway).
  const RESET_CARD_PROPS = CARD_PROPS.filter((p) => p !== "position");
  const VERIFY_TOLERANCE_PX = 90; // empty band under the last row that still counts as "filled"
  const PROBE_TRIES = 5; // card refused to change height this many times → it can't

  // ---- state ---------------------------------------------------------------
  const sized = new WeakMap(); // dialog -> rec
  const recByCard = new WeakMap(); // card -> rec (a handle finds its rec through the card)
  const baseByCard = new WeakMap(); // card -> native size, measured before we ever styled it
  const origByEl = new WeakMap(); // el -> { prop: {value, priority} } inline values before we touched them
  const cooldown = new WeakMap(); // dialog -> ts: don't repeat the expensive detection every frame
  const liveRecs = new Set();

  let listMode = "unknown"; // "unknown" | "flex" | "fixed" | "none" — "none" sticks for the page session
  // Persisted drag result; null = leave Instagram's own size. `hBlocked` is set
  // by rollback(): the height stays remembered but is NOT applied on the next
  // page load — a fresh vertical drag (the user's explicit retry) clears it, so
  // a one-off false rollback never silently erases the preferred size.
  let userSize = { w: null, h: null, hBlocked: false };
  let userTouched = false; // a drag/reset happened — a late storage read must not clobber it
  let toastedWidthOnly = false;
  let saveTimer = 0;
  let lastResetAt = 0;
  let lastPress = null; // { handle, t, x, y } for double-press-to-reset
  let swallowClickUntil = 0;
  let drag = null;

  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const clampW = (w) => clamp(Math.round(w), MIN_W, Math.floor(window.innerWidth * 0.95));
  const clampH = (h) => clamp(Math.round(h), MIN_H, Math.floor(window.innerHeight * 0.95));

  // chrome.storage may be unavailable (context invalidated, or a plain-page
  // fixture) — every call is best-effort, sync throws and async rejects alike.
  function storage(fn) {
    try {
      const p = fn();
      if (p && typeof p.catch === "function") p.catch(() => {});
      return p;
    } catch (_) {
      return null;
    }
  }

  // ---- detection (unchanged approach) --------------------------------------

  function isListDialog(dialog) {
    return (
      ui.dialogTitleIs(dialog, cfg.LABELS.followers) ||
      ui.dialogTitleIs(dialog, cfg.LABELS.following)
    );
  }

  // The visible "card" is the rounded, opaque box that bounds the modal — not
  // [role="dialog"] (a transparent centering wrapper) and not the full-viewport
  // overlay. Climb from the scroll container toward the overlay and pick the
  // OUTERMOST element that still looks like a styled box (border-radius or an
  // opaque background). Sizing it makes transparent wrappers shrink-wrap to it.
  function findCard(dialog, scroll) {
    // A card we already sized can never be the overlay — and once the user has
    // dragged it to ≥90vw the width heuristic below would mistake it (or an
    // inner wrapper that is now just as wide) for one on a list re-mount and
    // adopt the wrong element (duplicate handles, stuck styles). Look up the
    // whole chain for a known card first.
    for (let n = scroll ? scroll.parentElement : null; n && n !== document.body; n = n.parentElement) {
      if (recByCard.has(n) || n.classList.contains("bwi-big-card")) return n;
    }
    const overlayW = window.innerWidth * 0.9;
    let node = scroll ? scroll.parentElement : dialog;
    let best = null;
    let safety = 0;
    while (node && node !== document.body && safety++ < 40) {
      if (node.getBoundingClientRect().width >= overlayW) break; // hit the overlay
      const cs = getComputedStyle(node);
      const radius = parseFloat(cs.borderTopLeftRadius) || 0;
      const bg = cs.backgroundColor;
      const opaque = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
      if (radius >= 4 || opaque) best = node; // outermost styled box
      node = node.parentElement;
    }
    return best || (scroll && scroll.parentElement) || dialog;
  }

  // Native geometry, taken ONCE per card before any inline style of ours lands
  // on it. `below` is the space between the list's bottom and the card's bottom
  // (footer/padding, usually ~0) that a grown list must keep leaving free.
  function measureBase(card, scroll) {
    const cr = card.getBoundingClientRect();
    const sr = scroll.getBoundingClientRect();
    // Feature 2/7 insert their panel synchronously on the same mutation batch
    // we scan on, so our own boxes may already sit above the list — subtract
    // them so cardH is Instagram's geometry.
    return {
      cardW: cr.width,
      cardH: Math.max(0, cr.height - injectedAbove(card, sr)),
      scrollH: sr.height,
      below: Math.max(0, cr.bottom - sr.bottom),
    };
  }

  // Remember what Instagram had inline for the properties we may overwrite, so
  // rollback/reset can put THEIRS back (react-window keeps its list height as an
  // inline style, and React won't re-write it just because we removed it).
  function snapshotOrig(el, props) {
    if (origByEl.has(el)) return;
    const snap = {};
    for (const p of props) {
      snap[p] = { value: el.style.getPropertyValue(p), priority: el.style.getPropertyPriority(p) };
    }
    origByEl.set(el, snap);
  }

  // ---- idempotent inline-style ownership -----------------------------------
  // rec.applied maps "card:width" / "scroll:height" … → the exact string we last
  // set, so re-scans write nothing when the DOM already holds our value, and
  // removal touches a property only while it still holds OUR value (if React
  // has since re-set it, it's theirs again and we leave it alone).

  function own(rec, which, el, prop, value, important = true) {
    rec.applied.set(which + ":" + prop, value);
    const cur = el.style.getPropertyValue(prop);
    if (cur === value && (!important || el.style.getPropertyPriority(prop) === "important")) {
      return false;
    }
    el.style.setProperty(prop, value, important ? "important" : "");
    return true;
  }

  function disown(rec, which, el, prop) {
    const key = which + ":" + prop;
    const ours = rec.applied.get(key);
    if (ours == null) return false;
    rec.applied.delete(key);
    if (el.style.getPropertyValue(prop) !== ours) return false; // no longer ours
    const orig = (origByEl.get(el) || {})[prop];
    if (orig && orig.value) el.style.setProperty(prop, orig.value, orig.priority);
    else el.style.removeProperty(prop);
    return true;
  }

  // ---- target size ---------------------------------------------------------
  // null on an axis = "leave Instagram's own size" (no inline width/height).
  function targetSize() {
    let w = null;
    let h = null;
    if (RESIZABLE && isNum(userSize.w)) w = userSize.w;
    else if (cfg.BIGGER_MODALS) w = cfg.MODAL_WIDTH_PX;
    if (RESIZABLE && listMode !== "none" && isNum(userSize.h) && !userSize.hBlocked) {
      h = userSize.h;
    }
    return { w: w == null ? null : clampW(w), h: h == null ? null : clampH(h) };
  }

  // Nudge any AutoSizer / resize-driven layout to recompute. Coalesced to one
  // per frame, with a loop breaker: if something on the page answered every
  // resize by rewriting the styles we just set (we re-set → resize → …) we stop
  // feeding it. Drags are exempt — they legitimately change size every frame.
  let resizeQueued = false;
  let resizeWindowStart = 0;
  let resizeCount = 0;
  function dispatchResize() {
    if (resizeQueued) return;
    const now = performance.now();
    if (now - resizeWindowStart > 1000) {
      resizeWindowStart = now;
      resizeCount = 0;
    }
    if (++resizeCount > 20 && !drag) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      window.dispatchEvent(new Event("resize"));
    });
  }

  // ---- layout --------------------------------------------------------------

  // IDEMPOTENT: safe to run on every scan (and it does run on every scan for a
  // sized dialog — that is what restores anything React stripped, including
  // the handle layer if the card's children were re-rendered).
  function applyLayout(rec) {
    const { card, scroll } = rec;
    if (!card.isConnected) return;
    let changed = false;

    if (!card.classList.contains("bwi-big-card")) card.classList.add("bwi-big-card");
    if (scroll.isConnected && !scroll.classList.contains("bwi-big-scroll")) {
      scroll.classList.add("bwi-big-scroll");
    }

    if (RESIZABLE) {
      if (!card.classList.contains("bwi-resizable")) card.classList.add("bwi-resizable");
      if (listMode === "none" && !card.classList.contains("bwi-resize--width-only")) {
        card.classList.add("bwi-resize--width-only");
      }
      if (rec.layer && rec.layer.parentElement !== card) card.appendChild(rec.layer);
      // The handle layer is position:absolute; inset:0 — it needs the card to be
      // its containing block. Only touch position if Instagram left it static.
      if (getComputedStyle(card).position === "static") {
        changed = own(rec, "card", card, "position", "relative") || changed;
      }
    }

    let { w, h } = targetSize();

    // We write border-box sizes (they come from getBoundingClientRect); a
    // content-box card would otherwise jump by its padding+border on the first
    // write. Only touched while we size the card at all.
    if ((w != null || h != null) && getComputedStyle(card).boxSizing === "content-box") {
      changed = own(rec, "card", card, "box-sizing", "border-box") || changed;
    } else if (w == null && h == null) {
      changed = disown(rec, "card", card, "box-sizing") || changed;
    }

    if (w != null) {
      changed = own(rec, "card", card, "width", w + "px") || changed;
      changed = own(rec, "card", card, "max-width", "95vw") || changed;
    } else {
      changed = disown(rec, "card", card, "width") || changed;
      changed = disown(rec, "card", card, "max-width") || changed;
    }

    if (RESIZABLE && rec.layer && scroll.isConnected) syncEastHandle(rec);

    if (h != null) {
      // Live geometry (needed by both the min-height clamp and detection).
      const crNow = card.getBoundingClientRect();
      const srNow = scroll.isConnected ? scroll.getBoundingClientRect() : null;

      // "fixed": the list is OUR box, so never let the card get shorter than
      // header + panel + a minimum list — a list hanging below the card would
      // be self-inflicted "clipping" (and rows unreachable). The user's stored
      // h is untouched; only what we render is floored.
      if (rec.mode === "fixed" && srNow) {
        const above = Math.max(0, srNow.top - crNow.top);
        h = Math.max(h, Math.round(above + MIN_LIST_PX + rec.base.below));
      }

      // Panel share: the injected panel (Feature 2/7 .bwi-list, default
      // max-height 240px) gets 40% of whatever height the user added beyond the
      // natural layout — natural = Instagram's header/search + the panel's own
      // chrome (measured live; 0 without a panel) + 240 + the native list as we
      // first found it. Every input is live or pre-touch, so it doesn't matter
      // whether the panel arrived before or after we first sized the card, and
      // a card dragged SHORTER takes 40% back from the panel. Floor 80px.
      if (srNow) {
        const above = Math.max(0, srNow.top - crNow.top);
        const inj = injectedAbove(card, srNow);
        const panelList = card.querySelector("[data-bwi] .bwi-list");
        const panelChrome = Math.max(0, inj - (panelList ? panelList.getBoundingClientRect().height : 0));
        const avail = h - (above - inj) - rec.base.below;
        const natural = panelChrome + 240 + rec.base.scrollH;
        const listMax = clamp(Math.round(240 + (avail - natural) * 0.4), 80, 100000);
        changed = own(rec, "card", card, "--bwi-list-max", listMax + "px", false) || changed;
      }

      // Detection: remember the card + list heights from BEFORE our first
      // height write (the probe), and judge only once the card has actually
      // moved ≥24px away from it — a smooth drag adds a few px per frame, so
      // comparing against the previous frame would never reach a verdict.
      if (rec.mode == null && !rec.probe && srNow) {
        rec.probe = { cardH: crNow.height, scrollH: srNow.height };
      }
      changed = own(rec, "card", card, "height", h + "px") || changed;
      changed = own(rec, "card", card, "max-height", "95vh") || changed;
      if (rec.mode == null && rec.probe && !rec.detecting && Math.abs(h - rec.probe.cardH) >= 24) {
        rec.detecting = true;
        // Two frames: our resize dispatch below is itself rAF-coalesced, and an
        // AutoSizer-fed list only re-measures after it.
        requestAnimationFrame(() => requestAnimationFrame(() => detectMode(rec)));
      } else if (rec.mode === "fixed" && scroll.isConnected) {
        changed = syncListHeight(rec) || changed;
      }
    } else {
      rec.probe = null; // a later height sequence re-probes from the then-natural size
      changed = disown(rec, "card", card, "--bwi-list-max") || changed;
      changed = disown(rec, "card", card, "height") || changed;
      changed = disown(rec, "card", card, "max-height") || changed;
      changed = disown(rec, "scroll", scroll, "height") || changed;
      changed = disown(rec, "scroll", scroll, "max-height") || changed;
    }

    if (changed) dispatchResize();
  }

  // Height of our own top-level [data-bwi] boxes (Feature 2/7 panels) that sit
  // above the native list inside the card — i.e. how much of "above" is ours.
  function injectedAbove(card, sr) {
    let sum = 0;
    for (const el of card.querySelectorAll("[data-bwi]")) {
      if (el.parentElement && el.parentElement.closest("[data-bwi]")) continue;
      const r = el.getBoundingClientRect();
      if (r.height && r.bottom <= sr.top + 1) sum += r.height;
    }
    return sum;
  }

  // Two frames after the card moved ≥24px from the probe: did the list follow?
  function detectMode(rec) {
    rec.detecting = false;
    // React may have re-mounted the list under the same card in between; the
    // verdict belongs to whatever rec now owns that card (a fresh list is tall
    // already in "flex" layouts and still React's inline height in "fixed" ones,
    // so the old probe still discriminates correctly).
    const cur = recByCard.get(rec.card) || rec;
    cur.detecting = false;
    const probe = cur.probe || rec.probe;
    if (!probe) return;
    if (!cur.card.isConnected || !cur.scroll.isConnected) return; // a fresh dialog re-detects
    if (cur.applied.get("card:height") == null) return; // height dropped meanwhile; detect on the next one
    const dCard = cur.card.getBoundingClientRect().height - probe.cardH;
    if (Math.abs(dCard) < 8) {
      // The card didn't move: React/an ancestor pinned its height. Re-probe on
      // the next scan a few times, then accept that this modal can't change
      // height at all (→ width-only, like a failed verification).
      if ((cur.probeTries = (cur.probeTries || 0) + 1) >= PROBE_TRIES) rollback(cur, "card-locked");
      return;
    }
    const dScroll = cur.scroll.getBoundingClientRect().height - probe.scrollH;
    cur.mode = Math.abs(dScroll) > Math.abs(dCard) / 2 ? "flex" : "fixed";
    if (listMode !== "none") listMode = cur.mode; // informational; only "none" is binding
    cur.verifyTries = 0;
    cur.symptomStreak = 0;
    applyLayout(cur); // "fixed": now writes the list height
    scheduleVerify(cur); // one post-hoc check that the taller box really renders
  }

  // The east strip would sit on top of a classic (Windows-style) vertical
  // scrollbar of the native list — grabbing the scrollbar would resize instead.
  // When one is present, shorten the strip to the header/search zone above the
  // list (the corners and the whole west edge still resize). Overlay
  // scrollbars report zero width and keep the full strip. Idempotent.
  function syncEastHandle(rec) {
    const east = rec.layer.querySelector(".bwi-resize-handle--e");
    if (!east) return;
    const barW = rec.scroll.offsetWidth - rec.scroll.clientWidth;
    let want = "";
    if (barW >= 4) {
      const top = rec.scroll.getBoundingClientRect().top - rec.card.getBoundingClientRect().top;
      want = Math.max(0, Math.round(top) - 14) + "px";
    }
    if (east.style.height !== want) {
      east.style.height = want;
      east.style.bottom = want ? "auto" : "";
    }
  }

  // "fixed" mode: make the list fill the card below whatever sits above it
  // (header, search box, our injected panel — measured live, so a panel that
  // appears/collapses later is absorbed on the next scan) and above `below`.
  function syncListHeight(rec) {
    const cr = rec.card.getBoundingClientRect();
    const sr = rec.scroll.getBoundingClientRect();
    const above = Math.max(0, sr.top - cr.top);
    const listH = Math.max(MIN_LIST_PX, Math.round(cr.height - above - rec.base.below));
    // 1px hysteresis so a layout that rounds differently each frame can't
    // ping-pong the observer — but only while the DOM still holds OUR value
    // (if React just rewrote it, it must be re-applied whatever the delta).
    const ours = rec.applied.get("scroll:height");
    const prev = parseInt(ours || "", 10);
    if (
      isNum(prev) &&
      Math.abs(prev - listH) <= 1 &&
      rec.scroll.style.getPropertyValue("height") === ours &&
      rec.scroll.style.getPropertyPriority("height") === "important"
    ) {
      return false;
    }
    let changed = own(rec, "scroll", rec.scroll, "height", listH + "px");
    changed = own(rec, "scroll", rec.scroll, "max-height", "none") || changed;
    return changed;
  }

  function scheduleVerify(rec, delay = VERIFY_DELAY_MS) {
    clearTimeout(rec.verifyTimer);
    rec.verifyTimer = setTimeout(() => {
      rec.verifyTimer = 0;
      verify(rec);
    }, delay);
  }

  // Did the native list actually render into the taller box? Symptoms:
  //  (i)  blank/windowing — the list's content box reaches (or passes) the
  //       bottom of the grown container, yet no native row is mounted at all
  //       ("blank", after a few retries for late-arriving rows) or the
  //       bottom-most mounted row ends far above the bottom ("windowing": a
  //       virtualizer with a fixed viewport height mounted rows only for its
  //       old size). A genuinely short/lazy list whose content simply ends
  //       higher up is NOT a symptom — its content box ends there too.
  //  (ii) clipping — hit-testing just inside the box's bottom edge lands on
  //       something that is neither the list nor our own UI (an ancestor clips
  //       the grown list → its bottom rows are unreachable). A stacked dialog
  //       (Instagram's options/confirm sheet) or a fixed toast bar covering the
  //       point is transient, not clipping: judge again later, bounded.
  // A symptom must hold on two consecutive checks before the (sticky) rollback
  // to width-only. Also catches a "flex" verdict that didn't hold (list stayed
  // short while the card grew) and re-runs as "fixed" once before judging.
  function verify(rec) {
    rec.verifyTimer = 0;
    if (drag || rec.detecting || listMode === "none") return;
    const { card, scroll } = rec;
    if (!card.isConnected || !scroll.isConnected) return;
    // A hidden tab pauses rAF/ResizeObserver-driven virtualizers — judging
    // there would fault a list that simply hasn't had a chance to render.
    if (document.hidden) {
      if (rec.verifyTries++ < 3) scheduleVerify(rec, 700);
      return;
    }
    if (rec.applied.get("card:height") == null) return; // no height in play
    if (rec.mode !== "fixed" && rec.mode !== "flex") return;

    const cr = card.getBoundingClientRect();
    const sr = scroll.getBoundingClientRect();
    if (sr.height < 40 || sr.width < 40) return; // not laid out; nothing to judge

    if (rec.mode === "flex" && !rec.reflexed && cr.bottom - sr.bottom > rec.base.below + 24) {
      rec.reflexed = true;
      rec.mode = "fixed";
      if (listMode !== "none") listMode = "fixed";
      applyLayout(rec);
      scheduleVerify(rec);
      return;
    }
    // Our own list box hanging below the card would be self-inflicted (the
    // fixed-mode floor in applyLayout prevents it, but never judge it).
    if (sr.bottom > cr.bottom + 2) return;

    let why = null;
    let unsure = false;
    let maxRowBottom = -Infinity;
    let maxAnyBottom = -Infinity;
    let maxAnyEl = null;
    let anyRow = null;
    for (const el of scroll.querySelectorAll("*")) {
      if (el.closest("[data-bwi]")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (r.bottom > maxAnyBottom) {
        maxAnyBottom = r.bottom;
        maxAnyEl = el;
      }
      if (el.tagName === "A") {
        const href = el.getAttribute("href") || "";
        if (href.startsWith("/") || href.startsWith("https://www.instagram.com/")) {
          if (r.bottom > maxRowBottom) {
            maxRowBottom = r.bottom;
            anyRow = el;
          }
        }
      }
    }
    const contentReachesBottom =
      maxAnyBottom >= sr.bottom - VERIFY_TOLERANCE_PX ||
      scroll.scrollHeight > scroll.clientHeight + 8;
    if (contentReachesBottom) {
      if (maxRowBottom === -Infinity) {
        // Rows not mounted (yet?) — look again a few times, then it's blank.
        if (rec.verifyTries++ < 3) {
          scheduleVerify(rec);
          return;
        }
        why = "blank";
      } else if (maxRowBottom < sr.bottom - VERIFY_TOLERANCE_PX) {
        why = "windowing";
      }
    }
    // A virtualizer whose sizer is SHORTER than the grown box (small first
    // page) never trips the check above, yet still mounts rows only for its
    // old viewport: the element that reaches lowest is the rows' own container
    // and it ends far (≥150px, > any end-of-list spinner) below the last row.
    if (
      !why &&
      anyRow &&
      maxAnyEl &&
      maxAnyEl.contains(anyRow) &&
      maxAnyBottom - maxRowBottom >= 150
    ) {
      why = "windowing";
    }
    if (!why) {
      const el = document.elementFromPoint(sr.left + sr.width / 2, sr.bottom - 10);
      // null = point off-screen (can't judge). Our own UI (handles, toasts,
      // panels) never clips the list, so it doesn't count. Only something
      // INSIDE our dialog can be clipping the list (a clipping ancestor lives
      // there); a hit outside it — a stacked options/confirm sheet, its
      // backdrop, a fixed banner/toast — is transient: judge again later.
      if (el && !scroll.contains(el) && !el.closest("[data-bwi], #bwi-toast-host")) {
        if (!rec.dialog.contains(el)) unsure = true;
        else why = "clipping";
      }
    }
    if (unsure) {
      if (rec.verifyTries++ < 3) scheduleVerify(rec, 700);
      return;
    }
    if (why) {
      rec.symptomStreak = (rec.symptomStreak || 0) + 1;
      if (rec.symptomStreak < 2) {
        scheduleVerify(rec, 500); // must hold twice in a row
        return;
      }
      rollback(rec, why);
    } else {
      rec.symptomStreak = 0;
      rec.verifyTries = 0;
    }
  }

  function rollback(rec, why) {
    listMode = "none";
    console.info(
      "[Socialfix] modal resize: Instagram's list didn't render into the taller box (" +
        why +
        ") — heights rolled back, width-only resize for this page session."
    );
    userSize.hBlocked = true; // remembered but not re-applied next load; a new drag retries
    userTouched = true;
    if (drag) {
      // Verdict landed mid-drag (card-locked probes): finish it width-only so
      // the remaining frames can't un-block the height again.
      drag.widthOnly = true;
      document.body.dataset.bwiCursor = "ew";
    }
    persistUserSize();
    for (const r of liveRecs) applyLayout(r); // drops heights, adds the width-only class
    if (!toastedWidthOnly) {
      toastedWidthOnly = true;
      ui.toast("Instagram's list can't be made taller here — width-only resize");
    }
  }

  // ---- persistence ---------------------------------------------------------

  function persistUserSize() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      const val = {};
      if (isNum(userSize.w)) val.w = userSize.w;
      if (isNum(userSize.h)) val.h = userSize.h;
      if (isNum(userSize.h) && userSize.hBlocked) val.hBlocked = true;
      storage(() =>
        Object.keys(val).length
          ? chrome.storage.local.set({ [SIZE_KEY]: val })
          : chrome.storage.local.remove(SIZE_KEY)
      );
    }, SAVE_DEBOUNCE_MS);
  }

  function loadUserSize() {
    storage(() =>
      chrome.storage.local.get(SIZE_KEY).then((r) => {
        if (userTouched) return;
        const v = r && r[SIZE_KEY];
        if (!v || typeof v !== "object") return;
        if (isNum(v.w)) userSize.w = v.w;
        if (isNum(v.h)) userSize.h = v.h;
        userSize.hBlocked = !!v.hBlocked;
        schedule();
      })
    );
  }

  // Double-click on a handle: forget the user size, drop every inline style we
  // own on card + scroll (the handle layer stays), let applyLayout re-apply only
  // the config default (BIGGER_MODALS width, if on).
  function resetSize() {
    const now = performance.now();
    if (now - lastResetAt < 500) return; // dblclick + double-press both fire
    lastResetAt = now;
    lastPress = null;
    userSize = { w: null, h: null, hBlocked: false };
    userTouched = true;
    clearTimeout(saveTimer);
    saveTimer = 0;
    storage(() => chrome.storage.local.remove(SIZE_KEY));
    for (const rec of liveRecs) {
      if (!rec.card.isConnected) continue;
      for (const p of RESET_CARD_PROPS) disown(rec, "card", rec.card, p);
      for (const p of SCROLL_PROPS) disown(rec, "scroll", rec.scroll, p);
      if (listMode !== "none") rec.card.classList.remove("bwi-resize--width-only");
      applyLayout(rec);
    }
    dispatchResize();
    ui.toast("Modal size reset");
  }

  // ---- handle layer + drag -------------------------------------------------

  function buildLayer() {
    const layer = document.createElement("div");
    layer.className = "bwi-resize-layer";
    layer.setAttribute("data-bwi", "resize");
    for (const dir of DIRS) {
      const h = document.createElement("div");
      h.className = "bwi-resize-handle bwi-resize-handle--" + dir;
      h.setAttribute("data-bwi", "resize");
      h.dataset.dir = dir;
      h.addEventListener("pointerdown", onPointerDown);
      h.addEventListener("dblclick", onHandleDblClick);
      layer.appendChild(h);
    }
    return layer;
  }

  function cursorFor(dir, widthOnly) {
    if (widthOnly) return "ew";
    if (dir === "n" || dir === "s") return "ns";
    if (dir === "e" || dir === "w") return "ew";
    if (dir === "ne" || dir === "sw") return "nesw";
    return "nwse";
  }

  // Instagram centers the card in a fixed overlay; whether that overlay spans
  // innerWidth or clientWidth (scrollbar) we can't tell, so accept either.
  function nearCenter(c, inner, client) {
    return (
      Math.abs(c - inner / 2) < CENTER_TOLERANCE_PX ||
      Math.abs(c - client / 2) < CENTER_TOLERANCE_PX
    );
  }

  function onPointerDown(e) {
    if (e.button !== 0 || e.isPrimary === false) return;
    const handle = e.currentTarget;
    const layer = handle.parentElement;
    const card = layer && layer.parentElement;
    const rec = card && recByCard.get(card);
    if (!rec || drag) return;
    e.preventDefault();
    e.stopPropagation();

    // Double-press on the same handle with no drag in between = reset. Kept
    // alongside the dblclick listener because a canceled pointerdown may or may
    // not still yield a dblclick depending on the browser.
    const now = performance.now();
    const lp = lastPress;
    lastPress = { handle, t: now, x: e.clientX, y: e.clientY };
    if (
      lp &&
      lp.handle === handle &&
      now - lp.t < 400 &&
      Math.hypot(e.clientX - lp.x, e.clientY - lp.y) < 4
    ) {
      resetSize();
      return;
    }

    try {
      handle.setPointerCapture(e.pointerId);
    } catch (_) {}
    const cr = card.getBoundingClientRect();
    const dir = handle.dataset.dir || "se";
    const widthOnly = listMode === "none" || card.classList.contains("bwi-resize--width-only");
    const docEl = document.documentElement;
    drag = {
      rec,
      handle,
      dir,
      widthOnly,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      startW: cr.width,
      startH: cr.height,
      // A centered card grows on BOTH sides, so the dragged edge only tracks the
      // pointer if the size changes by twice the pointer delta.
      centeredX: nearCenter(cr.left + cr.width / 2, window.innerWidth, docEl.clientWidth),
      centeredY: nearCenter(cr.top + cr.height / 2, window.innerHeight, docEl.clientHeight),
      raf: 0,
      moved: false,
    };
    clearTimeout(rec.verifyTimer);
    rec.verifyTimer = 0;
    card.classList.add("bwi-resizing");
    document.body.classList.add("bwi-resizing");
    document.body.dataset.bwiCursor = cursorFor(dir, widthOnly);
    // Capture-phase window listeners: they see the captured events on the
    // handle AND, if capture failed, events targeted anywhere on the page.
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", endDrag, true);
    window.addEventListener("pointercancel", endDrag, true);
    window.addEventListener("lostpointercapture", endDrag, true);
    // Alt-tab / OS focus steal mid-drag: no pointerup ever arrives, so end the
    // drag ourselves instead of leaving the page-wide cursor + user-select and
    // a modal that follows the mouse on return.
    window.addEventListener("blur", endDrag); // bubble phase: only the window's own blur
    document.addEventListener("visibilitychange", onVisibilityChange, true);
  }

  function onVisibilityChange() {
    if (document.hidden) endDrag();
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    if (!drag.raf) drag.raf = requestAnimationFrame(applyDrag);
  }

  function applyDrag() {
    const d = drag;
    if (!d) return;
    d.raf = 0;
    const dx = d.lastX - d.startX;
    const dy = d.lastY - d.startY;
    if (!dx && !dy) return;
    const fx = d.centeredX ? 2 : 1;
    const fy = d.centeredY ? 2 : 1;
    let w = null;
    let h = null;
    if (d.dir.includes("e")) w = d.startW + dx * fx;
    else if (d.dir.includes("w")) w = d.startW - dx * fx;
    if (!d.widthOnly && listMode !== "none") {
      if (d.dir.includes("s")) h = d.startH + dy * fy;
      else if (d.dir.includes("n")) h = d.startH - dy * fy;
    }
    if (w == null && h == null) return;
    if (w != null) userSize.w = clampW(w);
    if (h != null) {
      userSize.h = clampH(h);
      userSize.hBlocked = false; // a vertical drag is the user's explicit retry
    }
    userTouched = true;
    d.moved = true;
    applyLayout(d.rec); // renders live while dragging
  }

  function endDrag(e) {
    const d = drag;
    if (!d) return;
    if (e && typeof e.pointerId === "number" && e.pointerId !== d.pointerId) return;
    if (d.raf) {
      cancelAnimationFrame(d.raf);
      d.raf = 0;
      applyDrag(); // flush the last pointer position
    }
    drag = null;
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", endDrag, true);
    window.removeEventListener("pointercancel", endDrag, true);
    window.removeEventListener("lostpointercapture", endDrag, true);
    window.removeEventListener("blur", endDrag);
    document.removeEventListener("visibilitychange", onVisibilityChange, true);
    try {
      d.handle.releasePointerCapture(d.pointerId);
    } catch (_) {}
    d.rec.card.classList.remove("bwi-resizing");
    document.body.classList.remove("bwi-resizing");
    delete document.body.dataset.bwiCursor;
    resizeCount = 0;
    if (!d.moved) return;
    lastPress = null; // a real drag is never half of a double-press
    // The click that follows a drag has no legitimate consumer — and if pointer
    // capture had failed and the pointer was released over the backdrop, that
    // click could close the modal.
    swallowClickUntil = performance.now() + 300;
    persistUserSize();
    if (d.rec.mode === "fixed" || d.rec.mode === "flex") {
      d.rec.verifyTries = 0;
      scheduleVerify(d.rec);
    }
  }

  function onHandleDblClick(e) {
    e.preventDefault();
    e.stopPropagation();
    resetSize();
  }

  if (RESIZABLE) {
    window.addEventListener(
      "click",
      (e) => {
        if (!swallowClickUntil) return;
        if (performance.now() < swallowClickUntil) {
          e.stopPropagation();
          e.preventDefault();
        }
        swallowClickUntil = 0;
      },
      true
    );
  }

  // ---- per-dialog wiring ---------------------------------------------------

  function ensureSized(dialog) {
    const rec = sized.get(dialog);
    if (rec && rec.card.isConnected && rec.scroll.isConnected) {
      applyLayout(rec); // cheap when nothing changed
      return;
    }
    if (rec) liveRecs.delete(rec);
    const until = cooldown.get(dialog);
    if (until && performance.now() < until) return;
    if (!isListDialog(dialog)) {
      cooldown.set(dialog, performance.now() + 250);
      return;
    }
    const scroll = ui.findScrollContainer(dialog);
    if (!scroll) {
      cooldown.set(dialog, performance.now() + 200); // rows not mounted yet; try again shortly
      return;
    }
    const card = findCard(dialog, scroll);
    if (!card) return;

    snapshotOrig(card, CARD_PROPS);
    snapshotOrig(scroll, SCROLL_PROPS);
    let base = baseByCard.get(card);
    if (!base) {
      base = measureBase(card, scroll);
      baseByCard.set(card, base);
    }
    // Same card seen before (React swapped the list or the dialog wrapper)?
    // Keep its layer, mode and card-level ownership; scroll ownership is stale.
    const prev = recByCard.get(card);
    if (prev) {
      clearTimeout(prev.verifyTimer);
      liveRecs.delete(prev);
      for (const k of Array.from(prev.applied.keys())) {
        if (k.startsWith("scroll:")) prev.applied.delete(k);
      }
    }
    const next = {
      dialog,
      card,
      scroll,
      base,
      layer: prev && prev.layer ? prev.layer : RESIZABLE ? buildLayer() : null,
      mode: prev ? prev.mode : null, // null | "flex" | "fixed"
      probe: prev ? prev.probe : null, // {cardH, scrollH} from before our first height write
      detecting: prev ? prev.detecting : false,
      applied: prev ? prev.applied : new Map(),
      verifyTimer: 0,
      verifyTries: 0,
      symptomStreak: 0,
      probeTries: prev ? prev.probeTries : 0,
      reflexed: prev ? prev.reflexed : false,
    };
    sized.set(dialog, next);
    recByCard.set(card, next);
    liveRecs.add(next);
    applyLayout(next);
    // A re-mounted list under an already-heightened card gets its own check.
    if (prev && next.mode && next.applied.get("card:height") != null) scheduleVerify(next);
  }

  // Coalesce mutation bursts into one pass per frame.
  let scheduled = false;
  function scan() {
    scheduled = false;
    for (const rec of liveRecs) {
      if (!rec.card.isConnected) {
        clearTimeout(rec.verifyTimer);
        liveRecs.delete(rec);
      }
    }
    for (const d of ui.getDialogs()) ensureSized(d);
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  }

  // ---- debug / test surface ------------------------------------------------

  function stateFor(el) {
    let rec = (el && (sized.get(el) || recByCard.get(el))) || null;
    if (!rec && el && el.contains) {
      for (const r of liveRecs) {
        if (el.contains(r.card)) {
          rec = r;
          break;
        }
      }
    }
    return {
      mode: rec ? rec.mode : null,
      listMode,
      userSize: { w: userSize.w, h: userSize.h, hBlocked: !!userSize.hBlocked },
      base: rec ? rec.base : null,
      applied: rec ? Object.fromEntries(rec.applied) : null,
    };
  }
  BWI.modalResize = { stateFor, reset: resetSize, applyAll: scan };

  // ---- boot ----------------------------------------------------------------

  // style: React strips/rewrites inline styles → re-apply idempotently.
  // class: the injected panel collapses via a class flip, which changes how much
  // sits above the list ("fixed" mode re-measures that on the next scan).
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class"],
  });
  window.addEventListener("resize", schedule); // re-clamp + re-apply (our own dispatches included)
  if (RESIZABLE) loadUserSize();
  schedule(); // catch a modal already open on load
})();
