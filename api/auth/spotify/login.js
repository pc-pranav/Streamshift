// api/auth/spotify/login.js
import { setCors, apiError } from "../../_lib/utils.js";

const SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-library-read",
  "user-library-modify",
  "user-read-private",
  "user-read-email",
].join(" ");

export default function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) return apiError(res, 500, "missing_config", "SPOTIFY_CLIENT_ID not configured");

  const baseUrl = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173");
  const redirectUri = `${baseUrl}/api/auth/spotify/callback`;
  const role = req.query.role || "source"; // "source" | "dest"
  const state = `${role}:${Math.random().toString(36).slice(2)}`;

  res.setHeader("Set-Cookie", `spotify_state=${encodeURIComponent(state)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
    show_dialog: "true",
  });

  return res.redirect(302, `https://accounts.spotify.com/authorize?${params}`);
}
