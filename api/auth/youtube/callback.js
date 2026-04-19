// api/auth/youtube/callback.js
import { timedFetch } from "../../_lib/utils.js";

function parseCookie(h, name) {
  if (!h) return null;
  const m = h.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;
  res.setHeader("Set-Cookie", "youtube_state=; HttpOnly; Path=/; Max-Age=0");

  if (error) {
    const msg = error === "access_denied" ? "You cancelled the YouTube Music login." : `Google returned: ${error}`;
    return res.redirect(302, `/?auth_error=${encodeURIComponent(msg)}&platform=youtube_music`);
  }
  if (!code) return res.redirect(302, `/?auth_error=${encodeURIComponent("No code from Google.")}&platform=youtube_music`);

  const cookieState = parseCookie(req.headers.cookie, "youtube_state");
  if (cookieState && state && cookieState !== state)
    return res.redirect(302, `/?auth_error=${encodeURIComponent("Security check failed. Try again.")}&platform=youtube_music`);

  const role        = (state || "source:").split(":")[0] === "dest" ? "dest" : "source";
  const clientId    = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const baseUrl     = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173");
  const redirectUri = `${baseUrl}/api/auth/youtube/callback`;

  if (!clientId || !clientSecret)
    return res.redirect(302, `/?auth_error=${encodeURIComponent("YouTube not configured on server.")}&platform=youtube_music`);

  try {
    const tokenRes = await timedFetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }).toString(),
    }, 12000);

    if (!tokenRes.ok) {
      const b = await tokenRes.json().catch(() => ({}));
      return res.redirect(302, `/?auth_error=${encodeURIComponent(b.error_description || "Token exchange failed.")}&platform=youtube_music`);
    }
    const tokens = await tokenRes.json();

    // Get Google user info
    const profileRes = await timedFetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }, 8000);
    let profile = { sub: "unknown", name: "YouTube User", picture: null };
    if (profileRes.ok) profile = await profileRes.json();

    const payload = encodeURIComponent(JSON.stringify({
      platform: "youtube_music",
      role,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_in: tokens.expires_in,
      expires_at: Date.now() + tokens.expires_in * 1000,
      user_id: profile.sub,
      display_name: profile.name || "YouTube User",
      email: profile.email || null,
      avatar: profile.picture || null,
    }));

    return res.redirect(302, `/?youtube_auth=${payload}`);
  } catch (err) {
    return res.redirect(302, `/?auth_error=${encodeURIComponent(`YouTube auth failed: ${err.message}`)}&platform=youtube_music`);
  }
}
