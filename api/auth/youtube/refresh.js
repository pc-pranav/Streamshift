// api/auth/youtube/refresh.js
import { setCors, timedFetch, apiError } from "../../_lib/utils.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return apiError(res, 405, "method_not_allowed", "POST only");

  const { refresh_token } = req.body || {};
  if (!refresh_token) return apiError(res, 400, "missing_param", "refresh_token required");

  const clientId     = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return apiError(res, 500, "missing_config", "YouTube not configured");

  try {
    const r = await timedFetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token, client_id: clientId, client_secret: clientSecret }).toString(),
    }, 10000);

    if (r.status === 400) return apiError(res, 401, "refresh_token_revoked", "Session expired. Please reconnect YouTube.");
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      return apiError(res, r.status, "refresh_failed", b.error_description || `Refresh failed (${r.status})`);
    }
    const data = await r.json();
    return res.status(200).json({
      access_token: data.access_token,
      expires_in: data.expires_in,
      expires_at: Date.now() + data.expires_in * 1000,
      refresh_token: data.refresh_token || refresh_token,
    });
  } catch (err) {
    return apiError(res, err.status || 503, "network_error", err.message);
  }
}
