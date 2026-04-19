// api/auth/spotify/callback.js
import { timedFetch, apiError } from "../../_lib/utils.js";

function parseCookie(header, name) {
  if (!header) return null;
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;
  const cookieState = parseCookie(req.headers.cookie, "spotify_state");

  // Clear state cookie immediately
  res.setHeader("Set-Cookie", "spotify_state=; HttpOnly; Path=/; Max-Age=0");

  // ── Error cases ───────────────────────────────────────────────────────────
  if (error) {
    const msg = error === "access_denied"
      ? "You cancelled the Spotify login. Please try again."
      : `Spotify returned an error: ${error}`;
    return res.redirect(302, `/?auth_error=${encodeURIComponent(msg)}&platform=spotify`);
  }

  if (!code) {
    return res.redirect(302, `/?auth_error=${encodeURIComponent("No authorization code received from Spotify.")}&platform=spotify`);
  }

  // ── CSRF state validation ─────────────────────────────────────────────────
  if (cookieState && state && cookieState !== state) {
    return res.redirect(302, `/?auth_error=${encodeURIComponent("Security check failed (state mismatch). Please try again.")}&platform=spotify`);
  }

  // Parse role from state (format: "source:randomstring" or "dest:randomstring")
  const role = (state || "source:").split(":")[0] === "dest" ? "dest" : "source";

  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const baseUrl      = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173");
  const redirectUri  = `${baseUrl}/api/auth/spotify/callback`;

  if (!clientId || !clientSecret) {
    return res.redirect(302, `/?auth_error=${encodeURIComponent("Server misconfiguration: Spotify credentials not set.")}&platform=spotify`);
  }

  try {
    // ── Exchange code for tokens ──────────────────────────────────────────
    const tokenRes = await timedFetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }).toString(),
    }, 12000);

    if (!tokenRes.ok) {
      const body = await tokenRes.json().catch(() => ({}));
      const msg = body.error_description || body.error || `Token exchange failed (HTTP ${tokenRes.status})`;
      return res.redirect(302, `/?auth_error=${encodeURIComponent(msg)}&platform=spotify`);
    }

    const tokens = await tokenRes.json();

    // ── Fetch user profile ────────────────────────────────────────────────
    const profileRes = await timedFetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }, 8000);

    let profile = { id: "unknown", display_name: "Spotify User", images: [] };
    if (profileRes.ok) profile = await profileRes.json();

    // ── Fetch liked-songs count for the badge ─────────────────────────────
    let likedCount = null;
    const likedRes = await timedFetch("https://api.spotify.com/v1/me/tracks?limit=1", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }, 6000).catch(() => null);
    if (likedRes?.ok) {
      const d = await likedRes.json();
      likedCount = d.total ?? null;
    }

    const payload = encodeURIComponent(JSON.stringify({
      platform: "spotify",
      role,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_in: tokens.expires_in,
      expires_at: Date.now() + tokens.expires_in * 1000,
      user_id: profile.id,
      display_name: profile.display_name || profile.id,
      email: profile.email || null,
      avatar: profile.images?.[0]?.url || null,
      product: profile.product || "free", // "premium" | "free"
      likedCount,
    }));

    return res.redirect(302, `/?spotify_auth=${payload}`);
  } catch (err) {
    console.error("[spotify/callback]", err);
    return res.redirect(302, `/?auth_error=${encodeURIComponent(`Authentication failed: ${err.message}`)}&platform=spotify`);
  }
}
