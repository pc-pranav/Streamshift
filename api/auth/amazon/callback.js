// api/auth/amazon/callback.js
import { timedFetch } from "../../_lib/utils.js";

function parseCookie(h, name) {
  if (!h) return null;
  const m = h.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;
  res.setHeader("Set-Cookie", "amazon_state=; HttpOnly; Path=/; Max-Age=0");

  if (error) {
    const msg = error === "access_denied"
      ? "You cancelled the Amazon Music login."
      : `Amazon returned an error: ${error}`;
    return res.redirect(302, `/?auth_error=${encodeURIComponent(msg)}&platform=amazon_music`);
  }
  if (!code) {
    return res.redirect(302,
      `/?auth_error=${encodeURIComponent("No authorization code from Amazon.")}&platform=amazon_music`);
  }

  const cookieState = parseCookie(req.headers.cookie, "amazon_state");
  if (cookieState && state && cookieState !== state) {
    return res.redirect(302,
      `/?auth_error=${encodeURIComponent("Security check failed. Please try again.")}&platform=amazon_music`);
  }

  const parts     = (state || "source:com:").split(":");
  const role      = parts[0] === "dest" ? "dest" : "source";
  const region    = parts[1] === "in" ? "in" : "com";

  const clientId     = process.env.AMAZON_CLIENT_ID;
  const clientSecret = process.env.AMAZON_CLIENT_SECRET;
  const baseUrl      = process.env.APP_URL || `https://${process.env.VERCEL_URL}`;
  const redirectUri  = `${baseUrl}/api/auth/amazon/callback`;

  if (!clientId || !clientSecret) {
    return res.redirect(302,
      `/?auth_error=${encodeURIComponent("Amazon Music not configured on server.")}&platform=amazon_music`);
  }

  try {
    // Exchange code for tokens via Amazon Token endpoint
    const tokenHost = region === "in" ? "api.amazon.in" : "api.amazon.com";
    const tokenRes  = await timedFetch(`https://${tokenHost}/auth/o2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "authorization_code",
        code,
        redirect_uri:  redirectUri,
        client_id:     clientId,
        client_secret: clientSecret,
      }).toString(),
    }, 12000);

    if (!tokenRes.ok) {
      const b = await tokenRes.json().catch(() => ({}));
      const msg = b.error_description || b.error || `Token exchange failed (${tokenRes.status})`;
      return res.redirect(302, `/?auth_error=${encodeURIComponent(msg)}&platform=amazon_music`);
    }

    const tokens = await tokenRes.json();

    // Get Amazon profile
    const profileRes = await timedFetch("https://api.amazon.com/user/profile", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }, 8000);
    let profile = { user_id: "unknown", name: "Amazon User", email: null };
    if (profileRes.ok) profile = await profileRes.json();

    const payload = encodeURIComponent(JSON.stringify({
      platform:      "amazon_music",
      role,
      region,
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_in:    tokens.expires_in,
      expires_at:    Date.now() + tokens.expires_in * 1000,
      user_id:       profile.user_id,
      display_name:  profile.name || "Amazon User",
      email:         profile.email || null,
      avatar:        null,
    }));

    return res.redirect(302, `/?amazon_auth=${payload}`);
  } catch (err) {
    return res.redirect(302,
      `/?auth_error=${encodeURIComponent(`Amazon auth failed: ${err.message}`)}&platform=amazon_music`);
  }
}
