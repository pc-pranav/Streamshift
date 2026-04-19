// api/auth/amazon/login.js
// Login with Amazon (LWA) — OAuth 2.0 for Amazon Music
// Supports both amazon.com (global) and amazon.in (India) regions
import { setCors, apiError } from "../../_lib/utils.js";

export default function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const clientId = process.env.AMAZON_CLIENT_ID;
  if (!clientId) {
    return apiError(res, 500, "missing_config",
      "AMAZON_CLIENT_ID not set. Create an app at developer.amazon.com/apps-and-games.");
  }

  const baseUrl     = process.env.APP_URL || `https://${process.env.VERCEL_URL}`;
  const redirectUri = `${baseUrl}/api/auth/amazon/callback`;
  const role        = req.query.role || "source";
  // Use Indian endpoint if region=in query param
  const region      = req.query.region === "in" ? "in" : "com";
  const state       = `${role}:${region}:${Math.random().toString(36).slice(2)}`;

  res.setHeader("Set-Cookie",
    `amazon_state=${encodeURIComponent(state)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);

  // Amazon uses different auth endpoints per region
  const authHost = region === "in"
    ? "www.amazon.in"
    : "www.amazon.com";

  const scopes = [
    "profile",
    "postal_code",
  ].join(" ");

  const params = new URLSearchParams({
    client_id:     clientId,
    scope:         scopes,
    response_type: "code",
    redirect_uri:  redirectUri,
    state,
  });

  return res.redirect(302, `https://${authHost}/ap/oa?${params}`);
}
