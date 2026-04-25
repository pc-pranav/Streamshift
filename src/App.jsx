import { useState, useEffect, useRef, useCallback } from "react";

// ─── PLATFORM REGISTRY ────────────────────────────────────────────────────────
const P = {
  spotify: {
    name: "Spotify", color: "#1DB954",
    authPath:    "/api/auth?platform=spotify&action=login&role=source",
    refreshPath: "/api/auth?platform=spotify&action=refresh",
    authParam:   "spotify_auth",
    authType:    "oauth",
    icon: <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>,
  },
  youtube_music: {
    name: "YouTube Music", color: "#FF0000",
    authPath:    "/api/auth?platform=youtube_music&action=login&role=source",
    refreshPath: "/api/auth?platform=youtube_music&action=refresh",
    authParam:   "youtube_auth",
    authType:    "oauth",
    note: "Signs in via Google",
    icon: <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M23.495 6.205a3.007 3.007 0 0 0-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 0 0 .527 6.205a31.247 31.247 0 0 0-.522 5.805 31.247 31.247 0 0 0 .522 5.783 3.007 3.007 0 0 0 2.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 0 0 2.088-2.088 31.247 31.247 0 0 0 .5-5.783 31.247 31.247 0 0 0-.5-5.805zM9.609 15.601V8.408l6.264 3.602z"/></svg>,
  },
  apple_music: {
    name: "Apple Music", color: "#FC3C44",
    authPath:    null,
    refreshPath: null,
    authParam:   "apple_auth",
    authType:    "oauth",
    note: "Requires Apple Developer account",
    icon: <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>,
  },
  amazon_music: {
    name: "Amazon Music", color: "#00A8E1",
    authPath:    "/api/auth?platform=amazon_music&action=login",
    refreshPath: "/api/auth?platform=amazon_music&action=refresh",
    authParam:   "amazon_auth",
    authType:    "oauth",
    note: "Works for amazon.in too",
    icon: <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M.045 18.02c.072-.116.187-.124.348-.022 3.636 2.11 7.594 3.166 11.87 3.166 2.852 0 5.668-.533 8.447-1.595l.315-.14c.138-.06.234-.1.293-.13.226-.088.39-.046.525.13.12.174.09.336-.12.48-.256.19-.6.41-1.006.654-1.244.743-2.64 1.316-4.185 1.726a17.74 17.74 0 0 1-5.05.736 19.36 19.36 0 0 1-5.78-.87 21.24 21.24 0 0 1-5.04-2.405c-.198-.133-.23-.28-.12-.483zm6.565-6.218c0-1.005.247-1.863.743-2.575.495-.71 1.17-1.25 2.025-1.615.013-.01.03-.015.045-.02a8.65 8.65 0 0 1 2.974-.578l.312-.013v-.311c0-.912-.048-1.497-.15-1.758-.15-.386-.455-.58-.92-.58-.435 0-.74.207-.914.62-.138.33-.218.795-.243 1.39l-3.322-.338C7.38 4.96 7.738 3.96 8.43 3.26c.692-.698 1.7-1.048 3.024-1.048 1.67 0 2.802.515 3.397 1.546.3.523.452 1.332.452 2.428v4.968l.002.268c.01.37.04.658.087.866.048.208.125.364.232.468h-3.307a3.173 3.173 0 0 1-.227-.807 5.917 5.917 0 0 1-.047-.65c-.398.535-.827.924-1.287 1.17-.46.245-.97.367-1.53.367-.868 0-1.564-.278-2.086-.834-.523-.557-.784-1.264-.784-2.12zm3.816-.04c0 .437.097.782.29 1.035.193.253.45.38.773.38.34 0 .65-.152.928-.455.28-.303.42-.67.42-1.098V9.2l-.283.007c-.64.016-1.109.152-1.405.41-.297.258-.446.68-.446 1.265c0 .025-.002.053-.004.08l.004-.02z"/></svg>,
  },
  wynk: {
    name: "Wynk Music", color: "#E1175E",
    authPath:    null,
    refreshPath: "/api/auth?platform=wynk&action=refresh",
    authParam:   "wynk_auth",
    authType:    "otp",
    note: "Airtel · India · OTP login",
    icon: <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>,
  },
  jiosaavn: {
    name: "JioSaavn", color: "#2BC5B4",
    authPath:    null,
    refreshPath: "/api/auth?platform=jiosaavn&action=refresh",
    authParam:   "jiosaavn_auth",
    authType:    "password",
    note: "Jio · India · Email/phone login",
    icon: <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>,
  },
};

const STEP_LABELS = ["Source", "Destination", "Playlists", "Preview", "Transfer"];

// ─── AUTH STORE (localStorage, persists across OAuth redirects + page reloads) ───────────────────
const Auth = {
  _k: k => `ss_${k}`,
  save(k, v)  { try { localStorage.setItem(Auth._k(k), JSON.stringify(v)); } catch {} },
  load(k)     { try { const r = localStorage.getItem(Auth._k(k)); return r ? JSON.parse(r) : null; } catch { return null; } },
  clear(k)    { try { localStorage.removeItem(Auth._k(k)); } catch {} },
  clearAll()  { ["spotify","youtube_music","apple_music","amazon_music","wynk","jiosaavn","_src_snap"].forEach(k => Auth.clear(k)); },

  // Returns a valid access token, refreshing automatically if near expiry
  async token(platform) {
    const a = Auth.load(platform);
    if (!a?.access_token) return null;
    const nearExpiry = a.expires_at && Date.now() > a.expires_at - 4 * 60 * 1000;
    if (!nearExpiry) return a.access_token;
    if (!a.refresh_token) { Auth.clear(platform); return null; }
    const path = P[platform]?.refreshPath;
    if (!path) return a.access_token; // Apple Music — no server refresh
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: a.refresh_token }),
      });
      if (!res.ok) {
        if (res.status === 401) Auth.clear(platform); // revoked
        return null;
      }
      const fresh = await res.json();
      Auth.save(platform, { ...a, ...fresh });
      return fresh.access_token;
    } catch { return null; }
  },
};

// ─── API HELPER — returns parsed JSON, throws structured error ───────────────
async function api(url, opts = {}) {
  let res;
  try { res = await fetch(url, opts); }
  catch (e) {
    const err = new Error("Network error. Check your connection.");
    err.code = "network"; throw err;
  }
  let body = {};
  try { body = await res.json(); } catch {}
  if (res.ok) return body;
  const err = new Error(body.message || body.error || `HTTP ${res.status}`);
  err.status = res.status;
  err.code = body.error || String(res.status);
  err.retryAfter = body.retryAfter || null;
  throw err;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── SHARED UI COMPONENTS ─────────────────────────────────────────────────────
function Spin({ s = 16, c = "#fff" }) {
  return (
    <div style={{
      width: s, height: s, flexShrink: 0, borderRadius: "50%",
      border: `2px solid ${c}22`, borderTopColor: c,
      animation: "spin .7s linear infinite",
    }} />
  );
}

function Ring({ pct, size = 128, color = "#a78bfa", children }) {
  const r = size / 2 - 10;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="8"
          strokeLinecap="round" strokeDasharray={circ}
          strokeDashoffset={circ * (1 - Math.min(Math.max(pct, 0), 100) / 100)}
          style={{ transition: "stroke-dashoffset .5s ease, stroke .4s" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        {children}
      </div>
    </div>
  );
}

function Tag({ label, v = "n" }) {
  const m = {
    g: ["#22c55e14","#22c55e","#22c55e30"],
    i: ["#a78bfa14","#a78bfa","#a78bfa30"],
    w: ["#f59e0b14","#f59e0b","#f59e0b30"],
    r: ["#ef444414","#ef4444","#ef444430"],
    n: ["rgba(255,255,255,0.05)","rgba(255,255,255,0.4)","rgba(255,255,255,0.1)"],
  };
  const [bg, fg, border] = m[v] || m.n;
  return (
    <span style={{
      background: bg, color: fg, border: `1px solid ${border}`,
      borderRadius: 99, padding: "2px 8px", fontSize: 10, fontWeight: 700,
      letterSpacing: ".05em", fontFamily: "'DM Mono',monospace", flexShrink: 0,
    }}>{label}</span>
  );
}

function Alert({ title, msg, type = "r", onRetry, onDismiss }) {
  const cm = {
    r: ["#ef4444","#f87171","#ef444410"],
    w: ["#f59e0b","#fbbf24","#f59e0b10"],
    i: ["#a78bfa","#c4b5fd","#a78bfa10"],
  };
  const [border, text, bg] = cm[type] || cm.r;
  const icon = type === "i" ? "ℹ" : type === "w" ? "⚡" : "⚠";
  return (
    <div style={{ background: bg, border: `1px solid ${border}25`, borderRadius: 11, padding: "11px 13px", marginBottom: 14, display: "flex", gap: 9, alignItems: "flex-start" }}>
      <span style={{ color: border, fontSize: 14, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <div style={{ color: text, fontWeight: 700, fontSize: 12.5, fontFamily: "'DM Sans',sans-serif", marginBottom: 2 }}>{title}</div>}
        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, fontFamily: "'DM Sans',sans-serif", lineHeight: 1.5, wordBreak: "break-word" }}>{msg}</div>
      </div>
      <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
        {onRetry   && <button onClick={onRetry}   style={{ background: `${border}20`, border: `1px solid ${border}35`, borderRadius: 6, color: border, cursor: "pointer", padding: "3px 9px", fontSize: 11, fontWeight: 700, fontFamily: "'DM Sans',sans-serif" }}>Retry</button>}
        {onDismiss && <button onClick={onDismiss} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "rgba(255,255,255,0.3)", cursor: "pointer", padding: "3px 7px", fontSize: 11, fontFamily: "'DM Sans',sans-serif" }}>✕</button>}
      </div>
    </div>
  );
}

function Btn({ children, onClick, disabled, loading, variant = "p" }) {
  const bgs = {
    p: disabled ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg,#a78bfa,#7c3aed)",
    s: "linear-gradient(135deg,#22c55e,#16a34a)",
    g: "rgba(255,255,255,0.07)",
  };
  return (
    <button onClick={onClick} disabled={disabled || loading} style={{
      width: "100%", padding: "13px", borderRadius: 11, border: "none",
      cursor: disabled || loading ? "not-allowed" : "pointer",
      background: bgs[variant] || bgs.p,
      color: disabled ? "rgba(255,255,255,0.2)" : "#fff",
      fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 14,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
      opacity: loading ? 0.75 : 1, transition: "opacity .2s",
    }}>
      {loading && <Spin />}{children}
    </button>
  );
}

function StepBar({ cur }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
      {STEP_LABELS.map((lbl, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", flex: i < STEP_LABELS.length - 1 ? 1 : "none" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{
              width: 27, height: 27, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              background: i < cur ? "#a78bfa" : i === cur ? "rgba(167,139,250,0.14)" : "rgba(255,255,255,0.04)",
              border: `1.5px solid ${i < cur ? "#a78bfa" : i === cur ? "#a78bfa70" : "rgba(255,255,255,0.09)"}`,
              color: i < cur ? "#fff" : i === cur ? "#a78bfa" : "rgba(255,255,255,0.22)",
              fontSize: 10, fontWeight: 700, fontFamily: "'DM Mono',monospace", transition: "all .3s",
            }}>
              {i < cur ? "✓" : i + 1}
            </div>
            <div style={{ fontSize: 9, color: i === cur ? "#a78bfa" : "rgba(255,255,255,0.22)", fontFamily: "'DM Sans',sans-serif", whiteSpace: "nowrap", fontWeight: i === cur ? 700 : 400 }}>
              {lbl}
            </div>
          </div>
          {i < STEP_LABELS.length - 1 && (
            <div style={{ flex: 1, height: 1.5, background: i < cur ? "#a78bfa55" : "rgba(255,255,255,0.07)", margin: "0 3px", marginBottom: 15, transition: "background .4s" }} />
          )}
        </div>
      ))}
    </div>
  );
}

function SHdr({ n, sub, title, desc }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: ".1em", marginBottom: 5 }}>STEP {n} / {sub}</div>
      <h2 style={{ fontFamily: "'Instrument Serif',serif", fontSize: 22, fontWeight: 400, color: "#fff", lineHeight: 1.2, margin: 0 }}>{title}</h2>
      {desc && <p style={{ color: "rgba(255,255,255,0.35)", marginTop: 5, fontFamily: "'DM Sans',sans-serif", fontSize: 12.5 }}>{desc}</p>}
    </div>
  );
}

function PlatCard({ pk, selected, onSelect, subtitle }) {
  const pl = P[pk];
  return (
    <button onClick={onSelect} style={{
      background: selected ? `${pl.color}12` : "rgba(255,255,255,0.02)",
      border: `1.5px solid ${selected ? pl.color : "rgba(255,255,255,0.07)"}`,
      borderRadius: 12, padding: "12px 14px", cursor: "pointer",
      textAlign: "left", width: "100%", position: "relative", overflow: "hidden", transition: "all .18s",
    }}>
      {selected && <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 80% 0%,${pl.color}15,transparent 60%)`, pointerEvents: "none" }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{ color: pl.color, flexShrink: 0 }}>{pl.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "#fff", fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 13 }}>{pl.name}</div>
          <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 10.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {subtitle || pl.note || "OAuth 2.0"}
          </div>
        </div>
        {selected && (
          <div style={{ width: 17, height: 17, borderRadius: "50%", background: pl.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>✓</div>
        )}
      </div>
    </button>
  );
}

// ─── CREDENTIAL MODAL (Wynk OTP + JioSaavn password) ─────────────────────────
function CredModal({ platform, role, onSuccess, onClose }) {
  const pl = P[platform];
  const isWynk   = platform === "wynk";
  const isSaavn  = platform === "jiosaavn";
  const [phase, setPhase]   = useState(isWynk ? "phone" : "login"); // phone|otp|login
  const [phone,  setPhone]  = useState("");
  const [otp,    setOtp]    = useState("");
  const [txnId,  setTxnId]  = useState("");
  const [user,   setUser]   = useState("");
  const [pass,   setPass]   = useState("");
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState(null);

  const inp = (label, value, onChange, type="text", placeholder="") => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontFamily: "'DM Mono',monospace", marginBottom: 5, letterSpacing: ".06em" }}>{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)} type={type} placeholder={placeholder}
        style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "9px 12px", color: "#fff", fontFamily: "'DM Sans',sans-serif", fontSize: 13, outline: "none" }} />
    </div>
  );

  const requestOtp = async () => {
    setBusy(true); setErr(null);
    try {
      const d = await api("/api/auth?platform=wynk&action=request-otp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      setTxnId(d.txnId || ""); setPhase("otp");
    } catch(e) { setErr(e.message); }
    setBusy(false);
  };

  const verifyOtp = async () => {
    setBusy(true); setErr(null);
    try {
      const d = await api("/api/auth?platform=wynk&action=verify-otp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp, txnId }),
      });
      Auth.save("wynk", { ...d, role });
      onSuccess({ ...d, role, platform: "wynk" });
    } catch(e) { setErr(e.message); }
    setBusy(false);
  };

  const loginSaavn = async () => {
    setBusy(true); setErr(null);
    try {
      const d = await api("/api/auth?platform=jiosaavn&action=login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pass }),
      });
      Auth.save("jiosaavn", { ...d, role });
      onSuccess({ ...d, role, platform: "jiosaavn" });
    } catch(e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 20, backdropFilter: "blur(12px)" }}>
      <div style={{ background: "#121220", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 18, padding: 24, maxWidth: 360, width: "100%", boxShadow: "0 40px 100px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div style={{ color: pl.color }}>{pl.icon}</div>
          <div style={{ fontFamily: "'Instrument Serif',serif", fontSize: 19, color: "#fff" }}>
            Connect {pl.name}
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        {err && <Alert msg={err} type="r" onDismiss={() => setErr(null)} />}

        {/* Wynk: Phone entry */}
        {isWynk && phase === "phone" && (
          <>
            <Alert type="i" msg="Wynk uses phone + OTP login. Your number is sent directly to Wynk's servers — never stored by StreamShift." />
            {inp("PHONE NUMBER", phone, setPhone, "tel", "+91 9876543210")}
            <Btn onClick={requestOtp} loading={busy} disabled={phone.length < 8}>Send OTP →</Btn>
          </>
        )}

        {/* Wynk: OTP entry */}
        {isWynk && phase === "otp" && (
          <>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, fontFamily: "'DM Sans',sans-serif", marginBottom: 14 }}>OTP sent to {phone}</div>
            {inp("ENTER OTP", otp, setOtp, "text", "6-digit code")}
            <Btn onClick={verifyOtp} loading={busy} disabled={otp.length < 4}>Verify & Connect →</Btn>
            <button onClick={() => { setPhase("phone"); setOtp(""); setErr(null); }} style={{ width: "100%", marginTop: 8, background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontSize: 12, padding: "6px 0" }}>← Change number</button>
          </>
        )}

        {/* JioSaavn: username + password */}
        {isSaavn && (
          <>
            <Alert type="i" msg="Your credentials are used only to create a session with JioSaavn's servers. StreamShift stores only the session cookie, not your password." />
            {inp("EMAIL OR PHONE", user, setUser, "text", "you@email.com")}
            {inp("PASSWORD", pass, setPass, "password", "••••••••")}
            <Btn onClick={loginSaavn} loading={busy} disabled={!user || !pass}>Sign In & Connect →</Btn>
          </>
        )}
      </div>
    </div>
  );
}

// ─── STEP 0: CONNECT SOURCE ───────────────────────────────────────────────────
function StepSource({ existingSrcAuth, onNext }) {
  const [sel, setSel]       = useState(existingSrcAuth?.platform || null);
  const [busy, setBusy]     = useState(false);
  const [modal, setModal]   = useState(false);

  const connect = () => {
    if (!sel) return;
    const plat = P[sel];
    if (plat.authType === "otp" || plat.authType === "password") {
      setModal(true); return;
    }
    if (!plat.authPath) return;
    setBusy(true);
    localStorage.setItem("ss_pending_role", "source");
    window.location.href = `${plat.authPath}?role=source`;
  };

  const handleCredSuccess = (authData) => {
    setModal(false);
    Auth.save(sel, { ...authData, role: "source" });
    onNext(sel, authData);
  };

  return (
    <div>
      <SHdr n="01" sub="SOURCE" title="Where is your music?" desc="Connect the account you want to transfer from" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 22 }}>
        {Object.keys(P).map(pk => (
          <PlatCard key={pk} pk={pk} selected={sel === pk} onSelect={() => setSel(pk)}
            subtitle={existingSrcAuth?.platform === pk ? `✓ ${existingSrcAuth.display_name}` : P[pk].note || "OAuth 2.0"} />
        ))}
      </div>
      {sel === "apple_music" && <Alert type="i" msg="Apple Music requires APPLE_DEVELOPER_TOKEN set in Vercel env vars. See README." />}
      {sel === "youtube_music" && <Alert type="i" msg="YouTube Music uses your Google account. YouTube Data API v3 must be enabled in Google Cloud Console." />}
      {sel === "wynk" && <Alert type="i" msg="Wynk uses phone + OTP. No password needed." />}
      {sel === "jiosaavn" && <Alert type="i" msg="JioSaavn uses email/phone + password to create a session." />}
      {sel === "amazon_music" && <Alert type="i" msg="Amazon Music uses Login with Amazon (LWA) OAuth. Works for both amazon.com and amazon.in accounts." />}
      <Btn onClick={connect} disabled={!sel} loading={busy}>
        {busy ? "Redirecting…" : sel ? `Connect ${P[sel]?.name} →` : "Select a platform"}
      </Btn>
      {modal && <CredModal platform={sel} role="source" onSuccess={handleCredSuccess} onClose={() => setModal(false)} />}
    </div>
  );
}

// ─── STEP 1: CONNECT DESTINATION ─────────────────────────────────────────────
function StepDest({ srcPlatform, srcAuth, existingDstAuth, onNext }) {
  const [sel, setSel]     = useState(existingDstAuth?.platform || null);
  const [busy, setBusy]   = useState(false);
  const [modal, setModal] = useState(false);
  const sp = P[srcPlatform];

  const connect = () => {
    if (!sel) return;
    const plat = P[sel];
    if (plat.authType === "otp" || plat.authType === "password") {
      setModal(true); return;
    }
    if (!plat.authPath) return;
    setBusy(true);
    Auth.save("_src_snap", srcAuth);
    localStorage.setItem("ss_pending_role", "dest");
    window.location.href = `${plat.authPath}?role=dest`;
  };

  const handleCredSuccess = (authData) => {
    setModal(false);
    Auth.save(sel, { ...authData, role: "dest" });
    onNext(authData);
  };

  return (
    <div>
      <SHdr n="02" sub="DESTINATION" title="Where should it go?" desc="Connect the account you're transferring to" />

      {/* Source badge */}
      <div style={{ background: `${sp.color}0d`, border: `1px solid ${sp.color}22`, borderRadius: 9, padding: "9px 12px", marginBottom: 14, display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{ color: sp.color, flexShrink: 0 }}>{sp.icon}</div>
        <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12.5, color: "rgba(255,255,255,0.5)" }}>
          Source: <span style={{ color: sp.color, fontWeight: 700 }}>{srcAuth?.display_name || sp.name}</span>
        </span>
        <div style={{ marginLeft: "auto" }}><Tag label="LIVE" v="g" /></div>
      </div>

      {sel === srcPlatform && (
        <Alert type="w" msg={`Same platform selected for both. You'll need to sign in with a different ${sp.name} account.`} />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 22 }}>
        {Object.keys(P).map(pk => (
          <PlatCard key={pk} pk={pk} selected={sel === pk} onSelect={() => setSel(pk)}
            subtitle={existingDstAuth?.platform === pk ? `✓ ${existingDstAuth.display_name}` : P[pk].note || "OAuth 2.0"} />
        ))}
      </div>

      <Btn onClick={connect} disabled={!sel} loading={busy}>
        {busy ? "Redirecting…" : sel ? `Connect ${P[sel]?.name} as destination →` : "Select destination"}
      </Btn>

      {modal && sel && (
        <CredModal platform={sel} role="dest" onSuccess={handleCredSuccess} onClose={() => setModal(false)} />
      )}
    </div>
  );
}

// ─── STEP 2: SELECT PLAYLISTS ─────────────────────────────────────────────────
function StepPlaylists({ srcPlatform, srcAuth, onNext }) {
  const [lists, setLists] = useState([]);
  const [pageTotal, setPageTotal] = useState(null);
  const [nextToken, setNextToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState(new Set(["__liked__"]));
  const [q, setQ] = useState("");
  const [retry, setRetry] = useState(0);

  const load = useCallback(async (offset = 0, append = false) => {
    append ? setLoadingMore(true) : setLoading(true);
    setErr(null);
    try {
      const token = await Auth.token(srcPlatform);
      if (!token) throw Object.assign(new Error("Session expired. Please go back and reconnect."), { code: "token_expired" });

      const params = new URLSearchParams({ platform: srcPlatform, limit: "50", offset: String(offset) });
      if (nextToken && offset > 0) params.set("pageToken", nextToken);

      const data = await api(`/api/playlists?${params}`, { headers: { Authorization: `Bearer ${token}` } });

      setLists(prev => append ? [...prev, ...(data.playlists || [])] : (data.playlists || []));
      setPageTotal(data.pagination?.total ?? null);
      setNextToken(data.pagination?.nextPageToken || null);
    } catch (e) {
      setErr({ msg: e.message, code: e.code, fatal: e.code === "token_expired" || e.code === "forbidden" });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [srcPlatform, nextToken]);

  useEffect(() => { load(0); }, [retry]);

  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const filtered = lists.filter(pl => !q || pl.name.toLowerCase().includes(q.toLowerCase()));
  const selTracks = [...sel].reduce((a, id) => {
    if (id === "__liked__") return a + (srcAuth?.likedCount || 0);
    return a + (lists.find(p => p.id === id)?.trackCount || 0);
  }, 0);
  const hasMore = nextToken || (pageTotal !== null && lists.length < pageTotal);

  return (
    <div>
      <SHdr n="03" sub="PLAYLISTS" title="Your playlists"
        desc={pageTotal !== null ? `${pageTotal} playlists on your ${P[srcPlatform]?.name} account` : "Loading…"} />

      {err && (
        <Alert
          title={err.code === "token_expired" ? "Session expired" : "Failed to load playlists"}
          msg={err.msg}
          type={err.fatal ? "r" : "w"}
          onRetry={!err.fatal ? () => setRetry(c => c + 1) : undefined}
          onDismiss={() => setErr(null)}
        />
      )}

      {/* Liked Songs — always visible */}
      <div style={{ marginBottom: 8 }}>
        <PLRow
          pl={{ id: "__liked__", name: "Liked Songs", trackCount: srcAuth?.likedCount ?? "–", isPublic: false, isLiked: true }}
          selected={sel.has("__liked__")} onToggle={() => toggle("__liked__")}
        />
      </div>

      {lists.length > 7 && (
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search playlists…"
          style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "8px 12px", color: "#fff", fontFamily: "'DM Sans',sans-serif", fontSize: 13, outline: "none", marginBottom: 8 }} />
      )}

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 11, padding: "26px 0" }}>
          <Spin s={24} c="#a78bfa" />
          <div style={{ color: "rgba(255,255,255,0.35)", fontFamily: "'DM Sans',sans-serif", fontSize: 13 }}>
            Fetching playlists from {P[srcPlatform]?.name}…
          </div>
        </div>
      ) : (
        <>
          {lists.length === 0 && !err && (
            <div style={{ textAlign: "center", padding: "18px 0", color: "rgba(255,255,255,0.28)", fontFamily: "'DM Sans',sans-serif", fontSize: 12.5 }}>
              No playlists found. Liked Songs will still be transferred.
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
              {filtered.length} PLAYLISTS
            </span>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setSel(new Set(["__liked__", ...lists.map(p => p.id)]))}
                style={{ background: "none", border: "none", color: "#a78bfa", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 700 }}>All</button>
              <button onClick={() => setSel(new Set(["__liked__"]))}
                style={{ background: "none", border: "none", color: "rgba(255,255,255,0.28)", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontSize: 12 }}>None</button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 265, overflowY: "auto", marginBottom: 10, paddingRight: 3 }}>
            {filtered.map(pl => (
              <PLRow key={pl.id} pl={pl} selected={sel.has(pl.id)} onToggle={() => toggle(pl.id)} />
            ))}
            {filtered.length === 0 && q && (
              <div style={{ textAlign: "center", padding: "14px 0", color: "rgba(255,255,255,0.25)", fontFamily: "'DM Sans',sans-serif", fontSize: 12 }}>
                No playlists match "{q}"
              </div>
            )}
          </div>

          {hasMore && (
            <button onClick={() => load(lists.length, true)} disabled={loadingMore}
              style={{ width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "8px", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontSize: 12, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {loadingMore ? <><Spin s={12} c="#a78bfa" />Loading more…</> : `Load more${pageTotal !== null ? ` (${pageTotal - lists.length} remaining)` : ""}`}
            </button>
          )}
        </>
      )}

      {sel.size > 0 && (
        <div style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.13)", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
          <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12.5, color: "rgba(255,255,255,0.42)" }}>
            <span style={{ color: "#a78bfa", fontWeight: 700 }}>{sel.size}</span> selected
            {" · ~"}<span style={{ color: "#a78bfa", fontWeight: 700 }}>{selTracks.toLocaleString()}</span> tracks
          </span>
        </div>
      )}

      <Btn onClick={() => onNext([...sel].filter(id => id !== "__liked__"), lists.filter(p => sel.has(p.id)), sel.has("__liked__"))}
        disabled={sel.size === 0 || loading}>
        {loading ? "Loading…" : sel.size > 0 ? "Continue →" : "Select playlists to continue"}
      </Btn>
    </div>
  );
}

function PLRow({ pl, selected, onToggle }) {
  const icon = pl.isLiked ? "❤️" : pl.isCollab ? "🤝" : pl.isPublic ? "🌍" : "🔒";
  return (
    <button onClick={onToggle} style={{
      background: selected ? "rgba(167,139,250,0.08)" : "rgba(255,255,255,0.02)",
      border: `1.5px solid ${selected ? "#a78bfa55" : "rgba(255,255,255,0.06)"}`,
      borderRadius: 10, padding: "9px 11px", cursor: "pointer", textAlign: "left",
      display: "flex", alignItems: "center", gap: 9, transition: "all .15s", width: "100%",
    }}>
      {pl.coverUrl
        ? <img src={pl.coverUrl} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} onError={e => { e.target.style.display = "none"; }} />
        : <span style={{ fontSize: 17, width: 32, textAlign: "center", flexShrink: 0 }}>{icon}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "#fff", fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pl.name}</div>
        <div style={{ color: "rgba(255,255,255,0.27)", fontSize: 11, marginTop: 1 }}>
          {typeof pl.trackCount === "number" ? pl.trackCount.toLocaleString() : pl.trackCount} tracks
          {pl.ownerName && pl.ownerName !== "You" ? ` · ${pl.ownerName}` : ""}
        </div>
      </div>
      <div style={{ width: 16, height: 16, borderRadius: 4, background: selected ? "#a78bfa" : "transparent", border: `1.5px solid ${selected ? "#a78bfa" : "rgba(255,255,255,0.18)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all .15s" }}>
        {selected && <span style={{ color: "#fff", fontSize: 9 }}>✓</span>}
      </div>
    </button>
  );
}

// ─── STEP 3: PREVIEW & MATCH ──────────────────────────────────────────────────
function StepPreview({ srcPlatform, dstPlatform, srcAuth, dstAuth, playlistIds, playlists, includeLiked, onNext }) {
  const [phase, setPhase] = useState("fetching"); // fetching | matching | done | error
  const [fetchProg, setFetchProg] = useState({ done: 0, total: 0 });
  const [allTracks, setAllTracks] = useState([]);
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState("all");
  const [resolving, setResolving] = useState(null);
  const [resolved, setResolved] = useState({});
  const ran = useRef(false);

  useEffect(() => { if (!ran.current) { ran.current = true; run(); } }, []);

  async function run() {
    setPhase("fetching"); setErr(null);

    const jobs = [
      ...(includeLiked ? [{ id: "__liked__", name: "Liked Songs", liked: true }] : []),
      ...playlistIds.map(id => ({ id, name: playlists.find(p => p.id === id)?.name || id, liked: false })),
    ];
    setFetchProg({ done: 0, total: jobs.length });

    // ── 1. Fetch all source tracks ────────────────────────────────────────────
    let fetched = [];
    for (const job of jobs) {
      let success = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const token = await Auth.token(srcPlatform);
          if (!token) throw Object.assign(new Error("Source session expired. Please go back and reconnect."), { code: "token_expired", fatal: true });

          const params = new URLSearchParams({ platform: srcPlatform });
          job.liked ? params.set("liked", "true") : params.set("playlist_id", job.id);

          const data = await api(`/api/tracks?${params}`, { headers: { Authorization: `Bearer ${token}` } });
          fetched = [...fetched, ...(data.tracks || []).map(t => ({ ...t, _playlist: job.name }))];
          success = true;
          break;
        } catch (e) {
          if (e.fatal || e.code === "token_expired") { setPhase("error"); setErr({ msg: e.message, fatal: true }); return; }
          if (e.code === "not_found") { success = true; break; } // deleted playlist — skip
          if (e.code === "rate_limited" && attempt < 2) { await sleep(((e.retryAfter || 3) + 1) * 1000); continue; }
          if (e.code === "network" && attempt < 2) { await sleep(2000); continue; }
          // Non-fatal skip
          console.warn(`[fetch] skipped "${job.name}":`, e.message);
          success = true;
          break;
        }
      }
      setFetchProg(p => ({ ...p, done: p.done + 1 }));
    }

    if (fetched.length === 0) {
      setErr({ msg: "No playable tracks found. Local files and region-locked tracks are excluded.", fatal: false });
      setPhase("error"); return;
    }

    // Deduplicate by ISRC, then by platform ID
    const seen = new Set();
    const tracks = fetched.filter(t => {
      const key = t.isrc || `${t.platform || srcPlatform}:${t.id}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    setAllTracks(tracks);

    // ── 2. Match against destination ──────────────────────────────────────────
    setPhase("matching");

    const dstToken = await Auth.token(dstPlatform);
    if (!dstToken) { setErr({ msg: "Destination session expired. Please go back and reconnect.", fatal: true }); setPhase("error"); return; }

    const CHUNK = 50; // stay within Vercel's 10s function timeout
    let allResults = [];
    let consecutiveErrors = 0;

    for (let i = 0; i < tracks.length; i += CHUNK) {
      const chunk = tracks.slice(i, i + CHUNK);
      let success = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const data = await api("/api/tracks?action=match", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tracks: chunk, dest_platform: dstPlatform, dest_token: dstToken }),
          });
          allResults = [...allResults, ...(data.results || [])];
          consecutiveErrors = 0; success = true; break;
        } catch (e) {
          if (e.code === "token_expired") { setErr({ msg: "Destination token expired during matching. Please reconnect.", fatal: true }); setPhase("error"); return; }
          if (e.code === "rate_limited" && attempt < 2) { await sleep(((e.retryAfter || 5) + 1) * 1000); continue; }
          if (e.code === "network" && attempt < 2) { await sleep(2000); continue; }
          // Mark chunk as errored — never abort the full run
          allResults = [...allResults, ...chunk.map(t => ({ sourceTrack: t, status: "error", matchScore: 0, error: e.message, candidates: [] }))];
          consecutiveErrors++;
          if (consecutiveErrors >= 3 && !err) setErr({ msg: `Repeated matching failures: ${e.message}`, fatal: false });
          success = true; break;
        }
      }
    }

    setResults(allResults);
    const matched   = allResults.filter(r => r.status === "matched").length;
    const conflicts = allResults.filter(r => r.status === "conflict").length;
    const unmatched = allResults.filter(r => r.status === "unmatched" || r.status === "error").length;
    setSummary({ matched, conflicts, unmatched, total: allResults.length, matchRate: allResults.length ? matched / allResults.length : 0 });
    setPhase("done");
  }

  const fix = (sourceId, cand) => { setResolved(r => ({ ...r, [sourceId]: cand })); setResolving(null); };

  // Fatal error screen
  if (phase === "error" && err?.fatal) {
    return (
      <div>
        <SHdr n="04" sub="PREVIEW" title="Pipeline failed" />
        <Alert title="Cannot continue" msg={err.msg} type="r" />
        <Btn variant="g" onClick={() => { Auth.clearAll(); window.location.href = "/"; }}>Start Over</Btn>
      </div>
    );
  }

  // Fetching
  if (phase === "fetching") {
    return (
      <div>
        <SHdr n="04" sub="PREVIEW" title="Reading your library…" />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "30px 0" }}>
          <Ring pct={fetchProg.total ? (fetchProg.done / fetchProg.total) * 100 : 10} size={108} color="#a78bfa">
            <div style={{ color: "#fff", fontFamily: "'DM Mono',monospace", fontSize: 17, fontWeight: 800 }}>
              {fetchProg.done}/{fetchProg.total}
            </div>
            <Spin s={12} c="#a78bfa" />
          </Ring>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: "#fff", fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>Fetching tracks</div>
            <div style={{ color: "rgba(255,255,255,0.32)", fontSize: 12, marginTop: 3 }}>Paginating {fetchProg.total} playlist{fetchProg.total !== 1 ? "s" : ""}…</div>
          </div>
        </div>
      </div>
    );
  }

  // Matching
  if (phase === "matching") {
    return (
      <div>
        <SHdr n="04" sub="PREVIEW" title="Matching tracks…" />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "30px 0" }}>
          <Ring pct={60} size={108} color="#a78bfa"><Spin s={22} c="#a78bfa" /></Ring>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: "#fff", fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>
              {allTracks.length.toLocaleString()} tracks
            </div>
            <div style={{ color: "rgba(255,255,255,0.32)", fontSize: 12, marginTop: 3 }}>ISRC lookup → fuzzy title/artist/duration scoring</div>
            <div style={{ color: "rgba(255,255,255,0.22)", fontSize: 11, marginTop: 2 }}>{P[srcPlatform]?.name} → {P[dstPlatform]?.name}</div>
          </div>
        </div>
      </div>
    );
  }

  const display = tab === "all" ? results : results.filter(r => r.status === tab);
  const resCount = Object.keys(resolved).length;

  return (
    <div>
      <SHdr n="04" sub="PREVIEW" title="Match results"
        desc={`${allTracks.length.toLocaleString()} tracks · ${P[srcPlatform]?.name} → ${P[dstPlatform]?.name}`} />

      {err && <Alert type="w" title="Partial results" msg={err.msg} onDismiss={() => setErr(null)} />}

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: 12 }}>
        {[
          ["Matched",   summary.matched,   "#22c55e"],
          [`Review${resCount > 0 ? ` (${resCount}✓)` : ""}`, summary.conflicts, "#f59e0b"],
          ["Not Found", summary.unmatched, "#ef4444"],
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: `${c}0b`, border: `1px solid ${c}1e`, borderRadius: 9, padding: "10px 11px" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: c, fontFamily: "'DM Mono',monospace" }}>{v}</div>
            <div style={{ fontSize: 9.5, color: "rgba(255,255,255,0.3)", marginTop: 3, fontFamily: "'DM Sans',sans-serif" }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Match rate bar */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "'DM Sans',sans-serif" }}>Match rate</span>
          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#22c55e", fontWeight: 700 }}>{Math.round((summary.matchRate || 0) * 100)}%</span>
        </div>
        <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 99, height: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${(summary.matchRate || 0) * 100}%`, background: "linear-gradient(90deg,#22c55e55,#22c55e)", borderRadius: 99, transition: "width 1s ease" }} />
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 3, background: "rgba(255,255,255,0.035)", borderRadius: 8, padding: 3, marginBottom: 11 }}>
        {[["all","All",results.length],["matched","Matched",summary.matched],["conflict","Review",summary.conflicts],["unmatched","Not Found",summary.unmatched]].map(([id, lbl, cnt]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex: 1, padding: "5px 2px", borderRadius: 6, border: "none", cursor: "pointer", background: tab === id ? "rgba(167,139,250,0.18)" : "transparent", color: tab === id ? "#a78bfa" : "rgba(255,255,255,0.28)", fontFamily: "'DM Sans',sans-serif", fontSize: 10.5, fontWeight: 700 }}>
            {lbl} ({cnt})
          </button>
        ))}
      </div>

      {/* Track list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 205, overflowY: "auto", marginBottom: 13, paddingRight: 3 }}>
        {display.length === 0 && (
          <div style={{ textAlign: "center", padding: "16px 0", color: "rgba(255,255,255,0.25)", fontFamily: "'DM Sans',sans-serif", fontSize: 12 }}>No tracks in this category.</div>
        )}
        {display.map((r, i) => {
          const t = r.sourceTrack;
          const isISRC = r.matchMethod === "isrc";
          const tagV = isISRC ? "i" : r.status === "matched" ? "g" : r.status === "conflict" ? "w" : "r";
          const tagLabel = isISRC ? "ISRC" : r.status === "matched" ? `${Math.round(r.matchScore * 100)}%` : r.status === "conflict" ? `${Math.round(r.matchScore * 100)}%` : r.status === "error" ? "ERR" : "–";
          return (
            <div key={t?.id || i} style={{
              background: r.status === "conflict" ? "rgba(245,158,11,0.04)" : r.status === "unmatched" || r.status === "error" ? "rgba(239,68,68,0.04)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${r.status === "conflict" ? "rgba(245,158,11,0.17)" : r.status === "unmatched" || r.status === "error" ? "rgba(239,68,68,0.13)" : "rgba(255,255,255,0.055)"}`,
              borderRadius: 8, padding: "7px 10px", display: "flex", alignItems: "center", gap: 8,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "#fff", fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t?.title || "Unknown"}</div>
                <div style={{ color: "rgba(255,255,255,0.27)", fontSize: 11, marginTop: 1 }}>
                  {t?.artist}{t?._playlist ? ` · ${t._playlist}` : ""}
                  {r.status === "error" && <span style={{ color: "#f87171" }}> · {r.error}</span>}
                </div>
              </div>
              <Tag label={tagLabel} v={tagV} />
              {r.status === "conflict" && !resolved[t?.id] && (
                <button onClick={() => setResolving(r)} style={{ background: "#f59e0b14", border: "1px solid #f59e0b28", borderRadius: 6, color: "#f59e0b", cursor: "pointer", padding: "3px 8px", fontSize: 10.5, fontWeight: 700, fontFamily: "'DM Sans',sans-serif", flexShrink: 0 }}>Fix</button>
              )}
              {resolved[t?.id] && <span style={{ color: "#22c55e", fontSize: 13, flexShrink: 0 }}>✓</span>}
            </div>
          );
        })}
      </div>

      {/* Conflict resolver modal */}
      {resolving && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20, backdropFilter: "blur(10px)" }}>
          <div style={{ background: "#121220", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 18, padding: 22, maxWidth: 400, width: "100%", boxShadow: "0 40px 100px rgba(0,0,0,0.6)" }}>
            <div style={{ fontFamily: "'Instrument Serif',serif", fontSize: 19, color: "#fff", marginBottom: 3 }}>Resolve conflict</div>
            <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 12, fontFamily: "'DM Sans',sans-serif", marginBottom: 15 }}>
              "{resolving.sourceTrack?.title}" — {resolving.sourceTrack?.artist}
            </div>
            {!resolving.candidates?.length ? (
              <div style={{ color: "rgba(255,255,255,0.35)", fontFamily: "'DM Sans',sans-serif", fontSize: 13, padding: "8px 0" }}>
                No candidates found on {P[dstPlatform]?.name}.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                {resolving.candidates.map((c, ci) => (
                  <button key={c.id || ci} onClick={() => fix(resolving.sourceTrack?.id, c)}
                    style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "9px 12px", cursor: "pointer", textAlign: "left", transition: "all .14s" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#a78bfa45"; e.currentTarget.style.background = "rgba(167,139,250,0.07)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; e.currentTarget.style.background = "rgba(255,255,255,0.025)"; }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: "#fff", fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12.5 }}>{c.title}</div>
                        <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, marginTop: 1 }}>{c.artist}{c.album ? ` · ${c.album}` : ""}</div>
                      </div>
                      <Tag label={`${Math.round((c.score || 0) * 100)}%`} v={c.score >= 0.8 ? "g" : "w"} />
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => fix(resolving.sourceTrack?.id, { skip: true })} style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 7, color: "rgba(255,255,255,0.3)", cursor: "pointer", padding: "8px", fontSize: 12, fontFamily: "'DM Sans',sans-serif" }}>Skip</button>
              <button onClick={() => setResolving(null)} style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 7, color: "rgba(255,255,255,0.3)", cursor: "pointer", padding: "8px", fontSize: 12, fontFamily: "'DM Sans',sans-serif" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <Btn onClick={() => onNext(results, resolved, allTracks)} disabled={phase !== "done"}>
        Transfer {summary.matched + resCount} tracks →
      </Btn>
    </div>
  );
}

// ─── STEP 4: TRANSFER ─────────────────────────────────────────────────────────
function StepTransfer({ srcPlatform, dstPlatform, results, resolved, playlists, includeLiked }) {
  const [phase, setPhase] = useState("running"); // running | complete | error
  const [log, setLog] = useState([]);
  const [pct, setPct] = useState(0);
  const [report, setReport] = useState(null);
  const [err, setErr] = useState(null);
  const logRef = useRef(null);
  const ran = useRef(false);

  const addLog = (msg, type = "info") => {
    setLog(prev => {
      const next = [...prev, { msg, type }];
      setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 30);
      return next;
    });
  };

  useEffect(() => { if (!ran.current) { ran.current = true; run(); } }, []);

  async function run() {
    setPhase("running"); setLog([]); setPct(0); setReport(null); setErr(null);

    const dstToken = await Auth.token(dstPlatform);
    if (!dstToken) { setErr("Destination session expired. Please go back and reconnect."); setPhase("error"); return; }

    // Group track URIs by source playlist name
    const byPlaylist = {};
    for (const r of results) {
      const name = r.sourceTrack?._playlist || "Transferred Playlist";
      if (!byPlaylist[name]) byPlaylist[name] = [];
      const tid = r.sourceTrack?.id;
      let uri = null;
      if (resolved[tid] && !resolved[tid].skip) {
        uri = resolved[tid].uri || resolved[tid].id;
      } else if (r.status === "matched" && r.destTrack) {
        uri = r.destTrack.uri || r.destTrack.id;
      }
      if (uri) byPlaylist[name].push(uri);
    }

    const plNames = Object.keys(byPlaylist).filter(k => byPlaylist[k].length > 0);
    if (!plNames.length) { setErr("No matched tracks to transfer."); setPhase("error"); return; }

    const totalUris = plNames.reduce((a, k) => a + byPlaylist[k].length, 0);
    addLog(`Starting: ${totalUris} tracks → ${plNames.length} playlist(s) on ${P[dstPlatform]?.name}`, "info");

    let totalAdded = 0, totalFailed = 0, playlistsCreated = 0;

    for (const [plName, uris] of Object.entries(byPlaylist)) {
      if (!uris.length) continue;
      addLog(`Creating "${plName}"…`, "info");
      try {
        const data = await api("/api/transfer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dest_platform: dstPlatform,
            dest_token: dstToken,
            playlist_name: `[StreamShift] ${plName}`,
            playlist_description: `Transferred from ${P[srcPlatform]?.name} via StreamShift`,
            track_uris: uris,
            is_public: false,
          }),
        });

        if (data.error === "token_expired_mid_transfer") {
          addLog(`Token expired. ${data.added || 0} tracks were saved.`, "error");
          totalAdded += data.added || 0; totalFailed += data.failed || 0;
          setErr(`Session expired mid-transfer. ${totalAdded} tracks saved successfully.`);
          break;
        }
        if (data.error === "quota_exceeded") {
          addLog(`YouTube daily API quota exceeded. ${data.added || 0} tracks saved.`, "error");
          totalAdded += data.added || 0;
          setErr("YouTube daily quota exceeded. Your partial playlist was saved. Try the rest tomorrow.");
          break;
        }

        const icon = data.partial ? "⚠" : "✓";
        addLog(`${icon} "${plName}": ${data.added} added${data.failed ? `, ${data.failed} failed` : ""}${data.playlistUrl ? ` — ${data.playlistUrl}` : ""}`, data.partial ? "warn" : "success");
        totalAdded += data.added || 0;
        totalFailed += data.failed || 0;
        playlistsCreated++;
      } catch (e) {
        addLog(`✕ "${plName}" failed: ${e.message}`, "error");
        totalFailed += uris.length;
      }
      setPct(Math.round((totalAdded + totalFailed) / totalUris * 100));
    }

    setPct(100);
    const final = { added: totalAdded, failed: totalFailed, playlists: playlistsCreated, total: totalUris };
    setReport(final);
    addLog(
      `Done. ${totalAdded} tracks transferred${totalFailed > 0 ? `, ${totalFailed} could not be matched` : ""}.`,
      totalFailed > 0 ? "warn" : "success"
    );
    setPhase(totalAdded === 0 && totalFailed > 0 ? "error" : "complete");
  }

  const ringColor = phase === "complete" ? "#22c55e" : phase === "error" ? "#ef4444" : "#a78bfa";
  const logColor = t => ({ success: "#22c55e", warn: "#f59e0b", error: "#ef4444", info: "rgba(255,255,255,0.45)" })[t] || "rgba(255,255,255,0.45)";

  return (
    <div>
      <SHdr n="05" sub="TRANSFER"
        title={phase === "complete" ? "Transfer complete!" : phase === "error" ? "Transfer failed" : "Transferring…"}
        desc={`${P[srcPlatform]?.name} → ${P[dstPlatform]?.name}`} />

      <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
        <Ring pct={pct} size={122} color={ringColor}>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'DM Mono',monospace", color: phase === "complete" ? "#22c55e" : phase === "error" ? "#ef4444" : "#fff" }}>
            {pct}%
          </div>
          {phase === "running"  && <Spin s={13} c="#a78bfa" />}
          {phase === "complete" && <span style={{ fontSize: 15, marginTop: 2 }}>✓</span>}
          {phase === "error"    && <span style={{ fontSize: 15, marginTop: 2 }}>✕</span>}
        </Ring>
      </div>

      {/* Live log */}
      <div ref={logRef} style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.055)", borderRadius: 10, padding: "10px 12px", maxHeight: 150, overflowY: "auto", marginBottom: 14, fontFamily: "'DM Mono',monospace", fontSize: 11 }}>
        {log.map((e, i) => (
          <div key={i} style={{ color: logColor(e.type), marginBottom: 4, display: "flex", gap: 8, lineHeight: 1.5 }}>
            <span style={{ color: "rgba(255,255,255,0.15)", flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</span>
            <span style={{ wordBreak: "break-all" }}>{e.msg}</span>
          </div>
        ))}
        {phase === "running" && <span style={{ color: "#a78bfa", animation: "blink 1s step-end infinite" }}>▋</span>}
      </div>

      {err && <Alert type="w" msg={err} />}

      {/* Final report */}
      {report && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: 12 }}>
            {[
              ["Transferred", report.added,     "#22c55e"],
              ["Failed",      report.failed,     report.failed > 0 ? "#f59e0b" : "#22c55e"],
              ["Playlists",   report.playlists,  "#a78bfa"],
            ].map(([l, v, c]) => (
              <div key={l} style={{ background: `${c}0b`, border: `1px solid ${c}1e`, borderRadius: 9, padding: "10px 11px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: c, fontFamily: "'DM Mono',monospace" }}>{v}</div>
                <div style={{ fontSize: 9.5, color: "rgba(255,255,255,0.3)", marginTop: 2, fontFamily: "'DM Sans',sans-serif" }}>{l}</div>
              </div>
            ))}
          </div>
          {report.failed > 0 && (
            <Alert type="w" msg={`${report.failed} track${report.failed !== 1 ? "s" : ""} could not be found on ${P[dstPlatform]?.name}. These are typically region-exclusive or unavailable on that platform.`} />
          )}
          <Btn variant="s" onClick={() => { Auth.clearAll(); window.location.href = "/"; }}>
            Transfer More ↺
          </Btn>
        </>
      )}

      {phase === "error" && !report && (
        <Btn onClick={run}>Retry Transfer</Btn>
      )}
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep] = useState(0);
  const [srcPlatform, setSrcPlatform] = useState(null);
  const [dstPlatform, setDstPlatform] = useState(null);
  const [srcAuth, setSrcAuth] = useState(null);
  const [dstAuth, setDstAuth] = useState(null);
  const [playlistIds, setPlaylistIds] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [includeLiked, setIncludeLiked] = useState(false);
  const [results, setResults] = useState([]);
  const [resolved, setResolved] = useState({});
  const [allTracks, setAllTracks] = useState([]);
  const [globalErr, setGlobalErr] = useState(null);

  // ── Parse OAuth redirect on mount ─────────────────────────────────────────
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    window.history.replaceState({}, "", "/");

    // Auth error from callback
    const authErr = sp.get("auth_error");
    if (authErr) { setGlobalErr(decodeURIComponent(authErr)); return; }

    // Successful OAuth callback — find which platform returned
    for (const platform of Object.keys(P)) {
      const raw = sp.get(P[platform].authParam);
      if (!raw) continue;
      try {
        const data = JSON.parse(decodeURIComponent(raw));
        const pendingRole = localStorage.getItem("ss_pending_role") || data.role || "source";
        localStorage.removeItem("ss_pending_role");

        if (pendingRole === "source") {
          const authData = { ...data, role: "source", platform };
          Auth.save(platform, authData);
          Auth.clear("_src_snap");
          setSrcAuth(authData);
          setSrcPlatform(platform);
          setStep(1);
        } else {
          // Restore source auth snapshotted before dest redirect
          const snap = Auth.load("_src_snap");
          if (snap) {
            Auth.save(snap.platform, { ...snap, role: "source" });
            Auth.clear("_src_snap");
            setSrcAuth(snap);
            setSrcPlatform(snap.platform);
          }
          const authData = { ...data, role: "dest", platform };
          Auth.save(platform, authData);
          setDstAuth(authData);
          setDstPlatform(platform);
          setStep(snap ? 2 : 1);
        }
      } catch {
        setGlobalErr("Failed to parse authentication response. Please try again.");
      }
      return;
    }

    // Restore existing session on page reload (survives F5)
    let srcRestored = false, dstRestored = false;
    for (const pk of Object.keys(P)) {
      const a = Auth.load(pk);
      if (!a) continue;
      if (a.role === "source" && !srcRestored) { setSrcAuth(a); setSrcPlatform(pk); srcRestored = true; }
      if (a.role === "dest"   && !dstRestored) { setDstAuth(a); setDstPlatform(pk); dstRestored = true; }
    }
    if (srcRestored && dstRestored) setStep(2);
    else if (srcRestored) setStep(1);
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=DM+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0d0d18; min-height: 100%; }
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes blink { 0%,100% { opacity:1 } 50% { opacity:0 } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(11px); } to { opacity:1; transform:translateY(0); } }
        @keyframes float { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-5px); } }
        input::placeholder { color: rgba(255,255,255,0.22); }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: rgba(167,139,250,0.18); border-radius: 99px; }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#0d0d18", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>

        {/* Ambient background */}
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: "-8%", left: "-8%", width: 500, height: 500, background: "radial-gradient(circle,rgba(124,58,237,.09) 0%,transparent 65%)", borderRadius: "50%" }} />
          <div style={{ position: "absolute", bottom: "-6%", right: "-4%", width: 400, height: 400, background: "radial-gradient(circle,rgba(167,139,250,.06) 0%,transparent 65%)", borderRadius: "50%" }} />
          <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,.011) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.011) 1px,transparent 1px)", backgroundSize: "56px 56px" }} />
        </div>

        <div style={{ width: "100%", maxWidth: 448, position: "relative" }}>

          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 32, animation: "fadeUp .45s ease" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, background: "linear-gradient(135deg,#a78bfa,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, animation: "float 4s ease-in-out infinite", boxShadow: "0 8px 26px rgba(124,58,237,.38)" }}>♫</div>
              <span style={{ fontFamily: "'Instrument Serif',serif", fontSize: 26, fontWeight: 400, color: "#fff", letterSpacing: "-.2px" }}>StreamShift</span>
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
              {Object.entries(P).map(([k, pl]) => (
                <div key={k} style={{ color: pl.color, opacity: .38, transform: "scale(.8)" }}>{pl.icon}</div>
              ))}
            </div>
            <div style={{ color: "rgba(255,255,255,.22)", fontSize: 11, fontFamily: "'DM Sans',sans-serif", marginTop: 6 }}>
              Spotify · YouTube Music · Apple Music · Amazon Music · Wynk · JioSaavn
            </div>
          </div>

          {/* Global OAuth error */}
          {globalErr && (
            <Alert title="Authentication Error" msg={globalErr} type="r" onDismiss={() => setGlobalErr(null)} />
          )}

          {/* Main card */}
          <div style={{ background: "rgba(255,255,255,.022)", border: "1px solid rgba(255,255,255,.065)", borderRadius: 20, padding: "22px 20px", backdropFilter: "blur(28px)", boxShadow: "0 28px 72px rgba(0,0,0,.44), inset 0 0 0 1px rgba(255,255,255,.025)", animation: "fadeUp .5s ease" }}>
            <StepBar cur={step} />
            <div key={step} style={{ animation: "fadeUp .25s ease" }}>
              {step === 0 && (
                <StepSource existingSrcAuth={srcAuth}
                  onNext={(platform, authData) => {
                    setSrcPlatform(platform);
                    setSrcAuth(authData);
                    setStep(1);
                  }} />
              )}
              {step === 1 && srcAuth && (
                <StepDest srcPlatform={srcPlatform} srcAuth={srcAuth} existingDstAuth={dstAuth}
                  onNext={(authData) => {
                    const platform = authData.platform;
                    setDstPlatform(platform);
                    setDstAuth(authData);
                    setStep(2);
                  }} />
              )}
              {step === 2 && srcAuth && (
                <StepPlaylists srcPlatform={srcPlatform} srcAuth={srcAuth}
                  onNext={(ids, pls, liked) => { setPlaylistIds(ids); setPlaylists(pls); setIncludeLiked(liked); setStep(3); }} />
              )}
              {step === 3 && srcAuth && dstAuth && (
                <StepPreview
                  srcPlatform={srcPlatform} dstPlatform={dstPlatform}
                  srcAuth={srcAuth} dstAuth={dstAuth}
                  playlistIds={playlistIds} playlists={playlists} includeLiked={includeLiked}
                  onNext={(r, res, tracks) => { setResults(r); setResolved(res); setAllTracks(tracks); setStep(4); }} />
              )}
              {step === 4 && srcAuth && dstAuth && (
                <StepTransfer
                  srcPlatform={srcPlatform} dstPlatform={dstPlatform}
                  results={results} resolved={resolved}
                  playlists={playlists} includeLiked={includeLiked} />
              )}
            </div>
          </div>

          {/* Footer */}
          <div style={{ textAlign: "center", marginTop: 14, display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
            {["No audio stored", "OAuth 2.0 PKCE", "Free & open source"].map((t, i) => (
              <span key={i} style={{ color: "rgba(255,255,255,.15)", fontSize: 10.5, fontFamily: "'DM Sans',sans-serif" }}>
                {i > 0 && <span style={{ marginRight: 10, opacity: .3 }}>·</span>}{t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
