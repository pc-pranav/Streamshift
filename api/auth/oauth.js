// api/auth/oauth.js
// Handles OAuth for Spotify, YouTube Music, and Amazon Music
// Routes: GET  /api/auth/oauth?platform=spotify&action=login[&role=source|dest]
//         GET  /api/auth/oauth?platform=spotify&action=callback&code=...&state=...
//         POST /api/auth/oauth?platform=spotify&action=refresh   body: {refresh_token}

import { setCors, timedFetch, apiError } from "../_lib/utils.js";

// ── Platform configs ──────────────────────────────────────────────────────────
const CONFIGS = {
  spotify: {
    authUrl:    "https://accounts.spotify.com/authorize",
    tokenUrl:   "https://accounts.spotify.com/api/token",
    profileUrl: "https://api.spotify.com/v1/me",
    scopes:     "playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private user-library-read user-library-modify user-read-private user-read-email",
    clientIdEnv: "SPOTIFY_CLIENT_ID",
    clientSecretEnv: "SPOTIFY_CLIENT_SECRET",
    basicAuth: true, // Spotify uses Basic auth for token exchange
    getProfile: async (token) => {
      const r = await timedFetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${token}` } }, 8000);
      if (!r.ok) return { id: "unknown", display_name: "Spotify User" };
      const d = await r.json();
      // also fetch liked count
      let likedCount = null;
      const lr = await timedFetch("https://api.spotify.com/v1/me/tracks?limit=1", { headers: { Authorization: `Bearer ${token}` } }, 6000).catch(() => null);
      if (lr?.ok) { const ld = await lr.json(); likedCount = ld.total ?? null; }
      return { user_id: d.id, display_name: d.display_name || d.id, email: d.email || null, avatar: d.images?.[0]?.url || null, product: d.product || "free", likedCount };
    },
  },
  youtube_music: {
    authUrl:    "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl:   "https://oauth2.googleapis.com/token",
    profileUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
    scopes:     "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube",
    clientIdEnv: "YOUTUBE_CLIENT_ID",
    clientSecretEnv: "YOUTUBE_CLIENT_SECRET",
    basicAuth: false,
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    getProfile: async (token) => {
      const r = await timedFetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token}` } }, 8000);
      if (!r.ok) return { user_id: "unknown", display_name: "YouTube User" };
      const d = await r.json();
      return { user_id: d.sub, display_name: d.name || "YouTube User", email: d.email || null, avatar: d.picture || null };
    },
  },
  amazon_music: {
    authUrl:    "https://www.amazon.com/ap/oa",
    tokenUrl:   "https://api.amazon.com/auth/o2/token",
    profileUrl: "https://api.amazon.com/user/profile",
    scopes:     "profile postal_code",
    clientIdEnv: "AMAZON_CLIENT_ID",
    clientSecretEnv: "AMAZON_CLIENT_SECRET",
    basicAuth: false,
    getProfile: async (token) => {
      const r = await timedFetch("https://api.amazon.com/user/profile", { headers: { Authorization: `Bearer ${token}` } }, 8000);
      if (!r.ok) return { user_id: "unknown", display_name: "Amazon User" };
      const d = await r.json();
      return { user_id: d.user_id, display_name: d.name || "Amazon User", email: d.email || null, avatar: null };
    },
  },
};

function getBaseUrl(req) {
  return process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173");
}

function parseCookie(header, name) {
  if (!header) return null;
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { platform, action, role = "source" } = req.query;

  if (!platform || !CONFIGS[platform]) {
    return apiError(res, 400, "invalid_platform", `platform must be one of: ${Object.keys(CONFIGS).join(", ")}`);
  }
  if (!action) return apiError(res, 400, "missing_action", "action required: login | callback | refresh");

  const cfg = CONFIGS[platform];

  switch (action) {
    case "login":    return handleLogin(req, res, platform, cfg, role);
    case "callback": return handleCallback(req, res, platform, cfg);
    case "refresh":  return handleRefresh(req, res, platform, cfg);
    default: return apiError(res, 400, "invalid_action", "action must be: login | callback | refresh");
  }
}

// ── LOGIN — redirect to platform OAuth page ──────────────────────────────────
function handleLogin(req, res, platform, cfg, role) {
  const clientId = process.env[cfg.clientIdEnv];
  if (!clientId) return apiError(res, 500, "missing_config", `${cfg.clientIdEnv} not set`);

  const baseUrl     = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/auth/oauth?platform=${platform}&action=callback`;
  const state       = `${role}:${Math.random().toString(36).slice(2)}`;

  res.setHeader("Set-Cookie", `oauth_state_${platform}=${encodeURIComponent(state)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);

  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: "code",
    redirect_uri:  redirectUri,
    scope:         cfg.scopes,
    state,
    ...(cfg.extraAuthParams || {}),
  });
  // Spotify needs show_dialog
  if (platform === "spotify") params.set("show_dialog", "true");

  return res.redirect(302, `${cfg.authUrl}?${params}`);
}

// ── CALLBACK — exchange code for tokens ──────────────────────────────────────
async function handleCallback(req, res, platform, cfg) {
  const { code, state, error } = req.query;
  res.setHeader("Set-Cookie", `oauth_state_${platform}=; HttpOnly; Path=/; Max-Age=0`);

  if (error) {
    const msg = error === "access_denied" ? `You cancelled the ${platform.replace("_", " ")} login.` : `OAuth error: ${error}`;
    return res.redirect(302, `/?auth_error=${encodeURIComponent(msg)}&platform=${platform}`);
  }
  if (!code) return res.redirect(302, `/?auth_error=${encodeURIComponent("No code received.")}&platform=${platform}`);

  const cookieState = parseCookie(req.headers.cookie, `oauth_state_${platform}`);
  if (cookieState && state && cookieState !== state)
    return res.redirect(302, `/?auth_error=${encodeURIComponent("Security check failed.")}&platform=${platform}`);

  const role = (state || "source:").split(":")[0] === "dest" ? "dest" : "source";

  const clientId     = process.env[cfg.clientIdEnv];
  const clientSecret = process.env[cfg.clientSecretEnv];
  if (!clientId || !clientSecret)
    return res.redirect(302, `/?auth_error=${encodeURIComponent("Server misconfiguration.")}&platform=${platform}`);

  const baseUrl     = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/auth/oauth?platform=${platform}&action=callback`;

  try {
    // Build token request
    const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
    const headers = { "Content-Type": "application/x-www-form-urlencoded" };

    if (cfg.basicAuth) {
      headers["Authorization"] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    } else {
      body.set("client_id", clientId);
      body.set("client_secret", clientSecret);
    }

    const tokenRes = await timedFetch(cfg.tokenUrl, { method: "POST", headers, body: body.toString() }, 12000);
    if (!tokenRes.ok) {
      const b = await tokenRes.json().catch(() => ({}));
      const msg = b.error_description || b.error || `Token exchange failed (${tokenRes.status})`;
      return res.redirect(302, `/?auth_error=${encodeURIComponent(msg)}&platform=${platform}`);
    }

    const tokens  = await tokenRes.json();
    const profile = await cfg.getProfile(tokens.access_token);

    const payload = encodeURIComponent(JSON.stringify({
      platform, role,
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_in:    tokens.expires_in,
      expires_at:    Date.now() + tokens.expires_in * 1000,
      ...profile,
    }));

    const paramName = platform === "youtube_music" ? "youtube_auth" : platform === "amazon_music" ? "amazon_auth" : "spotify_auth";
    return res.redirect(302, `/?${paramName}=${payload}`);
  } catch (err) {
    return res.redirect(302, `/?auth_error=${encodeURIComponent(`Auth failed: ${err.message}`)}&platform=${platform}`);
  }
}

// ── REFRESH — get new access token ───────────────────────────────────────────
async function handleRefresh(req, res, platform, cfg) {
  setCors(res);
  if (req.method !== "POST") return apiError(res, 405, "method_not_allowed", "POST only");

  const { refresh_token } = req.body || {};
  if (!refresh_token) return apiError(res, 400, "missing_param", "refresh_token required");

  const clientId     = process.env[cfg.clientIdEnv];
  const clientSecret = process.env[cfg.clientSecretEnv];
  if (!clientId || !clientSecret) return apiError(res, 500, "missing_config", `${cfg.clientIdEnv} not set`);

  try {
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token });
    const headers = { "Content-Type": "application/x-www-form-urlencoded" };

    if (cfg.basicAuth) {
      headers["Authorization"] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    } else {
      body.set("client_id", clientId);
      body.set("client_secret", clientSecret);
    }

    const r = await timedFetch(cfg.tokenUrl, { method: "POST", headers, body: body.toString() }, 10000);
    if (r.status === 400) return apiError(res, 401, "refresh_token_revoked", "Session expired. Please reconnect.");
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      return apiError(res, r.status, "refresh_failed", b.error_description || `Refresh failed (${r.status})`);
    }
    const data = await r.json();
    return res.status(200).json({
      access_token:  data.access_token,
      expires_in:    data.expires_in,
      expires_at:    Date.now() + data.expires_in * 1000,
      refresh_token: data.refresh_token || refresh_token,
    });
  } catch (err) {
    return apiError(res, err.status || 503, "network_error", err.message);
  }
}
