// Better Web Insta — Feature 6: edit bio links from the web Edit Profile page.
// Instagram's desktop web /accounts/edit/ doesn't expose the multi-link bio
// manager (up to 5 links, each with an optional title) — it's mobile-only. This
// injects a non-destructive bwi- panel into that page to add / edit / remove /
// reorder those links, then saves them through api.setBioLinks (the private web
// API, same same-origin credentialed path as every other write). It's a single
// low-frequency write per save, so it does NOT use queue.js — DRY_RUN is the
// only relevant safety knob. Closest in spirit to Feature 4's page toolbar:
// module-scope state survives Instagram's React re-renders, and the panel
// re-injects itself if a re-render tears it out.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});
  const cfg = BWI.config;
  const api = BWI.api;
  const ui = BWI.ui;
  const L = cfg.LABELS;

  if (!cfg.EDIT_BIO_LINKS) return;

  // State lives at module scope so it survives React replacing our panel node.
  let links = []; // [{ url, title, link_id }]
  let loaded = false;
  let loading = false;
  let loadError = false;
  let saving = false;

  let panel = null;
  let els = null; // { list, addBtn, saveBtn, status }
  let confirmPending = false;
  let confirmTimer = null;

  function isEditPath() {
    return location.pathname.toLowerCase().startsWith("/accounts/edit");
  }

  // Anchor the panel just above Instagram's own edit form (located via its
  // Submit button — never by CSS class), falling back to the top of <main>.
  function findAnchor() {
    const main = document.querySelector("main");
    if (!main) return null;
    const submit = ui.findButtonByText(main, L.editProfileSubmit);
    const form = submit ? submit.closest("form") : main.querySelector("form");
    return form || main;
  }

  // ---- Panel ---------------------------------------------------------------

  function buildPanel() {
    const root = document.createElement("div");
    root.className = "bwi-section bwi-biolinks";
    root.setAttribute("data-bwi", "biolinks");

    const header = document.createElement("div");
    header.className = "bwi-section__header";
    const title = document.createElement("div");
    title.className = "bwi-section__title";
    title.textContent = "Bio links";
    header.appendChild(title);
    root.appendChild(header);

    const hint = document.createElement("div");
    hint.className = "bwi-biolinks__hint";
    hint.textContent = `Add, edit, reorder or remove the links shown in your bio (up to ${cfg.MAX_BIO_LINKS}).`;
    root.appendChild(hint);

    const list = document.createElement("div");
    list.className = "bwi-biolinks__list";
    root.appendChild(list);

    const actions = document.createElement("div");
    actions.className = "bwi-section__actions bwi-biolinks__actions";

    const status = document.createElement("span");
    status.className = "bwi-biolinks__status";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "bwi-btn bwi-btn--ghost";
    addBtn.textContent = "Add link";
    addBtn.addEventListener("click", onAdd);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "bwi-btn bwi-btn--primary";
    saveBtn.textContent = "Save links";
    saveBtn.addEventListener("click", onSave);

    actions.appendChild(status);
    actions.appendChild(addBtn);
    actions.appendChild(saveBtn);
    root.appendChild(actions);

    els = { list, addBtn, saveBtn, status };
    return root;
  }

  function ensurePanel() {
    if (panel && document.contains(panel)) return;
    const anchor = findAnchor();
    if (!anchor) return; // try again on the next mutation
    panel = buildPanel();
    if (anchor.tagName === "FORM") anchor.parentNode.insertBefore(panel, anchor);
    else anchor.prepend(panel);
    render();
    if (!loaded && !loading) loadLinks();
  }

  function loadLinks() {
    loading = true;
    loadError = false;
    render();
    api
      .getBioLinks()
      .then((arr) => {
        links = arr || [];
        loaded = true;
        loading = false;
        render();
      })
      .catch((err) => {
        loading = false;
        loadError = true;
        render();
        console.warn("[BWI] getBioLinks failed", err);
      });
  }

  // ---- Rendering -----------------------------------------------------------

  function render() {
    if (!els) return;
    const { list } = els;
    list.innerHTML = "";

    if (loading) {
      list.appendChild(message("bwi-loading", "Loading your links…"));
    } else if (loadError) {
      list.appendChild(
        message(
          "bwi-biolinks__empty",
          "Couldn't load your links. Reload the page to try again."
        )
      );
    } else if (links.length === 0) {
      list.appendChild(
        message("bwi-biolinks__empty", "No bio links yet — click “Add link”.")
      );
    } else {
      links.forEach((link, i) => list.appendChild(buildRow(link, i)));
    }

    els.addBtn.disabled =
      loading || saving || links.length >= cfg.MAX_BIO_LINKS;
    els.saveBtn.disabled = loading || saving;
    if (!confirmPending) {
      els.saveBtn.textContent = saving ? "Saving…" : "Save links";
    }
    syncStatus();
  }

  function message(cls, txt) {
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = txt;
    return el;
  }

  function buildRow(link, i) {
    const row = document.createElement("div");
    row.className = "bwi-biolinks__row";

    const fields = document.createElement("div");
    fields.className = "bwi-biolinks__fields";

    const url = document.createElement("input");
    url.type = "text";
    url.className = "bwi-input";
    url.placeholder = "URL (e.g. example.com)";
    url.value = link.url || "";
    url.addEventListener("input", () => {
      link.url = url.value;
      syncStatus();
    });

    const title = document.createElement("input");
    title.type = "text";
    title.className = "bwi-input";
    title.placeholder = "Title (optional)";
    title.value = link.title || "";
    title.addEventListener("input", () => {
      link.title = title.value;
    });

    fields.appendChild(url);
    fields.appendChild(title);

    const controls = document.createElement("div");
    controls.className = "bwi-biolinks__controls";

    const upBtn = iconBtn("↑", "Move up", () => move(i, -1));
    upBtn.disabled = i === 0;
    const downBtn = iconBtn("↓", "Move down", () => move(i, 1));
    downBtn.disabled = i === links.length - 1;
    const delBtn = iconBtn("✕", "Remove", () => remove(i));
    delBtn.classList.add("bwi-biolinks__del");

    controls.appendChild(upBtn);
    controls.appendChild(downBtn);
    controls.appendChild(delBtn);

    row.appendChild(fields);
    row.appendChild(controls);
    return row;
  }

  function iconBtn(glyph, tip, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "bwi-iconbtn";
    b.textContent = glyph;
    b.title = tip;
    b.addEventListener("click", onClick);
    return b;
  }

  function syncStatus() {
    if (!els) return;
    const n = links.filter((l) => (l.url || "").trim()).length;
    els.status.textContent = `${n}/${cfg.MAX_BIO_LINKS}`;
  }

  // ---- Operations ----------------------------------------------------------

  function onAdd() {
    if (links.length >= cfg.MAX_BIO_LINKS) return;
    links.push({ url: "", title: "", link_id: null });
    resetConfirm();
    render();
  }

  function remove(i) {
    links.splice(i, 1);
    resetConfirm();
    render();
  }

  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= links.length) return;
    const tmp = links[i];
    links[i] = links[j];
    links[j] = tmp;
    resetConfirm();
    render();
  }

  // ---- Save ----------------------------------------------------------------

  function normalizeUrl(u) {
    const s = (u || "").trim();
    if (!s) return "";
    return /^https?:\/\//i.test(s) ? s : "https://" + s;
  }

  function isLikelyUrl(u) {
    try {
      const x = new URL(u);
      return !!x.hostname && x.hostname.includes(".");
    } catch (_) {
      return false;
    }
  }

  function resetConfirm() {
    confirmPending = false;
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  }

  function onSave() {
    if (saving) return;

    // Build the cleaned payload (skip blank rows, normalize + validate URLs).
    const cleaned = [];
    let invalid = 0;
    for (const l of links) {
      const raw = (l.url || "").trim();
      if (!raw) continue;
      const url = normalizeUrl(raw);
      if (!isLikelyUrl(url)) {
        invalid++;
        continue;
      }
      cleaned.push({ url, title: (l.title || "").trim(), link_id: l.link_id || null });
    }
    if (invalid) ui.toast(`Skipped ${invalid} link(s) that don't look like URLs`);

    // Two-click inline confirm (never window.confirm — it blocks the page).
    if (!confirmPending) {
      confirmPending = true;
      els.saveBtn.textContent = `Confirm save (${cleaned.length})?`;
      confirmTimer = setTimeout(() => {
        resetConfirm();
        render();
      }, 4000);
      return;
    }
    resetConfirm();

    if (cfg.DRY_RUN) ui.toast("DRY_RUN on — payload logged, nothing sent");

    saving = true;
    render();
    api
      .setBioLinks(cleaned)
      .then(() => {
        // Reflect the saved set back into our state (normalized URLs, blanks
        // dropped) so the panel matches what's now live.
        links = cleaned.map((l) => ({ ...l }));
        saving = false;
        render();
        ui.toast(
          cfg.DRY_RUN
            ? "DRY_RUN — links not actually changed"
            : "Bio links saved"
        );
      })
      .catch((err) => {
        saving = false;
        render();
        const status = err && err.status;
        if (status === 429) {
          ui.toast("Instagram rate-limited the request — try again later.");
        } else {
          ui.toast(`Couldn't save links${status ? ` (${status})` : ""}.`);
        }
        console.warn("[BWI] setBioLinks failed", err);
      });
  }

  // ---- Lifecycle -----------------------------------------------------------

  function maybeInject() {
    if (!isEditPath()) {
      teardown();
      return;
    }
    ensurePanel();
  }

  function teardown() {
    if (!panel) return;
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
    els = null;
    links = [];
    loaded = false;
    loading = false;
    loadError = false;
    saving = false;
    resetConfirm();
  }

  const observer = new MutationObserver(() => maybeInject());
  observer.observe(document.body, { childList: true, subtree: true });

  // Catch SPA navigations that don't immediately mutate <body>.
  window.addEventListener("popstate", maybeInject);

  maybeInject();
})();
