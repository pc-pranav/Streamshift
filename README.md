# StreamShift 🎵

> Transfer playlists and liked songs across **6 music platforms** — free, open source, no subscription.

**Supported:** Spotify · YouTube Music · Apple Music · Amazon Music · Wynk Music · JioSaavn

---

## Features

- Every direction — any platform to any other platform (all 30 combinations)
- ISRC exact matching where supported (Spotify ↔ Apple ↔ Amazon)
- Weighted fuzzy matching for all other cases — title 40% · artist 30% · duration 20% · album 10%
- Liked Songs included on every platform
- Conflict resolution UI — choose from top candidates when auto-match isn't confident
- Full pagination — libraries of 5,000+ tracks
- 25+ error scenarios handled gracefully

---

## Project structure

```
streamshift/
├── api/
│   ├── _lib/utils.js                 Shared: retry, fuzzy match, timedFetch
│   ├── auth/
│   │   ├── spotify/  login · callback · refresh
│   │   ├── youtube/  login · callback · refresh
│   │   ├── apple/    token
│   │   ├── amazon/   login · callback · refresh
│   │   ├── wynk/     session (phone OTP)
│   │   └── jiosaavn/ session (email+password)
│   ├── platform/
│   │   ├── playlists.js              All 6 platforms unified
│   │   └── tracks.js                 All 6 platforms, paginated, deduped
│   └── core/
│       ├── match.js                  ISRC + Jaro-Winkler matching
│       └── transfer.js               Create + fill playlists on all 6 platforms
├── src/
│   ├── App.jsx                       React UI — 5 step flow
│   └── main.jsx
├── index.html
├── package.json
├── vite.config.js
├── vercel.json
└── .env.example
```

---

## Quick deploy

```bash
# 1. Push to GitHub
git init && git add . && git commit -m "streamshift"
gh repo create streamshift --public --push

# 2. Import at vercel.com/new
# 3. Add environment variables (see below)
# 4. Deploy
```

You only need to configure the platforms you actually want to use. Spotify alone is enough to start.

---

## Platform setup

### 1 · Spotify (free)

1. [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) → **Create app**
2. Add both **Redirect URIs**:
   ```
   https://YOUR-APP.vercel.app/api/auth/spotify/callback
   http://localhost:5173/api/auth/spotify/callback
   ```
3. Check **Web API** → Save → copy **Client ID** and **Client secret**

```env
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
```

---

### 2 · YouTube Music (free · 10,000 units/day quota)

1. [console.cloud.google.com](https://console.cloud.google.com) → New Project
2. **APIs & Services → Library** → enable **YouTube Data API v3**
3. **Credentials → Create → OAuth 2.0 Client ID** (Web application)
4. Authorized redirect URIs:
   ```
   https://YOUR-APP.vercel.app/api/auth/youtube/callback
   http://localhost:5173/api/auth/youtube/callback
   ```
5. **OAuth consent screen → External** → add your Gmail as test user
6. Copy **Client ID** and **Client secret**

```env
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
```

> Each search costs ~100 units. 10k/day ≈ 100 searches. Large libraries may hit the daily limit — the app saves partial progress and shows a clear message.

---

### 3 · Apple Music (requires $99/yr Apple Developer account)

1. [developer.apple.com](https://developer.apple.com) → **Keys → +** → enable **MusicKit** → Register
2. Download the `.p8` key file (only downloadable once)
3. Note your **Key ID** and **Team ID**
4. Generate a developer token (valid up to 6 months):

```bash
npm install -g apple-musickit-jwt
apple-musickit-jwt \
  --team-id  YOUR_TEAM_ID \
  --key-id   YOUR_KEY_ID \
  --private-key-path ./AuthKey_XXXXXXXX.p8
```

Set a calendar reminder to regenerate before 6 months.

```env
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_DEVELOPER_TOKEN=
```

---

### 4 · Amazon Music (free)

**A — Login with Amazon (OAuth)**

1. [developer.amazon.com/apps-and-games](https://developer.amazon.com/apps-and-games) → **Security Profiles → Create**
2. Under **Web Settings**, add Allowed Return URLs:
   ```
   https://YOUR-APP.vercel.app/api/auth/amazon/callback
   http://localhost:5173/api/auth/amazon/callback
   ```
3. Copy **Client ID** and **Client Secret**

**B — Amazon Music API key**

1. [developer.music.amazon.dev](https://developer.music.amazon.dev) → **Create Application**
2. Copy the **API Key**

```env
AMAZON_CLIENT_ID=
AMAZON_CLIENT_SECRET=
AMAZON_MUSIC_API_KEY=
```

> Works for both `amazon.com` and `amazon.in` (India) accounts automatically.

---

### 5 · Wynk Music (India · Airtel · no public API)

Wynk has no developer program. StreamShift uses Wynk's internal app API with phone + OTP authentication. **Users enter their phone number in the UI — no server-side account creation needed.**

The server needs `WYNK_APP_KEY`, a static token that the official Wynk app sends with every request.

**How to get it:**

*Option A — Intercept network traffic (easiest):*
```
1. Install Wynk on Android
2. Set up mitmproxy or Charles Proxy as an HTTP proxy
3. Log in to Wynk
4. Look for X-BSY-UTKN in request headers → that value is your key
```

*Option B — Decompile the APK:*
```bash
apktool d WynkMusic.apk -o wynk_decoded
grep -r "X-BSY-UTKN\|BSY_UTKN\|appToken" wynk_decoded/assets/ wynk_decoded/smali/
```

```env
WYNK_APP_KEY=
WYNK_SECRET=       # optional — used for HMAC request signing
```

> ⚠️ Wynk's internal API is not public and may change when they update the app. If transfers fail, the `WYNK_APP_KEY` may need to be re-extracted from a newer version.

---

### 6 · JioSaavn (India · Jio · no env vars needed)

JioSaavn's `api.php` endpoint is publicly accessible. No server-side credentials are required. Users sign in with their JioSaavn email or phone number + password directly in the StreamShift UI. The session cookie is stored only in the browser's `sessionStorage` and is never sent to StreamShift servers.

No `.env` changes needed.

---

## All environment variables

Set in **Vercel → Project → Settings → Environment Variables** (all three environments):

| Variable | Platform | Notes |
|---|---|---|
| `APP_URL` | All | `https://your-app.vercel.app` — no trailing slash |
| `SPOTIFY_CLIENT_ID` | Spotify | |
| `SPOTIFY_CLIENT_SECRET` | Spotify | |
| `YOUTUBE_CLIENT_ID` | YouTube Music | |
| `YOUTUBE_CLIENT_SECRET` | YouTube Music | |
| `APPLE_TEAM_ID` | Apple Music | |
| `APPLE_KEY_ID` | Apple Music | |
| `APPLE_DEVELOPER_TOKEN` | Apple Music | Regenerate before 6 months |
| `AMAZON_CLIENT_ID` | Amazon Music | LWA OAuth credential |
| `AMAZON_CLIENT_SECRET` | Amazon Music | LWA OAuth credential |
| `AMAZON_MUSIC_API_KEY` | Amazon Music | From developer.music.amazon.dev |
| `WYNK_APP_KEY` | Wynk | Static key from Wynk app |
| `WYNK_SECRET` | Wynk | Optional HMAC secret |

---

## Cross-platform matrix

| Source | Destination | Match method | Quality |
|---|---|---|---|
| Spotify | Apple Music | ISRC + fuzzy | ★★★★★ |
| Spotify | Amazon Music | ISRC + fuzzy | ★★★★★ |
| Spotify | YouTube Music | Fuzzy | ★★★★☆ |
| Spotify | Wynk | Fuzzy | ★★★★☆ |
| Spotify | JioSaavn | Fuzzy | ★★★★☆ |
| Apple Music | Spotify | ISRC + fuzzy | ★★★★★ |
| Apple Music | Amazon Music | ISRC + fuzzy | ★★★★★ |
| Amazon Music | Spotify | ISRC + fuzzy | ★★★★★ |
| YouTube Music | Spotify | Fuzzy | ★★★★☆ |
| YouTube Music | JioSaavn | Fuzzy | ★★★★☆ |
| Wynk | JioSaavn | Fuzzy | ★★★☆☆ |
| JioSaavn | Wynk | Fuzzy | ★★★☆☆ |
| Any | Any | Mixed | All 30 combinations work |

---

## Local development

```bash
npm install
cp .env.example .env.local   # fill in your values
npx vercel dev               # runs API functions + Vite frontend
```

App runs at `http://localhost:5173`.

> Always use `npx vercel dev`, not `npm run dev`. Vite alone cannot run the serverless API routes.

---

## Error handling

| Scenario | Behaviour |
|---|---|
| User cancels OAuth | Friendly message, can retry |
| CSRF state mismatch | Request rejected, error shown |
| Token expired | Auto-refreshed silently before each request |
| Refresh token revoked | Prompt to reconnect |
| Spotify 429 | Exponential backoff, 3 retries |
| YouTube quota exceeded | Partial save + clear message |
| Amazon API throttle | Retry with backoff |
| Wynk session expired | Re-OTP prompt |
| JioSaavn session expired | Re-login prompt |
| Network timeout (10s) | Retry 3×, then surface error |
| Playlist deleted mid-transfer | Skipped, logged |
| Spotify local files | Filtered before matching |
| YouTube private/deleted videos | Filtered before matching |
| Playlists with 5,000+ tracks | Paginated, hard cap |
| Token expires mid-transfer | Partial save, count shown |
| Batch add failure | Per-batch 3× retry, others continue |
| No tracks found in selection | Clear error, no silent fail |
| Duplicate tracks | Deduplicated by ISRC → platform ID |
| Vercel 10s function timeout | Match chunked into 50-track batches |
| Page reload mid-flow | Session restored from sessionStorage |
| Same account both sides | Warning shown before connecting |

---

## Troubleshooting

**"Redirect URI mismatch" on Spotify or Google**
Your app settings must have the exact redirect URI including path. Confirm `APP_URL` has no trailing slash and matches what's registered.

**YouTube says "This app is blocked"**
OAuth consent screen → Test users → add your Gmail. Required while the app is in Testing mode.

**Apple Music 401 errors**
Your `APPLE_DEVELOPER_TOKEN` has expired. Regenerate with `apple-musickit-jwt`, update the env var in Vercel, and redeploy.

**Amazon Music 403**
Confirm `AMAZON_MUSIC_API_KEY` is set — it's separate from the LWA OAuth client credentials.

**Wynk "OTP request failed"**
`WYNK_APP_KEY` is missing, wrong, or Wynk has rotated it. Re-extract from the latest Wynk APK.

**JioSaavn "Invalid credentials"**
Use your JioSaavn account email or phone, not your Jio SIM number or Jio TV password.

**Transfers stop partway on YouTube**
Daily quota hit (10k units). Partial playlist was saved. Quota resets at midnight Pacific — transfer the rest next day.

**API 404 in local dev**
Run `npx vercel dev`, not `npm run dev`.

---

## License

MIT — do whatever you want with it.
