// api/transfer.js — creates playlist + adds tracks on all 6 platforms
// POST /api/transfer  { dest_platform, dest_token, playlist_name, track_uris[], is_public }

// ─── INLINE UTILITIES ────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}
function apiError(res, status, code, msg) { return res.status(status).json({ error: code, message: msg }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function timedFetch(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  catch(e) { if (e.name==="AbortError"){const err=new Error("Timeout");err.status=504;throw err;} const err=new Error(`Network: ${e.message}`);err.status=503;throw err; }
  finally { clearTimeout(t); }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return apiError(res, 405, "method_not_allowed", "POST only");

  const { dest_platform, dest_token, playlist_name, playlist_description="Transferred via StreamShift", track_uris=[], is_public=false } = req.body || {};

  if (!dest_platform)  return apiError(res, 400, "missing_param", "dest_platform required");
  if (!dest_token)     return apiError(res, 401, "missing_token", "dest_token required");
  if (!playlist_name)  return apiError(res, 400, "missing_param", "playlist_name required");
  if (!Array.isArray(track_uris) || !track_uris.length) return apiError(res, 400, "missing_param", "track_uris[] required");

  try {
    switch(dest_platform) {
      case "spotify":       return toSpotify(res, dest_token, playlist_name, playlist_description, track_uris, is_public);
      case "youtube_music": return toYoutube(res, dest_token, playlist_name, playlist_description, track_uris, is_public);
      case "apple_music":   return toApple(res, dest_token, playlist_name, playlist_description, track_uris);
      case "amazon_music":  return toAmazon(res, dest_token, playlist_name, playlist_description, track_uris, is_public);
      case "wynk":          return toWynk(res, dest_token, playlist_name, playlist_description, track_uris);
      case "jiosaavn":      return toSaavn(res, dest_token, playlist_name, playlist_description, track_uris);
      default: return apiError(res, 400, "unsupported_platform", "Supported: spotify, youtube_music, apple_music, amazon_music, wynk, jiosaavn");
    }
  } catch(e) {
    console.error(`[transfer/${dest_platform}]`, e.message);
    return apiError(res, e.status||503, e.code||"transfer_error", e.message);
  }
}

// ─── SPOTIFY ─────────────────────────────────────────────────────────────────
async function toSpotify(res, token, name, desc, uris, pub) {
  const sf = (url, opts={}) => timedFetch(url, { ...opts, headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json", ...(opts.headers||{}) } });

  const me = await sf("https://api.spotify.com/v1/me");
  if (me.status===401) return res.status(401).json({ error:"token_expired" });
  if (!me.ok) return apiError(res, me.status, "profile_error", "Failed to get Spotify profile");
  const { id:userId } = await me.json();

  const cr = await sf(`https://api.spotify.com/v1/users/${encodeURIComponent(userId)}/playlists`, { method:"POST", body:JSON.stringify({ name, description:desc, public:pub, collaborative:false }) });
  if (!cr.ok) { const b=await cr.json().catch(()=>({})); if(cr.status===401)return res.status(401).json({error:"token_expired"}); return apiError(res, cr.status, "create_failed", b?.error?.message||"Failed to create playlist"); }
  const pl = await cr.json();
  const plId=pl.id, plUrl=pl.external_urls?.spotify;

  let added=0, failed=0;
  for (let i=0; i<uris.length; i+=100) {
    const batch=uris.slice(i,i+100); let ok=false;
    for (let a=0;a<3;a++) {
      const r=await sf(`https://api.spotify.com/v1/playlists/${plId}/tracks`,{method:"POST",body:JSON.stringify({uris:batch})});
      if(r.status===429){await sleep((parseInt(r.headers.get("Retry-After")||"3")+1)*1000);continue;}
      if(r.status===401)return res.status(200).json({partial:true,added,failed:failed+(uris.length-i),error:"token_expired_mid_transfer"});
      if(r.ok){ok=true;break;}
      if(a<2)await sleep(800*(a+1));
    }
    ok?added+=batch.length:failed+=batch.length;
    if(i+100<uris.length)await sleep(200);
  }
  return res.status(200).json({ success:failed===0, partial:failed>0&&added>0, playlistId:plId, playlistUrl:plUrl, added, failed, total:uris.length });
}

// ─── YOUTUBE MUSIC ─────────────────────────────────────────────────────────────
async function toYoutube(res, token, name, desc, videoIds, pub) {
  const yf = (url, opts={}) => timedFetch(url, { ...opts, headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json", ...(opts.headers||{}) } });

  const cr=await yf("https://www.googleapis.com/youtube/v3/playlists?part=snippet,status",{method:"POST",body:JSON.stringify({snippet:{title:name,description:desc},status:{privacyStatus:pub?"public":"private"}})});
  if(!cr.ok){const b=await cr.json().catch(()=>({}));if(cr.status===401)return res.status(401).json({error:"token_expired"});if(cr.status===403)return res.status(403).json({error:"quota_exceeded",message:b?.error?.message||"YouTube quota exceeded"});return apiError(res,cr.status,"create_failed",b?.error?.message||"Failed to create playlist");}
  const pl=await cr.json(); const plId=pl.id; const plUrl=`https://music.youtube.com/playlist?list=${plId}`;

  let added=0, failed=0;
  for(const rawUri of videoIds) {
    const videoId=rawUri.includes("watch?v=")?new URL(rawUri).searchParams.get("v"):rawUri;
    let ok=false;
    for(let a=0;a<3;a++){
      const r=await yf("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet",{method:"POST",body:JSON.stringify({snippet:{playlistId:plId,resourceId:{kind:"youtube#video",videoId}}})});
      if(r.status===403){const b=await r.json().catch(()=>({}));if(b?.error?.errors?.[0]?.reason==="quotaExceeded")return res.status(200).json({partial:true,playlistId:plId,playlistUrl:plUrl,added,failed:failed+(videoIds.length-videoIds.indexOf(rawUri)),error:"quota_exceeded"});await sleep(2000*(a+1));continue;}
      if(r.status===429){await sleep(3000*(a+1));continue;}
      if(r.ok){ok=true;break;}
      if(a<2)await sleep(600*(a+1));
    }
    ok?added++:failed++;
    await sleep(150);
  }
  return res.status(200).json({ success:failed===0, partial:failed>0&&added>0, playlistId:plId, playlistUrl:plUrl, added, failed, total:videoIds.length });
}

// ─── APPLE MUSIC ─────────────────────────────────────────────────────────────
async function toApple(res, token, name, desc, trackIds) {
  const dev=process.env.APPLE_DEVELOPER_TOKEN;
  if(!dev) return apiError(res,500,"missing_config","APPLE_DEVELOPER_TOKEN not set");
  const af=(url,opts={})=>timedFetch(url,{...opts,headers:{Authorization:`Bearer ${dev}`,"Music-User-Token":token,"Content-Type":"application/json",...(opts.headers||{})}});

  const cr=await af("https://api.music.apple.com/v1/me/library/playlists",{method:"POST",body:JSON.stringify({attributes:{name,description:desc}})});
  if(!cr.ok){const b=await cr.json().catch(()=>({}));if(cr.status===401)return res.status(401).json({error:"token_expired"});return apiError(res,cr.status,"create_failed",b?.errors?.[0]?.detail||"Failed to create Apple Music playlist");}
  const plData=await cr.json(); const plId=plData.data?.[0]?.id;
  if(!plId) return apiError(res,500,"create_failed","No playlist ID returned");

  let added=0,failed=0;
  for(let i=0;i<trackIds.length;i+=25){
    const batch=trackIds.slice(i,i+25).map(id=>({id,type:"songs"}));
    const r=await af(`https://api.music.apple.com/v1/me/library/playlists/${plId}/tracks`,{method:"POST",body:JSON.stringify({data:batch})});
    (r.ok||r.status===204)?added+=batch.length:failed+=batch.length;
    if(i+25<trackIds.length)await sleep(300);
  }
  return res.status(200).json({ success:failed===0, partial:failed>0&&added>0, playlistId:plId, playlistUrl:`https://music.apple.com/library/playlist/${plId}`, added, failed, total:trackIds.length });
}

// ─── AMAZON MUSIC ─────────────────────────────────────────────────────────────
async function toAmazon(res, token, name, desc, trackIds, pub) {
  const apiKey=process.env.AMAZON_MUSIC_API_KEY||"";
  const af=(url,opts={})=>timedFetch(url,{...opts,headers:{Authorization:`Bearer ${token}`,"x-api-key":apiKey,"Content-Type":"application/json",...(opts.headers||{})}});

  const cr=await af("https://api.music.amazon.dev/v1/playlists",{method:"POST",body:JSON.stringify({title:name,description:desc,accessType:pub?"PUBLIC":"PRIVATE"})});
  if(!cr.ok){const b=await cr.json().catch(()=>({}));if(cr.status===401)return res.status(401).json({error:"token_expired"});return apiError(res,cr.status,"create_failed",b?.message||"Failed to create Amazon playlist");}
  const pl=await cr.json(); const plId=pl.id||pl.playlistId;

  let added=0,failed=0;
  for(let i=0;i<trackIds.length;i+=50){
    const batch=trackIds.slice(i,i+50);
    const r=await af(`https://api.music.amazon.dev/v1/playlists/${plId}/tracks`,{method:"POST",body:JSON.stringify({tracks:batch.map(id=>({id}))})});
    r.ok?added+=batch.length:failed+=batch.length;
    if(i+50<trackIds.length)await sleep(200);
  }
  return res.status(200).json({ success:failed===0, partial:failed>0&&added>0, playlistId:plId, playlistUrl:`https://music.amazon.com/playlists/${plId}`, added, failed, total:trackIds.length });
}

// ─── WYNK ─────────────────────────────────────────────────────────────────────
async function toWynk(res, token, name, desc, songIds) {
  const appKey=process.env.WYNK_APP_KEY||"";
  const wf=(url,opts={})=>timedFetch(url,{...opts,headers:{Authorization:`Bearer ${token}`,"X-BSY-UTKN":appKey,"Content-Type":"application/json","User-Agent":"WynkMusic/3.28.0.2 (Android)",...(opts.headers||{})}});

  const cr=await wf("https://api-staging.wynk.in/v1/user/playlists",{method:"POST",body:JSON.stringify({name,description:desc,isPublic:false})});
  if(!cr.ok){const b=await cr.json().catch(()=>({}));if(cr.status===401)return res.status(401).json({error:"token_expired"});return apiError(res,cr.status,"create_failed",b?.message||"Failed to create Wynk playlist");}
  const pl=await cr.json(); const plId=pl.id||pl.playlistId;

  let added=0,failed=0;
  for(let i=0;i<songIds.length;i+=50){
    const batch=songIds.slice(i,i+50);
    const r=await wf(`https://api-staging.wynk.in/v1/user/playlists/${plId}/songs`,{method:"POST",body:JSON.stringify({songIds:batch})});
    r.ok?added+=batch.length:failed+=batch.length;
    if(i+50<songIds.length)await sleep(200);
  }
  return res.status(200).json({ success:failed===0, partial:failed>0&&added>0, playlistId:plId, playlistUrl:null, added, failed, total:songIds.length });
}

// ─── JIOSAAVN ─────────────────────────────────────────────────────────────────
async function toSaavn(res, token, name, desc, songIds) {
  const hdr={"Cookie":token,"User-Agent":"Mozilla/5.0","Referer":"https://www.jiosaavn.com/","Content-Type":"application/x-www-form-urlencoded"};

  const crParams=new URLSearchParams({__call:"playlist.create",_format:"json",_marker:"0",listname:name});
  const cr=await timedFetch("https://www.jiosaavn.com/api.php",{method:"POST",headers:hdr,body:crParams.toString()});
  if(!cr.ok)return apiError(res,cr.status,"create_failed",`JioSaavn ${cr.status}`);
  const plData=await cr.json();
  if(plData.status==="failure")return apiError(res,400,"create_failed",plData.message||"Failed to create JioSaavn playlist");
  const plId=plData.listid||plData.id; const plUrl=plData.perma_url||`https://www.jiosaavn.com/playlist/-/${plId}`;

  let added=0,failed=0;
  for(let i=0;i<songIds.length;i+=50){
    const batch=songIds.slice(i,i+50);
    const addParams=new URLSearchParams({__call:"playlist.addSong",_format:"json",_marker:"0",listid:plId,songid:batch.join(",")});
    const r=await timedFetch("https://www.jiosaavn.com/api.php",{method:"POST",headers:hdr,body:addParams.toString()});
    const d=await r.json().catch(()=>({}));
    (r.ok&&d.status!=="failure")?added+=batch.length:failed+=batch.length;
    if(i+50<songIds.length)await sleep(200);
  }
  return res.status(200).json({ success:failed===0, partial:failed>0&&added>0, playlistId:plId, playlistUrl:plUrl, added, failed, total:songIds.length });
}
