# Zaliels

Static storefront (HTML, CSS, vanilla JS) + Firebase-backed admin dashboard. No build step, no npm dependencies (the Firebase SDK is loaded from Google's CDN, pinned to 10.14.1).

| Path | Purpose |
|---|---|
| `index.html`, `style.css`, `script.js`, `shop.js` | Storefront (unchanged design/features) |
| `catalogue.js` | Loads **published** products from Firestore into the storefront |
| `firebase-config.js` | **Your Firebase web config (placeholders until you fill it in)** |
| `products.js` | Site config + original catalogue (migration source / fallback while Firebase is unconfigured) |
| `admin/` | Protected dashboard at `/admin/` (login, products CRUD, image upload, publish, migration) |
| `firestore.rules`, `storage.rules`, `firebase.json` | Security rules |
| `backup/products.original.json` | Backup of the original hardcoded data |
| `vercel.json`, `.vercelignore` | Redirect `/admin`, security headers, files not to publish |

## 1. Firebase setup
1. [console.firebase.google.com](https://console.firebase.google.com) → create a project → add a **Web app** → copy the config into `firebase-config.js` (replace every `REPLACE_ME`). These values are public by design; never put a service-account key in the repo.
2. **Authentication** → Sign-in method → enable **Email/Password**. (Optionally disable public sign-ups under Settings → User actions.)
3. **Firestore Database** → create database (production mode).
4. **Storage** → get started. ⚠️ Since 3 Feb 2026 Cloud Storage for Firebase requires the pay-as-you-go **Blaze** plan (it has a free monthly quota, but needs a billing account). If you don't want that, skip Storage: the dashboard also accepts pasted `https://` image URLs, and everything else works on the free Spark plan.
5. Publish the rules: paste `firestore.rules` into Firestore → Rules, and `storage.rules` into Storage → Rules (or `npx firebase-tools deploy --only firestore:rules,storage` with the CLI). Storage rules read `/admins/` from Firestore; if the console asks to grant cross-service access, accept.
6. Authentication → Authorized domains: add your Vercel domain(s) (`*.vercel.app` and your custom domain).

## 2. Provision an administrator
Admin = a signed-in user whose UID has a document in `admins/`. Clients cannot write that collection, so only you can grant access from the console.
1. Authentication → Users → **Add user** (email + strong password). Copy the **User UID**.
2. Firestore → **Start collection** `admins` → Document ID = that UID → add any field (e.g. `role: "admin"`).
3. Repeat for each admin. Delete the document to revoke access.

## 3. Migrate existing products
1. Open `/admin/`, sign in, go to the **Migration** tab.
2. **Download backup** → **Dry run** → **Run migration**. IDs, fields and image URLs are preserved; existing IDs are skipped (never overwritten), so it is safe to repeat. Each product is read back to verify; the result is recorded in `meta/migration`.
3. Do this **before** (or right after) deploying the configured site, otherwise the live shop shows "no pieces" until products exist.

## 4. Deploy on Vercel
Push the folder (Framework preset: **Other**, no build command, output = root). `vercel.json` redirects `/admin` → `/admin/`, adds `noindex` and a CSP to the admin, and `.vercelignore` keeps rules/backup/README out of the deployment. Until `firebase-config.js` has real values, the storefront keeps using `products.js` and `/admin/` shows "Firebase is not configured".

## Notes
- Storefront: only `published == true` products are readable publicly (enforced by rules). Loading, empty and error (with retry) states are handled; the saved cart is never cleared by a failed load.
- Stock modes match the existing storefront logic: not tracked / total / per `Size|Colour`.
- Big photos are downscaled in the browser (max 1800px, WebP) before upload; rules cap uploads at 5 MB and image types.
- Tests (not deployed): `node tests/lib.test.mjs`; `NODE_PATH=<dir with jsdom> node tests/storefront.test.cjs`.
