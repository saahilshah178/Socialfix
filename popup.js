// Popup: show today's counts and let the user stop a running bulk job.
// These caps are duplicated from src/config.js — keep them in sync.
const DAILY_CAP = 150; // src/config.js DAILY_CAP
const STORY_DAILY_CAP = 20; // src/config.js STORY.DAILY_CAP

function dayStamp() {
  return new Date().toISOString().slice(0, 10);
}
function todayKey() {
  return "bwi_daily_" + dayStamp();
}
function storyTodayKey() {
  return "bwi_daily_story_" + dayStamp();
}

async function refresh() {
  const res = await chrome.storage.local.get([todayKey(), storyTodayKey()]);
  const count = (res && res[todayKey()]) || 0;
  document.getElementById("count").textContent = count;
  document.getElementById("cap").textContent = DAILY_CAP;
  document.getElementById("barfill").style.width =
    Math.min(100, Math.round((count / DAILY_CAP) * 100)) + "%";

  const storyCount = (res && res[storyTodayKey()]) || 0;
  document.getElementById("storyCount").textContent = storyCount;
  document.getElementById("storyCap").textContent = STORY_DAILY_CAP;
  document.getElementById("storyBarfill").style.width =
    Math.min(100, Math.round((storyCount / STORY_DAILY_CAP) * 100)) + "%";
}

// Every host the queue runs on (mirrors manifest.json content_scripts) — the
// Stop button must reach a bulk run on any of them, not just Instagram.
const SUPPORTED_TAB =
  /^https:\/\/(www\.instagram\.com|www\.youtube\.com|x\.com|[^/]*\.reddit\.com|www\.linkedin\.com|www\.tiktok\.com)\//;

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
