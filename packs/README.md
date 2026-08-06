# GAA Team Packs

Club colour/jersey/crest packs for the GAA Score Tracker, compiled with the
tracker's `pack-builder.html`.

To publish a pack:
1. Build it in the Pack Builder and export the `.json` file.
2. Commit the file into this folder (e.g. `mayo_senior.json`).
3. Add an entry to `index.json`:
   `{ "name": "Mayo Senior", "file": "mayo_senior.json", "teams": 40 }`
4. Push — Netlify deploys it and the tracker's "Browse online packs" lists it.
