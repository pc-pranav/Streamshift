// api/core/match.js
// Cross-platform track matching — all 6 platforms
// Phase 1: ISRC exact lookup (where supported)
// Phase 2: Weighted fuzzy — title 40% | artist 30% | duration 20% | album 10%

import { setCors, timedFetch, withRetry, sleep, apiError, matchScore, classifyStatus, normalizeStr } from "../_lib/utils.js";

const DELAY_MS = 130;
const SUPPORTED = ["spotify", "youtube_music", "apple_music", "amazon_music", "wynk", "jiosaavn"];

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return apiError(res, 405, "method_not_allowed", "POST only");

  const { tracks, dest_platform, dest_token } = req.body || {};

  if (!Array.isArray(tracks) || !tracks.length) return apiError(res, 400, "missing_param", "tracks[] required");
  if (!dest_platform) return apiError(res, 400, "missing_param", "dest_platform required");
  if (!dest_token)    return apiError(res, 401, "missing_token", "dest_token required");
  if (!SUPPORTED.includes(dest_platform))
    return apiError(res, 400, "unsupported_platform", `dest_platform must be one of: ${SUPPORTED.join(", ")}`);

  const results = [];
  for (let i = 0; i < tracks.length; i++) {
    try {
      results.push(await matchOne(tracks[i], dest_platform, dest_token));
    } catch (err) {
      results.push({ sourceTrack: tracks[i], destTrack: null, matchScore: 0, matchMethod: null, status: "error", error: err.message, candidates: [] });
    }
    if (i < tracks.length - 1) await sleep(DELAY_MS);
  }

  const matched   = results.filter(r => r.status === "matched").length;
  const conflicts = results.filter(r => r.status === "conflict").length;
  const unmatched = results.filter(r => r.status === "unmatched" || r.status === "error").length;

  return res.status(200).json({
    results,
    summary: { total: tracks.length, matched, conflicts, unmatched, matchRate: tracks.length ? matched / tracks.length : 0 },
  });
}

async function matchOne(track, destPlatform, destToken) {
  // Phase 1: ISRC (Spotify, Apple, Amazon support it; YouTube, Wynk, JioSaavn don't)
  if (track.isrc) {
    const hit = await isrcLookup(track.isrc, destPlatform, destToken);
    if (hit) return { sourceTrack: track, destTrack: hit, matchScore: 1.0, matchMethod: "isrc", status: "matched", candidates: [] };
  }

  // Phase 2: Fuzzy search
  const candidates = await fuzzySearch(track, destPlatform, destToken);
  if (!candidates.length) {
    return { sourceTrack: track, destTrack: null, matchScore: 0, matchMethod: "fuzzy", status: "unmatched", candidates: [] };
  }

  const scored = candidates.map(c => ({ ...c, score: matchScore(track, c) })).sort((a, b) => b.score - a.score);
  const best   = scored[0];
  const status = classifyStatus(best.score);

  return { sourceTrack: track, destTrack: status !== "unmatched" ? best : null, matchScore: best.score, matchMethod: "fuzzy", status, candidates: scored.slice(0, 5) };
}

// ── ISRC Lookup ───────────────────────────────────────────────────────────────
async function isrcLookup(isrc, platform, token) {
  try {
    switch (platform) {
      case "spotify": {
        const r = await withRetry(() => timedFetch(
          `https://api.spotify.com/v1/search?q=isrc:${isrc}&type=track&limit=1`,
          { headers: { Authorization: `Bearer ${token}` } }, 8000), { label: "isrc/spotify" });
        if (!r.ok) return null;
        const d = await r.json();
        const t = d.tracks?.items?.[0];
        return t ? toSpotify(t) : null;
      }
      case "apple_music": {
        const dev = process.env.APPLE_DEVELOPER_TOKEN; if (!dev) return null;
        const r = await withRetry(() => timedFetch(
          `https://api.music.apple.com/v1/catalog/us/songs?filter[isrc]=${isrc}&limit=1`,
          { headers: { Authorization: `Bearer ${dev}`, "Music-User-Token": token } }, 8000), { label: "isrc/apple" });
        if (!r.ok) return null;
        const d = await r.json();
        return d.data?.[0] ? toApple(d.data[0]) : null;
      }
      case "amazon_music": {
        const r = await withRetry(() => timedFetch(
          `https://api.music.amazon.dev/v1/catalog/tracks?isrc=${isrc}`,
          { headers: { Authorization: `Bearer ${token}`, "x-api-key": process.env.AMAZON_MUSIC_API_KEY || "" } }, 8000), { label: "isrc/amazon" });
        if (!r.ok) return null;
        const d = await r.json();
        const t = d.tracks?.[0] || d.items?.[0];
        return t ? toAmazon(t) : null;
      }
      default: return null; // YouTube, Wynk, JioSaavn don't support ISRC lookup
    }
  } catch { return null; }
}

// ── Fuzzy Search ──────────────────────────────────────────────────────────────
async function fuzzySearch(track, platform, token) {
  const q     = `${normalizeStr(track.title)} ${normalizeStr(track.artist || track.artists?.[0] || "")}`.trim();
  const exact = `track:${normalizeStr(track.title)} artist:${normalizeStr(track.artist || "")}`;

  try {
    switch (platform) {
      case "spotify": {
        const r = await withRetry(() => timedFetch(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(exact)}&type=track&limit=5&market=US`,
          { headers: { Authorization: `Bearer ${token}` } }, 8000), { label: "fuzzy/spotify" });
        if (!r.ok) return [];
        const d = await r.json();
        return (d.tracks?.items || []).map(toSpotify);
      }
      case "youtube_music": {
        const params = new URLSearchParams({ part: "snippet", q: `${track.title} ${track.artist || ""} official audio`, type: "video", videoCategoryId: "10", maxResults: "5" });
        const r = await withRetry(() => timedFetch(
          `https://www.googleapis.com/youtube/v3/search?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }, 8000), { label: "fuzzy/youtube" });
        if (!r.ok) return [];
        const d = await r.json();
        return (d.items || []).filter(i => i.id?.videoId).map(item => ({
          id: item.id.videoId, title: item.snippet?.title || "", artist: item.snippet?.channelTitle || "",
          artists: [item.snippet?.channelTitle || ""], album: "", durationMs: 0, isrc: null,
          uri: `https://www.youtube.com/watch?v=${item.id.videoId}`,
          coverUrl: item.snippet?.thumbnails?.high?.url || null, platform: "youtube_music",
        }));
      }
      case "apple_music": {
        const dev = process.env.APPLE_DEVELOPER_TOKEN; if (!dev) return [];
        const r = await withRetry(() => timedFetch(
          `https://api.music.apple.com/v1/catalog/us/search?term=${encodeURIComponent(q)}&types=songs&limit=5`,
          { headers: { Authorization: `Bearer ${dev}`, "Music-User-Token": token } }, 8000), { label: "fuzzy/apple" });
        if (!r.ok) return [];
        const d = await r.json();
        return (d.results?.songs?.data || []).map(toApple);
      }
      case "amazon_music": {
        const r = await withRetry(() => timedFetch(
          `https://api.music.amazon.dev/v1/catalog/search?type=TRACK&keywords=${encodeURIComponent(q)}&maxResults=5`,
          { headers: { Authorization: `Bearer ${token}`, "x-api-key": process.env.AMAZON_MUSIC_API_KEY || "" } }, 8000), { label: "fuzzy/amazon" });
        if (!r.ok) return [];
        const d = await r.json();
        return (d.tracks || d.items || []).map(toAmazon);
      }
      case "wynk": {
        const r = await withRetry(() => timedFetch(
          `https://api-staging.wynk.in/v1/search?q=${encodeURIComponent(q)}&type=song&limit=5`,
          { headers: { Authorization: `Bearer ${token}`, "X-BSY-UTKN": process.env.WYNK_APP_KEY || "", "User-Agent": "WynkMusic/3.28.0.2 (Android)" } }, 8000), { label: "fuzzy/wynk" });
        if (!r.ok) return [];
        const d = await r.json();
        return (d.songs || d.results || []).slice(0, 5).map(toWynk);
      }
      case "jiosaavn": {
        const params = new URLSearchParams({ __call: "search.getResults", _format: "json", _marker: "0", q, p: "1", n: "5", includeMetaTags: "0" });
        const r = await withRetry(() => timedFetch(
          `https://www.jiosaavn.com/api.php?${params}`,
          { headers: { Cookie: token, "User-Agent": "Mozilla/5.0", "Referer": "https://www.jiosaavn.com/" } }, 8000), { label: "fuzzy/saavn" });
        if (!r.ok) return [];
        const d = await r.json();
        return (d.results || d.songs || []).slice(0, 5).map(toSaavn);
      }
      default: return [];
    }
  } catch { return []; }
}

// ── Candidate normalizers ─────────────────────────────────────────────────────
function toSpotify(t) {
  return { id: t.id, title: t.name, artist: t.artists?.[0]?.name || "", artists: t.artists?.map(a => a.name) || [], album: t.album?.name || "", durationMs: t.duration_ms || 0, isrc: t.external_ids?.isrc || null, uri: t.uri, coverUrl: t.album?.images?.[0]?.url || null, platform: "spotify" };
}

function toApple(t) {
  const a = t.attributes || {};
  return { id: t.id, title: a.name || "", artist: a.artistName || "", artists: [a.artistName || ""], album: a.albumName || "", durationMs: a.durationInMillis || 0, isrc: a.isrc || null, uri: a.url || null, coverUrl: a.artwork?.url?.replace("{w}", "80").replace("{h}", "80") || null, platform: "apple_music" };
}

function toAmazon(t) {
  return { id: t.id || t.asin, title: t.title || t.name || "", artist: t.artist?.name || t.artistName || "", artists: t.artists?.map(a => a.name) || [], album: t.album?.title || "", durationMs: (t.durationSeconds || 0) * 1000, isrc: t.isrc || null, uri: t.id || t.asin, platform: "amazon_music" };
}

function toWynk(t) {
  return { id: t.id || t.songId, title: t.name || t.title || t.songName || "", artist: t.artistNames || t.primaryArtists || "", artists: [t.artistNames || ""], album: t.albumName || "", durationMs: (t.duration || 0) * 1000, isrc: t.isrc || null, uri: t.id || t.songId, platform: "wynk" };
}

function toSaavn(s) {
  return { id: s.id, title: s.song || s.title || "", artist: s.primary_artists || s.singers || "", artists: [s.primary_artists || ""], album: s.album || "", durationMs: parseInt(s.duration || "0") * 1000, isrc: null, uri: s.perma_url || s.id, platform: "jiosaavn" };
}
