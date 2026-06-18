// Popup: show today's unfollow count and let the user stop a running bulk job.
const DAILY_CAP = 150; // keep in sync with src/config.js DAILY_CAP

function todayKey() {
  return "bwi_daily_" + new Date().toISOString().slice(0, 10);
}

async function refresh() {
  const key = todayKey();
  const res = await chrome.storage.local.get(key);
  const count = (res && res[key]) || 0;
  document.getElementById("count").textContent = count;
  document.getElementById("cap").textContent = DAILY_CAP;
  const pct = Math.min(100, Math.round((count / DAILY_CAP) * 100));
  document.getElementById("barfill").style.width = pct + "%";
}

document.getElementById("stop").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/www\.instagram\.com\//.test(tab.url || "")) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "bwi-stop" });
  } catch (_) {
    /* no content script on this tab */
  }
});

refresh();
