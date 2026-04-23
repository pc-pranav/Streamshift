// api/auth.js  — single file handles ALL platform authentication
// Routes via query params:  ?platform=spotify&action=login|callback|refresh
//                           ?platform=wynk&action=request-otp|verify-otp|refresh
//                           ?platform=jiosaavn&action=login|refresh
//                           ?platform=apple_music&action=token

// ─── INLINE UTILITIES ────────────────────────────────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};
function setCors(res) { Object.entries(CORS_HEADERS).forEach(([k,v]) => res.setHeader(k,v)); }
function apiError(res, status, code, message) { return res.status(status).json({ error: code, message }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function timedFetch(url, opts = {}, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch(e) {
    if (e.name === "AbortError") { const err = new Error(`Timeout after ${ms}ms`); err.status = 504; throw err; }
    const err = new Error(`Network error: ${e.message}`); err.status = 503; throw err;
  } finally { clearTimeout(t); }
}

function parseCookie(header, name) {
  if (!header) return null;
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}
function extractCookie(str, name) {
  const m = str.match(new RegExp(`${name}=([^;,\\s]+)`));
  return m ? m[1] : "";
}
function getBaseUrl() {
  return process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173");
}

// ─── OAUTH PLATFORM CONFIGS ──────────────────────────────────────────────────
const OAUTH = {
  spotify: {
    authUrl:  "https://accounts.spotify.com/authorize",
    tokenUrl: "https://accounts.spotify.com/api/token",
    scopes:   "playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private user-library-read user-library-modify user-read-private user-read-email",
    cidEnv: "SPOTIFY_CLIENT_ID", csecEnv: "SPOTIFY_CLIENT_SECRET",
    basicAuth: true,
    extraParams: { show_dialog: "true" },
    authParamName: "spotify_auth",
    async profile(token) {
      const r = await timedFetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${token}` } }, 8000);
      if (!r.ok) return {};
      const d = await r.json();
      let likedCount = null;
      const lr = await timedFetch("https://api.spotify.com/v1/me/tracks?limit=1", { headers: { Authorization: `Bearer ${token}` } }, 6000).catch(() => null);
      if (lr?.ok) { const ld = await lr.json(); likedCount = ld.total ?? null; }
      return { user_id: d.id, display_name: d.display_name || d.id, email: d.email || null, avatar: d.images?.[0]?.url || null, product: d.product || "free", likedCount };
    },
  },
  youtube_music: {
    authUrl:  "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes:   "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube",
    cidEnv: "YOUTUBE_CLIENT_ID", csecEnv: "YOUTUBE_CLIENT_SECRET",
    basicAuth: false,
    extraParams: { access_type: "offline", prompt: "consent" },
    authParamName: "youtube_auth",
    async profile(token) {
      const r = await timedFetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token}` } }, 8000);
      if (!r.ok) return {};
      const d = await r.json();
      return { user_id: d.sub, display_name: d.name || "YouTube User", email: d.email || null, avatar: d.picture || null };
    },
  },
  amazon_music: {
    authUrl:  "https://www.amazon.com/ap/oa",
    tokenUrl: "https://api.amazon.com/auth/o2/token",
    scopes:   "profile postal_code",
    cidEnv: "AMAZON_CLIENT_ID", csecEnv: "AMAZON_CLIENT_SECRET",
    basicAuth: false,
    extraParams: {},
    authParamName: "amazon_auth",
    async profile(token) {
      const r = await timedFetch("https://api.amazon.com/user/profile", { headers: { Authorization: `Bearer ${token}` } }, 8000);
      if (!r.ok) return {};
      const d = await r.json();
      return { user_id: d.user_id, display_name: d.name || "Amazon User", email: d.email || null, avatar: null };
    },
  },
};

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { platform, action, role = "source" } = req.query;
  if (!platform) return apiError(res, 400, "missing_param", "?platform= required");
  if (!action)   return apiError(res, 400, "missing_param", "?action= required");

  try {
    // ── OAuth platforms ───────────────────────────────────────────────────────
    if (OAUTH[platform]) {
      switch (action) {
        case "login":    return oauthLogin(req, res, platform, role);
        case "callback": return oauthCallback(req, res, platform);
        case "refresh":  return oauthRefresh(req, res, platform);
        default: return apiError(res, 400, "invalid_action", "OAuth actions: login | callback | refresh");
      }
    }

    // ── Apple Music token (no OAuth redirect needed) ──────────────────────────
    if (platform === "apple_music") {
      if (action !== "token") return apiError(res, 400, "invalid_action", "Apple Music action: token");
      const devToken = process.env.APPLE_DEVELOPER_TOKEN;
      if (!devToken) return apiError(res, 500, "missing_config", "APPLE_DEVELOPER_TOKEN not set — see README");
      return res.status(200).json({ developerToken: devToken });
    }

    // ── Wynk (OTP) ────────────────────────────────────────────────────────────
    if (platform === "wynk") {
      if (req.method !== "POST") return apiError(res, 405, "method_not_allowed", "POST only");
      switch (action) {
        case "request-otp": return wynkRequestOtp(req, res);
        case "verify-otp":  return wynkVerifyOtp(req, res);
        case "refresh":     return wynkRefresh(req, res);
        default: return apiError(res, 400, "invalid_action", "Wynk actions: request-otp | verify-otp | refresh");
      }
    }

    // ── JioSaavn (password) ───────────────────────────────────────────────────
    if (platform === "jiosaavn") {
      if (req.method !== "POST") return apiError(res, 405, "method_not_allowed", "POST only");
      switch (action) {
        case "login":   return saavnLogin(req, res);
        case "refresh": return saavnRefresh(req, res);
        default: return apiError(res, 400, "invalid_action", "JioSaavn actions: login | refresh");
      }
    }

    return apiError(res, 400, "unsupported_platform", `platform must be: spotify | youtube_music | amazon_music | apple_music | wynk | jiosaavn`);
  } catch (err) {
    console.error(`[auth/${platform}/${action}]`, err.message);
    return apiError(res, err.status || 500, "server_error", err.message);
  }
}

// ─── OAUTH: LOGIN ─────────────────────────────────────────────────────────────
function oauthLogin(req, res, platform, role) {
  const cfg = OAUTH[platform];
  const clientId = process.env[cfg.cidEnv];
  if (!clientId) return apiError(res, 500, "missing_config", `${cfg.cidEnv} not set`);

  const state = `${role}:${Math.random().toString(36).slice(2)}`;
  res.setHeader("Set-Cookie", `oauth_state=${encodeURIComponent(state)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);

  const redirectUri = `${getBaseUrl()}/api/auth?platform=${platform}&action=callback`;
  const params = new URLSearchParams({
    client_id: clientId, response_type: "code",
    redirect_uri: redirectUri, scope: cfg.scopes, state,
    ...cfg.extraParams,
  });
  return res.redirect(302, `${cfg.authUrl}?${params}`);
}

// ─── OAUTH: CALLBACK ──────────────────────────────────────────────────────────
async function oauthCallback(req, res, platform) {
  const { code, state, error } = req.query;
  const cfg = OAUTH[platform];

  res.setHeader("Set-Cookie", "oauth_state=; HttpOnly; Path=/; Max-Age=0");

  if (error) {
    const msg = error === "access_denied" ? `You cancelled the ${cfg.authParamName.replace("_auth","").replace("_"," ")} login.` : `OAuth error: ${error}`;
    return res.redirect(302, `/?auth_error=${encodeURIComponent(msg)}&platform=${platform}`);
  }
  if (!code) return res.redirect(302, `/?auth_error=${encodeURIComponent("No code received.")}&platform=${platform}`);

  const cookieState = parseCookie(req.headers.cookie, "oauth_state");
  if (cookieState && state && cookieState !== state)
    return res.redirect(302, `/?auth_error=${encodeURIComponent("Security check failed. Please try again.")}&platform=${platform}`);

  const role = (state || "source:").split(":")[0] === "dest" ? "dest" : "source";
  const clientId = process.env[cfg.cidEnv];
  const clientSecret = process.env[cfg.csecEnv];
  if (!clientId || !clientSecret)
    return res.redirect(302, `/?auth_error=${encodeURIComponent("Server misconfiguration — credentials not set.")}&platform=${platform}`);

  const redirectUri = `${getBaseUrl()}/api/auth?platform=${platform}&action=callback`;

  try {
    const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
    const headers = { "Content-Type": "application/x-www-form-urlencoded" };
    if (cfg.basicAuth) {
      headers["Authorization"] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    } else {
      body.set("client_id", clientId); body.set("client_secret", clientSecret);
    }

    const tokenRes = await timedFetch(cfg.tokenUrl, { method: "POST", headers, body: body.toString() }, 12000);
    if (!tokenRes.ok) {
      const b = await tokenRes.json().catch(() => ({}));
      return res.redirect(302, `/?auth_error=${encodeURIComponent(b.error_description || b.error || `Token exchange failed (${tokenRes.status})`)}&platform=${platform}`);
    }
    const tokens = await tokenRes.json();
    const profile = await cfg.profile(tokens.access_token);

    const payload = encodeURIComponent(JSON.stringify({
      platform, role,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_in: tokens.expires_in,
      expires_at: Date.now() + tokens.expires_in * 1000,
      ...profile,
    }));
    return res.redirect(302, `/?${cfg.authParamName}=${payload}`);
  } catch (err) {
    return res.redirect(302, `/?auth_error=${encodeURIComponent(`Auth failed: ${err.message}`)}&platform=${platform}`);
  }
}

// ─── OAUTH: REFRESH ───────────────────────────────────────────────────────────
async function oauthRefresh(req, res, platform) {
  if (req.method !== "POST") return apiError(res, 405, "method_not_allowed", "POST only");
  const { refresh_token } = req.body || {};
  if (!refresh_token) return apiError(res, 400, "missing_param", "refresh_token required");

  const cfg = OAUTH[platform];
  const clientId = process.env[cfg.cidEnv];
  const clientSecret = process.env[cfg.csecEnv];
  if (!clientId || !clientSecret) return apiError(res, 500, "missing_config", `${cfg.cidEnv} not set`);

  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token });
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (cfg.basicAuth) {
    headers["Authorization"] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else { body.set("client_id", clientId); body.set("client_secret", clientSecret); }

  try {
    const r = await timedFetch(cfg.tokenUrl, { method: "POST", headers, body: body.toString() }, 10000);
    if (r.status === 400) return apiError(res, 401, "refresh_revoked", "Session expired. Please reconnect.");
    if (!r.ok) { const b = await r.json().catch(() => ({})); return apiError(res, r.status, "refresh_failed", b.error_description || `Refresh failed (${r.status})`); }
    const data = await r.json();
    return res.status(200).json({ access_token: data.access_token, expires_in: data.expires_in, expires_at: Date.now() + data.expires_in * 1000, refresh_token: data.refresh_token || refresh_token });
  } catch (err) { return apiError(res, err.status || 503, "network_error", err.message); }
}

// ─── WYNK ─────────────────────────────────────────────────────────────────────
const WYNK = "https://api-staging.wynk.in/v1";
function wynkHeaders() {
  const k = process.env.WYNK_APP_KEY || "";
  return { "Content-Type": "application/json", "X-BSY-UTKN": k, "User-Agent": "WynkMusic/3.28.0.2 (Android)", "X-BSY-APPID": "com.bsy.wynk" };
}

async function wynkRequestOtp(req, res) {
  const { phone } = req.body || {};
  if (!phone) return apiError(res, 400, "missing_param", "phone required");
  if (!process.env.WYNK_APP_KEY) return apiError(res, 500, "missing_config", "WYNK_APP_KEY not set — see README");
  const r = await timedFetch(`${WYNK}/auth/requestOTP`, { method: "POST", headers: wynkHeaders(), body: JSON.stringify({ msisdn: phone.replace(/^\+/,""), countryCode:"91" }) }, 10000);
  if (!r.ok) { const b = await r.json().catch(()=>({})); return apiError(res, r.status, "otp_failed", b.message || `OTP request failed (${r.status})`); }
  const d = await r.json();
  return res.status(200).json({ success: true, message: d.message || "OTP sent", txnId: d.txnId || d.transactionId || null });
}

async function wynkVerifyOtp(req, res) {
  const { phone, otp, txnId } = req.body || {};
  if (!phone || !otp) return apiError(res, 400, "missing_param", "phone and otp required");
  if (!process.env.WYNK_APP_KEY) return apiError(res, 500, "missing_config", "WYNK_APP_KEY not set");
  const r = await timedFetch(`${WYNK}/auth/verifyOTP`, { method: "POST", headers: wynkHeaders(), body: JSON.stringify({ msisdn: phone.replace(/^\+/,""), otp, txnId: txnId||"", countryCode:"91" }) }, 10000);
  if (!r.ok) { const b = await r.json().catch(()=>({})); return apiError(res, r.status === 401 ? 401 : r.status, r.status === 401 ? "invalid_otp" : "verify_failed", b.message || "Verification failed"); }
  const d = await r.json();
  const token = d.token || d.accessToken || d.sessionToken;
  if (!token) return apiError(res, 502, "no_token", "Wynk did not return a token. Try again.");
  return res.status(200).json({ platform:"wynk", access_token: token, refresh_token: d.refreshToken||null, expires_at: Date.now()+(d.expiresIn||86400)*1000, user_id: d.userId||phone, display_name: d.name||phone, phone, avatar: d.profileImage||null });
}

async function wynkRefresh(req, res) {
  const { refresh_token } = req.body || {};
  if (!refresh_token) return apiError(res, 400, "missing_param", "refresh_token required");
  if (!process.env.WYNK_APP_KEY) return apiError(res, 500, "missing_config", "WYNK_APP_KEY not set");
  const r = await timedFetch(`${WYNK}/auth/refreshToken`, { method: "POST", headers: wynkHeaders(), body: JSON.stringify({ refreshToken: refresh_token }) }, 10000);
  if (!r.ok) return apiError(res, 401, "refresh_failed", "Wynk session expired. Please reconnect.");
  const d = await r.json();
  return res.status(200).json({ access_token: d.token||d.accessToken, refresh_token: d.refreshToken||refresh_token, expires_at: Date.now()+(d.expiresIn||86400)*1000 });
}

// ─── JIOSAAVN ─────────────────────────────────────────────────────────────────
const SAAVN = "https://www.jiosaavn.com/api.php";
const SAAVN_HDR = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "application/json", Referer: "https://www.jiosaavn.com/" };

async function saavnLogin(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) return apiError(res, 400, "missing_param", "username and password required");
  const params = new URLSearchParams({ __call:"user.login", _format:"json", _marker:"0", username, password });
  const r = await timedFetch(`${SAAVN}?${params}`, { headers: SAAVN_HDR }, 12000);
  if (!r.ok) return apiError(res, r.status, "login_failed", `JioSaavn returned HTTP ${r.status}`);
  const d = await r.json();
  if (d.status === "failure" || d.error) return apiError(res, 401, "invalid_credentials", d.message || d.error || "Invalid credentials");
  const setCookieH = r.headers.get("set-cookie") || "";
  const sc = extractCookie(setCookieH, "CT_CC_s");
  const uc = extractCookie(setCookieH, "CT_UC_s");
  if (!sc) return apiError(res, 502, "no_session", "JioSaavn did not return a session. Try again.");
  return res.status(200).json({ platform:"jiosaavn", access_token:`CT_CC_s=${sc}; CT_UC_s=${uc}`, refresh_token:null, expires_at: Date.now()+30*24*60*60*1000, user_id: d.uid||username, display_name: d.name||username, email: d.email||null, avatar: d.image||null });
}

async function saavnRefresh(req, res) {
  const { access_token } = req.body || {};
  if (!access_token) return apiError(res, 400, "missing_param", "access_token required");
  const params = new URLSearchParams({ __call:"user.getPlaylists", _format:"json" });
  const r = await timedFetch(`${SAAVN}?${params}`, { headers: { ...SAAVN_HDR, Cookie: access_token } }, 8000);
  if (r.status === 401 || r.status === 403) return apiError(res, 401, "session_expired", "JioSaavn session expired. Please log in again.");
  return res.status(200).json({ access_token, expires_at: Date.now()+30*24*60*60*1000 });
}
