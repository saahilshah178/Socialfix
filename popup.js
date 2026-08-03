// Popup: show today's counts and let the user stop a running bulk job.
// This cap is duplicated from src/config.js — keep it in sync.
const DAILY_CAP = 150; // src/config.js DAILY_CAP

function dayStamp() {
  return new Date().toISOString().slice(0, 10);
}
function todayKey() {
  return "bwi_daily_" + dayStamp();
}

async function refresh() {
  const res = await chrome.storage.local.get(todayKey());
  const count = (res && res[todayKey()]) || 0;
  document.getElementById("count").textContent = count;
  document.getElementById("cap").textContent = DAILY_CAP;
  document.getElementById("barfill").style.width =
    Math.min(100, Math.round((count / DAILY_CAP) * 100)) + "%";
}

// Every host the queue runs on (mirrors manifest.json content_scripts) — the
// Stop button must reach a bulk run on any of them, not just Instagram.
const SUPPORTED_TAB =
  /^https:\/\/(www\.instagram\.com|www\.youtube\.com|x\.com|[^/]*\.reddit\.com|www\.tiktok\.com)\//;

document.getElementById("stop").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !SUPPORTED_TAB.test(tab.url || "")) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "bwi-stop" });
  } catch (_) {
    /* no content script on this tab */
  }
});

refresh();
