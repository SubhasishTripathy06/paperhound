import { similarity, norm } from "./search.js";

async function http(url, { headers = {}, text = false } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    if (!r.ok) {
      throw new Error(
        r.status === 403 || r.status === 429 ? "rate-limited" : r.status === 401 ? "unauthorized" : `HTTP ${r.status}`
      );
    }
    return text ? await r.text() : await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const ghHeaders = (token, raw = false) => ({
  Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

const GH_RE = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g;
function githubRepos(text) {
  const out = new Set();
  for (const m of (text || "").matchAll(GH_RE)) {
    const repo = m[2].replace(/\.git$/, "").replace(/\.+$/, "");
    if (repo) out.add(`${m[1]}/${repo}`.toLowerCase());
  }
  return out;
}

async function hfLookup(arxivId) {
  const j = await http(`https://huggingface.co/api/papers/${arxivId}`);
  return {
    repo: j.githubRepo || "",
    authors: (j.authors || []).map((a) => a.name).filter(Boolean),
  };
}

// --- Classification of a GitHub repo.
const UNOFFICIAL = /\b(unofficial|un-official|re-?implementation|reproduction|not (the )?official|third[- ]party)\b/i;
const OFFICIAL =
  /official\s+(\w+\s+){0,3}(implementation|code|repo|repository|release|source)|(code|implementation)\s+(for|of|accompanying)\s+(the\s+|our\s+)?paper|accompanying code|official\s+(pytorch|tensorflow|jax)/i;

const lastNames = (authors) =>
  authors.map((a) => norm(a).split(" ").pop()).filter((n) => n && n.length >= 4);

function classify({ repo, readme, arxivId, title, authors, arxivLinked, hfLinked }) {
  const key = repo.full_name.toLowerCase();
  const mentions =
    (arxivId && readme.includes(arxivId)) || norm(readme).includes(norm(title));
  const saysOfficial = OFFICIAL.test(readme);
  const saysUnofficial = UNOFFICIAL.test(readme);
  const login = repo.owner.login.toLowerCase().replace(/[^a-z]/g, "");
  const ownerMatch = lastNames(authors).some((n) => login.includes(n));
  const byAuthors = arxivLinked.has(key);
  const byHF = hfLinked.has(key);

  if (!mentions && !byAuthors && !byHF) return null; // search noise

  if (byAuthors) return { level: "official", reason: "Linked in the paper's arXiv abstract or comments" };
  if (saysUnofficial) return { level: "unofficial", reason: "README describes it as unofficial or a re-implementation" };
  if (mentions && saysOfficial)
    return { level: "official", reason: "README says it's the official code and cites the paper" };
  if (byHF && ownerMatch)
    return { level: "official", reason: "Linked on Hugging Face Papers; owner matches an author" };
  if (byHF) return { level: "likely", reason: "Linked on Hugging Face Papers" };
  if (mentions && ownerMatch) return { level: "likely", reason: "Cites the paper; owner matches an author" };
  return { level: "community", reason: "Cites the paper; no sign it's from the authors" };
}

const RANK = { official: 0, likely: 1, community: 2, unofficial: 3 };

async function kaggleSearch(title, creds, authors) {
  const searchUrl = `https://www.kaggle.com/search?q=${encodeURIComponent(title)}`;
  if (!creds.kUser || !creds.kKey) return { searchUrl, items: [], needsKey: true };
  const headers = { Authorization: "Basic " + btoa(`${creds.kUser}:${creds.kKey}`) };
  const q = encodeURIComponent(title);
  const [k, d] = await Promise.allSettled([
    http(`https://www.kaggle.com/api/v1/kernels/list?search=${q}&pageSize=8&sortBy=relevance`, { headers }),
    http(`https://www.kaggle.com/api/v1/datasets/list?search=${q}&sortBy=votes`, { headers }),
  ]);
  const names = lastNames(authors);
  const items = [];
  const push = (kind, ref, label, author, votes) => {
    if (!ref) return;
    const authorMatch = names.some((n) => norm(`${author || ""} ${ref}`).includes(n));
    items.push({
      platform: "Kaggle",
      name: label || ref,
      url: `https://www.kaggle.com/${kind}/${ref}`,
      stars: votes,
      level: authorMatch ? "likely" : "community",
      reason: authorMatch ? `Kaggle ${kind === "code" ? "notebook" : "dataset"}; author name matches` : `Kaggle ${kind === "code" ? "notebook" : "dataset"}; Kaggle can't confirm it's official`,
    });
  };
  if (k.status === "fulfilled") for (const x of (Array.isArray(k.value) ? k.value : []).slice(0, 5)) push("code", x.ref, x.title, x.author, x.totalVotes);
  if (d.status === "fulfilled") for (const x of (Array.isArray(d.value) ? d.value : []).slice(0, 3)) push("datasets", x.ref, x.title, x.creatorName, x.voteCount);
  const error = k.status === "rejected" && d.status === "rejected" ? k.reason.message : null;
  return { searchUrl, items, error };
}

export async function findCode(identity, settings = {}) {
  const notes = [];
  const title = identity.title || "";
  const ax = identity.arxivId
    ? { id: identity.arxivId, authors: identity.authors || [], text: identity.text || "" }
    : null;

  let hf = null;
  if (ax) {
    try {
      hf = await hfLookup(ax.id);
    } catch {
      /* paper not indexed on Hugging Face */
    }
  }

  const authors = ax?.authors?.length ? ax.authors : hf?.authors || [];
  const arxivLinked = githubRepos(ax?.text);
  const hfLinked = githubRepos(hf?.repo);
  const token = settings.ghToken;

  const candidates = new Map();
  const add = (repo) => repo?.full_name && candidates.set(repo.full_name.toLowerCase(), repo);

  const queries = [];
  if (ax) queries.push(`"${ax.id}" in:readme`);
  if (title) queries.push(`"${title.replace(/"/g, " ")}" in:readme`);

  let githubError = null;
  const searches = await Promise.allSettled(
    queries.map((q) =>
      http(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=8`, {
        headers: ghHeaders(token),
      })
    )
  );
  for (const s of searches) {
    if (s.status === "fulfilled") (s.value.items || []).forEach(add);
    else githubError = s.reason.message;
  }

  // Repos the authors or Hugging Face link directly, even if search missed them.
  const linked = new Set([...arxivLinked, ...hfLinked]);
  await Promise.allSettled(
    [...linked]
      .filter((n) => !candidates.has(n))
      .map(async (n) => add(await http(`https://api.github.com/repos/${n}`, { headers: ghHeaders(token) })))
  );

  const toCheck = [...candidates.values()]
    .sort((a, b) => (linked.has(b.full_name.toLowerCase()) - linked.has(a.full_name.toLowerCase())) || b.stargazers_count - a.stargazers_count)
    .slice(0, 6);

  const checked = await Promise.all(
    toCheck.map(async (repo) => {
      let readme = "";
      try {
        readme = await http(`https://api.github.com/repos/${repo.full_name}/readme`, {
          headers: ghHeaders(token, true),
          text: true,
        });
      } catch {
        /* no README or rate-limited: classification falls back to link signals */
      }
      const verdict = classify({
        repo, readme, arxivId: ax?.id, title, authors, arxivLinked, hfLinked,
      });
      return verdict && {
        platform: "GitHub",
        name: repo.full_name,
        url: repo.html_url,
        stars: repo.stargazers_count,
        ...verdict,
      };
    })
  );

  const github = checked.filter(Boolean).sort((a, b) => RANK[a.level] - RANK[b.level] || b.stars - a.stars);

  let kaggle;
  try {
    kaggle = await kaggleSearch(title, settings, authors);
  } catch (e) {
    kaggle = { searchUrl: `https://www.kaggle.com/search?q=${encodeURIComponent(title)}`, items: [], error: e.message };
  }

  return {
    arxivId: ax?.id || null,
    github,
    kaggle,
    githubError,
    notes,
    resolved: Boolean(ax),
  };
}
