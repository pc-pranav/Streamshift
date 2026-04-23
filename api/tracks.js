// api/tracks.js  — fetches tracks AND runs cross-platform matching
// GET  /api/tracks?platform=spotify&playlist_id=xxx  (or &liked=true)
// POST /api/tracks?action=match  { tracks[], dest_platform, dest_token }

// ─── INLINE UTILITIES ────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}
function apiError(res, status, code, msg) { return res.status(status).json({ error: code, message: msg }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function timedFetch(url, opts = {}, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  catch(e) {
    if (e.name === "AbortError") { const err = new Error("Timeout"); err.status = 504; throw err; }
    const err = new Error(`Network: ${e.message}`); err.status = 503; throw err;
  } finally { clearTimeout(t); }
}

async function withRetry(fn, maxAttempts = 3) {
  let last;
  for (let i = 1; i <= maxAttempts; i++) {
    try { return await fn(); }
    catch(e) {
      last = e;
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429) throw e;
      if (i < maxAttempts) await sleep(Math.pow(2,i)*500 + Math.random()*300);
    }
  }
  throw last;
}

// Jaro-Winkler similarity
function jw(s1, s2) {
  s1=s1||""; s2=s2||"";
  if (s1===s2) return 1; if (!s1||!s2) return 0;
  const d = Math.max(Math.floor(Math.max(s1.length,s2.length)/2)-1,0);
  const m1=new Array(s1.length).fill(false), m2=new Array(s2.length).fill(false);
  let matches=0;
  for(let i=0;i<s1.length;i++) for(let j=Math.max(0,i-d);j<Math.min(i+d+1,s2.length);j++) { if(!m2[j]&&s1[i]===s2[j]){m1[i]=m2[j]=true;matches++;break;} }
  if(!matches) return 0;
  let t=0,k=0;
  for(let i=0;i<s1.length;i++){if(!m1[i])continue;while(!m2[k])k++;if(s1[i]!==s2[k])t++;k++;}
  const jaro=(matches/s1.length+matches/s2.length+(matches-t/2)/matches)/3;
  let p=0; for(let i=0;i<Math.min(4,s1.length,s2.length);i++){if(s1[i]===s2[i])p++;else break;}
  return jaro+p*0.1*(1-jaro);
}

const STRIP=[/\s*[\(\[](feat\.?|ft\.?|with)\s+[^\)\]]+[\)\]]/gi,/\s*[\(\[](remaster(?:ed)?|live|acoustic|radio\s*edit|single\s*version|deluxe|album\s*version|explicit|clean)[^\)\]]*[\)\]]/gi,/\s*-\s*(single|ep|remaster(?:ed)?|live|acoustic|explicit|clean)\s*$/gi,/[^\w\s]/g];
function norm(s){if(!s)return"";let r=s.toLowerCase().trim();for(const p of STRIP)r=r.replace(p,"");return r.replace(/\s+/g," ").trim();}

function scoreMatch(src, cand) {
  const ts = jw(norm(src.title), norm(cand.title));
  const artists = cand.artists?.length ? cand.artists : [cand.artist].filter(Boolean);
  const as = Math.max(...artists.map(a => jw(norm(src.artist||""), norm(a))));
  const ds = (!src.durationMs||!cand.durationMs) ? 0.5 : Math.max(0,1-Math.abs(src.durationMs-cand.durationMs)/15000);
  const albs = jw(norm(src.album||""), norm(cand.album||""));
  return ts*0.40 + as*0.30 + ds*0.20 + albs*0.10;
}

function classify(score) { return score>=0.90?"matched":score>=0.65?"conflict":"unmatched"; }

const MAX_TRACKS = 5000;

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action } = req.query;

  // Match action (POST)
  if (action === "match") {
    if (req.method !== "POST") return apiError(res, 405, "method_not_allowed", "POST only");
    return runMatch(req, res);
  }

  // Fetch tracks (GET)
  if (req.method !== "GET") return apiError(res, 405, "method_not_allowed", "GET only");

  const token      = (req.headers.authorization||"").replace("Bearer ","").trim();
  const platform   = req.query.platform;
  const playlistId = req.query.playlist_id;
  const liked      = req.query.liked === "true";

  if (!token)                return apiError(res, 401, "missing_token", "Authorization header required");
  if (!platform)             return apiError(res, 400, "missing_param", "?platform= required");
  if (!playlistId && !liked) return apiError(res, 400, "missing_param", "?playlist_id= or ?liked=true required");

  try {
    let tracks = [];
    switch(platform) {
      case "spotify":       tracks = liked ? await spotifyLiked(token) : await spotifyPlaylist(token, playlistId); break;
      case "youtube_music": tracks = await youtubePlaylist(token, playlistId, liked); break;
      case "apple_music":   tracks = liked ? await appleLiked(token) : await applePlaylist(token, playlistId); break;
      case "amazon_music":  tracks = liked ? await amazonLiked(token) : await amazonPlaylist(token, playlistId); break;
      case "wynk":          tracks = liked ? await wynkLiked(token) : await wynkPlaylist(token, playlistId); break;
      case "jiosaavn":      tracks = liked ? await saavnLiked(token) : await saavnPlaylist(token, playlistId); break;
      default: return apiError(res, 400, "unsupported_platform", "Unsupported platform");
    }
    const seen=new Set();
    const deduped=tracks.filter(t=>{if(!t)return false;const k=t.isrc||`${platform}:${t.id}`;if(seen.has(k))return false;seen.add(k);return true;});
    return res.status(200).json({ tracks:deduped, total:deduped.length });
  } catch(e) {
    console.error(`[tracks/${platform}]`, e.message);
    return apiError(res, e.status||503, e.code||"fetch_error", e.message);
  }
}

// ─── MATCH ───────────────────────────────────────────────────────────────────
async function runMatch(req, res) {
  const { tracks, dest_platform, dest_token } = req.body || {};
  if (!Array.isArray(tracks)||!tracks.length) return apiError(res, 400, "missing_param", "tracks[] required");
  if (!dest_platform) return apiError(res, 400, "missing_param", "dest_platform required");
  if (!dest_token)    return apiError(res, 401, "missing_token", "dest_token required");

  const results = [];
  for (let i=0; i<tracks.length; i++) {
    try { results.push(await matchOne(tracks[i], dest_platform, dest_token)); }
    catch(e) { results.push({ sourceTrack:tracks[i], destTrack:null, matchScore:0, matchMethod:null, status:"error", error:e.message, candidates:[] }); }
    if (i < tracks.length-1) await sleep(130);
  }

  const matched=results.filter(r=>r.status==="matched").length;
  const conflicts=results.filter(r=>r.status==="conflict").length;
  const unmatched=results.filter(r=>r.status==="unmatched"||r.status==="error").length;
  return res.status(200).json({ results, summary:{ total:tracks.length, matched, conflicts, unmatched, matchRate:tracks.length?matched/tracks.length:0 } });
}

async function matchOne(track, dest, destToken) {
  // Phase 1: ISRC
  if (track.isrc) {
    const hit = await isrcLookup(track.isrc, dest, destToken);
    if (hit) return { sourceTrack:track, destTrack:hit, matchScore:1.0, matchMethod:"isrc", status:"matched", candidates:[] };
  }
  // Phase 2: Fuzzy
  const cands = await fuzzySearch(track, dest, destToken);
  if (!cands.length) return { sourceTrack:track, destTrack:null, matchScore:0, matchMethod:"fuzzy", status:"unmatched", candidates:[] };
  const scored = cands.map(c=>({...c,score:scoreMatch(track,c)})).sort((a,b)=>b.score-a.score);
  const best=scored[0], status=classify(best.score);
  return { sourceTrack:track, destTrack:status!=="unmatched"?best:null, matchScore:best.score, matchMethod:"fuzzy", status, candidates:scored.slice(0,5) };
}

async function isrcLookup(isrc, platform, token) {
  try {
    if (platform==="spotify") {
      const r=await timedFetch(`https://api.spotify.com/v1/search?q=isrc:${isrc}&type=track&limit=1`,{headers:{Authorization:`Bearer ${token}`}},8000);
      if(!r.ok)return null; const d=await r.json(); const t=d.tracks?.items?.[0]; return t?toSpotify(t):null;
    }
    if (platform==="apple_music") {
      const dev=process.env.APPLE_DEVELOPER_TOKEN; if(!dev)return null;
      const r=await timedFetch(`https://api.music.apple.com/v1/catalog/us/songs?filter[isrc]=${isrc}&limit=1`,{headers:{Authorization:`Bearer ${dev}`,"Music-User-Token":token}},8000);
      if(!r.ok)return null; const d=await r.json(); return d.data?.[0]?toApple(d.data[0]):null;
    }
    if (platform==="amazon_music") {
      const r=await timedFetch(`https://api.music.amazon.dev/v1/catalog/tracks?isrc=${isrc}`,{headers:{Authorization:`Bearer ${token}`,"x-api-key":process.env.AMAZON_MUSIC_API_KEY||""}},8000);
      if(!r.ok)return null; const d=await r.json(); const t=d.tracks?.[0]||d.items?.[0]; return t?toAmazon(t):null;
    }
  } catch { return null; }
  return null;
}

async function fuzzySearch(track, platform, token) {
  const q=`${norm(track.title)} ${norm(track.artist||track.artists?.[0]||"")}`.trim();
  try {
    if (platform==="spotify") {
      const r=await withRetry(()=>timedFetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(`track:${norm(track.title)} artist:${norm(track.artist||"")}`)}&type=track&limit=5&market=US`,{headers:{Authorization:`Bearer ${token}`}},8000));
      if(!r.ok)return []; const d=await r.json(); return (d.tracks?.items||[]).map(toSpotify);
    }
    if (platform==="youtube_music") {
      const params=new URLSearchParams({part:"snippet",q:`${track.title} ${track.artist||""} official audio`,type:"video",videoCategoryId:"10",maxResults:"5"});
      const r=await withRetry(()=>timedFetch(`https://www.googleapis.com/youtube/v3/search?${params}`,{headers:{Authorization:`Bearer ${token}`}},8000));
      if(!r.ok)return []; const d=await r.json();
      return (d.items||[]).filter(i=>i.id?.videoId).map(i=>({ id:i.id.videoId, title:i.snippet?.title||"", artist:i.snippet?.channelTitle||"", artists:[i.snippet?.channelTitle||""], album:"", durationMs:0, isrc:null, uri:`https://www.youtube.com/watch?v=${i.id.videoId}`, coverUrl:i.snippet?.thumbnails?.high?.url||null, platform:"youtube_music" }));
    }
    if (platform==="apple_music") {
      const dev=process.env.APPLE_DEVELOPER_TOKEN; if(!dev)return [];
      const r=await withRetry(()=>timedFetch(`https://api.music.apple.com/v1/catalog/us/search?term=${encodeURIComponent(q)}&types=songs&limit=5`,{headers:{Authorization:`Bearer ${dev}`,"Music-User-Token":token}},8000));
      if(!r.ok)return []; const d=await r.json(); return (d.results?.songs?.data||[]).map(toApple);
    }
    if (platform==="amazon_music") {
      const r=await withRetry(()=>timedFetch(`https://api.music.amazon.dev/v1/catalog/search?type=TRACK&keywords=${encodeURIComponent(q)}&maxResults=5`,{headers:{Authorization:`Bearer ${token}`,"x-api-key":process.env.AMAZON_MUSIC_API_KEY||""}},8000));
      if(!r.ok)return []; const d=await r.json(); return (d.tracks||d.items||[]).map(toAmazon);
    }
    if (platform==="wynk") {
      const r=await withRetry(()=>timedFetch(`https://api-staging.wynk.in/v1/search?q=${encodeURIComponent(q)}&type=song&limit=5`,{headers:{Authorization:`Bearer ${token}`,"X-BSY-UTKN":process.env.WYNK_APP_KEY||"","User-Agent":"WynkMusic/3.28.0.2 (Android)"}},8000));
      if(!r.ok)return []; const d=await r.json(); return (d.songs||d.results||[]).slice(0,5).map(toWynk);
    }
    if (platform==="jiosaavn") {
      const params=new URLSearchParams({__call:"search.getResults",_format:"json",_marker:"0",q,p:"1",n:"5",includeMetaTags:"0"});
      const r=await withRetry(()=>timedFetch(`https://www.jiosaavn.com/api.php?${params}`,{headers:{Cookie:token,"User-Agent":"Mozilla/5.0",Referer:"https://www.jiosaavn.com/"}},8000));
      if(!r.ok)return []; const d=await r.json(); return (d.results||d.songs||[]).slice(0,5).map(toSaavn);
    }
  } catch { return []; }
  return [];
}

// ─── TRACK FETCHERS ───────────────────────────────────────────────────────────
async function spotifyPlaylist(token, id) {
  return paginateSpotify(`https://api.spotify.com/v1/playlists/${encodeURIComponent(id)}/tracks?limit=100&fields=items(added_at,track(id,name,artists,album,duration_ms,external_ids,is_local)),next,total`, token, item=>(!item?.track||item.track.is_local||!item.track.id)?null:toSpotifyFull(item.track,item.added_at));
}
async function spotifyLiked(token) {
  return paginateSpotify(`https://api.spotify.com/v1/me/tracks?limit=50`, token, item=>item?.track?.id?toSpotifyFull(item.track,item.added_at):null);
}
async function paginateSpotify(firstUrl, token, transform) {
  const results=[]; let url=firstUrl;
  while(url&&results.length<MAX_TRACKS) {
    const resp=await withRetry(async()=>{ const r=await timedFetch(url,{headers:{Authorization:`Bearer ${token}`}},12000); if(!r.ok){const e=new Error(`Spotify ${r.status}`);e.status=r.status;if(r.status===401)e.code="token_expired";throw e;} return r; });
    const d=await resp.json();
    for(const item of d.items||[]){const t=transform(item);if(t)results.push(t);}
    url=d.next||null; if(url)await sleep(80);
  }
  return results;
}
function toSpotifyFull(t,addedAt){return{id:t.id,title:t.name,artist:t.artists?.[0]?.name||"Unknown",artists:t.artists?.map(a=>a.name)||[],album:t.album?.name||"",durationMs:t.duration_ms||0,isrc:t.external_ids?.isrc||null,uri:`spotify:track:${t.id}`,addedAt,platform:"spotify"};}

async function youtubePlaylist(token, id, liked) {
  const pid=liked?"LL":id; const results=[]; let pageToken=null;
  do {
    const params=new URLSearchParams({part:"snippet,contentDetails",playlistId:pid,maxResults:"50"});
    if(pageToken)params.set("pageToken",pageToken);
    const resp=await withRetry(async()=>{ const r=await timedFetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`,{headers:{Authorization:`Bearer ${token}`}},10000); if(!r.ok){const e=new Error(`YouTube ${r.status}`);e.status=r.status;throw e;} return r; });
    const d=await resp.json();
    for(const item of d.items||[]){const vid=item.contentDetails?.videoId||item.snippet?.resourceId?.videoId;if(vid&&!["Private video","Deleted video"].includes(item.snippet?.title))results.push({id:vid,title:item.snippet?.title||"Unknown",artist:item.snippet?.videoOwnerChannelTitle||"Unknown",artists:[item.snippet?.videoOwnerChannelTitle||"Unknown"],album:"",durationMs:0,isrc:null,uri:`https://www.youtube.com/watch?v=${vid}`,platform:"youtube_music"});}
    pageToken=d.nextPageToken||null; if(pageToken)await sleep(100);
  } while(pageToken&&results.length<MAX_TRACKS);
  return results;
}

async function applePlaylist(token,id){return paginateApple(token,`/v1/me/library/playlists/${id}/tracks`);}
async function appleLiked(token){return paginateApple(token,`/v1/me/library/songs`);}
async function paginateApple(token,path){
  const dev=process.env.APPLE_DEVELOPER_TOKEN; if(!dev)throw Object.assign(new Error("APPLE_DEVELOPER_TOKEN not set"),{status:500,code:"missing_config"});
  const results=[]; let offset=0;
  while(results.length<MAX_TRACKS){
    const resp=await withRetry(async()=>{ const r=await timedFetch(`https://api.music.apple.com${path}?limit=100&offset=${offset}`,{headers:{Authorization:`Bearer ${dev}`,"Music-User-Token":token}},10000); if(!r.ok){const e=new Error(`Apple ${r.status}`);e.status=r.status;throw e;} return r; });
    const d=await resp.json();
    for(const item of d.data||[]){const a=item.attributes||{};results.push({id:item.id,title:a.name||"Unknown",artist:a.artistName||"Unknown",artists:[a.artistName||"Unknown"],album:a.albumName||"",durationMs:a.durationInMillis||0,isrc:a.isrc||null,uri:a.url||null,platform:"apple_music"});}
    if(!d.next)break; offset+=100; await sleep(100);
  }
  return results;
}

async function amazonPlaylist(token,id){return paginateAmazon(token,`/v1/playlists/${id}/tracks`);}
async function amazonLiked(token){return paginateAmazon(token,`/v1/favorites/tracks`);}
async function paginateAmazon(token,path){
  const apiKey=process.env.AMAZON_MUSIC_API_KEY||""; const results=[]; let start=0;
  while(results.length<MAX_TRACKS){
    const resp=await withRetry(async()=>{ const r=await timedFetch(`https://api.music.amazon.dev${path}?maxResults=50&startIndex=${start}`,{headers:{Authorization:`Bearer ${token}`,"x-api-key":apiKey}},10000); if(!r.ok){const e=new Error(`Amazon ${r.status}`);e.status=r.status;throw e;} return r; });
    const d=await resp.json(); const items=d.tracks||d.items||[];
    for(const t of items){if(t?.id||t?.asin)results.push({id:t.id||t.asin,title:t.title||t.name||"Unknown",artist:t.artist?.name||t.artistName||"Unknown",artists:t.artists?.map(a=>a.name)||[],album:t.album?.title||t.albumName||"",durationMs:(t.durationSeconds||0)*1000,isrc:t.isrc||null,uri:t.id||t.asin,platform:"amazon_music"});}
    if(!d.nextToken&&items.length<50)break; start+=50; await sleep(100);
  }
  return results;
}

async function wynkPlaylist(token,id){return paginateWynk(token,`/v1/playlist/${id}/songs`);}
async function wynkLiked(token){return paginateWynk(token,`/v1/user/favorites`);}
async function paginateWynk(token,path){
  const appKey=process.env.WYNK_APP_KEY||""; const results=[]; let offset=0;
  while(results.length<MAX_TRACKS){
    const resp=await withRetry(async()=>{ const r=await timedFetch(`https://api-staging.wynk.in${path}?limit=50&offset=${offset}`,{headers:{Authorization:`Bearer ${token}`,"X-BSY-UTKN":appKey,"User-Agent":"WynkMusic/3.28.0.2 (Android)"}},10000); if(!r.ok){const e=new Error(`Wynk ${r.status}`);e.status=r.status;throw e;} return r; });
    const d=await resp.json(); const items=d.songs||d.data||d.tracks||[];
    for(const t of items){if(t?.id||t?.songId)results.push({id:t.id||t.songId,title:t.name||t.title||t.songName||"Unknown",artist:t.artistNames||t.primaryArtists||t.artist||"Unknown",artists:t.artists?.map(a=>a.name)||[],album:t.albumName||"",durationMs:(t.duration||t.songDuration||0)*1000,isrc:t.isrc||null,uri:t.id||t.songId,platform:"wynk"});}
    if(!d.hasMore||items.length<50)break; offset+=50; await sleep(120);
  }
  return results;
}

async function saavnPlaylist(token,id){
  const results=[]; let page=1;
  while(results.length<MAX_TRACKS){
    const params=new URLSearchParams({__call:"playlist.getDetails",_format:"json",_marker:"0",listid:id,p:String(page),n:"50",includeMetaTags:"0"});
    const resp=await withRetry(async()=>{ const r=await timedFetch(`https://www.jiosaavn.com/api.php?${params}`,{headers:{Cookie:token,"User-Agent":"Mozilla/5.0",Referer:"https://www.jiosaavn.com/"}},10000); if(!r.ok){const e=new Error(`JioSaavn ${r.status}`);e.status=r.status;throw e;} return r; });
    const d=await resp.json(); const songs=d.songs||d.list||[];
    if(!songs.length)break;
    for(const s of songs)if(s?.id)results.push(toSaavnFull(s));
    if(songs.length<50)break; page++; await sleep(120);
  }
  return results;
}
async function saavnLiked(token){
  const params=new URLSearchParams({__call:"user.getFavorites",_format:"json",type:"songs"});
  const resp=await withRetry(async()=>{ const r=await timedFetch(`https://www.jiosaavn.com/api.php?${params}`,{headers:{Cookie:token,"User-Agent":"Mozilla/5.0",Referer:"https://www.jiosaavn.com/"}},10000); if(!r.ok){const e=new Error(`JioSaavn ${r.status}`);e.status=r.status;throw e;} return r; });
  const d=await resp.json(); return (d.songs||d||[]).filter(s=>s?.id).map(toSaavnFull);
}
function toSaavnFull(s){return{id:s.id,title:s.song||s.title||"Unknown",artist:s.primary_artists||s.singers||s.artist||"Unknown",artists:[s.primary_artists||s.singers||"Unknown"],album:s.album||"",durationMs:parseInt(s.duration||"0")*1000,isrc:null,uri:s.perma_url||s.id,platform:"jiosaavn"};}

// ─── CANDIDATE NORMALIZERS (for match results) ───────────────────────────────
function toSpotify(t){return{id:t.id,title:t.name,artist:t.artists?.[0]?.name||"",artists:t.artists?.map(a=>a.name)||[],album:t.album?.name||"",durationMs:t.duration_ms||0,isrc:t.external_ids?.isrc||null,uri:t.uri,coverUrl:t.album?.images?.[0]?.url||null,platform:"spotify"};}
function toApple(t){const a=t.attributes||{};return{id:t.id,title:a.name||"",artist:a.artistName||"",artists:[a.artistName||""],album:a.albumName||"",durationMs:a.durationInMillis||0,isrc:a.isrc||null,uri:a.url||null,coverUrl:a.artwork?.url?.replace("{w}","80").replace("{h}","80")||null,platform:"apple_music"};}
function toAmazon(t){return{id:t.id||t.asin,title:t.title||t.name||"",artist:t.artist?.name||t.artistName||"",artists:t.artists?.map(a=>a.name)||[],album:t.album?.title||"",durationMs:(t.durationSeconds||0)*1000,isrc:t.isrc||null,uri:t.id||t.asin,platform:"amazon_music"};}
function toWynk(t){return{id:t.id||t.songId,title:t.name||t.title||t.songName||"",artist:t.artistNames||t.primaryArtists||"",artists:[t.artistNames||""],album:t.albumName||"",durationMs:(t.duration||0)*1000,isrc:null,uri:t.id||t.songId,platform:"wynk"};}
function toSaavn(s){return{id:s.id,title:s.song||s.title||"",artist:s.primary_artists||s.singers||"",artists:[s.primary_artists||""],album:s.album||"",durationMs:parseInt(s.duration||"0")*1000,isrc:null,uri:s.perma_url||s.id,platform:"jiosaavn"};}
