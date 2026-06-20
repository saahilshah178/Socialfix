// Better Web Insta — shared DOM helpers + subsection rendering.
// All injected markup uses our own `bwi-` class names (styled in styles.css)
// so we never depend on Instagram's obfuscated classes.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});

  const text = (el) => (el && el.textContent ? el.textContent.trim() : "");

  // Neutral placeholder shown if a profile picture fails to load, so a broken
  // image icon never appears.
  const AVATAR_FALLBACK =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44'>" +
        "<circle cx='22' cy='22' r='22' fill='#c7c7c7'/>" +
        "<circle cx='22' cy='18' r='8' fill='#fff'/>" +
        "<path d='M8 39c1-9 27-9 28 0z' fill='#fff'/></svg>"
    );

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

  // Build the non-follower subsection.
  // handlers: { onUnfollowOne(user, rowEl), onUnfollowAll(), onStop(), onRefresh() }
  // Returns { root, setProgress, markRow }.
  function renderSubsection(nonFollowers, handlers) {
    const root = document.createElement("div");
    root.className = "bwi-section";
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
    title.textContent =
      nonFollowers.length === 0
        ? "Everyone you follow follows you back 🎉"
        : `${nonFollowers.length} ${
            nonFollowers.length === 1 ? "person doesn't" : "people don't"
          } follow you back`;
    titleWrap.appendChild(title);
    header.appendChild(titleWrap);

    const actions = document.createElement("div");
    actions.className = "bwi-section__actions";

    const unfollowAllBtn = document.createElement("button");
    unfollowAllBtn.className = "bwi-btn bwi-btn--danger";
    unfollowAllBtn.textContent = "Unfollow all";

    const stopBtn = document.createElement("button");
    stopBtn.className = "bwi-btn bwi-btn--ghost";
    stopBtn.textContent = "Stop";
    stopBtn.style.display = "none";

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "bwi-btn bwi-btn--ghost";
    refreshBtn.textContent = "Refresh";

    if (nonFollowers.length === 0) unfollowAllBtn.style.display = "none";

    actions.appendChild(unfollowAllBtn);
    actions.appendChild(stopBtn);
    actions.appendChild(refreshBtn);
    header.appendChild(actions);
    root.appendChild(header);

    const progress = document.createElement("div");
    progress.className = "bwi-progress";
    progress.style.display = "none";
    root.appendChild(progress);

    const list = document.createElement("div");
    list.className = "bwi-list";
    root.appendChild(list);

    const rowByPk = new Map();

    nonFollowers.forEach((u) => {
      const row = document.createElement("div");
      row.className = "bwi-row";
      row.dataset.pk = u.pk;

      const avatar = document.createElement("img");
      avatar.className = "bwi-row__avatar";
      avatar.alt = "";
      avatar.loading = "lazy";
      // referrerPolicy MUST be set BEFORE src — otherwise the fetch kicks off
      // under the page's default policy and ignores it. Instagram's image CDN
      // rejects requests carrying an unexpected referrer, so "no-referrer" is
      // the reliable choice (this ordering bug is what left avatars broken).
      avatar.referrerPolicy = "no-referrer";
      avatar.addEventListener("error", () => {
        if (avatar.dataset.bwiFallback) return; // avoid loops
        avatar.dataset.bwiFallback = "1";
        avatar.src = AVATAR_FALLBACK;
      });
      avatar.src = u.profile_pic_url || AVATAR_FALLBACK;

      const meta = document.createElement("a");
      meta.className = "bwi-row__meta";
      meta.href = `/${u.username}/`;
      meta.target = "_blank";
      meta.rel = "noopener";
      meta.innerHTML = `<span class="bwi-row__username">${u.username}</span>${
        u.full_name
          ? `<span class="bwi-row__name">${u.full_name}</span>`
          : ""
      }`;

      const btn = document.createElement("button");
      btn.className = "bwi-btn bwi-btn--row";
      btn.textContent = "Unfollow";
      btn.addEventListener("click", () => handlers.onUnfollowOne(u, row));

      row.appendChild(avatar);
      row.appendChild(meta);
      row.appendChild(btn);
      list.appendChild(row);
      rowByPk.set(u.pk, row);
    });

    unfollowAllBtn.addEventListener("click", () => handlers.onUnfollowAll());
    stopBtn.addEventListener("click", () => handlers.onStop());
    refreshBtn.addEventListener("click", () => handlers.onRefresh());
    titleWrap.addEventListener("click", () => {
      const collapsed = root.classList.toggle("bwi-section--collapsed");
      caret.textContent = collapsed ? "▸ Show" : "▾ Hide";
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

    return { root, setProgress, markRow };
  }

  BWI.ui = {
    text,
    getDialogs,
    dialogTitleIs,
    findScrollContainer,
    findButtonByText,
    toast,
    renderSubsection,
  };
})();
