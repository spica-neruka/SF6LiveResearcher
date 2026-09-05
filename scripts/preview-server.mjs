import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = Number(process.env.PREVIEW_PORT || 4173);

const allowedFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/js/app.js', ['js/app.js', 'text/javascript; charset=utf-8']],
  ['/js/character-images.js', ['js/character-images.js', 'text/javascript; charset=utf-8']],
  ['/js/streamers-page.js', ['js/streamers-page.js', 'text/javascript; charset=utf-8']],
  ['/js/streamer-category-filter.js', ['js/streamer-category-filter.js', 'text/javascript; charset=utf-8']],
  ['/js/zapping-player.js', ['js/zapping-player.js', 'text/javascript; charset=utf-8']],
  ['/css/style.css', ['css/style.css', 'text/css; charset=utf-8']],
  ['/css/character-assets.css', ['css/character-assets.css', 'text/css; charset=utf-8']],
  ['/css/favorites.css', ['css/favorites.css', 'text/css; charset=utf-8']],
  ['/css/interface.css', ['css/interface.css', 'text/css; charset=utf-8']],
  ['/css/redesign.css', ['css/redesign.css', 'text/css; charset=utf-8']],
  ['/css/responsive.css', ['css/responsive.css', 'text/css; charset=utf-8']],
  ['/css/zapping.css', ['css/zapping.css', 'text/css; charset=utf-8']],
]);

const sampleArt = character => `/preview-art.svg?character=${encodeURIComponent(character)}`;
const live = [
  ['preview-live-ryu', 'preview-channel-dojo', '道場ライブ：リュウでランクマッチ', '蒼い道場', 'リュウ', 'ranked', 1280],
  ['preview-live-juri', 'preview-channel-lab', 'ジュリ研究所｜マスター到達まで', 'ジュリ研究所', 'ジュリ', 'training', 842],
  ['preview-live-ken', 'preview-channel-night', '夜の対戦会：ケンで参加型', '夜ふかしファイターズ', 'ケン', 'custom', 516],
  ['preview-live-chunli', 'preview-channel-news', '春麗のコンボ確認と雑談', 'ファイターズ通信', '春麗', 'casual', 304],
  ['preview-live-guile', 'preview-channel-lab', 'ガイル使いのランクマ配信', 'ジュリ研究所', 'ガイル', 'ranked', 219],
  ['preview-live-cammy', 'preview-channel-dojo', 'キャミィでスト6基礎練習', '蒼い道場', 'キャミィ', 'training', 177],
  ['preview-live-marisa', 'preview-channel-arena', 'マリーザで大会対策', 'アリーナ配信部', 'マリーザ', 'tournament', 96],
  ['preview-live-luke', 'preview-channel-arena', 'ルークのモダン操作を試す', 'アリーナ配信部', 'ルーク', 'casual', 74],
].map(([video_id, channel_id, title, channel_title, character, category, concurrent_viewers], index) => ({
  video_id, channel_id, channel_title, sf6_player_name: channel_title, title, main_characters: [character], category,
  status: 'live', concurrent_viewers, actual_start_time: new Date(Date.now() - (index + 1) * 11 * 60_000).toISOString(), thumbnail_url: sampleArt(character),
}));

const upcoming = [
  ['preview-upcoming-tournament', 'preview-channel-arena', '週末トーナメント予選', 'アリーナ配信部', '大会', '2026-09-05T12:00:00Z'],
  ['preview-upcoming-akuma', 'preview-channel-dojo', '豪鬼で挑戦：夜のランクマ', '蒼い道場', '豪鬼', '2026-09-05T15:30:00Z'],
  ['preview-upcoming-chunli', 'preview-channel-news', '春麗使いの交流会', 'ファイターズ通信', '春麗', '2026-09-06T10:00:00Z'],
].map(([video_id, channel_id, title, channel_title, character, scheduled_start_time]) => ({
  video_id, channel_id, channel_title, sf6_player_name: channel_title, title, main_characters: [character], category: 'custom', status: 'upcoming',
  scheduled_start_time, thumbnail_url: sampleArt(character),
}));

const streamers = [
  ['preview-channel-dojo', '蒼い道場', 'リュウ', 'pro_gamer', 'independent', 18200],
  ['preview-channel-lab', 'ジュリ研究所', 'ジュリ', 'game_streamer', 'independent', 9600],
  ['preview-channel-night', '夜ふかしファイターズ', 'ケン', 'vtuber', 'corporate', 7400],
  ['preview-channel-news', 'ファイターズ通信', '春麗', 'media', 'corporate', 32100],
  ['preview-channel-arena', 'アリーナ配信部', 'マリーザ', 'event', 'team_org', 12800],
  ['preview-channel-offline', '週末ゲーム部', 'キャミィ', 'game_streamer', 'independent', 1100],
].map(([channel_id, channel_title, sf6_player_name, streamer_category, affiliation_type, subscriber_count]) => ({
  channel_id, channel_title, sf6_player_name, streamer_category, affiliation_type, subscriber_count, channel_thumbnail_url: sampleArt(sf6_player_name),
}));

const favorites = [
  { channelId: 'preview-channel-dojo', name: '蒼い道場', status: 'live', videoId: 'preview-live-ryu', thumbnailUrl: sampleArt('リュウ'), subscriberCount: 18200, streamerCategory: 'pro_gamer' },
  { channelId: 'preview-channel-arena', name: 'アリーナ配信部', status: 'upcoming', videoId: 'preview-upcoming-tournament', scheduledStartTime: '2026-09-05T12:00:00Z', thumbnailUrl: sampleArt('大会'), subscriberCount: 12800, streamerCategory: 'event' },
  { channelId: 'preview-channel-offline', name: '週末ゲーム部', status: 'offline', thumbnailUrl: sampleArt('キャミィ'), subscriberCount: 1100, streamerCategory: 'game_streamer' },
];

const previewPlayerScript = String.raw`<script>
window.SF6_API_BASE = location.origin;
window.YT = { Player: class PreviewPlayer {
  constructor(id, options) {
    this.options = options; this.videoId = options.videoId; this.muted = false; this.volume = 82; this.destroyed = false;
    this.iframe = document.createElement('iframe');
    this.iframe.title = 'サンプル配信プレイヤー'; this.iframe.setAttribute('allowfullscreen', '');
    this.iframe.style.cssText = 'width:100%;height:100%;border:0;background:#101827;';
    document.getElementById(id).replaceWith(this.iframe); this.render();
    queueMicrotask(() => options.events?.onReady?.({ target: this }));
  }
  render() { this.iframe.srcdoc = '<!doctype html><html lang="ja"><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,#17243a,#3a244e);color:#f5f7fb;font:600 18px system-ui,sans-serif;text-align:center"><main><div style="font-size:38px;margin-bottom:12px">▶</div><div>サンプル配信</div><small style="display:block;margin-top:8px;color:#b9c5d8">視聴操作のプレビュー</small></main></body></html>'; }
  getIframe() { return this.iframe; }
  loadVideoById(id) { this.videoId = id; this.render(); this.options.events?.onStateChange?.({ target: this, data: 2 }); }
  pauseVideo() { this.options.events?.onStateChange?.({ target: this, data: 2 }); }
  playVideo() { this.options.events?.onStateChange?.({ target: this, data: 1 }); }
  isMuted() { return this.muted; } mute() { this.muted = true; } unMute() { this.muted = false; }
  getVolume() { return this.volume; } setVolume(value) { this.volume = value; }
  destroy() { this.destroyed = true; this.iframe.remove(); }
} };
</script>`;

function json(res, value) {
  const body = JSON.stringify(value);
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(body);
}

function withPreviewInjection(html) {
  const label = '<div style="position:fixed;z-index:2147483647;bottom:74px;left:10px;padding:5px 9px;border:1px solid #b9c5d8;border-radius:999px;background:rgba(16,24,39,.9);color:#dfe7f3;font:600 11px/1.2 system-ui,sans-serif;letter-spacing:.02em;pointer-events:none">試作プレビュー・サンプル配信</div>';
  return html.replace('</head>', `${previewPlayerScript}<style>body{padding-top:0}</style></head>`).replace('<body>', `<body>${label}`);
}

function sampleArtwork(url) {
  const character = url.searchParams.get('character') || 'SF6';
  const safeCharacter = character.replace(/[<&>"']/g, '').slice(0, 24) || 'SF6';
  const hue = [...safeCharacter].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="hsl(${hue} 48% 22%)"/><stop offset="1" stop-color="hsl(${(hue + 55) % 360} 55% 38%)"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><circle cx="530" cy="70" r="150" fill="rgba(255,255,255,.08)"/><text x="42" y="92" fill="#dce8f7" font-family="system-ui,sans-serif" font-size="20" font-weight="700" letter-spacing="3">SF6 LIVE · SAMPLE</text><text x="42" y="220" fill="#fff" font-family="system-ui,sans-serif" font-size="58" font-weight="800">${safeCharacter}</text><text x="44" y="264" fill="#dce8f7" font-family="system-ui,sans-serif" font-size="18">試作プレビュー用サンプル配信</text></svg>`;
  return svg;
}

function safeFile(pathname) {
  if (pathname.includes('\\') || pathname.includes('/.') || pathname.includes('\0')) return null;
  return allowedFiles.get(pathname) || null;
}

async function handle(req, res) {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { allow: 'GET, HEAD' }); return res.end(); }
  let url;
  try { url = new URL(req.url, `http://${host}:${port}`); } catch { res.writeHead(400); return res.end('Bad request'); }
  if (url.pathname === '/api/videos') {
    const items = url.searchParams.get('status') === 'upcoming' ? upcoming : live;
    return json(res, { items, total: items.length, hasNextPage: false, nextCursor: null });
  }
  if (url.pathname === '/api/streamers') {
    const category = url.searchParams.get('category');
    const affiliation = url.searchParams.get('affiliation_type');
    const items = streamers.filter(item => (!category || item.streamer_category === category) && (!affiliation || item.affiliation_type === affiliation));
    return json(res, { items, total: items.length, hasNextPage: false, nextCursor: null });
  }
  if (url.pathname === '/api/favorites') {
    const ids = new Set((url.searchParams.get('ids') || '').split(',').filter(Boolean));
    return json(res, favorites.filter(item => ids.has(item.channelId)));
  }
  if (url.pathname === '/preview-art.svg') {
    const body = sampleArtwork(url);
    res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  const file = safeFile(url.pathname);
  if (!file) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
  const [relative, type] = file;
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${root}${path.sep}`) && absolute !== root) { res.writeHead(404); return res.end(); }
  try {
    await stat(absolute);
    let body;
    if (relative === 'index.html') body = withPreviewInjection(await readFile(absolute, 'utf8'));
    if (body === undefined && req.method === 'GET') return res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }) && res.end(await readFile(absolute));
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
}

const server = http.createServer((req, res) => { void handle(req, res); });
server.listen(port, host, () => console.log(`SF6 LIVE preview: http://${host}:${port}/`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
