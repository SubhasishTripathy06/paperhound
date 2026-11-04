import { checkPaper } from "./search.js";
import { findCode } from "./code.js";
import { resolveIdentity } from "./resolve.js";

const KEYS = ["ghToken", "kUser", "kKey"];

// The on-page panel can't call these APIs itself (page CORS), so it asks this worker.
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  (async () => {
    try {
      if (msg.op === "resolve") return send({ ok: await resolveIdentity(msg.input, msg.hints || {}) });
      if (msg.op === "venues") return send({ ok: await checkPaper(msg.identity) });
      if (msg.op === "code") return send({ ok: await findCode(msg.identity, await chrome.storage.local.get(KEYS)) });
      send({ error: "Unknown request" });
    } catch (e) {
      send({ error: e.message || String(e) });
    }
  })();
  return true; // keep the channel open for the async reply
});

// Right-click menu: works on highlighted text, links, and pages (including PDF viewers).
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "paperhound-check",
    title: "Check with Paperhound",
    contexts: ["selection", "link", "page"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "paperhound-check") return;
  const q = info.selectionText || info.linkUrl || info.pageUrl || tab?.url || "";
  const t = tab?.title || "";
  chrome.windows.create({
    url: chrome.runtime.getURL(`popup.html?q=${encodeURIComponent(q)}&t=${encodeURIComponent(t)}`),
    type: "popup",
    width: 440,
    height: 720,
  });
});
