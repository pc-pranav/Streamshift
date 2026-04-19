// api/auth/apple/token.js
// Returns a short-lived developer JWT for MusicKit JS (client-side Apple Music auth)
// Apple Music uses a hybrid: developer JWT (server-generated) + user token (client-side MusicKit JS)
import { setCors, apiError } from "../../_lib/utils.js";

export default function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const teamId  = process.env.APPLE_TEAM_ID;
  const keyId   = process.env.APPLE_KEY_ID;
  const keyB64  = process.env.APPLE_PRIVATE_KEY_B64; // base64 encoded .p8 file

  if (!teamId || !keyId || !keyB64) {
    return apiError(res, 500, "missing_config",
      "Apple Music not configured. Set APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY_B64.");
  }

  try {
    // Build JWT manually without jsonwebtoken (no npm install needed on Vercel Edge)
    const header  = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId })).toString("base64url");
    const now     = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({
      iss: teamId,
      iat: now,
      exp: now + 15777000, // ~6 months
    })).toString("base64url");

    // Note: full ES256 signing requires crypto.subtle or a library.
    // In practice, pre-generate the developer token and store as env var.
    const devToken = process.env.APPLE_DEVELOPER_TOKEN;
    if (!devToken) {
      return apiError(res, 500, "missing_config",
        "Set APPLE_DEVELOPER_TOKEN (pre-generated MusicKit JWT) in environment variables.");
    }

    return res.status(200).json({ developerToken: devToken });
  } catch (err) {
    return apiError(res, 500, "token_error", err.message);
  }
}
