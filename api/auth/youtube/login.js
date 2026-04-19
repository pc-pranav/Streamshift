// api/auth/youtube/login.js
import { setCors, apiError } from "../../_lib/utils.js";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube",
].join(" ");

export default function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) return apiError(res, 500, "missing_config", "YOUTUBE_CLIENT_ID not configured");

  const baseUrl    = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173");
  const redirectUri = `${baseUrl}/api/auth/youtube/callback`;
  const role        = req.query.role || "source";
  const state       = `${role}:${Math.random().toString(36).slice(2)}`;

  res.setHeader("Set-Cookie", `youtube_state=${encodeURIComponent(state)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
