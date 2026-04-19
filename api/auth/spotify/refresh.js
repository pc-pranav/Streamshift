// api/auth/spotify/refresh.js
import { setCors, timedFetch, apiError } from "../../_lib/utils.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return apiError(res, 405, "method_not_allowed", "POST only");

  const { refresh_token } = req.body || {};
  if (!refresh_token) return apiError(res, 400, "missing_param", "refresh_token required");

  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return apiError(res, 500, "missing_config", "Spotify not configured");

  try {
    const r = await timedFetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token }).toString(),
    }, 10000);

    if (r.status === 400) {
      // Refresh token revoked — user disconnected app from Spotify settings
      return apiError(res, 401, "refresh_token_revoked", "Session expired. Please reconnect your Spotify account.");
    }
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
