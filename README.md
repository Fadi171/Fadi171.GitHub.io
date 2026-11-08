# Alibaba Cloud CDN with GitHub Pages

A static website (HTML, CSS, vanilla JavaScript, JSON) hosted on **GitHub Pages**. It acts as the
**origin server** for an **Alibaba Cloud CDN** accelerated domain.

```
User Browser → Accelerated Domain (CNAME) → Alibaba Cloud CDN Edge → GitHub Pages Origin
```

## Structure

```text
.
├── index.html          # single page: hero, verification, architecture, JSON demo, cache rules, download, tech info
├── css/style.css       # responsive styles, light and dark
├── js/app.js           # SITE_CONFIG (student data and version) + fetch("api/news.json", { cache: "no-store" })
├── images/logo.png     # original logo (256×256)
├── api/news.json       # {"message": "...Version N.", "version": N}
├── downloads/guide.pdf # short original guide
├── README.md
└── .gitignore
```

All asset paths are relative, so the site works at `https://<username>.github.io/` and behind the CDN
domain without changes. No build step, no backend.

## Configure

Edit the `SITE_CONFIG` block at the top of `js/app.js`:

```js
const SITE_CONFIG = {
  studentName: "<STUDENT_NAME>",
  studentId: "<STUDENT_ID>",
  verificationToken: "<VERIFICATION_TOKEN>",
  version: 1,
  lastUpdated: "2026-11-05T00:00:00Z",
  originHost: "<USERNAME>.github.io",
  cdnDomain: "<cdn.your-domain.com>"
};
```

Any value that still contains `<...>` is highlighted on the page as a placeholder.

## Run locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Opening `index.html` directly as a `file://` URL blocks `fetch()` in most browsers. Use a local server.

## Deploy to GitHub Pages

1. Create a public repository named exactly **`<username>.github.io`**. A user site is served at the
   domain root, so the CDN paths are `/index.html`, `/api/news.json` and so on.
2. Push these files to the root of the `main` branch.
3. **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
4. **Do not** set a *Custom domain* in GitHub Pages and **do not** add a `CNAME` file. The custom
   domain belongs to Alibaba CDN. If GitHub Pages also has it, `<username>.github.io` starts
   redirecting to the CDN domain and the CDN loops back to itself.
5. Wait for the Pages deployment to finish (Actions tab), then open `https://<username>.github.io/`.

## Version history

| Version | Commit message |
|---|---|
| 1 | `Create Version 1 GitHub Pages origin` |
| 2 | `Update to Version 2 for CDN refresh test` |

Version 2 changes `version` and `lastUpdated` in `js/app.js` and the message and version in `api/news.json`.
