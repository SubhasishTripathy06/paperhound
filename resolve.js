import { similarity } from "./search.js";

async function http(url, text = false) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(r.status === 429 ? "rate-limited" : `HTTP ${r.status}`);
    return text ? await r.text() : await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------- parsing whatever the user gave us ----------
const ID = "[a-z\\-]+(?:\\.[A-Za-z]{2})?\\/\\d{7}|\\d{4}\\.\\d{4,5}";
const ARXIV_URL = new RegExp(`arxiv\\.org\\/(?:abs|pdf|html)\\/(${ID})(?:v\\d+)?`, "i");
const ARXIV_TAG = new RegExp(`\\barxiv\\s*:\\s*(${ID})(?:v\\d+)?`, "i");
const ARXIV_BARE = /^\s*(\d{4}\.\d{4,5})(?:v\d+)?\s*$/;
const ARXIV_START = /^\s*\[?(\d{4}\.\d{4,5})(?:v\d+)?\]?(?:\.pdf)?(?=\s|$|:)/i; // "2306.14141v1.pdf", "[2306.14141] Title"
const ARXIV_PATH = /[\/\\](\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?(?:[?#].*)?$/i;      // .../2306.14141v1.pdf (web or local file)
const ARXIV_DOI = /^10\.48550\/arxiv\.(.+)$/i;
const DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>]+)/i;
const CVF = /openaccess\.thecvf\.com\/.*\/papers\/([^/]+?)_(?:CVPR|ICCV|WACV|ACCV)[A-Za-z]*_\d{4}_paper\.pdf/i;

const cleanArxiv = (s) => String(s).trim().replace(/v\d+$/i, "");

// Accepts a title, "arXiv:2103.00020", an arXiv/CVF URL, or a DOI.
export function parseInput(text) {
  const t = String(text || "").trim();
  let arxivId = (t.match(ARXIV_URL) || t.match(ARXIV_TAG) || t.match(ARXIV_BARE) || t.match(ARXIV_START) || t.match(ARXIV_PATH) || [])[1] || null;
  let doi = (t.match(DOI_RE) || [])[1] || null;
  if (doi) {
    doi = doi.replace(/[.,;:)\]]+$/, "");
    const a = doi.match(ARXIV_DOI);
    if (a) {
      arxivId = arxivId || cleanArxiv(a[1]);
      doi = null; // the arXiv DOI is not a publication DOI
    }
  }
  if (arxivId) arxivId = cleanArxiv(arxivId);

  let title = null;
  const cvf = t.match(CVF);
  if (cvf) title = cvf[1].split("_").slice(1).join(" "); // filename is Author_Title_Words
  else if (!arxivId && !doi && !/^https?:\/\//i.test(t))
    title = t.replace(/\s+/g, " ").replace(/^["“”'‘’]+|["“”'‘’]+$/g, "").slice(0, 300);
  return { title, arxivId, doi };
}

// ---------- arXiv (Atom XML, parsed without DOMParser so it also runs in a service worker) ----------
const decode = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, "&");
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].replace(/\s+/g, " ").trim()) : "";
};

function parseEntries(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map((m) => m[1])
    .map((e) => {
      const idUrl = tag(e, "id");
      return {
        idUrl,
        arxivId: cleanArxiv((idUrl.split("/abs/")[1] || "")),
        title: tag(e, "title"),
        summary: tag(e, "summary"),
        comment: tag(e, "arxiv:comment"),
        journalRef: tag(e, "arxiv:journal_ref"),
        doi: tag(e, "arxiv:doi"),
        year: Number((tag(e, "published") || "").slice(0, 4)) || null,
        authors: [...e.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((a) => decode(a[1].trim())),
      };
    })
    .filter((e) => e.idUrl.includes("/abs/") && e.arxivId);
}

async function arxivById(id) {
  const xml = await http(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, true);
  return parseEntries(xml)[0] || null;
}

async function arxivSearch(title) {
  const q = `ti:"${title.replace(/["']/g, " ")}"`;
  const xml = await http(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}&max_results=5`, true);
  return parseEntries(xml).find((e) => similarity(title, e.title) >= 0.85) || null;
}

// ---------- Semantic Scholar ----------
const S2 = "https://api.semanticscholar.org/graph/v1/paper";
const S2_FIELDS = "title,year,authors,externalIds";

async function s2Search(title) {
  const j = await http(`${S2}/search?query=${encodeURIComponent(title)}&limit=5&fields=${S2_FIELDS}`);
  return (j.data || []).find((p) => similarity(title, p.title) >= 0.85) || null;
}
const s2ById = (key) => http(`${S2}/${key}?fields=${S2_FIELDS}`);

// ---------- resolution ----------
function fromArxiv(id, e) {
  id.arxivId = e.arxivId;
  id.title = e.title || id.title;
  if (e.authors.length) id.authors = e.authors;
  id.text = `${e.comment} ${e.summary}`;
  id.journalRef = e.journalRef;
  id.year = e.year || id.year;
  if (e.doi && !id.doi) id.doi = e.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
}

function fromS2(id, p) {
  id.title = id.title || p.title;
  if (!id.authors.length) id.authors = (p.authors || []).map((a) => a.name).filter(Boolean);
  id.year = id.year || p.year;
  const ext = p.externalIds || {};
  if (!id.arxivId && ext.ArXiv) id.arxivId = cleanArxiv(ext.ArXiv);
  if (!id.doi && ext.DOI && !/^10\.48550\//i.test(ext.DOI)) id.doi = ext.DOI;
}

// Turns a title, ID, URL or DOI into one identity that every later lookup can use.
export async function resolveIdentity(input, hints = {}) {
  const p = parseInput(input);
  const id = {
    title: p.title || hints.title || null,
    arxivId: p.arxivId || (hints.arxivId ? cleanArxiv(hints.arxivId) : null),
    doi: p.doi || hints.doi || null,
    authors: [],
    text: "",
    journalRef: "",
    year: null,
  };

  // 1. An arXiv ID is exact: fetch the record (title, authors, comments, journal-ref, DOI).
  if (id.arxivId) {
    try {
      const e = await arxivById(id.arxivId);
      if (e) fromArxiv(id, e);
    } catch {
      /* keep going with whatever we have */
    }
  }

  // 2. A DOI is exact too: Semantic Scholar maps it to the title and arXiv ID.
  if (!id.arxivId && id.doi) {
    try {
      fromS2(id, await s2ById(`DOI:${id.doi}`));
      if (id.arxivId) {
        const e = await arxivById(id.arxivId);
        if (e) fromArxiv(id, e);
      }
    } catch {
      /* fall through to title */
    }
  }

  // 3. Only a title: look it up on arXiv and Semantic Scholar together to recover the IDs.
  if (!id.arxivId && id.title) {
    const [ax, s2] = await Promise.allSettled([arxivSearch(id.title), s2Search(id.title)]);
    if (ax.status === "fulfilled" && ax.value) fromArxiv(id, ax.value);
    if (s2.status === "fulfilled" && s2.value) {
      fromS2(id, s2.value);
      if (id.arxivId && !id.text) {
        try {
          const e = await arxivById(id.arxivId);
          if (e) fromArxiv(id, e);
        } catch {
          /* optional */
        }
      }
    }
  }

  if (!id.title) throw new Error("Couldn't identify a paper from that input. Try pasting its title.");
  return id;
}
