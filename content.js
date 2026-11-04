// Adds a Paperhound button to paper pages (arXiv, OpenReview, CVF, NeurIPS, IEEE, ...).
(() => {
  if (window.top !== window || document.getElementById("paperhound-host")) return;

  const meta = (n) =>
    document.querySelector(`meta[name="${n}"],meta[property="${n}"]`)?.content?.trim() || "";

  const pageHints = () => ({
    title: meta("citation_title") || meta("dc.title") || meta("og:title") || document.title,
    arxivId: meta("citation_arxiv_id"),
    doi: meta("citation_doi") || meta("dc.identifier"),
  });

  const call = (op, payload) =>
    chrome.runtime.sendMessage({ op, ...payload }).then((r) => {
      if (!r || r.error) throw new Error(r?.error || "No response from extension");
      return r.ok;
    });

  const host = document.createElement("div");
  host.id = "paperhound-host";
  host.style.cssText = "all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });

  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = chrome.runtime.getURL("popup.css");

  const fab = document.createElement("button");
  fab.className = "pv-fab";
  fab.title = "Paperhound: check venue and code (highlight a title first to check just that)";
  const icon = document.createElement("img");
  icon.src = chrome.runtime.getURL("icons/icon48.png");
  icon.width = 36;
  icon.height = 36;
  icon.alt = "Paperhound";
  fab.append(icon);

  const panel = document.createElement("div");
  panel.className = "pv-panel";
  panel.hidden = true;
  const head = document.createElement("div");
  head.className = "pv-head";
  const h = document.createElement("strong");
  h.textContent = "Paperhound";
  const close = document.createElement("button");
  close.className = "pv-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close");
  head.append(h, close);
  const $identity = document.createElement("div");
  const $venues = document.createElement("div");
  const $code = document.createElement("div");
  panel.append(head, $identity, $venues, $code);

  root.append(css, panel, fab);
  document.documentElement.append(host);

  let selection = "";
  let running = false;
  let R = null;

  // Keep the highlight: pressing the button would otherwise clear it before click.
  fab.addEventListener("mousedown", (e) => {
    e.preventDefault();
    selection = String(getSelection() || "").trim();
  });
  close.addEventListener("click", () => (panel.hidden = true));

  fab.addEventListener("click", async () => {
    if (!panel.hidden && !running && !selection) {
      panel.hidden = true;
      return;
    }
    if (running) return;
    running = true;
    panel.hidden = false;
    try {
      R = R || (await import(chrome.runtime.getURL("render.js")));
      const h = pageHints();
      const useSel = selection.length >= 8;
      const input = useSel
        ? selection
        : h.arxivId ? `arXiv:${h.arxivId}` : h.doi || h.title || location.href;
      const hints = useSel ? {} : h;
      selection = "";

      $venues.replaceChildren();
      $code.replaceChildren();
      $identity.replaceChildren(R.note("Identifying paper…"));
      const identity = await call("resolve", { input, hints });
      R.renderIdentity($identity, identity);
      $venues.replaceChildren(R.note("Checking publication venues…"));
      $code.replaceChildren(R.note("Looking for code…"));

      await Promise.all([
        call("venues", { identity }).then((r) => R.renderVenues($venues, r)).catch((e) => $venues.replaceChildren(R.note(`Venue search failed: ${e.message}`))),
        call("code", { identity }).then((r) => R.renderCode($code, r)).catch((e) => $code.replaceChildren(R.note(`Code search failed: ${e.message}`))),
      ]);
    } catch (e) {
      $identity.replaceChildren(R ? R.note(e.message) : document.createTextNode(e.message));
    } finally {
      running = false;
    }
  });
})();
