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

// We deliberately do NOT inspect tab.url here. Reading a tab's URL requires the
// "tabs" permission (or a host permission), and this extension asks for
// neither — it only declares content scripts. Instead we just send the message:
// the content script exists only on supported sites, so sendMessage rejects
// everywhere else, which is exactly the signal we need.
document.getElementById("stop").addEventListener("click", async () => {
  const status = document.getElementById("status");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "bwi-stop" });
    status.textContent = "Stop signal sent.";
  } catch (_) {
    // No content script on this tab — not a supported site.
    status.textContent = "No Socialfix run on this tab.";
  }
});

refresh();
