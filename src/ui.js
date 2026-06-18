// Better Web Insta — shared DOM helpers + subsection rendering.
// All injected markup uses our own `bwi-` class names (styled in styles.css)
// so we never depend on Instagram's obfuscated classes.
(function () {
  "use strict";

  const BWI = (window.BWI = window.BWI || {});

  const text = (el) => (el && el.textContent ? el.textContent.trim() : "");

  function getDialogs() {
    return Array.from(document.querySelectorAll('[role="dialog"]'));
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

    const title = document.createElement("div");
    title.className = "bwi-section__title";
    title.textContent =
      nonFollowers.length === 0
        ? "Everyone you follow follows you back 🎉"
        : `${nonFollowers.length} ${
            nonFollowers.length === 1 ? "person doesn't" : "people don't"
          } follow you back`;
    header.appendChild(title);

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
      avatar.src = u.profile_pic_url;
      avatar.referrerPolicy = "no-referrer";
      avatar.alt = "";

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
    findButtonByText,
    toast,
    renderSubsection,
  };
})();
