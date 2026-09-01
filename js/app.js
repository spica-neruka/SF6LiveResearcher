const API_BASE = window.SF6_API_BASE || 'https://sf6-live-researcher.u-ambers.workers.dev';

// Official SF6 character asset slugs used by the local assets downloaded by GitHub Actions.
const CHARACTER_ROSTER = [
  ['リュウ','ryu'],['ルーク','luke'],['ジェイミー','jamie'],['春麗','chunli'],['ガイル','guile'],
  ['キンバリー','kimberly'],['ジュリ','juri'],['ケン','ken'],['ブランカ','blanka'],['ダルシム','dhalsim'],
  ['エドモンド本田','honda'],['ザンギエフ','zangief'],['キャミィ','cammy'],['マノン','manon'],['マリーザ','marisa'],
  ['リリー','lily'],['JP','jp'],['ディージェイ','deejay'],['ラシード','rashid'],['A.K.I.','aki'],['ED','ed'],
  ['豪鬼','gouki'],['テリー','terry'],['舞','mai'],['ベガ','vega'],['エレナ','elena'],['サガット','sagat'],
  ['C.ヴァイパー','cviper'],['アレックス','alex'],['イングリッド','ingrid'],['ヤスミン','yasmine']
].map(([name, slug]) => ({
  name,
  id: slug,
  image: `./assets/characters/character_${slug}_l.png`
}));

const state = {
  data: { characters: CHARACTER_ROSTER, streams: [], upcoming: [] },
  view: 'home', query: '', charFilter: 'all',
  favorites: JSON.parse(localStorage.getItem('sf6-live-favorites') || '[]')
};
const $ = (s) => document.querySelector(s);
const escapeHtml = (v) => String(v ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
const chars = () => state.data.characters;
const charByName = name => chars().find(c => c.name === name) || null;
const streams = () => state.data.streams;
const isFav = id => state.favorites.includes(id);
function saveFavs(){ localStorage.setItem('sf6-live-favorites', JSON.stringify(state.favorites)); }
function toggleFav(id){ state.favorites = isFav(id) ? state.favorites.filter(x=>x!==id) : [...state.favorites,id]; saveFavs(); render(); }
function nav(view){ state.view=view; state.charFilter='all'; document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===view)); render(); }
function filteredUpcoming(){
  return state.data.upcoming.filter(s =>
    (!state.charFilter || state.charFilter === 'all' || s.characterNames.some(n => characterSlug(n) === state.charFilter)) &&
    (!state.query || `${s.streamer} ${s.title} ${s.characterNames.join(' ')}`.toLowerCase().includes(state.query.toLowerCase()))
  );
}
function characterSlug(name){ return charByName(name)?.id || normalizeCharacter(name); }
function normalizeCharacter(name){ return String(name || 'unknown').trim().normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-') || 'unknown'; }
function parseCharacterNames(value){
  const values=Array.isArray(value)?value:String(value ?? '').split(',');
  const names=[...new Set(values.map(name=>String(name ?? '').trim()).filter(Boolean))];
  return names.length?names:['unknown'];
}
function formatJst(value, fallback='--'){ const d=new Date(value); if(Number.isNaN(d.getTime())) return fallback; return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(d); }
function formatTime(value, fallback='--:--'){ const d=new Date(value); if(Number.isNaN(d.getTime())) return fallback; return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hour12:false}).format(d); }
function getCharacterImage(names){ const c=names.map(charByName).find(Boolean); return c?.image || ''; }
function charImageStyle(names){ const image=getCharacterImage(names); return image ? `background-image:linear-gradient(180deg,rgba(8,10,15,.05),rgba(8,10,15,.86)),url('${image}')` : ''; }

// Channel icons are supplied by the Worker from D1's channel_thumbnail_url.
// No external avatar service or channel-id fallback is used.
function channelIconHtml(thumbnailUrl,name){
  if(!thumbnailUrl) return '';
  return `<img class="channel-icon" src="${escapeHtml(thumbnailUrl)}" alt="${escapeHtml(name)} のYouTubeチャンネルアイコン" loading="lazy" referrerpolicy="no-referrer">`;
}

function liveCard(s){
  const names=s.characterNames.join(' / ');
  return `<article class="stream-card" data-open="${s.id}"><div class="thumb" style="background-image:linear-gradient(135deg,rgba(20,24,31,.25),rgba(17,21,27,.72)),url('${escapeHtml(s.thumbnail)}');background-size:cover;background-position:center"><span class="live-pill">● LIVE</span><span class="char-badge">${escapeHtml(names)}</span></div><div class="card-body"><div class="streamer-row"><span class="streamer-name">${escapeHtml(s.streamer)}</span><button class="favorite ${isFav(s.streamerId)?'on':''}" data-fav="${s.streamerId}" aria-label="お気に入り">${isFav(s.streamerId)?'♥':'♡'}</button></div><div class="meta"><span>◉ ${escapeHtml(names)}</span>${s.viewers != null ? `<span>👁 ${Number(s.viewers).toLocaleString()}</span>` : ''}</div></div></article>`;
}
function upcomingCard(s){
  const names=s.characterNames.join(' / ');
  return `<article class="upcoming-card" data-open="${s.id}"><div class="upcoming-thumb" style="background-image:${s.thumbnail ? `linear-gradient(135deg,rgba(20,24,31,.12),rgba(17,21,27,.78)),url('${escapeHtml(s.thumbnail)}')` : 'linear-gradient(135deg,#252b35,#11151b)'};background-size:cover;background-position:center"><span class="upcoming-time">${escapeHtml(formatJst(s.scheduledStart))}</span></div><div class="upcoming-body"><div class="streamer-row"><strong>${escapeHtml(s.streamer)}</strong><button class="favorite ${isFav(s.streamerId)?'on':''}" data-fav="${s.streamerId}">${isFav(s.streamerId)?'♥':'♡'}</button></div><p>${escapeHtml(s.title)}</p><div class="meta"><span>◉ ${escapeHtml(names)}</span><span>YouTube</span></div></div></article>`;
}
function home(){
  const live=streams().filter(s=>s.status==='live')
    .filter(s=>!state.charFilter || state.charFilter==='all' || s.characterNames.some(n=>characterSlug(n)===state.charFilter))
    .filter(s=>!state.query || `${s.streamer} ${s.title} ${s.characterNames.join(' ')}`.toLowerCase().includes(state.query.toLowerCase()));
  const upcoming=filteredUpcoming().slice(0,6);
  const selectedCharacter=state.charFilter!=='all' ? charByName(state.charFilter) : null;
  return `<section class="section"><div class="section-head"><div><h2>🔴 NOW LIVE</h2><p>${selectedCharacter ? `${escapeHtml(selectedCharacter.name)} の現在LIVE中の配信` : 'いま見られるスト6配信'}</p></div>${selectedCharacter ? '<button class="section-link" data-clear-char>すべてのLIVE →</button>' : '<button class="section-link" data-go="upcoming">配信予定 →</button>'}</div>${selectedCharacter ? `<div class="filter-row"><button class="chip active" data-clear-char>◉ ${escapeHtml(selectedCharacter.name)}</button></div>` : ''}<div class="live-grid">${live.length?live.map(liveCard).join(''):'<div class="empty">現在LIVE中の配信はありません。</div>'}</div></section><section class="section"><div class="section-head"><div><h2>UPCOMING</h2><p>これから始まる配信</p></div><button class="section-link" data-go="upcoming">すべて見る →</button></div><div class="upcoming-grid">${upcoming.length?upcoming.map(upcomingCard).join(''):'<div class="empty">現在、配信予定はありません。</div>'}</div></section>`;
}
function upcomingPage(){
  const items=filteredUpcoming();
  return `<section class="section"><div class="section-head"><div><h2>配信予定</h2><p>YouTubeで公開予定になっているSF6 LIVE</p></div><span class="result-count">${items.length} streams</span></div><div class="filter-row"><button class="chip ${state.charFilter==='all'?'active':''}" data-upcoming-char="all">すべて</button>${chars().map(c=>`<button class="chip ${state.charFilter===c.id?'active':''}" data-upcoming-char="${c.id}">${escapeHtml(c.name)}</button>`).join('')}</div><div class="upcoming-grid">${items.length?items.map(upcomingCard).join(''):'<div class="empty">該当する配信予定はありません。</div>'}</div></section>`;
}
function streamersPage(){
  const names=[...new Map([...streams(),...state.data.upcoming].map(s=>[s.streamerId,{id:s.streamerId,name:s.streamer,channelThumbnailUrl:s.channelThumbnailUrl,characterNames:s.characterNames,lp:s.lp,mr:s.mr}])).values()];
  return `<section class="section"><div class="section-head"><div><h2>配信者</h2><p>Cloudflare D1に登録されている配信者情報</p></div></div><div class="streamer-grid">${names.map(x=>`<article class="streamer-card"><div class="character-art channel-art">${channelIconHtml(x.channelThumbnailUrl,x.name)}</div><div class="streamer-row"><strong>${escapeHtml(x.name)}</strong><button class="favorite ${isFav(x.id)?'on':''}" data-fav="${x.id}">${isFav(x.id)?'♥':'♡'}</button></div><small>${x.lp != null ? `LP ${escapeHtml(x.lp)}` : ''}${x.mr != null ? ` · MR ${escapeHtml(x.mr)}` : ''}</small></article>`).join('')}</div></section>`;
}
function charactersPage(){
  return `<section class="section"><div class="section-head"><div><h2>キャラクター</h2><p>現在実装されているファイターの公式アート</p></div></div><div class="character-grid">${chars().map(c=>{const count=[...streams(),...state.data.upcoming].filter(s=>s.characterNames.some(n=>characterSlug(n)===c.id)).length;return `<article class="character-card" data-character="${c.id}"><div class="character-art image-art" style="background-image:linear-gradient(180deg,rgba(8,10,15,.02),rgba(8,10,15,.84)),url('${c.image}')"></div><strong>${escapeHtml(c.name)}</strong><small>${count} streams</small></article>`}).join('')}</div></section>`;
}
function favoritesPage(){
  const fav=[...streams(),...state.data.upcoming].filter(s=>isFav(s.streamerId));
  return `<section class="section"><div class="section-head"><div><h2>お気に入り</h2><p>このブラウザだけに保存されます。アカウントは不要です。</p></div></div>${fav.length?`<div class="upcoming-grid">${fav.map(s=>s.status==='upcoming'?upcomingCard(s):liveCard(s)).join('')}</div>`:'<div class="empty">お気に入りの配信者はありません。</div>'}</section>`;
}
function simplePage(title,body){ return `<section class="section"><div class="page-card"><h2>${title}</h2>${body}</div></section>`; }
function render(){
  const app=$('#app');
  const titles={home:'ホーム',upcoming:'配信予定',streamers:'配信者',characters:'キャラクター',favorites:'お気に入り',notice:'お知らせ',settings:'設定',help:'使い方'};
  $('#page-title').textContent=titles[state.view];
  if(state.view==='home') app.innerHTML=home();
  else if(state.view==='upcoming') app.innerHTML=upcomingPage();
  else if(state.view==='streamers') app.innerHTML=streamersPage();
  else if(state.view==='characters') app.innerHTML=charactersPage();
  else if(state.view==='favorites') app.innerHTML=favoritesPage();
  else if(state.view==='notice') app.innerHTML=simplePage('お知らせ','<div class="notice">Cloudflare D1 APIと接続しています。<span>実データ</span></div>');
  else if(state.view==='settings') app.innerHTML=simplePage('設定','<p>API：<strong>Cloudflare Worker / D1</strong></p><p>お気に入りは localStorage に保存されています。</p><button class="chip" id="clear-favs">お気に入りをすべて削除</button>');
  else app.innerHTML=simplePage('使い方','<p><strong>NOW LIVE</strong> から現在LIVE中の配信を探せます。</p><p><strong>配信予定</strong> ではYouTubeのupcoming配信を開始時刻順に表示します。</p><p><strong>キャラクター</strong> では公式キャラクターアートから配信を探せます。</p>');
  bind();
}
function bind(){
  document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>nav(b.dataset.go));
  document.querySelectorAll('[data-upcoming-char]').forEach(b=>b.onclick=()=>{state.charFilter=b.dataset.upcomingChar; state.view='upcoming'; document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view==='upcoming')); render();});
  document.querySelectorAll('[data-clear-char]').forEach(b=>b.onclick=()=>{state.charFilter='all'; state.view='home'; document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view==='home')); render();});
  document.querySelectorAll('[data-fav]').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleFav(b.dataset.fav)});
  document.querySelectorAll('[data-open]').forEach(card=>card.onclick=()=>openStream(card.dataset.open));
  const clear=$('#clear-favs'); if(clear) clear.onclick=()=>{state.favorites=[];saveFavs();render();};
  document.querySelectorAll('.character-card').forEach(card=>card.onclick=()=>{state.charFilter=card.dataset.character; state.view='home'; document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view==='home')); render();});
}
function openStream(id){ const all=[...streams(),...state.data.upcoming]; const s=all.find(x=>x.id===id); if(s) window.open(s.youtubeUrl,'_blank','noopener'); }
function mapVideo(v){
  const characterNames=parseCharacterNames(v.main_characters ?? v.main_character);
  return {
    id:v.video_id, streamerId:v.channel_id, characterNames, streamer:v.sf6_player_name || v.channel_title || v.channel_id,
    channelThumbnailUrl:v.channel_thumbnail_url || '',
    status:v.status, viewers:v.concurrent_viewers, title:v.title || '', youtubeUrl:`https://www.youtube.com/watch?v=${v.video_id}`,
    thumbnail:v.thumbnail_url || `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg`, lp:v.lp, mr:v.mr,
    scheduledStart:v.scheduled_start_time, actualStart:v.actual_start_time, actualEnd:v.actual_end_time
  };
}
async function fetchVideos(status, limit=200){
  const response=await fetch(`${API_BASE}/api/videos?status=${status}&limit=${limit}`,{headers:{accept:'application/json'},cache:'no-store'});
  if(!response.ok) throw new Error(`API ${response.status}`); return response.json();
}
async function loadApiData(){
  const [allPayload, upcomingPayload]=await Promise.all([fetchVideos('all'),fetchVideos('upcoming')]);
  state.data.streams=(allPayload.items||[]).map(mapVideo).filter(v=>v.status==='live');
  state.data.upcoming=(upcomingPayload.items||[]).map(mapVideo).filter(v=>v.status==='upcoming');
}

document.querySelectorAll('.nav-item').forEach(n=>n.onclick=()=>nav(n.dataset.view));
$('#search-input').addEventListener('input',e=>{state.query=e.target.value;render();});
loadApiData().then(render).catch(error=>{console.error(error);$('#app').innerHTML=`<div class="empty">APIデータの読み込みに失敗しました。<br><small>${escapeHtml(error.message)}</small></div>`;});
