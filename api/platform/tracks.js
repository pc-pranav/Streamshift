// api/platform/tracks.js
// Unified track fetcher — all 6 platforms, full pagination, edge-case handling
// GET /api/platform/tracks?platform=spotify&playlist_id=xxx  OR  ?liked=true

import { setCors, timedFetch, withRetry, sleep, apiError } from "../_lib/utils.js";

const MAX_TRACKS = 5000;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return apiError(res, 405, "method_not_allowed", "GET only");

  const token      = (req.headers.authorization || "").replace("Bearer ", "").trim();
  const platform   = req.query.platform;
  const playlistId = req.query.playlist_id;
  const liked      = req.query.liked === "true";

  if (!token)                return apiError(res, 401, "missing_token", "Authorization header required");
  if (!platform)             return apiError(res, 400, "missing_param", "?platform= required");
  if (!playlistId && !liked) return apiError(res, 400, "missing_param", "?playlist_id= or ?liked=true required");

  try {
    let tracks = [];
    switch (platform) {
      case "spotify":       tracks = liked ? await spotifyLiked(token) : await spotifyPlaylist(token, playlistId); break;
      case "youtube_music": tracks = await youtubePlaylist(token, playlistId, liked); break;
      case "apple_music":   tracks = liked ? await appleLiked(token) : await applePlaylist(token, playlistId); break;
      case "amazon_music":  tracks = liked ? await amazonLiked(token) : await amazonPlaylist(token, playlistId); break;
      case "wynk":          tracks = liked ? await wynkLiked(token) : await wynkPlaylist(token, playlistId); break;
      case "jiosaavn":      tracks = liked ? await saavnLiked(token) : await saavnPlaylist(token, playlistId); break;
      default: return apiError(res, 400, "unsupported_platform", `"${platform}" not supported`);
    }

    // Dedup by ISRC → platform:id
    const seen = new Set();
    const deduped = tracks.filter(t => {
      if (!t) return false;
      const key = t.isrc || `${platform}:${t.id}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });

    return res.status(200).json({ tracks: deduped, total: deduped.length });
  } catch (err) {
    console.error(`[tracks/${platform}]`, err);
    return apiError(res, err.status || 503, err.code || "fetch_error", err.message);
  }
}

// ── SPOTIFY ──────────────────────────────────────────────────────────────────
async function spotifyPlaylist(token, id) {
  return paginateSpotify(
    `https://api.spotify.com/v1/playlists/${encodeURIComponent(id)}/tracks?limit=100&fields=items(added_at,track(id,name,artists,album,duration_ms,external_ids,is_local)),next,total`,
    token,
    item => (!item?.track || item.track.is_local || !item.track.id) ? null : toSpotifyTrack(item.track, item.added_at)
  );
}

async function spotifyLiked(token) {
  return paginateSpotify(
    `https://api.spotify.com/v1/me/tracks?limit=50`,
    token,
    item => item?.track?.id ? toSpotifyTrack(item.track, item.added_at) : null
  );
}

async function paginateSpotify(firstUrl, token, transform) {
  const results = []; let url = firstUrl;
  while (url && results.length < MAX_TRACKS) {
    const resp = await withRetry(async () => {
      const r = await timedFetch(url, { headers: { Authorization: `Bearer ${token}` } }, 12000);
      await spotifyAssert(r); return r;
    }, { label: "spotify/tracks-page" });
    const d = await resp.json();
    for (const item of d.items || []) { const t = transform(item); if (t) results.push(t); }
    url = d.next || null;
    if (url) await sleep(80);
  }
  return results;
}

function toSpotifyTrack(t, addedAt) {
  return { id: t.id, title: t.name, artist: t.artists?.[0]?.name || "Unknown", artists: t.artists?.map(a => a.name) || [], album: t.album?.name || "", durationMs: t.duration_ms || 0, isrc: t.external_ids?.isrc || null, uri: `spotify:track:${t.id}`, addedAt, platform: "spotify" };
}

async function spotifyAssert(r) {
  if (r.ok) return;
  const b = await r.json().catch(() => ({}));
  const e = new Error(b?.error?.message || `Spotify ${r.status}`);
  e.status = r.status; e.code = r.status === 401 ? "token_expired" : r.status === 404 ? "not_found" : r.status === 429 ? "rate_limited" : "spotify_error"; throw e;
}

// ── YOUTUBE MUSIC ─────────────────────────────────────────────────────────────
async function youtubePlaylist(token, playlistId, liked) {
  return paginateYoutube(token, liked ? "LL" : playlistId); // "LL" = Liked videos
}

async function paginateYoutube(token, playlistId) {
  const results = []; let pageToken = null;
  do {
    const params = new URLSearchParams({ part: "snippet,contentDetails", playlistId, maxResults: "50" });
    if (pageToken) params.set("pageToken", pageToken);
    const resp = await withRetry(async () => {
      const r = await timedFetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }, 10000);
      await youtubeAssert(r); return r;
    }, { label: "youtube/tracks-page" });
    const d = await resp.json();
    for (const item of d.items || []) { const t = toYoutubeTrack(item); if (t) results.push(t); }
    pageToken = d.nextPageToken || null;
    if (pageToken) await sleep(100);
  } while (pageToken && results.length < MAX_TRACKS);
  return results;
}

function toYoutubeTrack(item) {
  const vid = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
  if (!vid || ["Private video", "Deleted video"].includes(item.snippet?.title)) return null;
  return { id: vid, title: item.snippet?.title || "Unknown", artist: item.snippet?.videoOwnerChannelTitle || "Unknown", artists: [item.snippet?.videoOwnerChannelTitle || "Unknown"], album: "", durationMs: 0, isrc: null, uri: `https://www.youtube.com/watch?v=${vid}`, platform: "youtube_music" };
}

async function youtubeAssert(r) {
  if (r.ok) return;
  const b = await r.json().catch(() => ({}));
  const e = new Error(b?.error?.message || `YouTube ${r.status}`);
  e.status = r.status; e.code = r.status === 401 ? "token_expired" : r.status === 403 ? "forbidden" : r.status === 404 ? "not_found" : "youtube_error"; throw e;
}

// ── APPLE MUSIC ────────────────────────────────────────────────────────────────
async function applePlaylist(token, id) { return paginateApple(token, `/v1/me/library/playlists/${id}/tracks`); }
async function appleLiked(token)        { return paginateApple(token, `/v1/me/library/songs`); }

async function paginateApple(token, path) {
  const devToken = process.env.APPLE_DEVELOPER_TOKEN;
  if (!devToken) throw Object.assign(new Error("APPLE_DEVELOPER_TOKEN not set"), { status: 500, code: "missing_config" });
  const results = []; let offset = 0; const LIMIT = 100;
  while (results.length < MAX_TRACKS) {
    const resp = await withRetry(async () => {
      const r = await timedFetch(`https://api.music.apple.com${path}?limit=${LIMIT}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${devToken}`, "Music-User-Token": token } }, 10000);
      await appleAssert(r); return r;
    }, { label: "apple/tracks-page" });
    const d = await resp.json();
    for (const item of d.data || []) { const t = toAppleTrack(item); if (t) results.push(t); }
    if (!d.next) break;
    offset += LIMIT; await sleep(100);
  }
  return results;
}

function toAppleTrack(item) {
  const a = item.attributes || {};
  return { id: item.id, title: a.name || "Unknown", artist: a.artistName || "Unknown", artists: [a.artistName || "Unknown"], album: a.albumName || "", durationMs: a.durationInMillis || 0, isrc: a.isrc || null, uri: a.url || null, platform: "apple_music" };
}

async function appleAssert(r) {
  if (r.ok) return;
  const e = new Error(`Apple Music ${r.status}`);
  e.status = r.status; e.code = r.status === 401 ? "token_expired" : r.status === 403 ? "forbidden" : r.status === 404 ? "not_found" : "apple_error"; throw e;
}

// ── AMAZON MUSIC ──────────────────────────────────────────────────────────────
async function amazonPlaylist(token, playlistId) {
  return paginateAmazon(token, `/v1/playlists/${playlistId}/tracks`);
}

async function amazonLiked(token) {
  return paginateAmazon(token, `/v1/favorites/tracks`);
}

async function paginateAmazon(token, path) {
  const results = []; let startIndex = 0; const LIMIT = 50;
  while (results.length < MAX_TRACKS) {
    const resp = await withRetry(async () => {
      const r = await timedFetch(
        `https://api.music.amazon.dev${path}?maxResults=${LIMIT}&startIndex=${startIndex}`,
        { headers: { Authorization: `Bearer ${token}`, "x-api-key": process.env.AMAZON_MUSIC_API_KEY || "" } }, 10000);
      await amazonAssert(r); return r;
    }, { label: "amazon/tracks-page" });
    const d = await resp.json();
    const items = d.tracks || d.items || [];
    for (const item of items) { const t = toAmazonTrack(item); if (t) results.push(t); }
    if (!d.nextToken && items.length < LIMIT) break;
    startIndex += LIMIT; await sleep(100);
  }
  return results;
}

function toAmazonTrack(t) {
  if (!t?.id && !t?.asin) return null;
  return {
    id:         t.id || t.asin,
    title:      t.title || t.name || "Unknown",
    artist:     t.artist?.name || t.artistName || "Unknown",
    artists:    t.artists?.map(a => a.name) || [t.artist?.name || "Unknown"],
    album:      t.album?.title || t.albumName || "",
    durationMs: (t.durationSeconds || 0) * 1000,
    isrc:       t.isrc || null,
    uri:        t.id || t.asin,
    platform:   "amazon_music",
  };
}

async function amazonAssert(r) {
  if (r.ok) return;
  const b = await r.json().catch(() => ({}));
  const e = new Error(b?.message || `Amazon Music ${r.status}`);
  e.status = r.status; e.code = r.status === 401 ? "token_expired" : r.status === 429 ? "rate_limited" : "amazon_error"; throw e;
}

// ── WYNK MUSIC ────────────────────────────────────────────────────────────────
async function wynkPlaylist(token, playlistId) {
  return paginateWynk(token, `/v1/playlist/${playlistId}/songs`);
}

async function wynkLiked(token) {
  return paginateWynk(token, `/v1/user/favorites`);
}

async function paginateWynk(token, path) {
  const WYNK_BASE = "https://api-staging.wynk.in";
  const WYNK_APP_KEY = process.env.WYNK_APP_KEY || "";
  const results = []; let offset = 0; const LIMIT = 50;

  while (results.length < MAX_TRACKS) {
    const resp = await withRetry(async () => {
      const r = await timedFetch(`${WYNK_BASE}${path}?limit=${LIMIT}&offset=${offset}`, {
        headers: { Authorization: `Bearer ${token}`, "X-BSY-UTKN": WYNK_APP_KEY, "User-Agent": "WynkMusic/3.28.0.2 (Android)" }
      }, 10000);
      await wynkAssert(r); return r;
    }, { label: "wynk/tracks-page" });
    const d = await resp.json();
    const items = d.songs || d.data || d.tracks || [];
    for (const item of items) { const t = toWynkTrack(item); if (t) results.push(t); }
    if (!d.hasMore || items.length < LIMIT) break;
    offset += LIMIT; await sleep(120);
  }
  return results;
}

function toWynkTrack(t) {
  if (!t?.id && !t?.songId) return null;
  return {
    id:         t.id || t.songId,
    title:      t.name || t.title || t.songName || "Unknown",
    artist:     t.artistNames || t.primaryArtists || t.artist || "Unknown",
    artists:    t.artists?.map(a => a.name) || [t.artistNames || "Unknown"],
    album:      t.albumName || t.album?.name || "",
    durationMs: (t.duration || t.songDuration || 0) * 1000,
    isrc:       t.isrc || null,
    uri:        t.id || t.songId,
    platform:   "wynk",
  };
}

async function wynkAssert(r) {
  if (r.ok) return;
  const b = await r.json().catch(() => ({}));
  const e = new Error(b?.message || `Wynk ${r.status}`);
  e.status = r.status; e.code = r.status === 401 ? "token_expired" : r.status === 429 ? "rate_limited" : "wynk_error"; throw e;
}

// ── JIOSAAVN ──────────────────────────────────────────────────────────────────
async function saavnPlaylist(token, playlistId) {
  const results = []; let page = 1; const LIMIT = 50;

  while (results.length < MAX_TRACKS) {
    const params = new URLSearchParams({
      __call:   "playlist.getDetails",
      _format:  "json",
      _marker:  "0",
      listid:   playlistId,
      p:        String(page),
      n:        String(LIMIT),
      includeMetaTags: "0",
    });

    const resp = await withRetry(async () => {
      const r = await timedFetch(`https://www.jiosaavn.com/api.php?${params}`, {
        headers: { Cookie: token, "User-Agent": "Mozilla/5.0", "Referer": "https://www.jiosaavn.com/" }
      }, 10000);
      await saavnAssert(r); return r;
    }, { label: "saavn/tracks-page" });

    const d = await resp.json();
    const songs = d.songs || d.list || [];
    if (!songs.length) break;
    for (const s of songs) { const t = toSaavnTrack(s); if (t) results.push(t); }
    if (songs.length < LIMIT) break;
    page++; await sleep(120);
  }
  return results;
}

async function saavnLiked(token) {
  // JioSaavn stores liked songs as a special playlist
  const params = new URLSearchParams({ __call: "user.getFavorites", _format: "json", type: "songs" });
  const resp = await withRetry(async () => {
    const r = await timedFetch(`https://www.jiosaavn.com/api.php?${params}`, {
      headers: { Cookie: token, "User-Agent": "Mozilla/5.0", "Referer": "https://www.jiosaavn.com/" }
    }, 10000);
    await saavnAssert(r); return r;
  }, { label: "saavn/liked" });
  const d = await resp.json();
  return (d.songs || d || []).map(toSaavnTrack).filter(Boolean);
}

function toSaavnTrack(s) {
  if (!s?.id) return null;
  return {
    id:         s.id,
    title:      s.song || s.title || "Unknown",
    artist:     s.primary_artists || s.singers || s.artist || "Unknown",
    artists:    [s.primary_artists || s.singers || "Unknown"],
    album:      s.album || "",
    durationMs: parseInt(s.duration || "0") * 1000,
    isrc:       null,
    uri:        s.perma_url || s.id,
    platform:   "jiosaavn",
  };
}

async function saavnAssert(r) {
  if (r.ok) return;
  const e = new Error(`JioSaavn ${r.status}`);
  e.status = r.status; e.code = r.status === 401 ? "token_expired" : "saavn_error"; throw e;
}
