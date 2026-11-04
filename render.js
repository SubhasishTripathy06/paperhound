// Shared by the popup and the on-page panel.
import { VENUES } from "./search.js";

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}
export const note = (text) => el("p", { className: "note" }, text);
export const link = (href, text) => el("a", { href, target: "_blank", rel: "noreferrer", textContent: text });

export function renderIdentity(container, id) {
  container.replaceChildren();
  const authors = id.authors.slice(0, 3).join(", ") + (id.authors.length > 3 ? " et al." : "");
  const meta = [
    id.arxivId && `arXiv:${id.arxivId}`,
    id.doi && `DOI ${id.doi}`,
    id.year,
    authors,
  ].filter(Boolean).join(" · ");
  container.append(
    el("div", { className: "identity" }, el("strong", {}, id.title), meta ? el("div", { className: "meta" }, meta) : "")
  );
}

export function renderVenues(container, result) {
  container.replaceChildren();
  const { found, status, matchCount, otherVenues } = result;
  const full = VENUES.filter((v) => found[v.name].some((e) => !e.workshop)).map((v) => v.name);
  const workshopOnly = VENUES.filter(
    (v) => found[v.name].length && !found[v.name].some((e) => !e.workshop)
  ).map((v) => v.name);

  let text, cls = "warn";
  if (full.length) { text = `Published in ${full.join(", ")}`; cls = "ok"; }
  else if (workshopOnly.length) text = `Only found at a workshop (${workshopOnly.join(", ")})`;
  else if (matchCount) text = "Found, but not in these venues";
  else text = "No matching paper found";
  container.append(el("p", { className: `verdict ${cls}` }, text));

  const list = el("ul", { className: "ledger" });
  for (const v of VENUES) {
    const evidence = found[v.name];
    const right = el("span", { className: evidence.length ? "hit" : "miss" });
    if (!evidence.length) right.textContent = "Not found";
    else {
      const years = [...new Set(evidence.map((e) => e.year).filter(Boolean))].join(", ");
      const label = `${evidence.some((e) => !e.workshop) ? "Found" : "Workshop"}${years ? " · " + years : ""}`;
      const first = evidence.find((e) => e.url);
      right.append(first ? link(first.url, label) : label);
      right.title = evidence.map((e) => `${e.source}: ${e.venue}`).join("\n");
    }
    list.append(el("li", {}, el("span", { className: "name" }, v.name), right));
  }
  container.append(list);

  if (!full.length && otherVenues.length)
    container.append(note(`Listed under: ${otherVenues.slice(0, 4).join("; ")}`));

  const failed = status.filter((s) => s.error);
  const ok = status.filter((s) => !s.error).map((s) => `${s.name} (${s.count})`);
  let foot = `Searched ${ok.join(", ") || "no sources"}.`;
  if (failed.length) foot += ` Unavailable: ${failed.map((s) => `${s.name} ${s.error}`).join(", ")}.`;
  foot += " A miss isn't proof: new or renamed papers may not be indexed yet.";
  container.append(note(foot));
}

const LEVEL_LABEL = { official: "Official", likely: "Likely official", community: "Community", unofficial: "Unofficial" };

function repoRow(r) {
  const stars = r.stars != null ? `${r.platform === "GitHub" ? "★" : "▲"} ${r.stars}` : "";
  return el(
    "li",
    {},
    el("div", { className: "top" }, link(r.url, r.name), el("span", { className: `badge ${r.level}` }, LEVEL_LABEL[r.level])),
    el("div", { className: "why" }, [r.platform, stars, r.reason].filter(Boolean).join(" · "))
  );
}

export function renderCode(container, res) {
  container.replaceChildren();
  const section = el("div", { className: "section" }, el("h2", {}, "Code"));
  container.append(section);

  const all = [...res.github, ...res.kaggle.items];
  const official = res.github.filter((r) => r.level === "official");
  const likely = res.github.filter((r) => r.level === "likely");

  let text, cls = "warn";
  if (official.length) { text = "Official code found"; cls = "ok"; }
  else if (likely.length) { text = "Likely official code found"; cls = "ok"; }
  else if (all.length) text = "Code found, but none confirmed official";
  else text = "No code found";
  section.append(el("p", { className: `verdict ${cls}` }, text));

  if (all.length) section.append(el("ul", { className: "repos" }, ...all.map(repoRow)));

  const k = res.kaggle;
  const kLine = el("p", { className: "note" }, "Kaggle: ");
  kLine.append(link(k.searchUrl, "search for this title"));
  if (k.needsKey) kLine.append(" (add Kaggle credentials under Optional keys to list results here)");
  else if (k.error) kLine.append(` (couldn't list results: ${k.error})`);
  else if (!k.items.length) kLine.append(" (no notebooks or datasets returned)");
  section.append(kLine);

  const notes = [];
  if (!res.resolved) notes.push("No arXiv ID was found for this paper, so repos were matched by title only and fewer official signals were available.");
  if (res.githubError) notes.push(`GitHub search ${res.githubError}; add a token under Optional keys.`);
  notes.push("Official is judged from the authors' own links and README wording, so treat it as strong evidence, not proof.");
  section.append(note(notes.join(" ")));
}
