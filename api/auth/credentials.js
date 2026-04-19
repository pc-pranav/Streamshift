// api/auth/credentials.js
// Non-OAuth auth flows + Apple Music developer token
//
// Wynk Music  (phone + OTP):
//   POST /api/auth/credentials?platform=wynk&action=request-otp  { phone }
//   POST /api/auth/credentials?platform=wynk&action=verify-otp   { phone, otp, txnId }
//   POST /api/auth/credentials?platform=wynk&action=refresh       { refresh_token }
//
// JioSaavn (email/phone + password):
//   POST /api/auth/credentials?platform=jiosaavn&action=login     { username, password }
//   POST /api/auth/credentials?platform=jiosaavn&action=refresh   { access_token }
//
// Apple Music (developer token):
//   GET  /api/auth/credentials?platform=apple_music&action=token

import { setCors, timedFetch, apiError } from "../_lib/utils.js";

const WYNK_BASE    = "https://api-staging.wynk.in/v1";
const SAAVN_BASE   = "https://www.jiosaavn.com/api.php";
const SAAVN_HDR    = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "application/json", Origin: "https://www.jiosaavn.com", Referer: "https://www.jiosaavn.com/" };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { platform, action } = req.query;

  if (!platform) return apiError(res, 400, "missing_param", "platform required");
  if (!action)   return apiError(res, 400, "missing_param", "action required");

  // ── Apple Music developer token (GET) ────────────────────────────────────
  if (platform === "apple_music" && action === "token") {
    const devToken = process.env.APPLE_DEVELOPER_TOKEN;
    if (!devToken) return apiError(res, 500, "missing_config", "APPLE_DEVELOPER_TOKEN not set. See README for Apple Music setup.");
    return res.status(200).json({ developerToken: devToken });
  }

  if (req.method !== "POST") return apiError(res, 405, "method_not_allowed", "POST only");

  // ── Wynk routes ────────────────────────────────────────────────────────────
  if (platform === "wynk") {
    switch (action) {
      case "request-otp": return wynkRequestOtp(req, res);
      case "verify-otp":  return wynkVerifyOtp(req, res);
      case "refresh":     return wynkRefresh(req, res);
      default: return apiError(res, 400, "invalid_action", "Wynk actions: request-otp | verify-otp | refresh");
    }
  }

  // ── JioSaavn routes ────────────────────────────────────────────────────────
  if (platform === "jiosaavn") {
    switch (action) {
      case "login":   return saavnLogin(req, res);
      case "refresh": return saavnRefresh(req, res);
      default: return apiError(res, 400, "invalid_action", "JioSaavn actions: login | refresh");
    }
  }

  return apiError(res, 400, "unsupported_platform", "platform must be: wynk | jiosaavn | apple_music");
}

// ── WYNK: Request OTP ─────────────────────────────────────────────────────────
async function wynkRequestOtp(req, res) {
  const { phone } = req.body || {};
  if (!phone) return apiError(res, 400, "missing_param", "phone required (e.g. +919876543210)");

  const appKey = process.env.WYNK_APP_KEY;
  if (!appKey) return apiError(res, 500, "missing_config", "WYNK_APP_KEY not set. See README for Wynk setup.");

  try {
    const r = await timedFetch(`${WYNK_BASE}/auth/requestOTP`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BSY-UTKN": appKey, "User-Agent": "WynkMusic/3.28.0.2 (Android)", "X-BSY-APPID": "com.bsy.wynk" },
      body: JSON.stringify({ msisdn: phone.replace(/^\+/, ""), countryCode: "91" }),
    }, 10000);

    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      return apiError(res, r.status, "otp_request_failed", b.message || b.error || `OTP request failed (${r.status})`);
    }
    const data = await r.json();
    return res.status(200).json({ success: true, message: data.message || "OTP sent", txnId: data.txnId || data.transactionId || null });
  } catch (err) {
    return apiError(res, err.status || 503, "network_error", err.message);
  }
}

// ── WYNK: Verify OTP ──────────────────────────────────────────────────────────
async function wynkVerifyOtp(req, res) {
  const { phone, otp, txnId } = req.body || {};
  if (!phone || !otp) return apiError(res, 400, "missing_param", "phone and otp required");

  const appKey = process.env.WYNK_APP_KEY;
  if (!appKey) return apiError(res, 500, "missing_config", "WYNK_APP_KEY not set");

  try {
    const r = await timedFetch(`${WYNK_BASE}/auth/verifyOTP`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BSY-UTKN": appKey, "User-Agent": "WynkMusic/3.28.0.2 (Android)" },
      body: JSON.stringify({ msisdn: phone.replace(/^\+/, ""), otp, txnId: txnId || "", countryCode: "91" }),
    }, 10000);

    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      if (r.status === 401 || b.code === "INVALID_OTP") return apiError(res, 401, "invalid_otp", "Invalid OTP. Please try again.");
      return apiError(res, r.status, "verify_failed", b.message || `Verification failed (${r.status})`);
    }
    const data = await r.json();
    const token = data.token || data.accessToken || data.sessionToken;
    if (!token) return apiError(res, 502, "no_token", "Wynk did not return an auth token. Try again.");

    return res.status(200).json({
      platform: "wynk",
      access_token:  token,
      refresh_token: data.refreshToken || null,
      expires_at:    Date.now() + (data.expiresIn || 86400) * 1000,
      user_id:       data.userId || data.uid || phone,
      display_name:  data.name || data.displayName || phone,
      phone,
      avatar:        data.profileImage || null,
    });
  } catch (err) {
    return apiError(res, err.status || 503, "network_error", err.message);
  }
}

// ── WYNK: Refresh session ─────────────────────────────────────────────────────
async function wynkRefresh(req, res) {
  const { refresh_token } = req.body || {};
  if (!refresh_token) return apiError(res, 400, "missing_param", "refresh_token required");

  const appKey = process.env.WYNK_APP_KEY;
  if (!appKey) return apiError(res, 500, "missing_config", "WYNK_APP_KEY not set");

  try {
    const r = await timedFetch(`${WYNK_BASE}/auth/refreshToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BSY-UTKN": appKey, "User-Agent": "WynkMusic/3.28.0.2 (Android)" },
      body: JSON.stringify({ refreshToken: refresh_token }),
    }, 10000);

    if (!r.ok) return apiError(res, 401, "refresh_failed", "Wynk session expired. Please reconnect.");
    const data = await r.json();
    return res.status(200).json({
      access_token:  data.token || data.accessToken,
      refresh_token: data.refreshToken || refresh_token,
      expires_at:    Date.now() + (data.expiresIn || 86400) * 1000,
    });
  } catch (err) {
    return apiError(res, 503, "network_error", err.message);
  }
}

// ── JIOSAAVN: Login ───────────────────────────────────────────────────────────
async function saavnLogin(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) return apiError(res, 400, "missing_param", "username and password required");

  try {
    const params = new URLSearchParams({ __call: "user.login", _format: "json", _marker: "0", username, password });
    const r = await timedFetch(`${SAAVN_BASE}?${params}`, { headers: SAAVN_HDR }, 12000);

    if (!r.ok) return apiError(res, r.status, "login_failed", `JioSaavn returned HTTP ${r.status}`);

    const data = await r.json();
    if (data.status === "failure" || data.error) {
      const msg = data.message || data.error || "Invalid credentials";
      return apiError(res, 401, "invalid_credentials", msg.toLowerCase().includes("password") || msg.toLowerCase().includes("credential") ? "Invalid username or password." : msg);
    }

    // Extract session cookie
    const setCookieHeader = r.headers.get("set-cookie") || "";
    const sessionCookie   = extractCookie(setCookieHeader, "CT_CC_s");
    const userCookie      = extractCookie(setCookieHeader, "CT_UC_s");
    if (!sessionCookie) return apiError(res, 502, "no_session", "JioSaavn did not return a session. Try again.");

    return res.status(200).json({
      platform:     "jiosaavn",
      access_token: `CT_CC_s=${sessionCookie}; CT_UC_s=${userCookie}`,
      refresh_token: null,
      expires_at:   Date.now() + 30 * 24 * 60 * 60 * 1000,
      user_id:      data.uid || data.userId || username,
      display_name: data.name || data.displayName || username,
      email:        data.email || null,
      avatar:       data.image || data.profilePic || null,
    });
  } catch (err) {
    return apiError(res, err.status || 503, "network_error", err.message);
  }
}

// ── JIOSAAVN: Refresh (validate cookie still works) ──────────────────────────
async function saavnRefresh(req, res) {
  const { access_token } = req.body || {};
  if (!access_token) return apiError(res, 400, "missing_param", "access_token required");
  try {
    const params = new URLSearchParams({ __call: "user.getPlaylists", _format: "json" });
    const r = await timedFetch(`${SAAVN_BASE}?${params}`, { headers: { ...SAAVN_HDR, Cookie: access_token } }, 8000);
    if (r.status === 401 || r.status === 403) return apiError(res, 401, "session_expired", "JioSaavn session expired. Please log in again.");
    return res.status(200).json({ access_token, expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 });
  } catch (err) {
    return apiError(res, 503, "network_error", err.message);
  }
}

function extractCookie(str, name) {
  const m = str.match(new RegExp(`${name}=([^;,\\s]+)`));
  return m ? m[1] : "";
}
