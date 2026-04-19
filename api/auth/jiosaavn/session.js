// api/auth/jiosaavn/session.js
// JioSaavn — semi-public API (jiosaavn.com/api.php)
// Auth: cookie-based session using phone + password or OTP
// The jiosaavn.com API is not officially documented but is stable and widely used.
//
// Endpoints used:
//   Login:    https://www.jiosaavn.com/api.php?__call=user.login
//   Playlists:https://www.jiosaavn.com/api.php?__call=user.getPlaylists
//   Search:   https://www.jiosaavn.com/api.php?__call=search.getResults
//   Create:   https://www.jiosaavn.com/api.php?__call=playlist.create

import { setCors, timedFetch, apiError } from "../../_lib/utils.js";

const SAAVN_BASE = "https://www.jiosaavn.com/api.php";

// Common headers that mimic the JioSaavn web app
const SAAVN_HEADERS = {
  "User-Agent":  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept":      "application/json, text/plain, */*",
  "Origin":      "https://www.jiosaavn.com",
  "Referer":     "https://www.jiosaavn.com/",
};

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action } = req.query;

  switch (action) {
    case "login":   return login(req, res);
    case "refresh": return refresh(req, res);
    default:
      return apiError(res, 400, "invalid_action", "Use ?action=login or ?action=refresh");
  }
}

// ── Login with username (email/phone) + password ─────────────────────────────
async function login(req, res) {
  if (req.method !== "POST") return apiError(res, 405, "method_not_allowed", "POST only");

  const { username, password } = req.body || {};
  if (!username || !password) {
    return apiError(res, 400, "missing_param", "username (email or phone) and password required");
  }

  try {
    const params = new URLSearchParams({
      __call:    "user.login",
      _format:   "json",
      _marker:   "0",
      username,
      password,
    });

    const r = await timedFetch(`${SAAVN_BASE}?${params}`, {
      method:  "GET",
      headers: SAAVN_HEADERS,
    }, 12000);

    if (!r.ok) {
      return apiError(res, r.status, "login_failed", `JioSaavn returned HTTP ${r.status}`);
    }

    const data = await r.json();

    // JioSaavn returns status:"failure" even on 200
    if (data.status === "failure" || data.error) {
      const msg = data.message || data.error || "Invalid credentials";
      if (msg.toLowerCase().includes("password") || msg.toLowerCase().includes("credential")) {
        return apiError(res, 401, "invalid_credentials", "Invalid username or password.");
      }
      return apiError(res, 400, "login_failed", msg);
    }

    // Extract session cookie from response headers
    const setCookieHeader = r.headers.get("set-cookie") || "";
    const sessionCookie   = extractCookie(setCookieHeader, "CT_CC_s");
    const userCookie      = extractCookie(setCookieHeader, "CT_UC_s");
    const combinedCookie  = `CT_CC_s=${sessionCookie}; CT_UC_s=${userCookie}`;

    if (!sessionCookie) {
      return apiError(res, 502, "no_session", "JioSaavn did not return a session. Try again.");
    }

    return res.status(200).json({
      platform:      "jiosaavn",
      access_token:  combinedCookie,  // cookie string used as auth token
      refresh_token: null,            // JioSaavn uses long-lived cookies
      expires_at:    Date.now() + 30 * 24 * 60 * 60 * 1000, // ~30 days
      user_id:       data.uid  || data.userId || username,
      display_name:  data.name || data.displayName || username,
      email:         data.email || null,
      avatar:        data.image || data.profilePic || null,
    });
  } catch (err) {
    return apiError(res, err.status || 503, "network_error", err.message);
  }
}

// ── Re-validate session (JioSaavn cookies are long-lived, just check validity) 
async function refresh(req, res) {
  if (req.method !== "POST") return apiError(res, 405, "method_not_allowed", "POST only");

  const { access_token } = req.body || {};
  if (!access_token) return apiError(res, 400, "missing_param", "access_token (cookie) required");

  try {
    // Call a lightweight endpoint to check if cookie is still valid
    const params = new URLSearchParams({ __call: "user.getPlaylists", _format: "json" });
    const r = await timedFetch(`${SAAVN_BASE}?${params}`, {
      headers: { ...SAAVN_HEADERS, Cookie: access_token },
    }, 8000);

    if (r.status === 401 || r.status === 403) {
      return apiError(res, 401, "session_expired", "JioSaavn session expired. Please log in again.");
    }

    return res.status(200).json({
      access_token,
      expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
  } catch (err) {
    return apiError(res, 503, "network_error", err.message);
  }
}

function extractCookie(setCookieStr, name) {
  const re = new RegExp(`${name}=([^;,\\s]+)`);
  const m  = setCookieStr.match(re);
  return m ? m[1] : "";
}
