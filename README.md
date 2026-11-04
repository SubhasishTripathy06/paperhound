# Paperhound

A Chrome/Edge extension that answers two questions about a research paper:

1. **Where was it published?** CVPR, ICCV, ECCV, NeurIPS, AAAI, Pattern Recognition, CAAI or IEEE.
2. **Where is the code, and is it the official implementation?** GitHub and Kaggle.

Give it a title, an arXiv ID, a DOI or a link. It works out the paper's identity first, then searches by both the title and the exact IDs, which is more accurate than searching by title alone.

---

## Contents

- [Features](#features)
- [Install](#install)
- [How to use it](#how-to-use-it)
- [How it works](#how-it-works)
- [Venues and how to add more](#venues-and-how-to-add-more)
- [How "official code" is decided](#how-official-code-is-decided)
- [Optional keys](#optional-keys)
- [Permissions](#permissions)
- [Privacy](#privacy)
- [Project layout](#project-layout)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)

---

## Features

- **Venue check** across DBLP, Semantic Scholar, OpenAlex and Crossref, plus arXiv's journal reference and DOI prefixes.
- **Accepts anything:** a title, `arXiv:2306.14141`, a DOI, or a link to an arXiv/CVF page or PDF.
- **ID + title matching:** the paper is resolved to an arXiv ID, DOI and author list first, then every source is queried both ways. Exact ID matches aren't dropped because of title wording differences.
- **Workshop detection:** a paper that only appears at a workshop (for example "CVPR Workshops") is flagged separately from the main conference.
- **Code search** on GitHub, with each repo labelled *Official*, *Likely official*, *Community* or *Unofficial*, and the reason shown.
- **Kaggle** search link, with an optional notebook/dataset listing if you add credentials.
- **Works where you read papers:**
  - the toolbar popup, on any page
  - a floating button on arXiv, OpenReview, CVF, NeurIPS, IEEE Xplore and other paper pages
  - a right-click menu on highlighted text, links and pages
  - a keyboard shortcut (`Alt+Shift+P`)
  - arXiv PDFs and ID-named PDF files in the browser's PDF viewer

---

## Install

Paperhound isn't on a web store; load it as an unpacked extension.

1. **Unzip** `paperhound.zip`. Open the resulting folder and confirm `manifest.json` is directly inside it (not inside another folder).
2. Open the extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the folder that contains `manifest.json`.
5. Pin the Paperhound icon to your toolbar.

To update, remove the old copy, unzip the new one, and load it the same way. If the new version asks for extra permissions, approve them.

---

## How to use it

### The toolbar popup

Click the icon (or press `Alt+Shift+P`). The box fills in automatically, in this order:

1. text you highlighted on the page
2. an arXiv ID found in the tab's address (arXiv abs/PDF links, or a local file named like `2306.14141v1.pdf`)
3. an arXiv ID found in the tab's title
4. IDs in the page's metadata (`citation_arxiv_id`, `citation_doi`)
5. a title taken from a CVF PDF filename
6. the page title, if it looks like a real title
7. your clipboard, as a last resort (the popup tells you when it does this)

You can edit the box or type anything yourself, then click **Check venues and code**.

The popup shows:

- the **matched paper** (title, arXiv ID, DOI, year, authors), so you can spot a wrong match
- a **venue ledger** with one row per venue: found (with year and link) or not found
- a **Code** section with repos, their status, and the reason for it

### The on-page button

On supported paper pages a round Paperhound button appears at the bottom right. Click it to check the page's own paper and see results in a panel on the page. If you **highlight text first**, it checks the highlighted text instead.

Supported pages: arXiv (`/abs/`), OpenReview, CVF Open Access, NeurIPS proceedings, IEEE Xplore, Semantic Scholar, AAAI (OJS), ScienceDirect, SpringerLink chapters, and Hugging Face Papers.

The button only runs when you click it. It does not check pages automatically, to stay inside GitHub's rate limit.

### Right-click menu

Right-click highlighted text, a link, or a page and choose **Check with Paperhound**. Results open in a small window. A link to an arXiv abstract or PDF works directly.

### PDFs

Browser PDF viewers don't let extensions read highlighted text or add buttons. Paperhound works around this:

- **arXiv PDFs and ID-named files** are recognised from the address or tab title.
- **Other PDFs:** highlight the title, press `Ctrl+C`, open Paperhound and the box fills from your clipboard (or click **Paste**).
- The right-click menu on highlighted text may also work in some viewers.

---

## How it works

1. **Resolve.** Your input is parsed into a title, arXiv ID and/or DOI. An arXiv ID is looked up on arXiv (title, authors, comments, abstract, journal reference, DOI). A DOI is mapped through Semantic Scholar. A bare title is searched on arXiv and Semantic Scholar together to recover the IDs.
2. **Venue check.** Each source is searched by title and looked up by ID:
   - **DBLP:** title search; venue names and DBLP keys such as `conf/cvpr/...`
   - **Semantic Scholar:** title search, plus lookup by arXiv ID and DOI
   - **OpenAlex:** title search, plus lookup by DOI and arXiv DOI
   - **Crossref:** title search, plus lookup by DOI
   - **arXiv journal-ref** and **DOI prefixes** (for example `10.1109/cvpr`, `10.1609/aaai`, `10.1016/j.patcog`, `10.1049/cit2`) as direct evidence

   Title-search results are kept only if the title closely matches (word-set similarity of 0.85 or more). Results from an ID lookup are kept as exact matches.
3. **Code check.** GitHub is searched for repositories whose README mentions the arXiv ID or the exact title. Repos the authors link in their arXiv abstract or comments, or that Hugging Face Papers links, are added directly. The top candidates' READMEs are read and classified.

---

## Venues and how to add more

The venue list is at the top of `search.js`:

```js
export const VENUES = [
  { name: "CVPR", test: (h) => /\b(CVPR|Computer Vision and Pattern Recognition)\b/i.test(h) },
  ...
];
```

Each venue has a `test` function that receives the venue name plus any DBLP key. To add a venue (ICLR, ICML, ACL and so on), add one line with a regular expression for its name and abbreviation, then reload the extension.

Notes on current matching:

- **Pattern Recognition** means the Elsevier journal. It deliberately does not match "Computer Vision and Pattern Recognition", "International Conference on Pattern Recognition", "Pattern Recognition Letters" or "Pattern Recognition and Image Analysis".
- **IEEE** matches any IEEE venue, so CVPR and ICCV papers will usually show both.
- **CAAI** matches CAAI Transactions on Intelligence Technology and CAAI Artificial Intelligence Research.

---

## How "official code" is decided

Each GitHub repo that cites the paper gets one of four labels:

| Label | Meaning |
|---|---|
| **Official** | Linked in the paper's arXiv abstract or comments; or the README says it is the official code and cites the paper; or Hugging Face Papers links it and the repo owner matches an author's name |
| **Likely official** | Linked on Hugging Face Papers; or the README cites the paper and the owner matches an author's name |
| **Community** | Cites the paper, but nothing suggests it comes from the authors |
| **Unofficial** | README calls itself unofficial or a re-implementation |

Treat this as strong evidence, not proof. Repos under an organisation account (for example `facebookresearch`) can't be matched to an author by name, so they reach *Official* only through the other signals.

Kaggle results are labelled *Community* unless an author's name matches, because Kaggle can't confirm that a notebook or dataset is official.

---

## Optional keys

Open **Optional keys** at the bottom of the popup.

| Field | What it does |
|---|---|
| **GitHub token** | Raises GitHub's search rate limit (about 10 searches a minute without a token). No special scopes are needed for public repositories. |
| **Kaggle username and API key** | Lets the extension list matching Kaggle notebooks and datasets. Without them you get a link to a Kaggle search instead. |

Keys are stored in the browser's local extension storage and are sent only to GitHub and Kaggle respectively.

---

## Permissions

| Permission | Why it's needed |
|---|---|
| `activeTab`, `scripting` | Read highlighted text and page metadata from the current page when you open the popup |
| `tabs` | Read the tab's address and title. PDF viewers hide these otherwise, and arXiv PDFs are recognised from them |
| `storage` | Save your optional keys locally |
| `contextMenus` | The "Check with Paperhound" right-click item |
| `clipboardRead` | The **Paste** button and the clipboard fallback for PDFs |
| Host access: `dblp.org`, `api.semanticscholar.org`, `api.openalex.org`, `api.crossref.org`, `export.arxiv.org`, `huggingface.co`, `api.github.com`, `www.kaggle.com` | The data sources listed above |
| Content script on the paper sites listed under [The on-page button](#the-on-page-button) | The floating button and results panel |

---

## Privacy

- Paperhound has no server of its own and collects nothing.
- When you run a check, the **title, arXiv ID or DOI** is sent to the data sources listed above. If you added keys, they are sent to GitHub and Kaggle only.
- The clipboard is read only when you click **Paste**, or when the popup opens and nothing else on the page could be used.
- Nothing is read from a page until you click the extension, the on-page button, or the right-click item.

---

## Project layout

```
paperhound/
├── manifest.json     Extension manifest (Manifest V3)
├── popup.html        Popup markup
├── popup.css         Styles, shared by the popup and the on-page panel
├── popup.js          Popup logic: reads the tab, runs the checks, shows results
├── background.js     Service worker: answers the on-page panel, right-click menu
├── content.js        Floating button and results panel on paper pages
├── resolve.js        Parses input and resolves it to title + arXiv ID + DOI + authors
├── search.js         Venue list and the DBLP / Semantic Scholar / OpenAlex / Crossref checks
├── code.js           GitHub and Kaggle search, official-implementation classification
├── render.js         Result rendering shared by the popup and the on-page panel
└── icons/            Toolbar and store icons
```

There is no build step and no dependencies. Edit the files and reload the extension.

---

## Limitations

- **A "Not found" is not proof.** New papers, renamed papers, and papers the indexes haven't picked up yet can be missed.
- **Highlighted text in PDF viewers can't be read** by any extension. Use the clipboard, the right-click menu, or an arXiv link or ID-named file.
- **Official-code detection is a judgment** from links, README wording and owner names. It can be wrong in both directions.
- **Rate limits.** Semantic Scholar and GitHub may refuse requests when used heavily without a key. The popup lists which sources were unavailable.
- **Kaggle listing** uses Kaggle's username-and-key API. If your account uses a newer token format it may be rejected, and the popup will show the error.
- Written for Chromium browsers (Chrome, Edge). Firefox isn't supported.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Manifest file is missing or unreadable" | You selected a folder one level too high. Select the folder that has `manifest.json` directly inside it. |
| The popup box is empty on a PDF | Highlight the title, press `Ctrl+C`, reopen Paperhound or click **Paste**. Make sure you loaded the latest version so the `tabs` permission is active. |
| The floating button doesn't appear | Reload the page after installing or updating. Check the site is in the supported list above. |
| "rate-limited" shown for a source | Wait a minute and retry. For GitHub, add a token under **Optional keys**. |
| A different paper was matched | Check the matched-paper box at the top of the results. Paste the arXiv ID or DOI instead of the title for an exact match. |
| A venue you expect is "Not found" | The paper may be indexed under another name, or too new. Try the arXiv ID, and check the venue's own site. |
