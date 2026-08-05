// Socialfix — shared DOM helpers + subsection rendering.
// All injected markup uses our own `bwi-` class names (styled in styles.css)
// so we never depend on Instagram's obfuscated classes.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});

  const text = (el) => (el && el.textContent ? el.textContent.trim() : "");

  // Initials avatar shown when a profile picture is missing or fails to load.
  // A colored circle with the username's initials reads as intentional (like
  // Gmail/Slack) instead of a broken-image icon, and never depends on the IG
  // image CDN — so the list always looks complete even if a pic won't load.
  function initialsAvatar(username) {
    const clean = String(username || "").replace(/[^A-Za-z0-9]/g, "");
    const initials = (clean.slice(0, 2) || "?").toUpperCase();
    // Deterministic hue from the username so each person keeps a stable color.
    let h = 0;
    for (let i = 0; i < String(username).length; i++) {
      h = (h * 31 + String(username).charCodeAt(i)) >>> 0;
    }
    const bg = `hsl(${h % 360}, 45%, 52%)`;
    return (
      "data:image/svg+xml;utf8," +
      encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44'>` +
          `<rect width='44' height='44' rx='22' fill='${bg}'/>` +
          `<text x='22' y='29' font-size='17' font-weight='600' ` +
          `font-family='Arial, Helvetica, sans-serif' fill='#fff' ` +
          `text-anchor='middle'>${initials}</text></svg>`
      )
    );
  }

  // Best-effort: reuse an avatar Instagram has ALREADY loaded for this username
  // in its native list rows (guaranteed-valid, no CDN/referrer dependency).
  // Only finds currently-mounted rows (the list is virtualized), so it's a
  // bonus, not the primary source.
  function nativeAvatarFor(username) {
    if (!username) return null;
    const links = document.querySelectorAll(`a[href="/${username}/"]`);
    for (const a of links) {
      if (a.closest("[data-bwi]")) continue; // skip our own injected rows
      let img = a.querySelector("img");
      let p = a;
      for (let i = 0; i < 4 && !img && p; i++) {
        p = p.parentElement;
        if (p) img = p.querySelector("img");
      }
      if (img && img.src && !img.src.startsWith("data:")) return img.src;
    }
    return null;
  }

  function getDialogs() {
    return Array.from(document.querySelectorAll('[role="dialog"]'));
  }

  // Does `dialog` show `label` ("Following"/"Followers") as its modal title?
  // The title lives in the header — not inside a row's action button (which
  // also reads "Following") nor inside a row link — so we exclude those.
  function dialogTitleIs(dialog, label) {
    const candidates = dialog.querySelectorAll("div, span, h1, h2, h3");
    for (const el of candidates) {
      if (text(el) !== label) continue;
      if (el.closest('button, [role="button"], a')) continue;
      return true;
    }
    return false;
  }

  // Find the scrollable list container inside a list dialog (the element that
  // actually scrolls the rows). Used to place our panel and to resize the modal.
  function findScrollContainer(dialog) {
    for (const el of dialog.querySelectorAll("*")) {
      // Skip our own injected scrollers (the subsection list) so we always
      // resolve Instagram's native list, not ours.
      if (el.closest("[data-bwi]")) continue;
      if (el.scrollHeight > el.clientHeight + 20) {
        const oy = getComputedStyle(el).overflowY;
        if (oy === "auto" || oy === "scroll") return el;
      }
    }
    return null;
  }

  // Insert `node` so it sits visually ABOVE the native list `container`, even if
  // Instagram's wrapper around the list stacks its children horizontally. We
  // climb from the scroll container while each parent lays its children out in a
  // row/grid (where a plain previous-sibling would land BESIDE the list, not
  // above it) and insert before the highest such child — i.e. the lowest level
  // that stacks vertically. Plain sibling insertion only (never re-parents a
  // React-managed node, which could crash Instagram's renderer).
  function insertAboveList(node, container) {
    let child = container;
    let parent = container.parentElement;
    let safety = 0;
    while (parent && safety++ < 12) {
      const cs = getComputedStyle(parent);
      const disp = cs.display;
      const horizontal =
        disp === "grid" ||
        ((disp === "flex" || disp === "inline-flex") &&
          /^row/.test(cs.flexDirection || "row")) ||
        disp === "inline" ||
        disp === "inline-block";
      if (!horizontal) {
        // This parent stacks vertically → inserting before `child` puts us above
        // the list. Stop climbing.
        parent.insertBefore(node, child);
        return node;
      }
      child = parent;
      parent = parent.parentElement;
    }
    // Fallback to the original behavior if we couldn't find a vertical stacker.
    container.parentNode.insertBefore(node, container);
    return node;
  }

  // Find a <button> (or [role="button"]) within `root` whose trimmed text
  // exactly matches `label`.
  function findButtonByText(root, label) {
    const buttons = root.querySelectorAll('button, [role="button"]');
    for (const b of buttons) {
      if (text(b) === label) return b;
    }
    return null;
  }

  // Toast: a brief floating message in the corner.
  function toast(message, ms = 2600) {
    let host = document.getElementById("bwi-toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "bwi-toast-host";
      document.body.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = "bwi-toast";
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => el.classList.add("bwi-toast--in"), 10);
    setTimeout(() => {
      el.classList.remove("bwi-toast--in");
      setTimeout(() => el.remove(), 300);
    }, ms);
  }

  // Layered avatar <img> that never shows a broken image:
  //   0) Instagram's profile_pic_url, loaded with the page's DEFAULT referrer
  //      (instagram.com origin) — the same context IG itself uses, so these
  //      normally load. (The old code forced no-referrer, which dropped the
  //      origin the CDN expects and is the likely cause of blank avatars.)
  //   1) reuse an avatar IG already rendered natively for this user, if any
  //   2) a generated initials avatar (always works)
  function layeredAvatar(u) {
    const avatar = document.createElement("img");
    avatar.className = "bwi-row__avatar";
    avatar.alt = "";
    avatar.loading = "lazy";
    let stage = 0;
    avatar.addEventListener("error", () => {
      if (stage === 0) {
        stage = 1;
        const native = nativeAvatarFor(u.username);
        if (native) {
          avatar.src = native;
          return;
        }
      }
      if (stage <= 1) {
        stage = 2;
        avatar.src = initialsAvatar(u.username);
      }
    });
    if (u.profile_pic_url) {
      avatar.src = u.profile_pic_url;
    } else {
      stage = 2;
      avatar.src = initialsAvatar(u.username);
    }
    return avatar;
  }

  // Build a plain avatar + profile-link meta row (username, optional full name,
  // optional subtitle). No action button — the caller appends its own. Used by
  // renderListSubsection (Feature 7). Uses textContent so user-supplied strings
  // can't inject markup.
  function buildUserRow(u, opts = {}) {
    const row = document.createElement("div");
    row.className = "bwi-row";
    row.dataset.pk = u.pk;

    const meta = document.createElement("a");
    meta.className = "bwi-row__meta";
    meta.href = `/${u.username}/`;
    meta.target = "_blank";
    meta.rel = "noopener";
    const uname = document.createElement("span");
    uname.className = "bwi-row__username";
    uname.textContent = u.username;
    meta.appendChild(uname);
    if (u.full_name) {
      const name = document.createElement("span");
      name.className = "bwi-row__name";
      name.textContent = u.full_name;
      meta.appendChild(name);
    }
    if (opts.subtitle) {
      const sub = document.createElement("span");
      sub.className = "bwi-row__name";
      sub.textContent = opts.subtitle;
      meta.appendChild(sub);
    }

    row.appendChild(layeredAvatar(u));
    row.appendChild(meta);
    return row;
  }

  // A collapsible titled list of users with an optional per-row action button.
  // Read-only-friendly (Feature 7 "recently unfollowed you"): the caller passes
  // the full `users` array and, optionally, { rowActionLabel, onRowAction }.
  function renderListSubsection(titleText, users, opts = {}) {
    const root = document.createElement("div");
    root.className = "bwi-section";
    root.setAttribute("data-bwi", opts.dataKey || "listsubsection");

    const header = document.createElement("div");
    header.className = "bwi-section__header";
    const titleWrap = document.createElement("button");
    titleWrap.className = "bwi-section__toggle";
    titleWrap.type = "button";
    titleWrap.title = "Show/hide this list";
    const caret = document.createElement("span");
    caret.className = "bwi-caret";
    caret.textContent = "▾";
    titleWrap.appendChild(caret);
    const title = document.createElement("div");
    title.className = "bwi-section__title";
    title.textContent = titleText;
    titleWrap.appendChild(title);
    header.appendChild(titleWrap);
    root.appendChild(header);

    // Optional muted clarifying line under the title (e.g. a caveat about what
    // the list actually represents).
    if (opts.note) {
      const note = document.createElement("div");
      note.className = "bwi-section__note";
      note.textContent = opts.note;
      root.appendChild(note);
    }

    const list = document.createElement("div");
    list.className = "bwi-list";
    root.appendChild(list);

    if (!users || users.length === 0) {
      const empty = document.createElement("div");
      empty.className = "bwi-section__empty";
      empty.textContent = opts.emptyText || "Nothing to show.";
      list.appendChild(empty);
    } else {
      users.forEach((u) => {
        const row = buildUserRow(u, { subtitle: u.subtitle });
        if (opts.rowActionLabel && opts.onRowAction) {
          const btn = document.createElement("button");
          btn.className = "bwi-btn bwi-btn--row";
          btn.textContent = opts.rowActionLabel;
          btn.addEventListener("click", () => opts.onRowAction(u, row));
          row.appendChild(btn);
        }
        list.appendChild(row);
      });
    }

    titleWrap.addEventListener("click", () => {
      const collapsed = root.classList.toggle("bwi-section--collapsed");
      caret.textContent = collapsed ? "▸ Show" : "▾ Hide";
    });
    if (opts.collapsed) {
      root.classList.add("bwi-section--collapsed");
      caret.textContent = "▸ Show";
    }

    return { root };
  }

  // Build one user row for the subsection list.
  function buildRow(u, handlers) {
    const row = document.createElement("div");
    row.className = "bwi-row";
    row.dataset.pk = u.pk;

    const avatar = layeredAvatar(u);

    const meta = document.createElement("a");
    meta.className = "bwi-row__meta";
    meta.href = `/${u.username}/`;
    meta.target = "_blank";
    meta.rel = "noopener";
    // textContent, never innerHTML — username/full_name are user-supplied.
    const uname = document.createElement("span");
    uname.className = "bwi-row__username";
    uname.textContent = u.username;
    meta.appendChild(uname);
    if (u.full_name) {
      const name = document.createElement("span");
      name.className = "bwi-row__name";
      name.textContent = u.full_name;
      meta.appendChild(name);
    }

    const btn = document.createElement("button");
    btn.className = "bwi-btn bwi-btn--row";
    btn.textContent = "Unfollow";
    btn.addEventListener("click", () => handlers.onUnfollowOne(u, row));

    row.appendChild(avatar);
    row.appendChild(meta);
    row.appendChild(btn);
    return row;
  }

  // Build the non-follower subsection as an imperative, streamable panel. It
  // starts in a loading state with an empty list; the caller streams rows in
  // with addRow() as they're discovered and calls finish() when the scan is
  // done. This means the user sees results appear immediately instead of
  // staring at a single multi-second spinner.
  //
  // handlers: { onUnfollowOne(user, rowEl), onUnfollowAll(), onStop(), onRefresh() }
  // Returns { root, setProgress, markRow, addRow, setScanStatus, finish }.
  function renderSubsection(handlers) {
    const root = document.createElement("div");
    root.className = "bwi-section bwi-section--loading";
    root.setAttribute("data-bwi", "subsection");

    const header = document.createElement("div");
    header.className = "bwi-section__header";

    // Collapse toggle so the section can be folded away to give the native
    // list room. The caret + title together act as the toggle.
    const titleWrap = document.createElement("button");
    titleWrap.className = "bwi-section__toggle";
    titleWrap.type = "button";
    titleWrap.title = "Show/hide this list";

    const caret = document.createElement("span");
    caret.className = "bwi-caret";
    caret.textContent = "▾";
    titleWrap.appendChild(caret);

    const title = document.createElement("div");
    title.className = "bwi-section__title";
    title.textContent = "Finding who doesn't follow you back…";
    titleWrap.appendChild(title);
    header.appendChild(titleWrap);

    const actions = document.createElement("div");
    actions.className = "bwi-section__actions";

    const unfollowAllBtn = document.createElement("button");
    unfollowAllBtn.className = "bwi-btn bwi-btn--danger";
    unfollowAllBtn.textContent = "Unfollow all";
    unfollowAllBtn.style.display = "none"; // shown once the scan finds rows

    const stopBtn = document.createElement("button");
    stopBtn.className = "bwi-btn bwi-btn--ghost";
    stopBtn.textContent = "Stop";
    stopBtn.style.display = "none";

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "bwi-btn bwi-btn--ghost";
    refreshBtn.textContent = "Refresh";
    refreshBtn.disabled = true; // re-enabled when the scan finishes

    actions.appendChild(unfollowAllBtn);
    actions.appendChild(stopBtn);
    actions.appendChild(refreshBtn);
    header.appendChild(actions);
    root.appendChild(header);

    const progress = document.createElement("div");
    progress.className = "bwi-progress";
    root.appendChild(progress);

    const list = document.createElement("div");
    list.className = "bwi-list";
    root.appendChild(list);

    const rowByPk = new Map();
    let count = 0;

    function addRow(u) {
      if (rowByPk.has(String(u.pk))) return;
      const row = buildRow(u, handlers);
      list.appendChild(row);
      rowByPk.set(String(u.pk), row);
      count++;
    }

    // Live status during the scan (shown in the progress line).
    function setScanStatus(msg) {
      progress.textContent = msg;
    }

    // Finalize the panel once the scan completes: drop the loading state and
    // settle the title / buttons based on how many non-followers were found.
    function finish() {
      root.classList.remove("bwi-section--loading");
      progress.textContent = "";
      progress.style.display = "none";
      refreshBtn.disabled = false;
      if (count === 0) {
        title.textContent = "Everyone you follow follows you back 🎉";
        unfollowAllBtn.style.display = "none";
      } else {
        title.textContent = `${count} ${
          count === 1 ? "person doesn't" : "people don't"
        } follow you back`;
        unfollowAllBtn.style.display = "";
      }
    }

    // Settle into an error state but keep Refresh available so the user can
    // retry without reopening the modal.
    function showError(msg) {
      root.classList.remove("bwi-section--loading");
      title.textContent = "Couldn't load this list";
      progress.style.display = "";
      progress.textContent = msg;
      unfollowAllBtn.style.display = "none";
      stopBtn.style.display = "none";
      refreshBtn.disabled = false;
    }

    unfollowAllBtn.addEventListener("click", () => handlers.onUnfollowAll());
    stopBtn.addEventListener("click", () => handlers.onStop());
    refreshBtn.addEventListener("click", () => handlers.onRefresh());
    titleWrap.addEventListener("click", () => {
      const collapsed = root.classList.toggle("bwi-section--collapsed");
      caret.textContent = collapsed ? "▸" : "▾";
    });

    function setProgress(msg, { busy } = {}) {
      if (msg == null) {
        progress.style.display = "none";
        progress.textContent = "";
      } else {
        progress.style.display = "";
        progress.textContent = msg;
      }
      unfollowAllBtn.style.display = busy ? "none" : "";
      stopBtn.style.display = busy ? "" : "none";
      refreshBtn.disabled = !!busy;
    }

    // Mark a row's state: "pending" | "done" | "fail".
    function markRow(pk, state, label) {
      const row = rowByPk.get(String(pk));
      if (!row) return;
      const btn = row.querySelector(".bwi-btn--row");
      row.classList.toggle("bwi-row--done", state === "done");
      row.classList.toggle("bwi-row--fail", state === "fail");
      if (btn) {
        if (state === "done") {
          btn.textContent = label || "Unfollowed";
          btn.disabled = true;
        } else if (state === "fail") {
          btn.textContent = label || "Failed";
          btn.disabled = false;
        } else if (state === "pending") {
          btn.textContent = label || "Unfollowing…";
          btn.disabled = true;
        }
      }
    }

    return {
      root,
      setProgress,
      markRow,
      addRow,
      setScanStatus,
      finish,
      showError,
    };
  }

  BWI.ui = {
    text,
    getDialogs,
    dialogTitleIs,
    findScrollContainer,
    insertAboveList,
    findButtonByText,
    toast,
    buildUserRow,
    renderSubsection,
    renderListSubsection,
  };
})();
