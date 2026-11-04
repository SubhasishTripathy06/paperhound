import { checkPaper } from "./search.js";
import { findCode } from "./code.js";
import { resolveIdentity, parseInput } from "./resolve.js";
import { note, renderIdentity, renderVenues, renderCode } from "./render.js";

const $title = document.getElementById("title");
const $go = document.getElementById("go");
const $paste = document.getElementById("paste");
const $identity = document.getElementById("identity");
const $venues = document.getElementById("venues");
const $code = document.getElementById("code");
const KEY_FIELDS = ["ghToken", "kUser", "kKey"];

let hints = {}; // IDs read from the page; dropped as soon as the user edits the box
$title.addEventListener("input", () => (hints = {}));

// ---------- settings ----------
async function loadSettings() {
  const s = await chrome.storage.local.get(KEY_FIELDS);
  for (const k of KEY_FIELDS) if (s[k]) document.getElementById(k).value = s[k];
}
for (const k of KEY_FIELDS) {
  document.getElementById(k).addEventListener("change", (e) =>
    chrome.storage.local.set({ [k]: e.target.value.trim() })
  );
}

// ---------- clipboard (the reliable route for text inside PDF viewers) ----------
$paste.addEventListener("click", async () => {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (text) {
      $title.value = text;
      hints = {};
    }
  } catch {
    $title.focus();
    document.execCommand("paste");
  }
});

// ---------- what to check ----------
async function prefill() {
  const params = new URLSearchParams(location.search);
  if (params.has("q")) {
    // Opened from the right-click menu: q is the selection, link or page URL.
    $title.value = params.get("q");
    hints = { title: params.get("t") || undefined };
    return true;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || "";

  let page = null;
  try {
    // Fails on PDF viewers and browser pages; that's expected.
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const meta = (n) => document.querySelector(`meta[name="${n}"],meta[property="${n}"]`)?.content?.trim() || "";
        return {
          sel: String(window.getSelection() || "").trim(),
          title: meta("citation_title") || meta("og:title") || document.title || "",
          arxivId: meta("citation_arxiv_id"),
          doi: meta("citation_doi") || meta("dc.identifier"),
        };
      },
    });
    page = res?.result;
  } catch {
    /* no page access */
  }

  if (page?.sel) { $title.value = page.sel.slice(0, 300); return false; }
  const fromUrl = parseInput(url);                         // arXiv abs/pdf links, local ID-named files, CVF pdf names
  if (fromUrl.arxivId) { $title.value = `arXiv:${fromUrl.arxivId}`; return false; }
  const fromTabTitle = parseInput(tab?.title || "");       // PDF tabs are often titled "2306.14141v1"
  if (fromTabTitle.arxivId) { $title.value = `arXiv:${fromTabTitle.arxivId}`; return false; }
  if (page?.arxivId || page?.doi) {
    hints = { arxivId: page.arxivId, doi: page.doi, title: page.title };
    $title.value = page.arxivId ? `arXiv:${page.arxivId}` : page.doi;
    return false;
  }
  if (fromUrl.title) { $title.value = fromUrl.title; return false; }

  // A real title, not a filename or a one-word tab name.
  const candidate = (page?.title || tab?.title || "").trim();
  if (candidate && !/\.pdf$/i.test(candidate) && candidate.split(/\s+/).length >= 3) {
    $title.value = candidate.slice(0, 300);
    return false;
  }

  // Highlighted text inside PDF viewers can't be read by extensions, but it can be copied.
  try {
    const clip = (await navigator.clipboard.readText()).replace(/\s+/g, " ").trim();
    if (clip.length >= 8 && clip.length <= 300) {
      $title.value = clip;
      $identity.replaceChildren(note("Filled from your clipboard. Edit it if that isn't the paper."));
      return false;
    }
  } catch {
    /* clipboard not readable here */
  }
  $identity.replaceChildren(
    note("Couldn't read the paper from this page. Highlight the title, press Ctrl+C, then click Paste (or press Ctrl+V in the box).")
  );
  $title.focus();
  return false;
}

// ---------- run ----------
async function run() {
  const input = $title.value.trim();
  if (!input) {
    $identity.replaceChildren(note("Enter a title, arXiv ID, DOI or link first."));
    $venues.replaceChildren();
    $code.replaceChildren();
    return;
  }
  $go.disabled = true;
  $go.textContent = "Searching…";
  $venues.replaceChildren();
  $code.replaceChildren();
  $identity.replaceChildren(note("Identifying paper…"));

  try {
    const identity = await resolveIdentity(input, hints);
    renderIdentity($identity, identity);
    $venues.replaceChildren(note("Checking publication venues…"));
    $code.replaceChildren(note("Looking for code…"));
    const settings = await chrome.storage.local.get(KEY_FIELDS);
    await Promise.all([
      checkPaper(identity).then((r) => renderVenues($venues, r)).catch((e) => $venues.replaceChildren(note(`Venue search failed: ${e.message}`))),
      findCode(identity, settings).then((r) => renderCode($code, r)).catch((e) => $code.replaceChildren(note(`Code search failed: ${e.message}`))),
    ]);
  } catch (e) {
    $identity.replaceChildren(note(e.message));
  } finally {
    $go.disabled = false;
    $go.textContent = "Check venues and code";
  }
}

$go.addEventListener("click", run);

(async () => {
  await loadSettings();
  const auto = await prefill();
  if (auto && $title.value.trim()) run();
})();
