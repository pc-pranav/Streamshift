// api/auth/wynk/session.js
// Wynk Music (Airtel) — no public OAuth.
// Uses Wynk's internal API: phone number + OTP flow.
// This is a backend-assisted auth — credentials never leave the server.
//
// API base: https://api-staging.wynk.in  (used by official apps)
// All endpoints require X-BSY-UTKN header (Wynk app token, static per app version)
//
// IMPORTANT: Wynk has no public developer program.
// This integration uses reverse-engineered internal endpoints.
// It may break if Wynk updates their app. Use at your own risk.

import { setCors, timedFetch, apiError } from "../../_lib/utils.js";

const WYNK_BASE    = "https://api-staging.wynk.in/v1";
const WYNK_APP_KEY = process.env.WYNK_APP_KEY || ""; // static key from Wynk app
const WYNK_SECRET  = process.env.WYNK_SECRET  || ""; // HMAC secret from Wynk app

// ── Step 1: Request OTP ──────────────────────────────────────────────────────
// POST /api/auth/wynk/request-otp  { phone: "+919876543210" }
export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action } = req.query;

  switch (action) {
    case "request-otp": return requestOtp(req, res);
    case "verify-otp":  return verifyOtp(req, res);
    case "refresh":     return refreshSession(req, res);
    default:
      return apiError(res, 400, "invalid_action",
        "Use ?action=request-otp, ?action=verify-otp, or ?action=refresh");
  }
}

async function requestOtp(req, res) {
  if (req.method !== "POST") return apiError(res, 405, "method_not_allowed", "POST only");
  const { phone } = req.body || {};
  if (!phone) return apiError(res, 400, "missing_param", "phone required (e.g. +919876543210)");
  if (!WYNK_APP_KEY) return apiError(res, 500, "missing_config",
    "WYNK_APP_KEY not set. See README for Wynk setup instructions.");

  try {
    const r = await timedFetch(`${WYNK_BASE}/auth/requestOTP`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "X-BSY-UTKN":    WYNK_APP_KEY,
        "User-Agent":    "WynkMusic/3.28.0.2 (Android)",
        "X-BSY-APPID":   "com.bsy.wynk",
      },
      body: JSON.stringify({ msisdn: phone.replace(/^\+/, ""), countryCode: "91" }),
    }, 10000);

    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      return apiError(res, r.status, "otp_request_failed",
        b.message || b.error || `OTP request failed (${r.status})`);
    }

    const data = await r.json();
    return res.status(200).json({
      success: true,
      message: data.message || "OTP sent to your phone",
      txnId:   data.txnId   || data.transactionId || null,
    });
  } catch (err) {
    return apiError(res, err.status || 503, "network_error", err.message);
  }
}

async function verifyOtp(req, res) {
  if (req.method !== "POST") return apiError(res, 405, "method_not_allowed", "POST only");
  const { phone, otp, txnId } = req.body || {};
  if (!phone || !otp) return apiError(res, 400, "missing_param", "phone and otp required");
  if (!WYNK_APP_KEY) return apiError(res, 500, "missing_config", "WYNK_APP_KEY not set");

  try {
    const r = await timedFetch(`${WYNK_BASE}/auth/verifyOTP`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BSY-UTKN":   WYNK_APP_KEY,
        "User-Agent":   "WynkMusic/3.28.0.2 (Android)",
      },
      body: JSON.stringify({
        msisdn:      phone.replace(/^\+/, ""),
        otp,
        txnId:       txnId || "",
        countryCode: "91",
      }),
    }, 10000);

    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      if (r.status === 401 || b.code === "INVALID_OTP") {
        return apiError(res, 401, "invalid_otp", "Invalid OTP. Please try again.");
      }
      return apiError(res, r.status, "verify_failed", b.message || `Verification failed (${r.status})`);
    }

    const data = await r.json();
    const token  = data.token || data.accessToken || data.sessionToken;
    const userId = data.userId || data.uid || phone;

    if (!token) {
      return apiError(res, 502, "no_token", "Wynk did not return an auth token. Try again.");
    }

    return res.status(200).json({
      platform:      "wynk",
      access_token:  token,
      refresh_token: data.refreshToken || null,
      expires_at:    Date.now() + (data.expiresIn || 86400) * 1000,
      user_id:       userId,
      display_name:  data.name || data.displayName || phone,
      phone,
      avatar:        data.profileImage || null,
    });
  } catch (err) {
    return apiError(res, err.status || 503, "network_error", err.message);
  }
}

async function refreshSession(req, res) {
  if (req.method !== "POST") return apiError(res, 405, "method_not_allowed", "POST only");
  const { refresh_token } = req.body || {};
  if (!refresh_token) return apiError(res, 400, "missing_param", "refresh_token required");
  if (!WYNK_APP_KEY)  return apiError(res, 500, "missing_config", "WYNK_APP_KEY not set");

  try {
    const r = await timedFetch(`${WYNK_BASE}/auth/refreshToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BSY-UTKN": WYNK_APP_KEY },
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
