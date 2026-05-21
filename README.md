# GringoJobs

A static job board that aggregates remote-friendly US tech roles relevant to LATAM talent. Built with vanilla JS + Vite, deployed to GitHub Pages. Jobs are pre-fetched at build time — no backend, no API key exposed in the browser.

---

## Table of Contents

1. [How it works (big picture)](#how-it-works-big-picture)
2. [Project structure](#project-structure)
3. [File-by-file breakdown](#file-by-file-breakdown)
   - [scripts/fetch-jobs.js](#scriptsfetch-jobsjs)
   - [src/api.js](#srcapijs)
   - [src/main.js](#srcmainjs)
   - [index.html](#indexhtml)
   - [vite.config.js](#viteconfigjs)
   - [.github/workflows/deploy.yml](#githubworkflowsdeployyml)
4. [Data flow diagram](#data-flow-diagram)
5. [Local development setup](#local-development-setup)
6. [Deploying to GitHub Pages](#deploying-to-github-pages)
7. [GitHub Secrets setup](#github-secrets-setup)
8. [How jobs are fetched (Apify explained)](#how-jobs-are-fetched-apify-explained)
9. [Caching strategy](#caching-strategy)
10. [Security model](#security-model)
11. [Customizing jobs (titles, locations, limits)](#customizing-jobs-titles-locations-limits)
12. [How the experience filter works](#how-the-experience-filter-works)
13. [Troubleshooting](#troubleshooting)

---

## How it works (big picture)

The core idea is that **jobs are fetched once at deploy time, not on every page load**.

Here is the simplified flow:

```
GitHub Actions runs daily at 6am UTC
  → runs scripts/fetch-jobs.js with your secret APIFY_TOKEN
    → calls Apify API (server-side, token never touches the browser)
      → Apify scrapes job listings from 100s of company career pages
        → returns JSON array of job objects
          → script writes them to public/jobs.json
            → Vite builds the site (public/jobs.json becomes dist/jobs.json)
              → GitHub Pages deploys dist/
                → User visits site → browser fetches jobs.json (instant, just a file)
```

Contrast this with the old approach where the browser itself was calling Apify on every visit, which:
- Exposed the API token to anyone who opened DevTools
- Made every page load wait 1–5 minutes for Apify to run its actor
- Hit the Apify API on every single visitor's browser

---

## Project structure

```
gringojobs/
├── .github/
│   └── workflows/
│       └── deploy.yml          # CI/CD: fetch jobs + build + deploy
├── public/
│   ├── favicon.svg
│   ├── jobs.json               # generated at build time, NOT committed to git
│   └── (other static assets)
├── scripts/
│   └── fetch-jobs.js           # Node script that calls Apify and writes jobs.json
├── src/
│   ├── api.js                  # fetch logic + localStorage cache + job normalization
│   ├── main.js                 # all UI logic (DOM manipulation, filtering, rendering)
│   └── style.css               # all styles
├── index.html                  # the entire HTML structure of the app
├── vite.config.js              # Vite config (dev proxy for local Apify calls)
├── package.json
├── .gitignore
└── .env                        # local secrets (NOT committed, see .env.example)
```

> **Why is `public/jobs.json` not in git?**
> It is generated fresh on every deploy by `scripts/fetch-jobs.js`. Committing it would mean stale data in the repo and merge conflicts every day. It is listed in `.gitignore`.

---

## File-by-file breakdown

### scripts/fetch-jobs.js

This is a **Node.js script** (not browser code). It runs inside GitHub Actions before the Vite build.

**What it does:**
1. Reads `APIFY_TOKEN` and `APIFY_ACTOR_ID` from environment variables (never hardcoded).
2. Sends a `POST` request to the Apify API's `run-sync-get-dataset-items` endpoint.
   - "sync" means: run the actor AND wait for it to finish AND return the results, all in one HTTP call.
   - This is fine here because it runs in a GitHub Actions runner (not in the user's browser), so a 5-minute wait is acceptable.
3. Passes a configuration body that tells the Apify actor what to scrape:
   - `titleSearch`: array of job titles to look for
   - `locationSearch`: array of countries/regions to filter by
   - `limit`: max number of jobs to return (currently 1000)
   - `timeRange: '7d'`: only jobs posted in the last 7 days
   - `aiEmploymentTypeFilter: ['FULL_TIME']`: only full-time roles
   - `'remote only (legacy)': true`: only remote-friendly jobs
4. Writes the result as `public/jobs.json`.

**Why Node 20?** The script uses top-level `await` (no wrapping `async function main()`) and native `fetch` (no `node-fetch` package needed). Both require Node 18+.

**What happens if it fails?** The script calls `process.exit(1)` on any error, which causes the GitHub Actions job to fail. This prevents deploying a site with no jobs (better to keep the old version live than deploy an empty site). You will get an email from GitHub about the failed action.

---

### src/api.js

This is **browser code** bundled by Vite. It is the data layer of the app.

#### Environment detection

```js
import.meta.env.DEV   // true when running `npm run dev`, false in production build
import.meta.env.BASE_URL  // the base path of the site (e.g. "/" or "/gringojobs/")
```

`import.meta.env` is Vite's way of exposing environment info. These values are **replaced at build time** with their actual values. There is no runtime environment lookup.

#### `fetchJobsFromApify({ forceRefresh })`

The main export called by `main.js`. It decides where to get jobs:

- **In production** → calls `fetchProd()`, which does `fetch('/jobs.json')` (the pre-built static file). This is nearly instant — it's just a file download, usually cached by the browser.
- **In development** → calls `fetchDev()`, which POSTs to the Apify API via Vite's dev proxy (so the real URL `https://api.apify.com` is not exposed in the browser even locally).

Both paths go through the localStorage cache first (see Caching section).

#### `fetchProd()`

```js
const res = await fetch(`${import.meta.env.BASE_URL}jobs.json`)
```

Uses `BASE_URL` instead of hardcoding `/jobs.json` because GitHub Pages can serve the site at a subpath like `https://username.github.io/gringojobs/`. `BASE_URL` is automatically set by Vite based on the `base` config option.

#### `fetchDev()`

Reads `VITE_APIFY_TOKEN` and `VITE_APIFY_ACTOR_ID` from `.env` and calls the Apify actor through the Vite dev proxy at `/apify/...`. The Vite proxy rewrites this to `https://api.apify.com/v2/...` transparently. This means your token never appears in a cross-origin request from the browser.

> **Important**: `VITE_` prefixed env vars get baked into the JavaScript bundle at build time. This is fine for development because the bundle is only on your machine. In production, we do NOT use any `VITE_APIFY_TOKEN` — the `fetchDev()` function is dead code in production builds because Vite tree-shakes it out via the `import.meta.env.DEV` check.

#### `normalizeJob(job)`

The raw Apify job object has many fields with inconsistent naming. This function converts it into a clean, predictable shape that the UI can rely on:

| Raw field | Normalized field | Notes |
|---|---|---|
| `job.ai_work_arrangement` | `workType` | "Remote Solely", "Hybrid", "On-site" |
| `job.ai_salary_minvalue` | `salaryMin` | annualized if hourly (×2080) |
| `job.ai_experience_level` | `experienceLevel` | run through `normalizeExp()` |
| `job.locations_derived` | `location` | formatted as "City, State, Country" |
| `job.description_text` | `description` | truncated to 500 chars |

#### `normalizeExp(raw)`

The Apify actor returns free-text experience levels from job postings (e.g. "Mid-Senior level", "Entry level", "Associate"). This function maps them to consistent values that match the `<select>` filter options in the HTML:

```
"intern..." → "Internship"
"entry..." or "junior..." → "Entry Level"
"associate..." or "mid..." → "Mid Level"
"senior..." or "sr..." → "Senior Level"
"lead..." or "principal..." or "staff..." → "Lead"
"director...", "manager...", "executive...", "vp..." → "Manager+"
```

If nothing matches, the raw string is returned as-is (better than losing the data).

#### localStorage cache

`getCachedJobs()` / `setCachedJobs()` / `clearCache()` manage a simple cache in the browser's localStorage. The cache stores the full array of raw job objects plus a timestamp. On load, if cached data is less than 6 hours old, it is used immediately without fetching `jobs.json` again.

Why 6 hours? The site redeploys once a day (6am UTC cron). Caching longer than 24h risks showing very stale jobs. 6h is a reasonable middle ground that avoids repeat network requests for a user who refreshes the page.

---

### src/main.js

All UI logic. No framework — plain DOM manipulation.

#### Initialization

```js
init() → bindEvents() + loadJobs()
```

`loadJobs()` does two things in parallel:
1. Immediately renders whatever is in localStorage cache (so the user sees jobs instantly if they've visited before).
2. Also kicks off a fresh `fetchJobs(false)` in the background. If the fetch returns newer data, the UI is re-rendered.

This pattern is called **stale-while-revalidate** and makes the app feel fast even on slow connections.

#### Filtering (`applyFilters`)

All filtering is done **client-side** on the already-loaded `state.jobs` array. No new network requests on filter changes. Filters:

- **Text search**: matches against title, company name, description, and salary string
- **Work arrangement**: exact match against `j.workType` (e.g. "Remote Solely")
- **Experience**: exact match against `j.experienceLevel` (normalized values from `normalizeExp`)
- **Employment type**: `includes()` match against `j.employmentType` (e.g. "FULL_TIME")
- **Location**: partial match against the job's location, cities, regions, and countries arrays
- **Salary only**: filters out jobs where `salaryMin === 0`

#### `renderCard(job)`

Builds the HTML string for one job card using template literals. Uses `escHtml()` on all user-facing strings to prevent XSS — if a job title contained `<script>` it would be rendered as text, not executed.

---

### index.html

The single HTML file. A few things worth noting:

- **All element IDs** must match what `main.js` queries with `$('#id')`. If you rename an ID here, update `main.js` too.
- The **experience filter `<select>`** option values must exactly match the strings returned by `normalizeExp()` in `api.js`. If you add a new experience level, add it in both places.
- The **work type chip `data-value` attributes** must match the `ai_work_arrangement` values that Apify returns ("Remote Solely", "Hybrid", "On-site"). The "All" chip has `data-value=""`.

---

### vite.config.js

```js
server: {
  proxy: {
    '/apify': {
      target: 'https://api.apify.com',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/apify/, '/v2'),
    }
  }
}
```

This proxy only runs during `npm run dev`. It rewrites any request from the browser to `/apify/...` into a server-side request to `https://api.apify.com/v2/...`. The browser never sees the Apify domain (avoiding CORS) and the request goes through Node, not the browser.

In production (`npm run build`), this proxy does not exist. But in production, `fetchDev()` is never called anyway — only `fetchProd()` runs, loading the static `jobs.json`.

---

### .github/workflows/deploy.yml

This is the CI/CD pipeline. It runs in two situations:

1. **Every push to `main`** (manual deploy when you change code)
2. **Every day at 6am UTC** via the cron schedule `0 6 * * *`

The steps in order:

| Step | What it does |
|---|---|
| `actions/checkout@v4` | Clones your repo into the runner |
| `actions/setup-node@v4` | Installs Node 20 |
| `npm ci` | Installs exact versions from `package-lock.json` (faster + reproducible) |
| `node scripts/fetch-jobs.js` | Calls Apify, writes `public/jobs.json`. Uses `APIFY_TOKEN` and `APIFY_ACTOR_ID` secrets. |
| `npm run build` | Vite bundles `src/` + copies `public/` (including the freshly written `jobs.json`) into `dist/` |
| `actions/configure-pages@v4` | Prepares GitHub Pages settings |
| `actions/upload-pages-artifact@v3` | Packages `dist/` as a Pages artifact |
| `actions/deploy-pages@v4` | Publishes the artifact to GitHub Pages |

**The key insight**: `public/jobs.json` is written in step 4, then Vite copies it to `dist/jobs.json` in step 5. By the time the site is deployed, `jobs.json` is a normal static file alongside `index.html`.

---

## Data flow diagram

```
┌─────────────────────────────────────────────────────┐
│                  GitHub Actions                       │
│                                                       │
│  APIFY_TOKEN (secret) ──┐                            │
│                          ↓                            │
│  scripts/fetch-jobs.js  ──→  api.apify.com           │
│         ↓                         ↓                  │
│  public/jobs.json ←── job data ───┘                  │
│         ↓                                            │
│  npm run build (Vite)                                │
│         ↓                                            │
│  dist/ (static files including jobs.json)            │
│         ↓                                            │
│  GitHub Pages deployment                             │
└─────────────────────────────────────────────────────┘

        ↕ (once per day, or on every push)

┌─────────────────────────────────────────────────────┐
│                  User's browser                      │
│                                                       │
│  Visits site → fetches jobs.json (static file)       │
│       ↓                                              │
│  localStorage cache hit? → render immediately        │
│       ↓ (if miss)                                    │
│  Fetch jobs.json → parse → normalize → render        │
│       ↓                                              │
│  Cache result in localStorage for 6 hours            │
└─────────────────────────────────────────────────────┘
```

---

## Local development setup

**1. Clone and install**

```bash
git clone git@github.com:yllenfer/gringojobs.git
cd gringojobs
npm install
```

**2. Create your `.env` file**

Copy the example and fill in your Apify credentials:

```bash
cp .env.example .env
```

Edit `.env`:
```
APIFY_TOKEN=apify_api_your_token_here
APIFY_ACTOR_ID=fantastic-jobs~career-site-job-listing-api
VITE_APIFY_TOKEN=apify_api_your_token_here
VITE_APIFY_ACTOR_ID=fantastic-jobs~career-site-job-listing-api
```

> You need both the plain (`APIFY_TOKEN`) and `VITE_` prefixed versions:
> - `APIFY_TOKEN` is read by `scripts/fetch-jobs.js` (Node process)
> - `VITE_APIFY_TOKEN` is read by `src/api.js` (Vite dev server, injected into the browser bundle at build time)

**3. Option A: Run the fetch script first (recommended for realistic data)**

```bash
npm run fetch-jobs   # writes public/jobs.json
npm run dev          # start dev server
```

The site loads from the local `jobs.json` in development if you do this. But since `import.meta.env.DEV` is `true`, it will actually call Apify through the proxy, not the static file.

**4. Option B: Just start the dev server (calls Apify live)**

```bash
npm run dev
```

On page load the browser will call Apify through the Vite proxy. This is slower (actor takes 1–5 min to run) but gives you live data.

---

## Deploying to GitHub Pages

**One-time setup:**

1. Go to your repo on GitHub → **Settings → Pages**
2. Set **Source** to "GitHub Actions" (not "Deploy from a branch")
3. Add your secrets (see next section)
4. Push to `main` — the workflow runs automatically

After that, every push to `main` and every day at 6am UTC the workflow runs, refreshes jobs, and redeploys the site.

---

## GitHub Secrets setup

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|---|---|
| `APIFY_TOKEN` | Your Apify API token (from https://console.apify.com/settings/integrations) |
| `APIFY_ACTOR_ID` | `fantastic-jobs~career-site-job-listing-api` |

> **Secret names are case-sensitive.** The workflow references them as `secrets.APIFY_TOKEN` and `secrets.APIFY_ACTOR_ID`. A typo here means the script gets an empty string and fails with "APIFY_TOKEN env var is required".

> **`VITE_APIFY_TOKEN` is NOT needed as a GitHub secret.** In production, `fetchDev()` is never called. The browser loads `jobs.json` directly. The VITE_ vars are only needed in your local `.env`.

---

## How jobs are fetched (Apify explained)

[Apify](https://apify.com) is a web scraping platform. The actor `fantastic-jobs~career-site-job-listing-api` is a pre-built scraper that:

1. Takes your search parameters (titles, locations, time range, etc.)
2. Scrapes hundreds of company career sites and LinkedIn
3. Uses AI to enrich the data (salary estimates, experience level, work arrangement)
4. Returns a JSON array of job objects

The API endpoint used is `run-sync-get-dataset-items`, which means:
- **run**: actually execute the actor
- **sync**: wait for it to complete before responding (as opposed to async where you get a run ID and poll later)
- **get-dataset-items**: and return the output dataset in the response body

This is why local dev calls can take 1–5 minutes — you're waiting for the scraper to finish. In production this wait happens in GitHub Actions, not in the user's browser.

**Actor output fields used by this app:**

| Apify field | Used for |
|---|---|
| `title` | Job title |
| `organization` | Company name |
| `organization_logo` | Company logo URL |
| `url` | Link to apply |
| `locations_derived` | Structured location data |
| `ai_work_arrangement` | "Remote Solely" / "Hybrid" / "On-site" |
| `ai_salary_minvalue` / `ai_salary_maxvalue` | Salary range |
| `ai_salary_currency` | "USD", "MXN", etc. |
| `ai_salary_unittext` | "HOUR" or "YEAR" |
| `ai_experience_level` | Raw experience level string |
| `ai_employment_type` | ["FULL_TIME"] etc. |
| `description_text` | Plain text job description |
| `date_posted` | ISO date string |
| `remote_derived` | Boolean, AI-inferred |
| `countries_derived` / `cities_derived` / `regions_derived` | Arrays for location filtering |

---

## Caching strategy

The app uses a two-layer cache:

**Layer 1: Browser HTTP cache**
When the browser fetches `jobs.json`, the server (GitHub Pages) sets cache headers. On subsequent visits the browser may serve it from disk without a network request.

**Layer 2: localStorage cache (6 hours)**
After fetching `jobs.json`, the raw job array is stored in localStorage with a timestamp. On the next page load, if the data is less than 6 hours old, it is used immediately without any network request. This makes the app feel instant on repeat visits.

The "Refresh Jobs" button calls `clearCache()` then re-fetches, bypassing both layers (well, it bypasses the localStorage layer — the browser HTTP cache is separate).

**stale-while-revalidate pattern in `loadJobs()`:**
1. Render cached data immediately (if any) → user sees jobs within milliseconds
2. Simultaneously fetch fresh data in the background
3. When fresh data arrives, re-render (the UI updates silently)

---

## Security model

| Threat | How it's handled |
|---|---|
| API token exposed in browser | Token only used in GitHub Actions (server-side Node). Browser never sees it. |
| XSS via job data | All job text is passed through `escHtml()` before being inserted into the DOM. |
| XSS via job URLs | Apply links use `href` attribute (not `innerHTML`), and have `rel="noopener"` to prevent the new tab from accessing `window.opener`. |
| Malicious job data in localStorage | localStorage is parsed with try/catch. Malformed data is discarded. |
| CORS | In dev: Vite proxy avoids CORS entirely. In prod: browser fetches from same origin (GitHub Pages). |

---

## Customizing jobs (titles, locations, limits)

All customization happens in **`scripts/fetch-jobs.js`** — this is the single source of truth for what gets fetched. Changes here take effect on the next deploy.

**Add a job title:**
```js
const TITLES = [
  // ... existing titles
  'Rust Engineer',       // ← add here
]
```

**Add a country:**
```js
const LOCATIONS = [
  // ... existing locations
  'Spain',               // ← add here (might be useful for Spanish-speaking market)
]
```

**Fetch more jobs:**
```js
body: JSON.stringify({
  limit: 2000,           // ← increase (max is 5000, but more = slower actor run)
  timeRange: '14d',      // ← increase time window ('24h', '7d', '14d', '30d')
  ...
})
```

> After editing, push to `main` and the workflow will deploy with the new settings.

For local testing after changes:
```bash
APIFY_TOKEN=your_token node scripts/fetch-jobs.js
npm run dev
```

---

## How the experience filter works

The experience filter in the sidebar uses values that must match what `normalizeExp()` in `src/api.js` returns.

The mapping (defined in `normalizeExp`):

| If API returns (case-insensitive) | Filter value shown |
|---|---|
| Contains "intern" | `Internship` |
| Contains "entry" or "junior" | `Entry Level` |
| Contains "associate" or "mid" | `Mid Level` |
| Contains "senior" or "sr" | `Senior Level` |
| Contains "lead", "principal", "staff" | `Lead` |
| Contains "director", "manager", "executive", "vp" | `Manager+` |
| Anything else | Raw string (not filterable via select, shown in card) |

If you notice that filter returns 0 results, it usually means the API started returning different strings. Log `job.ai_experience_level` in `normalizeJob()` to see the raw values, then update the mapping.

---

## Troubleshooting

**"Failed to load jobs" on the live site**

1. Go to your repo → Actions tab → check if the last workflow run succeeded.
2. If it failed at the "Fetch jobs at build time" step, the secret is probably wrong. Re-check that `APIFY_TOKEN` in GitHub Secrets matches exactly.
3. If it succeeded but the site shows no jobs, open DevTools → Network → look at the `jobs.json` request. A 404 means the file wasn't generated. A 200 with `[]` means Apify returned 0 jobs (check your search terms).

**Jobs not refreshing**

The daily cron runs at 6am UTC. If you need jobs refreshed immediately, push any commit to `main` (even an empty commit: `git commit --allow-empty -m "refresh jobs"`).

**`APIFY_TOKEN env var is required` error in Actions**

The secret name in your repo does not match what the workflow expects. The workflow uses `secrets.APIFY_TOKEN` — your secret must be named exactly `APIFY_TOKEN` (all caps, underscore, no spaces).

**Local dev: actor takes too long / times out**

The `run-sync-get-dataset-items` endpoint waits for the actor to finish. During local dev this can take 1–5 minutes. Either wait it out, or pre-generate `jobs.json` once with `npm run fetch-jobs` and then rely on the localStorage cache while developing.

**Experience filter shows 0 results**

The filter values in the HTML must match exactly what `normalizeExp()` returns. See the table in the section above. You can debug by adding `console.log(j.experienceLevel)` inside `applyFilters` in `main.js`.

**The site works on `localhost` but not on GitHub Pages**

Most likely cause: a `BASE_URL` mismatch. If your repo is `username/gringojobs` (not a root `username.github.io` repo), GitHub Pages serves it at `https://username.github.io/gringojobs/`. Vite needs to know this to build correct asset paths. Add to `vite.config.js`:

```js
export default {
  base: '/gringojobs/',   // ← your repo name
  server: { proxy: { ... } }
}
```

Then update the GitHub Pages source to point to the same path. If everything is already working, you do not need this.
