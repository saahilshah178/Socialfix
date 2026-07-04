// Better Web Insta — Feature 9 (PRD "Story creation tools").
// A self-contained enhanced-story composer: pick an image, choose fit/fill,
// draw freehand, and place text, then upload via the shared story-upload core.
// We deliberately DON'T fight Instagram's React composer — we provide our own
// canvas composer and post through the private API.
//
// Text and freehand drawing are burned into the raster before upload, so the
// story is a plain image (zero sticker-payload dependency). Interactive
// link/poll stickers were removed — the web configure endpoint silently drops
// them (mobile-app-only; see FEATURE_FEASIBILITY_REPORT.md §2.2). Mutating
// write → honors DRY_RUN + the shared story daily budget
// (cfg.STORY.DAILY_KEY / DAILY_CAP).
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const api = BWI.api;
  const ui = BWI.ui;
  const L = cfg.LABELS;

  if (!cfg.STORY_CREATE_TOOLS) return;

  const CW = cfg.STORY.CANVAS_W; // 1080
  const CH = cfg.STORY.CANVAS_H; // 1920
  const FONTS = ["Inter, -apple-system, sans-serif", "Georgia, serif", "Courier New, monospace", "Impact, sans-serif"];

  let launcher = null;
  let overlay = null;
  let stage = null; // the visual stage element (CSS-scaled 9:16)
  let baseCanvas = null; // 1080x1920 image layer
  let drawCanvas = null; // 1080x1920 freehand layer
  let stickerLayer = null; // holds draggable widgets
  let els = null;

  let baseImage = null; // loaded <img>
  let baseImageUrl = null; // object URL to revoke
  let fitMode = "fit";
  let drawing = false; // draw mode on/off
  let strokes = []; // [{color,size,points:[{x,y}]}] in canvas coords
  let curStroke = null;
  let busy = false;
  let confirmPending = false;
  let confirmTimer = null;

  // ---- launcher ------------------------------------------------------------

  function shouldShowLauncher() {
    const p = location.pathname.toLowerCase();
    if (p.startsWith("/stories/") || p.startsWith("/accounts/edit")) return false;
    return true;
  }

  function ensureLauncher() {
    if (overlay) {
      if (launcher) launcher.style.display = "none";
      return;
    }
    if (!shouldShowLauncher()) {
      if (launcher) launcher.remove();
      launcher = null;
      return;
    }
    if (launcher && document.contains(launcher)) {
      launcher.style.display = "";
      return;
    }
    launcher = document.createElement("button");
    launcher.className = "bwi-story-launch";
    launcher.type = "button";
    launcher.textContent = "＋ " + L.enhancedStory;
    launcher.addEventListener("click", openComposer);
    document.body.appendChild(launcher);
  }

  // ---- composer ------------------------------------------------------------

  function openComposer() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "bwi-story-overlay";

    // Stage (left).
    const stageWrap = document.createElement("div");
    stageWrap.className = "bwi-story-stagewrap";
    stage = document.createElement("div");
    stage.className = "bwi-story-stage";

    baseCanvas = document.createElement("canvas");
    baseCanvas.width = CW;
    baseCanvas.height = CH;
    baseCanvas.className = "bwi-story-base";

    drawCanvas = document.createElement("canvas");
    drawCanvas.width = CW;
    drawCanvas.height = CH;
    drawCanvas.className = "bwi-story-draw";

    stickerLayer = document.createElement("div");
    stickerLayer.className = "bwi-story-stickers";

    stage.appendChild(baseCanvas);
    stage.appendChild(drawCanvas);
    stage.appendChild(stickerLayer);
    stageWrap.appendChild(stage);

    // Toolbar (right).
    const toolbar = buildToolbar();

    overlay.appendChild(stageWrap);
    overlay.appendChild(toolbar);
    document.body.appendChild(overlay);

    wireDrawing();
    renderBase();
    if (launcher) launcher.style.display = "none";
  }

  function closeComposer() {
    resetConfirm();
    if (overlay) overlay.remove();
    overlay = null;
    stage = baseCanvas = drawCanvas = stickerLayer = els = null;
    baseImage = null;
    if (baseImageUrl) {
      URL.revokeObjectURL(baseImageUrl);
      baseImageUrl = null;
    }
    fitMode = "fit";
    drawing = false;
    strokes = [];
    curStroke = null;
    busy = false;
    ensureLauncher();
  }

  function buildToolbar() {
    const bar = document.createElement("div");
    bar.className = "bwi-story-toolbar";

    const title = document.createElement("div");
    title.className = "bwi-story-title";
    title.textContent = "Enhanced story";
    bar.appendChild(title);

    // Image picker.
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.className = "bwi-story-file";
    fileInput.addEventListener("change", onPickImage);
    bar.appendChild(labeled("Image", fileInput));

    // Fit / fill.
    const fitBtn = toolBtn("Fit", () => setFit("fit"));
    const fillBtn = toolBtn("Fill", () => setFit("fill"));
    fitBtn.classList.add("bwi-story-on");
    bar.appendChild(labeled("Media", rowOf([fitBtn, fillBtn])));

    // Draw controls.
    const drawBtn = toolBtn("Draw: off", toggleDraw);
    const drawColor = colorInput("#ffffff");
    const drawSize = rangeInput(2, 60, 12);
    const undoBtn = toolBtn("Undo", undoStroke);
    const eraseBtn = toolBtn("Clear draw", clearDraw);
    bar.appendChild(
      labeled("Draw", rowOf([drawBtn, drawColor, drawSize, undoBtn, eraseBtn]))
    );

    // Text adder (burned into the raster on export).
    const textBtn = toolBtn("Text", addTextWidget);
    bar.appendChild(labeled("Text", rowOf([textBtn])));

    // Actions.
    const postBtn = document.createElement("button");
    postBtn.className = "bwi-btn bwi-btn--primary bwi-story-post";
    postBtn.textContent = L.postStory;
    postBtn.addEventListener("click", () => onPost(postBtn));
    const closeBtn = document.createElement("button");
    closeBtn.className = "bwi-btn bwi-btn--ghost";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", closeComposer);
    const status = document.createElement("div");
    status.className = "bwi-story-status";
    bar.appendChild(rowOf([postBtn, closeBtn]));
    bar.appendChild(status);

    els = { fileInput, fitBtn, fillBtn, drawBtn, drawColor, drawSize, postBtn, status };
    return bar;
  }

  // small builders
  function labeled(labelText, node) {
    const wrap = document.createElement("div");
    wrap.className = "bwi-story-group";
    const lab = document.createElement("div");
    lab.className = "bwi-story-grouplabel";
    lab.textContent = labelText;
    wrap.appendChild(lab);
    wrap.appendChild(node);
    return wrap;
  }
  function rowOf(nodes) {
    const r = document.createElement("div");
    r.className = "bwi-story-row";
    nodes.forEach((n) => r.appendChild(n));
    return r;
  }
  function toolBtn(text, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "bwi-btn bwi-btn--ghost bwi-story-tool";
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }
  function colorInput(val) {
    const i = document.createElement("input");
    i.type = "color";
    i.value = val;
    i.className = "bwi-story-color";
    return i;
  }
  function rangeInput(min, max, val) {
    const i = document.createElement("input");
    i.type = "range";
    i.min = String(min);
    i.max = String(max);
    i.value = String(val);
    i.className = "bwi-story-range";
    return i;
  }

  // ---- base image ----------------------------------------------------------

  function onPickImage(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (baseImageUrl) URL.revokeObjectURL(baseImageUrl);
    baseImageUrl = URL.createObjectURL(file);
    ui.loadImage(baseImageUrl)
      .then((img) => {
        baseImage = img;
        renderBase();
      })
      .catch(() => ui.toast("Couldn't load that image"));
  }

  function setFit(mode) {
    fitMode = mode;
    if (els) {
      els.fitBtn.classList.toggle("bwi-story-on", mode === "fit");
      els.fillBtn.classList.toggle("bwi-story-on", mode === "fill");
    }
    renderBase();
  }

  function renderBase() {
    if (!baseCanvas) return;
    const ctx = baseCanvas.getContext("2d");
    ctx.clearRect(0, 0, CW, CH);
    if (baseImage) {
      const c = ui.renderStoryBase(baseImage, fitMode);
      ctx.drawImage(c, 0, 0);
    } else {
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, CW, CH);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "40px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Pick an image →", CW / 2, CH / 2);
    }
  }

  // ---- freehand drawing ----------------------------------------------------

  function toggleDraw() {
    drawing = !drawing;
    if (els) els.drawBtn.textContent = drawing ? "Draw: on" : "Draw: off";
    if (stage) stage.classList.toggle("bwi-story-drawing", drawing);
  }

  // Map a pointer event to canvas (1080x1920) coordinates.
  function toCanvasXY(e) {
    const r = drawCanvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * CW,
      y: ((e.clientY - r.top) / r.height) * CH,
    };
  }

  function wireDrawing() {
    drawCanvas.addEventListener("pointerdown", (e) => {
      if (!drawing) return;
      drawCanvas.setPointerCapture(e.pointerId);
      curStroke = {
        color: els.drawColor.value,
        size: parseInt(els.drawSize.value, 10) || 12,
        points: [toCanvasXY(e)],
      };
    });
    drawCanvas.addEventListener("pointermove", (e) => {
      if (!drawing || !curStroke) return;
      curStroke.points.push(toCanvasXY(e));
      redrawStrokes();
    });
    const end = () => {
      if (curStroke) {
        strokes.push(curStroke);
        curStroke = null;
        redrawStrokes();
      }
    };
    drawCanvas.addEventListener("pointerup", end);
    drawCanvas.addEventListener("pointercancel", end);
  }

  function redrawStrokes() {
    const ctx = drawCanvas.getContext("2d");
    ctx.clearRect(0, 0, CW, CH);
    const all = curStroke ? strokes.concat([curStroke]) : strokes;
    all.forEach((s) => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.size;
      ctx.lineJoin = ctx.lineCap = "round";
      ctx.beginPath();
      s.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    });
  }

  function undoStroke() {
    strokes.pop();
    redrawStrokes();
  }
  function clearDraw() {
    strokes = [];
    redrawStrokes();
  }

  // ---- sticker widgets -----------------------------------------------------

  function makeDraggable(el, handle) {
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      sx = e.clientX;
      sy = e.clientY;
      ox = el.offsetLeft;
      oy = el.offsetTop;
      const move = (ev) => {
        el.style.left = ox + (ev.clientX - sx) + "px";
        el.style.top = oy + (ev.clientY - sy) + "px";
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    });
  }

  function baseWidget(type) {
    const w = document.createElement("div");
    w.className = "bwi-story-widget bwi-story-widget--" + type;
    w.dataset.type = type;
    w.style.left = "20%";
    w.style.top = "40%";
    const handle = document.createElement("div");
    handle.className = "bwi-story-drag";
    handle.textContent = "⠿";
    const del = document.createElement("button");
    del.className = "bwi-story-wdel";
    del.textContent = "✕";
    del.addEventListener("click", () => w.remove());
    w.appendChild(handle);
    w.appendChild(del);
    makeDraggable(w, handle);
    stickerLayer.appendChild(w);
    return w;
  }

  function addTextWidget() {
    const w = baseWidget("text");
    const text = document.createElement("div");
    text.className = "bwi-story-text";
    text.contentEditable = "true";
    text.textContent = "Your text";
    const controls = document.createElement("div");
    controls.className = "bwi-story-wcontrols";
    const font = document.createElement("select");
    FONTS.forEach((f, i) => {
      const o = document.createElement("option");
      o.value = f;
      o.textContent = ["Sans", "Serif", "Mono", "Impact"][i] || f;
      font.appendChild(o);
    });
    const color = colorInput("#ffffff");
    const size = rangeInput(24, 160, 64);
    const apply = () => {
      text.style.fontFamily = font.value;
      text.style.color = color.value;
      text.style.fontSize = size.value + "px";
    };
    font.addEventListener("change", apply);
    color.addEventListener("input", apply);
    size.addEventListener("input", apply);
    controls.appendChild(font);
    controls.appendChild(color);
    controls.appendChild(size);
    w.appendChild(text);
    w.appendChild(controls);
    apply();
    w._read = () => ({
      kind: "text",
      text: text.textContent || "",
      color: color.value,
      family: font.value,
      sizePx: parseInt(size.value, 10) || 64,
      el: text,
    });
  }

  // Normalized center + size of a widget within the stage (0..1).
  function widgetGeom(el) {
    const s = stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      x: (r.left + r.width / 2 - s.left) / s.width,
      y: (r.top + r.height / 2 - s.top) / s.height,
      width: r.width / s.width,
      height: r.height / s.height,
    };
  }

  // ---- export + post -------------------------------------------------------

  function resetConfirm() {
    confirmPending = false;
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  }

  async function overDailyCap() {
    try {
      const used = await BWI.queueUtil.getDailyCount(cfg.STORY.DAILY_KEY);
      return used >= cfg.STORY.DAILY_CAP;
    } catch (_) {
      return false;
    }
  }

  // Flatten base + drawing + burned text into one JPEG blob. Everything is
  // rasterized — the posted story is a plain image, no sticker payload.
  async function composite() {
    const canvas = document.createElement("canvas");
    canvas.width = CW;
    canvas.height = CH;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(baseCanvas, 0, 0);
    ctx.drawImage(drawCanvas, 0, 0);

    const scaleX = CW / stage.getBoundingClientRect().width;

    const widgets = Array.from(stickerLayer.querySelectorAll(".bwi-story-widget"));
    for (const el of widgets) {
      const data = el._read && el._read();
      if (!data || data.kind !== "text") continue;
      const g = widgetGeom(el);
      // Burn the text into the raster at its position.
      const px = g.x * CW;
      const py = g.y * CH;
      ctx.save();
      ctx.fillStyle = data.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.round(data.sizePx * scaleX)}px ${data.family}`;
      const lines = data.text.split("\n");
      const lh = Math.round(data.sizePx * scaleX * 1.15);
      lines.forEach((ln, i) => {
        ctx.fillText(ln, px, py + (i - (lines.length - 1) / 2) * lh);
      });
      ctx.restore();
    }

    return await ui.canvasToJpegBlob(canvas, 0.9);
  }

  async function onPost(postBtn) {
    if (busy) return;
    if (!baseImage) {
      ui.toast("Pick an image first");
      return;
    }
    if (!confirmPending) {
      confirmPending = true;
      postBtn.textContent = "Confirm post?";
      confirmTimer = setTimeout(() => {
        resetConfirm();
        postBtn.textContent = L.postStory;
      }, 4000);
      return;
    }
    resetConfirm();

    if (await overDailyCap()) {
      ui.toast(`Daily story limit reached (${cfg.STORY.DAILY_CAP}). Try tomorrow.`);
      postBtn.textContent = L.postStory;
      return;
    }

    busy = true;
    postBtn.disabled = true;
    setStatus("Building…");
    try {
      const blob = await composite();
      setStatus("Uploading…");
      const uploadId = await api.ruploadPhoto(blob, { width: CW, height: CH });
      await api.configureToStory({ uploadId });
      if (!cfg.DRY_RUN) await BWI.queueUtil.bumpDailyCount(cfg.STORY.DAILY_KEY, 1);
      ui.toast(
        cfg.DRY_RUN ? "DRY_RUN — story logged, not sent" : "Story posted"
      );
      closeComposer();
    } catch (err) {
      console.warn("[BWI] story post failed", err);
      if (BWI.queueUtil.isActionBlock(err)) {
        ui.toast("Instagram action-blocked — wait a while before retrying.");
      } else {
        ui.toast(`Couldn't post story${err && err.status ? ` (${err.status})` : ""}.`);
      }
      setStatus("");
      postBtn.disabled = false;
      postBtn.textContent = L.postStory;
      busy = false;
    }
  }

  function setStatus(msg) {
    if (els && els.status) els.status.textContent = msg || "";
  }

  // ---- lifecycle -----------------------------------------------------------

  const observer = new MutationObserver(() => ensureLauncher());
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("popstate", ensureLauncher);
  ensureLauncher();
})();
