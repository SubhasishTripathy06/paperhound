export const norm = (s) =>
  (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const tokens = (s) => new Set(norm(s).split(" ").filter(Boolean));

// Jaccard similarity on word sets: tolerant of punctuation, subtitles and case.
export function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// "... Conference on Computer Vision and Pattern Recognition" and similar are not the journal.
const CONF_PR = /(Conference|Symposium|Workshop)s?\s+on\s+([\w-]+\s+){0,4}?Pattern Recognition/gi;

// Each test runs on venue names plus DBLP keys (e.g. "conf/cvpr/...", "journals/pr/...").
// To add a venue, add one line here.
export const VENUES = [
  { name: "CVPR", test: (h) => /\b(CVPR|Computer Vision and Pattern Recognition)\b/i.test(h) },
  { name: "ICCV", test: (h) => /\b(ICCV|International Conference on Computer Vision)\b/i.test(h) },
  { name: "ECCV", test: (h) => /\b(ECCV|European Conference on Computer Vision)\b/i.test(h) },
  { name: "NeurIPS", test: (h) => /\b(NeurIPS|NIPS|Neural Information Processing Systems)\b/i.test(h) },
  { name: "AAAI", test: (h) => /\bAAAI\b|Association for the Advancement of Artificial Intelligence/i.test(h) },
  {
    name: "Pattern Recognition",
    test: (h) => {
      const s = h
        .replace(CONF_PR, " ")
        .replace(/Pattern Recognition Letters|Pattern Recognit\.\s*Lett\.?/gi, " ");
      return /\bPattern Recognition\b(?!\s+and\b)|\bPattern Recognit\.|journals\/pr\//i.test(s);
    },
  },
  { name: "CAAI", test: (h) => /\bCAAI\b|Chinese Association for Artificial Intelligence/i.test(h) },
  { name: "IEEE", test: (h) => /\bIEEE\b/i.test(h) },
];

// DOI prefixes that identify a publisher or venue on their own.
const DOI_HINTS = [
  [/^10\.1109\/cvpr/i, "CVPR (IEEE)"],
  [/^10\.1109\/iccv/i, "ICCV (IEEE)"],
  [/^10\.1109\//i, "IEEE"],
  [/^10\.1609\/aaai/i, "AAAI Conference on Artificial Intelligence"],
  [/^10\.1016\/j\.patcog/i, "Pattern Recognition"],
  [/^10\.1049\/cit2/i, "CAAI Transactions on Intelligence Technology"],
];

async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(r.status === 429 ? "rate-limited" : `HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const first = (x) => [].concat(x || [])[0];

// Runs lookups in parallel; only fails if every one of them failed.
async function settleAll(tasks) {
  const res = await Promise.allSettled(tasks.map((t) => t()));
  if (res.length && res.every((r) => r.status === "rejected")) throw res[0].reason;
  return res.filter((r) => r.status === "fulfilled").flatMap((r) => r.value);
}

// Every source gets the resolved identity, so it can search by title AND look up by ID.
// Records with exact:true came from an ID lookup and skip the title-similarity filter.

async function dblp(id) {
  if (!id.title) return [];
  const j = await getJSON(`https://dblp.org/search/publ/api?q=${encodeURIComponent(id.title)}&format=json&h=15`);
  return (j?.result?.hits?.hit || []).map((h) => h.info).map((i) => ({
    source: "DBLP",
    title: i.title,
    year: i.year,
    venue: [].concat(i.venue || []).join(", "),
    extra: i.key || "",
    url: first(i.ee) || i.url,
  }));
}

const S2 = "https://api.semanticscholar.org/graph/v1/paper";
const S2_FIELDS = "title,year,venue,publicationVenue,url";
const s2rec = (p, exact) => ({
  source: "Semantic Scholar",
  title: p.title,
  year: p.year,
  venue: p.venue || p.publicationVenue?.name || "",
  extra: [p.publicationVenue?.name, ...(p.publicationVenue?.alternate_names || [])].filter(Boolean).join(" "),
  url: p.url,
  exact,
});

async function semanticScholar(id) {
  const tasks = [];
  if (id.title)
    tasks.push(async () =>
      ((await getJSON(`${S2}/search?query=${encodeURIComponent(id.title)}&limit=10&fields=${S2_FIELDS}`)).data || []).map(
        (p) => s2rec(p, false)
      )
    );
  if (id.arxivId) tasks.push(async () => [s2rec(await getJSON(`${S2}/ARXIV:${id.arxivId}?fields=${S2_FIELDS}`), true)]);
  if (id.doi) tasks.push(async () => [s2rec(await getJSON(`${S2}/DOI:${id.doi}?fields=${S2_FIELDS}`), true)]);
  return settleAll(tasks);
}

const OA = "https://api.openalex.org/works";
const OA_SEL = "display_name,publication_year,doi,primary_location,locations";
const oarec = (w, exact) => ({
  source: "OpenAlex",
  title: w.display_name,
  year: w.publication_year,
  venue: [...new Set((w.locations || []).map((l) => l.source?.display_name).filter(Boolean))].join(", "),
  url: w.doi || w.primary_location?.landing_page_url,
  exact,
});

async function openAlex(id) {
  const tasks = [];
  if (id.title)
    tasks.push(async () =>
      ((await getJSON(`${OA}?search=${encodeURIComponent(id.title)}&per-page=10&select=${OA_SEL}`)).results || []).map(
        (w) => oarec(w, false)
      )
    );
  if (id.doi) tasks.push(async () => [oarec(await getJSON(`${OA}/https://doi.org/${id.doi}?select=${OA_SEL}`), true)]);
  if (id.arxivId)
    tasks.push(async () => [oarec(await getJSON(`${OA}/https://doi.org/10.48550/arXiv.${id.arxivId}?select=${OA_SEL}`), true)]);
  return settleAll(tasks);
}

const crrec = (w, exact) => ({
  source: "Crossref",
  title: first(w.title),
  year: w.issued?.["date-parts"]?.[0]?.[0],
  venue: [first(w["container-title"]), w.event?.name].filter(Boolean).join(", "),
  url: w.URL,
  exact,
});

async function crossref(id) {
  const tasks = [];
  if (id.title)
    tasks.push(async () =>
      ((await getJSON(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(id.title)}&rows=10`)).message
        ?.items || []).map((w) => crrec(w, false))
    );
  if (id.doi) tasks.push(async () => [crrec((await getJSON(`https://api.crossref.org/works/${id.doi}`)).message, true)]);
  return settleAll(tasks);
}

const SOURCES = [
  ["DBLP", dblp],
  ["Semantic Scholar", semanticScholar],
  ["OpenAlex", openAlex],
  ["Crossref", crossref],
];

// Evidence that needs no network: arXiv's journal-ref field and DOI prefixes.
function localEvidence(id) {
  const out = [];
  const url = id.arxivId ? `https://arxiv.org/abs/${id.arxivId}` : undefined;
  if (id.journalRef)
    out.push({ source: "arXiv journal-ref", title: id.title, year: id.year, venue: id.journalRef, url, exact: true });
  if (id.doi)
    for (const [re, label] of DOI_HINTS)
      if (re.test(id.doi))
        out.push({ source: "DOI prefix", title: id.title, year: id.year, venue: label, url: `https://doi.org/${id.doi}`, exact: true });
  return out;
}

export async function checkPaper(id) {
  const settled = await Promise.allSettled(SOURCES.map(([, fn]) => fn(id)));

  const status = [];
  const matches = [];
  settled.forEach((s, i) => {
    const name = SOURCES[i][0];
    if (s.status === "rejected") {
      status.push({ name, error: s.reason?.name === "AbortError" ? "timed out" : s.reason?.message });
      return;
    }
    const good = s.value.filter((r) => r.exact || (r.title && id.title && similarity(id.title, r.title) >= 0.85));
    status.push({ name, count: good.length });
    matches.push(...good);
  });
  const local = localEvidence(id);
  if (local.length) {
    status.push({ name: "arXiv/DOI metadata", count: local.length });
    matches.push(...local);
  }

  const found = Object.fromEntries(VENUES.map((v) => [v.name, []]));
  const seen = new Set();
  const otherVenues = new Set();

  for (const m of matches) {
    const hay = `${m.venue} ${m.extra || ""}`;
    let hitTarget = false;
    for (const v of VENUES) {
      if (!v.test(hay)) continue;
      hitTarget = true;
      const key = `${v.name}|${m.source}|${m.venue}|${m.year}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found[v.name].push({
        source: m.source,
        year: m.year,
        venue: m.venue,
        url: m.url,
        workshop: /workshop/i.test(hay),
      });
    }
    if (!hitTarget && m.venue) otherVenues.add(m.venue);
  }

  return { found, status, matchCount: matches.length, otherVenues: [...otherVenues] };
}
