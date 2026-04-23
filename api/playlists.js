// api/playlists.js  — fetches user playlists for all 6 platforms
// GET /api/playlists?platform=spotify&offset=0
// Authorization: Bearer <access_token>

// ─── INLINE UTILITIES ────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}
function apiError(res, status, code, message) { return res.status(status).json({ error: code, message }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function timedFetch(url, opts = {}, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  catch(e) {
    if (e.name === "AbortError") { const err = new Error(`Timeout`); err.status = 504; throw err; }
    const err = new Error(`Network: ${e.message}`); err.status = 503; throw err;
  } finally { clearTimeout(t); }
}

async function withRetry(fn, maxAttempts = 3) {
  let last;
  for (let i = 1; i <= maxAttempts; i++) {
    try { return await fn(); }
    catch(e) {
      last = e;
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429) throw e;
      if (i < maxAttempts) await sleep(Math.pow(2, i) * 500 + Math.random() * 300);
    }
  }
  throw last;
}

function platError(resp, platform) {
  const map = { 401:"token_expired", 403:"forbidden", 404:"not_found", 429:"rate_limited", 500:"platform_error", 503:"platform_down" };
  const msgs = { 401:`${platform} session expired. Please reconnect.`, 403:`Insufficient permissions on ${platform}.`, 404:`Not found on ${platform}.`, 429:`${platform} rate limited. Retrying…`, 500:`${platform} server error.`, 503:`${platform} unavailable.` };
  const e = new Error(msgs[resp.status] || `${platform} error (${resp.status})`);
  e.status = resp.status; e.code = map[resp.status] || "platform_error"; return e;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return apiError(res, 405, "method_not_allowed", "GET only");

  const token    = (req.headers.authorization || "").replace("Bearer ", "").trim();
  const platform = req.query.platform;
  const offset   = parseInt(req.query.offset) || 0;
  const limit    = Math.min(parseInt(req.query.limit) || 50, 50);
  const pageToken = req.query.pageToken || null;

  if (!token)    return apiError(res, 401, "missing_token", "Authorization: Bearer <token> required");
  if (!platform) return apiError(res, 400, "missing_param", "?platform= required");

  try {
    switch (platform) {
      case "spotify":       return await spotifyPlaylists(res, token, offset, limit);
      case "youtube_music": return await youtubePlaylists(res, token, limit, pageToken);
      case "apple_music":   return await applePlaylists(res, token, offset, limit);
      case "amazon_music":  return await amazonPlaylists(res, token, offset, limit);
      case "wynk":          return await wynkPlaylists(res, token, offset, limit);
      case "jiosaavn":      return await saavnPlaylists(res, token, offset, limit);
      default: return apiError(res, 400, "unsupported_platform", `Supported: spotify, youtube_music, apple_music, amazon_music, wynk, jiosaavn`);
    }
  } catch(e) {
    console.error(`[playlists/${platform}]`, e.message);
    return apiError(res, e.status || 503, e.code || "error", e.message);
  }
}

async function spotifyPlaylists(res, token, offset, limit) {
  const r = await withRetry(async () => {
    const resp = await timedFetch(`https://api.spotify.com/v1/me/playlists?limit=${limit}&offset=${offset}`, { headers: { Authorization: `Bearer ${token}` } }, 10000);
    if (!resp.ok) throw platError(resp, "Spotify");
    return resp;
  });
  const d = await r.json();
  return res.status(200).json({
    playlists: (d.items||[]).filter(Boolean).map(pl => ({ id:pl.id, name:pl.name||"Untitled", desc:pl.description||"", trackCount:pl.tracks?.total??0, isPublic:pl.public??false, isCollab:pl.collaborative??false, ownerId:pl.owner?.id, ownerName:pl.owner?.display_name||pl.owner?.id, coverUrl:pl.images?.[0]?.url||null, platform:"spotify", externalUrl:pl.external_urls?.spotify||null })),
    pagination: { total:d.total, offset, limit:d.limit, hasMore:!!d.next },
  });
}

async function youtubePlaylists(res, token, limit, pageToken) {
  const params = new URLSearchParams({ part:"snippet,contentDetails", mine:"true", maxResults:String(limit) });
  if (pageToken) params.set("pageToken", pageToken);
  const r = await withRetry(async () => {
    const resp = await timedFetch(`https://www.googleapis.com/youtube/v3/playlists?${params}`, { headers: { Authorization: `Bearer ${token}` } }, 10000);
    if (!resp.ok) throw platError(resp, "YouTube");
    return resp;
  });
  const d = await r.json();
  return res.status(200).json({
    playlists: (d.items||[]).map(pl => ({ id:pl.id, name:pl.snippet?.title||"Untitled", desc:pl.snippet?.description||"", trackCount:pl.contentDetails?.itemCount??0, isPublic:pl.snippet?.privacyStatus==="public", ownerId:pl.snippet?.channelId, ownerName:pl.snippet?.channelTitle||"You", coverUrl:pl.snippet?.thumbnails?.high?.url||null, platform:"youtube_music" })),
    pagination: { total:d.pageInfo?.totalResults||0, limit, hasMore:!!d.nextPageToken, nextPageToken:d.nextPageToken||null },
  });
}

async function applePlaylists(res, token, offset, limit) {
  const dev = process.env.APPLE_DEVELOPER_TOKEN;
  if (!dev) return apiError(res, 500, "missing_config", "APPLE_DEVELOPER_TOKEN not set");
  const r = await withRetry(async () => {
    const resp = await timedFetch(`https://api.music.apple.com/v1/me/library/playlists?limit=${limit}&offset=${offset}`, { headers: { Authorization:`Bearer ${dev}`, "Music-User-Token":token } }, 10000);
    if (!resp.ok) throw platError(resp, "Apple Music");
    return resp;
  });
  const d = await r.json();
  const next = d.next;
  return res.status(200).json({
    playlists: (d.data||[]).map(pl => ({ id:pl.id, name:pl.attributes?.name||"Untitled", desc:pl.attributes?.description?.standard||"", trackCount:pl.attributes?.trackCount??null, isPublic:false, coverUrl:pl.attributes?.artwork?.url?.replace("{w}","300").replace("{h}","300")||null, platform:"apple_music" })),
    pagination: { total:d.meta?.total||0, offset, limit, hasMore:!!next, nextOffset:next?parseInt(new URL("https://x"+next).searchParams.get("offset")||"0"):null },
  });
}

async function amazonPlaylists(res, token, offset, limit) {
  const apiKey = process.env.AMAZON_MUSIC_API_KEY || "";
  const r = await withRetry(async () => {
    const resp = await timedFetch(`https://api.music.amazon.dev/v1/playlists/me?maxResults=${limit}&startIndex=${offset}`, { headers: { Authorization:`Bearer ${token}`, "x-api-key":apiKey } }, 10000);
    if (!resp.ok) throw platError(resp, "Amazon Music");
    return resp;
  });
  const d = await r.json();
  const items = d.playlists||d.items||[];
  return res.status(200).json({
    playlists: items.map(pl => ({ id:pl.id||pl.asin, name:pl.title||pl.name||"Untitled", desc:pl.description||"", trackCount:pl.trackCount??pl.numberOfTracks??0, isPublic:pl.accessType==="PUBLIC", coverUrl:pl.image?.url||pl.imageUrl||null, platform:"amazon_music" })),
    pagination: { total:d.total||items.length, offset, limit, hasMore:offset+items.length<(d.total||0) },
  });
}

async function wynkPlaylists(res, token, offset, limit) {
  const appKey = process.env.WYNK_APP_KEY || "";
  const r = await withRetry(async () => {
    const resp = await timedFetch(`https://api-staging.wynk.in/v1/user/playlists?limit=${limit}&offset=${offset}`, { headers: { Authorization:`Bearer ${token}`, "X-BSY-UTKN":appKey, "User-Agent":"WynkMusic/3.28.0.2 (Android)" } }, 10000);
    if (!resp.ok) throw platError(resp, "Wynk");
    return resp;
  });
  const d = await r.json();
  const items = d.playlists||d.data||[];
  return res.status(200).json({
    playlists: items.map(pl => ({ id:pl.id||pl.playlistId, name:pl.name||pl.title||"Untitled", desc:pl.description||"", trackCount:pl.songCount??pl.trackCount??0, isPublic:pl.isPublic??false, coverUrl:pl.image||pl.thumbnail||null, platform:"wynk" })),
    pagination: { total:d.total||items.length, offset, limit, hasMore:!!d.hasMore },
  });
}

async function saavnPlaylists(res, token, offset, limit) {
  const page = Math.floor(offset/limit)+1;
  const params = new URLSearchParams({ __call:"user.getPlaylists", _format:"json", _marker:"0", p:String(page), n:String(limit), includeMetaTags:"0" });
  const r = await withRetry(async () => {
    const resp = await timedFetch(`https://www.jiosaavn.com/api.php?${params}`, { headers: { Cookie:token, "User-Agent":"Mozilla/5.0", Referer:"https://www.jiosaavn.com/", Accept:"application/json" } }, 10000);
    if (!resp.ok) throw platError(resp, "JioSaavn");
    return resp;
  });
  const d = await r.json();
  const items = Array.isArray(d) ? d : (d.playlists||d.data||[]);
  return res.status(200).json({
    playlists: items.map(pl => ({ id:pl.id||pl.listid, name:pl.title||pl.listname||"Untitled", desc:pl.description||pl.subtitle||"", trackCount:parseInt(pl.count||pl.song_count||"0"), isPublic:pl.type!=="user_playlist", ownerName:pl.username||pl.firstname||"You", coverUrl:(pl.image||pl.images?.[2]||"").replace("http:","https:")||null, platform:"jiosaavn" })),
    pagination: { total:parseInt(d.total||items.length), offset, limit, hasMore:parseInt(d.total||0)>offset+items.length },
  });
}
