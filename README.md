# Colorado Trails

Offline-first PWA trail guide for Colorado. Live at
**https://steezybrodeezy.github.io/colorado-trails/**

13,980 trails (merged from ~30k COTREX segments), searchable and mapped
entirely offline: trail data lives in IndexedDB, map tiles download by
region into Cache Storage, and the app installs to your home screen.

## Features

- **Search & filter** — name, difficulty, length, elevation gain
  (500+…3000+ ft), route style (loop / out & back / network), summit
  trails, and 14ers (gold-highlighted on the map)
- **Trail detail** — stats, dogs/season/manager, trailhead amenities,
  Google Maps directions to the trailhead, COTREX community-reports link
- **Offline maps** — per-region vector tile packs (~7–20 MB each);
  areas you browse online are cached automatically too
- **Wildfire conditions** — opt-in overlay of NIFC fire perimeters +
  incidents; manual sync with the data age always shown (off by default
  so stale data can never masquerade as current)
- **Saved lists** — local-first, with optional cross-device sync via
  Firebase (email/password)

## Development

```bash
npm install
npm run dev        # local dev server
npm run lint       # oxlint
npm run build      # production build (PWA + service worker)
node scripts/smoke-test.mjs   # data-flow tests on fake-indexeddb
```

Data pipeline (regenerates `public/data/` and `public/map-style/`):

```bash
node scripts/fetch-trails.mjs     # COTREX trails + trailheads + GNIS summits
node scripts/fetch-map-style.mjs  # snapshot OpenFreeMap liberty style
node scripts/generate-icons.mjs   # PWA icons from public/favicon.svg
```

Deploys automatically to GitHub Pages on push to `main`.

## List sync setup (one-time, Firebase console)

Lists work locally without any of this; sync stays hidden as
"not configured" until it's done.

1. [console.firebase.google.com](https://console.firebase.google.com) →
   **Add project** (e.g. `colorado-trails`; analytics not needed)
2. **Build → Authentication → Get started → Email/Password → Enable**
3. **Build → Firestore Database → Create database** (production mode)
4. **Firestore → Rules**, publish:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/lists/{listId} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

5. **Project settings → Your apps → Add app → Web**, copy the
   `firebaseConfig` object into `src/lib/firebaseConfig.js`
   (it's public-safe; the rules above do the protecting)

## Data sources

- Trails & trailheads: [COTREX](https://trails.colorado.gov/) (CPW /
  gis.colorado.gov)
- Summits: USGS GNIS via The National Map
- Wildfires: NIFC WFIGS current perimeters & incidents
- Basemap: [OpenFreeMap](https://openfreemap.org/) (© OpenMapTiles,
  data © OpenStreetMap contributors)
