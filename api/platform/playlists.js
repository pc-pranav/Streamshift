// api/platform/playlists.js
// Unified playlist fetcher for all 6 platforms:
// Spotify · YouTube Music · Apple Music · Amazon Music · Wynk · JioSaavn
// GET /api/platform/playlists?platform=spotify&offset=0
// Authorization: Bearer <access_token>

import { setCors, timedFetch, withRetry, retryAfterSecs, sleep, apiError } from "../_lib/utils.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return apiError(res, 405, "method_not_allowed", "GET only");

  const token    = (req.headers.authorization || "").replace("Bearer ", "").trim();
  const platform = req.query.platform;
  const offset   = parseInt(req.query.offset) || 0;
  const limit    = Math.min(parseInt(req.query.limit) || 50, 50);

  if (!token)    return apiError(res, 401, "missing_token", "Authorization: Bearer <token> required");
  if (!platform) return apiError(res, 400, "missing_param", "?platform= required");

  try {
    switch (platform) {
      case "spotify":       return await spotifyPlaylists(req, res, token, offset, limit);
      case "youtube_music": return await youtubePlaylists(req, res, token, offset, limit);
      case "apple_music":   return await applePlaylists(req, res, token, offset, limit);
      case "amazon_music":  return await amazonPlaylists(req, res, token, offset, limit);
      case "wynk":          return await wynkPlaylists(req, res, token, offset, limit);
      case "jiosaavn":      return await saavnPlaylists(req, res, token, offset, limit);
      default:
        return apiError(res, 400, "unsupported_platform",
          `"${platform}" not supported. Valid: spotify, youtube_music, apple_music, amazon_music, wynk, jiosaavn`);
    }
  } catch (err) {
    console.error(`[playlists/${platform}]`, err);
    return apiError(res, err.status || 503, err.code || "unexpected_error", err.message);
  }
}

// ── SPOTIFY ──────────────────────────────────────────────────────────────────
async function spotifyPlaylists(req, res, token, offset, limit) {
  const r = await withRetry(async () => {
    const resp = await timedFetch(
      `https://api.spotify.com/v1/me/playlists?limit=${limit}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${token}` } }, 10000);
    await assertOk(resp, "Spotify");
    return resp;
  }, { label: "spotify/playlists" });

  const d = await r.json();
  return res.status(200).json({
    playlists: (d.items || []).filter(Boolean).map(pl => ({
      id:        pl.id,
      name:      pl.name || "Untitled",
      desc:      pl.description || "",
      trackCount: pl.tracks?.total ?? 0,
      isPublic:  pl.public ?? false,
      isCollab:  pl.collaborative ?? false,
      ownerId:   pl.owner?.id,
      ownerName: pl.owner?.display_name || pl.owner?.id,
      coverUrl:  pl.images?.[0]?.url || null,
      platform:  "spotify",
      externalUrl: pl.external_urls?.spotify || null,
    })),
    pagination: { total: d.total, offset, limit: d.limit, hasMore: !!d.next },
  });
}

// ── YOUTUBE MUSIC ─────────────────────────────────────────────────────────────
async function youtubePlaylists(req, res, token, offset, limit) {
  const params = new URLSearchParams({ part: "snippet,contentDetails", mine: "true", maxResults: String(limit) });
  if (req.query.pageToken) params.set("pageToken", req.query.pageToken);

  const r = await withRetry(async () => {
    const resp = await timedFetch(
      `https://www.googleapis.com/youtube/v3/playlists?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }, 10000);
    await assertOk(resp, "YouTube");
    return resp;
  }, { label: "youtube/playlists" });

  const d = await r.json();
  return res.status(200).json({
    playlists: (d.items || []).map(pl => ({
      id:        pl.id,
      name:      pl.snippet?.title || "Untitled",
      desc:      pl.snippet?.description || "",
      trackCount: pl.contentDetails?.itemCount ?? 0,
      isPublic:  pl.snippet?.privacyStatus === "public",
      ownerId:   pl.snippet?.channelId,
      ownerName: pl.snippet?.channelTitle || "You",
      coverUrl:  pl.snippet?.thumbnails?.high?.url || null,
      platform:  "youtube_music",
    })),
    pagination: {
      total: d.pageInfo?.totalResults || 0, offset, limit,
      hasMore: !!d.nextPageToken, nextPageToken: d.nextPageToken || null,
    },
  });
}

// ── APPLE MUSIC ────────────────────────────────────────────────────────────────
async function applePlaylists(req, res, token, offset, limit) {
  const devToken = process.env.APPLE_DEVELOPER_TOKEN;
  if (!devToken) return apiError(res, 500, "missing_config", "APPLE_DEVELOPER_TOKEN not set");

  const r = await withRetry(async () => {
    const resp = await timedFetch(
      `https://api.music.apple.com/v1/me/library/playlists?limit=${limit}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${devToken}`, "Music-User-Token": token } }, 10000);
    await assertOk(resp, "Apple Music");
    return resp;
  }, { label: "apple/playlists" });

  const d = await r.json();
  const next = d.next;
  return res.status(200).json({
    playlists: (d.data || []).map(pl => ({
      id:        pl.id,
      name:      pl.attributes?.name || "Untitled",
      desc:      pl.attributes?.description?.standard || "",
      trackCount: pl.attributes?.trackCount ?? null,
      isPublic:  false,
      coverUrl:  pl.attributes?.artwork?.url?.replace("{w}", "300").replace("{h}", "300") || null,
      platform:  "apple_music",
    })),
    pagination: {
      total: d.meta?.total || 0, offset, limit,
      hasMore: !!next,
      nextOffset: next ? parseInt(new URL("https://x" + next).searchParams.get("offset") || "0") : null,
    },
  });
}

// ── AMAZON MUSIC ──────────────────────────────────────────────────────────────
// Amazon Music uses their Catalog API. Playlist access requires the
// com.amazon.music.library scope (requested during OAuth).
async function amazonPlaylists(req, res, token, offset, limit) {
  // Amazon Music API endpoint (same for amazon.com and amazon.in)
  const r = await withRetry(async () => {
    const resp = await timedFetch(
      `https://api.music.amazon.dev/v1/playlists/me?maxResults=${limit}&startIndex=${offset}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-api-key":   process.env.AMAZON_MUSIC_API_KEY || "",
          "Content-Type": "application/json",
        }
      }, 10000);
    await assertOk(resp, "Amazon Music");
    return resp;
  }, { label: "amazon/playlists" });

  const d = await r.json();
  const items = d.playlists || d.items || [];
  return res.status(200).json({
    playlists: items.map(pl => ({
      id:        pl.id || pl.asin,
      name:      pl.title || pl.name || "Untitled",
      desc:      pl.description || "",
      trackCount: pl.trackCount ?? pl.numberOfTracks ?? 0,
      isPublic:  pl.accessType === "PUBLIC",
      coverUrl:  pl.image?.url || pl.imageUrl || null,
      platform:  "amazon_music",
    })),
    pagination: {
      total:   d.total || items.length,
      offset,  limit,
      hasMore: offset + items.length < (d.total || 0),
    },
  });
}

// ── WYNK MUSIC ────────────────────────────────────────────────────────────────
async function wynkPlaylists(req, res, token, offset, limit) {
  const WYNK_BASE    = "https://api-staging.wynk.in/v1";
  const WYNK_APP_KEY = process.env.WYNK_APP_KEY || "";

  const r = await withRetry(async () => {
    const resp = await timedFetch(`${WYNK_BASE}/user/playlists?limit=${limit}&offset=${offset}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-BSY-UTKN":  WYNK_APP_KEY,
        "User-Agent":  "WynkMusic/3.28.0.2 (Android)",
      }
    }, 10000);
    await assertOk(resp, "Wynk");
    return resp;
  }, { label: "wynk/playlists" });

  const d = await r.json();
  const items = d.playlists || d.data || [];
  return res.status(200).json({
    playlists: items.map(pl => ({
      id:        pl.id || pl.playlistId,
      name:      pl.name || pl.title || "Untitled",
      desc:      pl.description || "",
      trackCount: pl.songCount ?? pl.trackCount ?? 0,
      isPublic:  pl.isPublic ?? false,
      coverUrl:  pl.image || pl.thumbnail || null,
      platform:  "wynk",
    })),
    pagination: { total: d.total || items.length, offset, limit, hasMore: !!d.hasMore },
  });
}

// ── JIOSAAVN ──────────────────────────────────────────────────────────────────
async function saavnPlaylists(req, res, token, offset, limit) {
  // token is the cookie string for JioSaavn
  const params = new URLSearchParams({
    __call:   "user.getPlaylists",
    _format:  "json",
    _marker:  "0",
    p:        String(Math.floor(offset / limit) + 1),
    n:        String(limit),
    includeMetaTags: "0",
  });

  const r = await withRetry(async () => {
    const resp = await timedFetch(`https://www.jiosaavn.com/api.php?${params}`, {
      headers: {
        Cookie:       token, // cookie-based auth
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer":    "https://www.jiosaavn.com/",
        Accept:       "application/json",
      }
    }, 10000);
    await assertOk(resp, "JioSaavn");
    return resp;
  }, { label: "jiosaavn/playlists" });

  const d = await r.json();

  // JioSaavn returns array directly or wrapped
  const items = Array.isArray(d) ? d : (d.playlists || d.data || []);

  return res.status(200).json({
    playlists: items.map(pl => ({
      id:        pl.id || pl.listid,
      name:      pl.title || pl.listname || "Untitled",
      desc:      pl.description || pl.subtitle || "",
      trackCount: parseInt(pl.count || pl.song_count || "0"),
      isPublic:  pl.type !== "user_playlist" || (pl.isfollowed === "1"),
      coverUrl:  (pl.image || pl.images?.[2] || "").replace("http:", "https:") || null,
      ownerName: pl.username || pl.firstname || "You",
      platform:  "jiosaavn",
    })),
    pagination: {
      total:   parseInt(d.total || items.length),
      offset,  limit,
      hasMore: parseInt(d.total || 0) > offset + items.length,
    },
  });
}

// ── Shared error asserter ────────────────────────────────────────────────────
async function assertOk(resp, platform) {
  if (resp.ok) return;
  const body = await resp.json().catch(() => ({}));
  const status = resp.status;
  const map = {
    401: { code: "token_expired",  msg: `${platform} session expired. Please reconnect.` },
    403: { code: "forbidden",      msg: `Insufficient permissions on ${platform}. Please reconnect.` },
    404: { code: "not_found",      msg: `Resource not found on ${platform}.` },
    429: { code: "rate_limited",   msg: `${platform} rate limit hit. Retrying…` },
    500: { code: "platform_error", msg: `${platform} server error. Retrying…` },
    503: { code: "platform_down",  msg: `${platform} is temporarily unavailable.` },
  };
  const { code, msg } = map[status] || { code: "platform_error", msg: body?.message || body?.error?.message || `${platform} error (${status})` };
  const err = new Error(msg);
  err.status = status; err.code = code;
  if (status === 429) err.retryAfter = retryAfterSecs(resp);
  throw err;
}
