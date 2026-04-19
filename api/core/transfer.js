// api/core/transfer.js
// Creates a playlist on any destination platform and adds matched tracks
// Spotify · YouTube Music · Apple Music · Amazon Music · Wynk · JioSaavn

import { setCors, timedFetch, withRetry, sleep, apiError } from "../_lib/utils.js";

const SUPPORTED = ["spotify", "youtube_music", "apple_music", "amazon_music", "wynk", "jiosaavn"];

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return apiError(res, 405, "method_not_allowed", "POST only");

  const { dest_platform, dest_token, playlist_name, playlist_description = "Transferred via StreamShift", track_uris = [], is_public = false } = req.body || {};

  if (!dest_platform) return apiError(res, 400, "missing_param", "dest_platform required");
  if (!dest_token)    return apiError(res, 401, "missing_token", "dest_token required");
  if (!playlist_name) return apiError(res, 400, "missing_param", "playlist_name required");
  if (!SUPPORTED.includes(dest_platform)) return apiError(res, 400, "unsupported_platform", `Must be one of: ${SUPPORTED.join(", ")}`);
  if (!Array.isArray(track_uris) || !track_uris.length) return apiError(res, 400, "missing_param", "track_uris[] must not be empty");

  try {
    switch (dest_platform) {
      case "spotify":       return await toSpotify(res, dest_token, playlist_name, playlist_description, track_uris, is_public);
      case "youtube_music": return await toYoutube(res, dest_token, playlist_name, playlist_description, track_uris, is_public);
      case "apple_music":   return await toApple(res, dest_token, playlist_name, playlist_description, track_uris);
      case "amazon_music":  return await toAmazon(res, dest_token, playlist_name, playlist_description, track_uris, is_public);
      case "wynk":          return await toWynk(res, dest_token, playlist_name, playlist_description, track_uris);
      case "jiosaavn":      return await toSaavn(res, dest_token, playlist_name, playlist_description, track_uris);
      default: return apiError(res, 400, "unsupported_platform", "Unknown platform");
    }
  } catch (err) {
    console.error(`[transfer/${dest_platform}]`, err);
    return apiError(res, err.status || 503, err.code || "transfer_error", err.message);
  }
}

// ── SPOTIFY ──────────────────────────────────────────────────────────────────
async function toSpotify(res, token, name, desc, uris, pub) {
  const me = await sf("https://api.spotify.com/v1/me", token);
  if (!me.ok) return handleAuthErr(res, me, "Spotify");
  const { id: userId } = await me.json();

  const cr = await sf(`https://api.spotify.com/v1/users/${encodeURIComponent(userId)}/playlists`, token, {
    method: "POST", body: JSON.stringify({ name, description: desc, public: pub, collaborative: false }),
  });
  if (!cr.ok) {
    const b = await cr.json().catch(() => ({}));
    if (cr.status === 401) return res.status(401).json({ error: "token_expired" });
    return res.status(cr.status).json({ error: "create_failed", message: b?.error?.message || "Failed to create playlist" });
  }
  const pl = await cr.json();
  const plId = pl.id;

  let added = 0, failed = 0;
  for (let i = 0; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    let ok = false;
    for (let a = 0; a < 3; a++) {
      const r = await sf(`https://api.spotify.com/v1/playlists/${plId}/tracks`, token, { method: "POST", body: JSON.stringify({ uris: batch }) });
      if (r.status === 429) { await sleep((parseInt(r.headers.get("Retry-After") || "3") + 1) * 1000); continue; }
      if (r.status === 401) return res.status(200).json({ partial: true, added, failed: failed + (uris.length - i), error: "token_expired_mid_transfer" });
      if (r.ok) { ok = true; break; }
      if (a < 2) await sleep(800 * (a + 1));
    }
    ok ? added += batch.length : failed += batch.length;
    if (i + 100 < uris.length) await sleep(200);
  }

  return res.status(200).json({ success: failed === 0, partial: failed > 0 && added > 0, playlistId: plId, playlistUrl: pl.external_urls?.spotify, added, failed, total: uris.length });
}

// ── YOUTUBE MUSIC ─────────────────────────────────────────────────────────────
async function toYoutube(res, token, name, desc, videoIds, pub) {
  const cr = await yf("https://www.googleapis.com/youtube/v3/playlists?part=snippet,status", token, {
    method: "POST", body: JSON.stringify({ snippet: { title: name, description: desc }, status: { privacyStatus: pub ? "public" : "private" } }),
  });
  if (!cr.ok) {
    const b = await cr.json().catch(() => ({}));
    if (cr.status === 401) return res.status(401).json({ error: "token_expired" });
    if (cr.status === 403) return res.status(403).json({ error: "quota_exceeded", message: b?.error?.message || "YouTube quota exceeded" });
    return res.status(cr.status).json({ error: "create_failed", message: b?.error?.message || "Failed to create playlist" });
  }
  const pl = await cr.json();
  const plId = pl.id;

  let added = 0, failed = 0;
  for (const rawUri of videoIds) {
    const videoId = rawUri.includes("watch?v=") ? new URL(rawUri).searchParams.get("v") : rawUri;
    let ok = false;
    for (let a = 0; a < 3; a++) {
      const r = await yf("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", token, {
        method: "POST", body: JSON.stringify({ snippet: { playlistId: plId, resourceId: { kind: "youtube#video", videoId } } }),
      });
      if (r.status === 403) {
        const b = await r.json().catch(() => ({}));
        if (b?.error?.errors?.[0]?.reason === "quotaExceeded")
          return res.status(200).json({ partial: true, playlistId: plId, playlistUrl: `https://music.youtube.com/playlist?list=${plId}`, added, failed: failed + (videoIds.length - videoIds.indexOf(rawUri)), error: "quota_exceeded" });
        await sleep(2000 * (a + 1)); continue;
      }
      if (r.status === 429) { await sleep(3000 * (a + 1)); continue; }
      if (r.ok) { ok = true; break; }
      if (a < 2) await sleep(600 * (a + 1));
    }
    ok ? added++ : failed++;
    await sleep(150);
  }

  return res.status(200).json({ success: failed === 0, partial: failed > 0 && added > 0, playlistId: plId, playlistUrl: `https://music.youtube.com/playlist?list=${plId}`, added, failed, total: videoIds.length });
}

// ── APPLE MUSIC ────────────────────────────────────────────────────────────────
async function toApple(res, token, name, desc, trackIds) {
  const dev = process.env.APPLE_DEVELOPER_TOKEN;
  if (!dev) return apiError(res, 500, "missing_config", "APPLE_DEVELOPER_TOKEN not set");

  const cr = await timedFetch("https://api.music.apple.com/v1/me/library/playlists", {
    method: "POST",
    headers: { Authorization: `Bearer ${dev}`, "Music-User-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ attributes: { name, description: desc } }),
  }, 10000);
  if (!cr.ok) {
    if (cr.status === 401) return res.status(401).json({ error: "token_expired" });
    const b = await cr.json().catch(() => ({}));
    return res.status(cr.status).json({ error: "create_failed", message: b?.errors?.[0]?.detail || "Failed to create Apple Music playlist" });
  }
  const pl = await cr.json();
  const plId = pl.data?.[0]?.id;
  if (!plId) return res.status(500).json({ error: "create_failed", message: "Apple Music returned no playlist ID" });

  let added = 0, failed = 0;
  for (let i = 0; i < trackIds.length; i += 25) {
    const batch = trackIds.slice(i, i + 25).map(id => ({ id, type: "songs" }));
    const r = await timedFetch(`https://api.music.apple.com/v1/me/library/playlists/${plId}/tracks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${dev}`, "Music-User-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ data: batch }),
    }, 10000);
    (r.ok || r.status === 204) ? added += batch.length : failed += batch.length;
    if (i + 25 < trackIds.length) await sleep(300);
  }

  return res.status(200).json({ success: failed === 0, partial: failed > 0 && added > 0, playlistId: plId, playlistUrl: `https://music.apple.com/library/playlist/${plId}`, added, failed, total: trackIds.length });
}

// ── AMAZON MUSIC ──────────────────────────────────────────────────────────────
async function toAmazon(res, token, name, desc, trackIds, pub) {
  const apiKey = process.env.AMAZON_MUSIC_API_KEY || "";

  const cr = await timedFetch("https://api.music.amazon.dev/v1/playlists", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ title: name, description: desc, accessType: pub ? "PUBLIC" : "PRIVATE" }),
  }, 10000);
  if (!cr.ok) {
    const b = await cr.json().catch(() => ({}));
    if (cr.status === 401) return res.status(401).json({ error: "token_expired" });
    return res.status(cr.status).json({ error: "create_failed", message: b?.message || "Failed to create Amazon Music playlist" });
  }
  const pl = await cr.json();
  const plId = pl.id || pl.playlistId;

  let added = 0, failed = 0;
  for (let i = 0; i < trackIds.length; i += 50) {
    const batch = trackIds.slice(i, i + 50);
    const r = await timedFetch(`https://api.music.amazon.dev/v1/playlists/${plId}/tracks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ tracks: batch.map(id => ({ id })) }),
    }, 10000);
    r.ok ? added += batch.length : failed += batch.length;
    if (i + 50 < trackIds.length) await sleep(200);
  }

  return res.status(200).json({ success: failed === 0, partial: failed > 0 && added > 0, playlistId: plId, playlistUrl: `https://music.amazon.com/playlists/${plId}`, added, failed, total: trackIds.length });
}

// ── WYNK MUSIC ────────────────────────────────────────────────────────────────
async function toWynk(res, token, name, desc, songIds) {
  const WYNK_BASE    = "https://api-staging.wynk.in/v1";
  const WYNK_APP_KEY = process.env.WYNK_APP_KEY || "";
  const headers      = { Authorization: `Bearer ${token}`, "X-BSY-UTKN": WYNK_APP_KEY, "Content-Type": "application/json", "User-Agent": "WynkMusic/3.28.0.2 (Android)" };

  const cr = await timedFetch(`${WYNK_BASE}/user/playlists`, {
    method: "POST", headers, body: JSON.stringify({ name, description: desc, isPublic: false }),
  }, 10000);
  if (!cr.ok) {
    if (cr.status === 401) return res.status(401).json({ error: "token_expired" });
    const b = await cr.json().catch(() => ({}));
    return res.status(cr.status).json({ error: "create_failed", message: b?.message || "Failed to create Wynk playlist" });
  }
  const pl = await cr.json();
  const plId = pl.id || pl.playlistId;

  let added = 0, failed = 0;
  for (let i = 0; i < songIds.length; i += 50) {
    const batch = songIds.slice(i, i + 50);
    const r = await timedFetch(`${WYNK_BASE}/user/playlists/${plId}/songs`, {
      method: "POST", headers, body: JSON.stringify({ songIds: batch }),
    }, 10000);
    r.ok ? added += batch.length : failed += batch.length;
    if (i + 50 < songIds.length) await sleep(200);
  }

  return res.status(200).json({ success: failed === 0, partial: failed > 0 && added > 0, playlistId: plId, playlistUrl: null, added, failed, total: songIds.length });
}

// ── JIOSAAVN ──────────────────────────────────────────────────────────────────
async function toSaavn(res, token, name, desc, songIds) {
  const headers = { Cookie: token, "User-Agent": "Mozilla/5.0", "Referer": "https://www.jiosaavn.com/", "Content-Type": "application/x-www-form-urlencoded" };

  // Step 1: Create playlist
  const crParams = new URLSearchParams({ __call: "playlist.create", _format: "json", _marker: "0", listname: name });
  const cr = await timedFetch(`https://www.jiosaavn.com/api.php`, {
    method: "POST", headers, body: crParams.toString(),
  }, 10000);
  if (!cr.ok) return res.status(cr.status).json({ error: "create_failed", message: `JioSaavn ${cr.status}` });

  const plData = await cr.json();
  if (plData.status === "failure") return res.status(400).json({ error: "create_failed", message: plData.message || "Failed to create JioSaavn playlist" });

  const plId  = plData.listid || plData.id;
  const plUrl = plData.perma_url || `https://www.jiosaavn.com/playlist/-/${plId}`;

  // Step 2: Add songs (one page at a time — JioSaavn adds by ID list)
  let added = 0, failed = 0;
  for (let i = 0; i < songIds.length; i += 50) {
    const batch = songIds.slice(i, i + 50);
    const addParams = new URLSearchParams({
      __call:   "playlist.addSong",
      _format:  "json",
      _marker:  "0",
      listid:   plId,
      songid:   batch.join(","),
    });
    const r = await timedFetch("https://www.jiosaavn.com/api.php", {
      method: "POST", headers, body: addParams.toString(),
    }, 10000);
    const d = await r.json().catch(() => ({}));
    (r.ok && d.status !== "failure") ? added += batch.length : failed += batch.length;
    if (i + 50 < songIds.length) await sleep(200);
  }

  return res.status(200).json({ success: failed === 0, partial: failed > 0 && added > 0, playlistId: plId, playlistUrl: plUrl, added, failed, total: songIds.length });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sf(url, token, opts = {}) {
  return timedFetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) } }, 12000);
}

function yf(url, token, opts = {}) {
  return timedFetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) } }, 12000);
}

function handleAuthErr(res, r, platform) {
  if (r.status === 401) return res.status(401).json({ error: "token_expired", message: `${platform} token expired` });
  return res.status(r.status).json({ error: "auth_failed" });
}
