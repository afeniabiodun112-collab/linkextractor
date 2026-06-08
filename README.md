# LinkSnap — Link Extractor

Extract every link from any webpage. Paste a URL, get all links instantly.

## Features
- Extracts all `<a href>` links from any public webpage
- Classifies links as **internal** or **external**
- Filter, search, copy individual links or all at once
- Auto-resolves relative URLs to absolute

## Local Development

```bash
npm install
npm start
# Open http://localhost:3000
```

## Deploy to Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New Web Service**
3. Connect your GitHub repo
4. Use these settings:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Port**: `3000` (Render auto-detects via `PORT` env var)
5. Click **Deploy** — done!
