# Tutu Tumble Community Ledger

A private, local-first tool for documenting **publicly visible** communications and screenshots you legitimately received. It is intended for factual timelines and possible confidential moderation reports—not surveillance or identification of anonymous people.

**Separate from tututumble.com**: this is a standalone web app. It does not modify the Tutu Tumble marketing site or waitlist, and it is configured not to be indexed by search engines.

## What works immediately

- Create a personal passphrase to initialize an encrypted browser workspace.
- Log post or comment source URLs, exact quoted text, platform, visible display handle, and neutral contextual notes.
- Categorize *visible account type* (personal, business, official organizational Page, or unknown). No identity or coordination claims are made automatically.
- Attach original PNG/JPG/WebP screenshots; SHA-256 hashes of the original file bytes are saved with each image.
- Search and filter; view sources, time chart, and chronology.
- Export neutral printable report (Print > Save as PDF), spreadsheet CSV, and encrypted JSON backups including screenshots.
- Import public Facebook/Instagram post datasets downloaded as JSON or CSV from Apify.
- Optional Netlify serverless read-only bridge fetches the **last successful** Apify Actor task dataset using an API token stored exclusively on Netlify. It never runs paid scrapers.

## Deployment: GitHub -> Netlify

1. Create a **new**, preferably private GitHub repository (e.g. `tutu-community-ledger`). Add the contents of this project folder at the repository root.
2. In Netlify, choose **Add new project → Import an existing project → GitHub**, select that new repository, and use build command (blank) and publish directory `public`. Netlify will pick up `netlify.toml`, including the optional function.
3. Use a separate site URL from tututumble.com (e.g. a private unadvertised Netlify URL). Do **not** deploy this on top of the public Tutu Tumble landing page.
4. Visit your HTTPS site, create a long unique workspace passphrase, and export an encrypted backup after entering any material. The encrypted database lives in **this browser on this device**.
5. Use a password manager for the passphrase. Clearing site data, browser storage, or switching devices does *not* transfer records automatically.

### One-click static preview

You can drag the `public/` folder into Netlify Drop to get the manual log, import, exports, and encrypted workspace. The optional `/.netlify/functions/pull-public` sync requires a Git-based Netlify build with serverless functions enabled. If the Netlify Drop URL is served over HTTPS, browser encryption and IndexedDB can work.

## Optional Apify task integration

Only use public business or organizational profiles/Pages. Do not attempt to scrape private Facebook groups, bypass membership settings, use someone else's login, obtain hidden account identities, or collect private member lists.

Create and configure an Apify Actor task that collects public posts from permitted public profiles/Pages, and run it in Apify separately. This app **does not start or schedule Actors**. It only reads the last successful task dataset.

In Netlify project environment variables, set:

| Name | Example | Purpose |
|------|---------|---------|
| `APIFY_TOKEN` | (secret Apify API token) | **Server-only** token; never put in browser JS |
| `APIFY_TASK_ID` | `ABCD12345` or `username~task-name` | Task with public source URLs |
| `TT_MONITOR_KEY` | 25+ random characters | Distinct access key entered in the app when fetching |
| `APIFY_ALLOWED_PUBLIC_HANDLES` | `tumbleberrydance,tutu_tumble` | Comma-separated public profile/page handles approved for monitoring |
| `APIFY_ALLOWED_PUBLIC_POST_PREFIXES` | (optional) | Comma-separated exact public post URL prefixes for items lacking approved author handles |

At least one of the public allowlists is mandatory. The backend excludes private Facebook group URLs, enforces the allowlist, returns at most 100 normalized items, and is protected by `TT_MONITOR_KEY` (passed to the function over HTTPS). The server does not store imported content. Avoid reusing a real account password for the monitor key.

Apify endpoint used: `GET https://api.apify.com/v2/actor-tasks/{taskId}/runs/last/dataset/items?status=SUCCEEDED`. See [Apify documentation](https://docs.apify.com/api/v2/actor-task-runs-last-dataset-items-get).

The importer accepts actors with fields like `postUrl`/`url`/`permalink`, `caption`/`text`/`message`, `authorName`/`username`, `postedAt`/`timestamp`. If your specific actor uses different keys, adjust `firstVal` in `app.js` and `read` in the Netlify function.

## Important privacy / evidence limitations

- This app **cannot** determine the real person operating an account, see private group discussions, reveal website visitors, prove coordination, or establish someone's motives.
- No external analytics, pixels, ad identifiers, IP collection, cloud record store, or public activity feed are installed.
- Screenshots from a permissioned group should be obtained voluntarily by people authorized to view them and only shared with appropriate recipients. Respect platform terms and others' privacy.
- The screenshot SHA-256 value establishes the stored file's byte fingerprint, not that its content or attribution is authentic. Save the original source link and context wherever possible.
- `Source checked` confirms only that a human verified the *visible source content*, not that the account label, identity, or post interpretation is independently proven.
- Encrypted local storage protects data at rest from casual access, but the app does not replace professional security controls. Physical or browser compromise, extensions, or unlocked screens may still expose content. A hostile browser extension could read decrypted page content.
- **Back up regularly.** The encryption passphrase is not recoverable.
- A public Netlify URL exposes the empty app shell to visitors, but your records stay encrypted in your browser. Use Netlify site-level access protection if your plan permits for additional defense.
- Browser IndexedDB storage quotas and eviction policies vary; keep encrypted backups after changes and avoid uploading very large images.
- CSV and printable reports contain readable data; handle as sensitive, confidential files.

## QA / maintenance

The app uses plain HTML, CSS, and vanilla JavaScript. No package install or compilation needed. The optional Netlify function uses Node.js built-ins and the global `fetch` API. The repo includes `robots.txt` and Netlify headers to discourage indexing; those are not authentication controls.

To test locally, run `python3 -m http.server 8080` from the `public/` folder and open `http://localhost:8080` (modern browsers treat localhost as a secure context). The Netlify function won't be present in that simple server; use Netlify CLI (`netlify dev`) to test serverless sync once configured.

## Follow-on enhancements

For shared access between you and Sosse, a real authenticated encrypted multi-user backend would be required. Do not email or publish a raw evidence database or expose the Apify token on the client. Do not create a public dashboard of allegations about named people.

## Alternative private deployment: Render Web Service

Because this contains potentially sensitive screenshots, **Render Web Service with HTTP Basic Auth** is an option when a Netlify password-protected project is not available. Set runtime `Node`, build command `node --version`, start command `npm start`, free plan, and the following environment variables:

| Name | Value |
| ---- | ----- |
| `TT_SITE_USER` | A chosen account name without spaces |
| `TT_SITE_PASSWORD` | A unique randomly generated 20+ character password (minimum 16) |
| `APIFY_TOKEN` | Your Apify API token (server-only, optional until connected) |
| `APIFY_TASK_ID` | A public-source Apify task ID (optional until connected) |
| `TT_MONITOR_KEY` | A unique different 25+ character access key (optional until connected) |
| `APIFY_ALLOWED_PUBLIC_HANDLES` | Comma-separated public account handles to monitor (optional until connected) |

Without both site login environment variables, the app deliberately serves only `/healthz` and otherwise returns `503`. Never commit passwords or Apify tokens to GitHub, share them in screenshots, or paste them into a website field meant for code. The optional API is accessible at both `/api/pull-public` and `/.netlify/functions/pull-public`, so the Netlify-compatible frontend needs no changes. On Render, unlike a static Netlify website, Node will run the function via `server.mjs`. If Render sleeps on its free plan, first visits may take additional time.

The browser workspace is encrypted at rest and is **not** shared between devices even if two people know the site's login password. Back up the encrypted vault regularly.
