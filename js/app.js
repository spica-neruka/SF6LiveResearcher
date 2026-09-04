const API_BASE = window.SF6_API_BASE || 'https://sf6-live-researcher.u-ambers.workers.dev';
const FAVORITES_KEY = 'sf6-live-favorites';
const CHARACTERS = [
  ['リュウ', 'ryu'], ['ルーク', 'luke'], ['ジェイミー', 'jamie'], ['春麗', 'chunli'],
  ['ガイル', 'guile'], ['キンバリー', 'kimberly'], ['ジュリ', 'juri'], ['ケン', 'ken'],
  ['ブランカ', 'blanka'], ['ダルシム', 'dhalsim'], ['エドモンド本田', 'honda'],
  ['ザンギエフ', 'zangief'], ['キャミィ', 'cammy'], ['マノン', 'manon'], ['マリーザ', 'marisa'],
  ['リリー', 'lily'], ['JP', 'jp'], ['ディージェイ', 'deejay'], ['ラシード', 'rashid'],
  ['A.K.I.', 'aki'], ['ED', 'ed'], ['豪鬼', 'gouki'], ['テリー', 'terry'], ['舞', 'mai'],
  ['ベガ', 'vega'], ['エレナ', 'elena'], ['サガット', 'sagat'], ['C.ヴァイパー', 'cviper'],
  ['アレックス', 'alex'], ['イングリッド', 'ingrid'], ['ヤスミン', 'yasmine'],
].map(([name, id]) => ({ name, id }));
const LIVE_CATEGORIES = { ranked: 'ランクマッチ', custom: '参加型', tournament: '大会', casual: 'カジュアル', training: 'トレーニング', avatar_battle: 'アバターバトル', other: 'その他' };
const CATEGORIES = { pro_gamer: 'プロゲーマー', vtuber: 'VTuber', game_streamer: 'ゲーム配信者', official: '公式', team_org: 'チーム・団体', event: 'イベント', media: 'メディア' };
const TITLES = { home: '配信中', upcoming: '配信予定', streamers: '配信者', characters: 'キャラクター', favorites: 'お気に入り', explore: '探す', notice: 'お知らせ', settings: '設定', help: '使い方' };
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().trim();
const characterId = name => CHARACTERS.find(c => normalize(c.name) === normalize(name))?.id || normalize(name);
const resource = () => ({ items: [], loaded: false, busy: false, error: '', fetchedAt: null, cursor: null, hasNext: false, offset: 0, token: 0, controller: null, append: false });
const state = {
  view: 'home', queries: {}, character: 'all', category: 'all', sort: 'viewers',
  streamerCategory: 'all', affiliation: 'all', favoriteIds: readFavorites(),
  live: resource(), upcoming: resource(), streamers: resource(), favorites: resource(),
};
let searchTimer;

function readFavorites() {
  try {
    const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && id.trim()))] : [];
  } catch { return []; }
}
function announce(message) { $('#app-status').textContent = message; }
function formatDate(value) {
  if (!value) return '日時未定';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '日時未定' : new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}
function timeValue(value, fallback = 0) { const n = Date.parse(value); return Number.isNaN(n) ? fallback : n; }
function safeImage(value) {
  if (!value) return '';
  try { const url = new URL(value, location.href); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
function mapVideo(v) {
  const raw = v.main_characters ?? v.main_character ?? [];
  return {
    id: v.video_id, channelId: v.channel_id, name: v.sf6_player_name || v.channel_title || v.channel_id,
    title: v.title || 'タイトル未取得', status: v.status, category: v.category || 'other', viewers: v.concurrent_viewers,
    characters: [...new Set((Array.isArray(raw) ? raw : String(raw).split(',')).map(n => String(n).trim()).filter(n => n && normalize(n) !== 'unknown'))],
    image: safeImage(v.thumbnail_url || `https://i.ytimg.com/vi/${encodeURIComponent(v.video_id)}/hqdefault.jpg`),
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(v.video_id)}`,
    scheduled: v.scheduled_start_time, started: v.actual_start_time, discovered: v.discovered_at,
  };
}
function mapStreamer(s) {
  return {
    id: s.channel_id, name: s.sf6_player_name || s.channel_title || s.channel_id,
    image: safeImage(s.channel_thumbnail_url), subscribers: s.subscriber_count,
    category: s.streamer_category, affiliation: s.affiliation_type, organization: s.organization,
    tags: Array.isArray(s.streamer_tags) ? s.streamer_tags : [], lp: s.lp, mr: s.mr,
  };
}
function mapFavorite(item) {
  return {
    id: item.channelId, name: item.name || item.channelId, image: safeImage(item.thumbnailUrl),
    subscribers: item.subscriberCount, category: item.streamerCategory,
    status: ['live', 'upcoming', 'offline'].includes(item.status) ? item.status : 'unknown',
    videoId: item.videoId, scheduled: item.scheduledStartTime,
  };
}
async function getJson(pathname, params, signal) {
  // Normal caching is intentional. Refresh never forces YouTube collection.
  const response = await fetch(`${API_BASE}${pathname}?${params}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function favoriteProfiles(ids, signal) {
  const items = [];
  for (let index = 0; index < ids.length; index += 50) {
    const payload = await getJson('/api/favorites', new URLSearchParams({ ids: ids.slice(index, index + 50).join(',') }), signal);
    if (!Array.isArray(payload)) throw new Error('Unexpected favorites response');
    items.push(...payload.map(mapFavorite));
  }
  return items;
}
function cancelRequest(key) {
  const data = state[key];
  data.controller?.abort();
  data.token += 1;
  data.busy = false;
}
async function load(key, { append = false, clear = false } = {}) {
  const data = state[key];
  if (append && (data.busy || !data.hasNext)) return;
  cancelRequest(key);
  const token = data.token;
  const controller = new AbortController();
  data.controller = controller;
  if (clear) Object.assign(data, { items: [], loaded: false, fetchedAt: null, cursor: null, hasNext: false, offset: 0 });
  data.busy = true;
  data.error = '';
  data.append = append;
  render();
  try {
    let payload;
    let items;
    if (key === 'favorites') {
      items = await favoriteProfiles([...state.favoriteIds], controller.signal);
      payload = { items, hasNextPage: false };
    } else {
      const params = new URLSearchParams({ limit: key === 'streamers' ? '24' : '200' });
      if (append) {
        if (data.cursor) params.set('cursor', data.cursor);
        else params.set('offset', String(data.offset));
      }
      if (key === 'streamers') {
        params.set('sort', 'subscribers_desc');
        if (state.streamerCategory !== 'all') params.set('category', state.streamerCategory);
        if (state.affiliation !== 'all') params.set('affiliation_type', state.affiliation);
        if ((state.queries.streamers || '').trim()) params.set('q', state.queries.streamers.trim());
      } else {
        params.set('status', key === 'live' ? 'live' : 'upcoming');
        params.set('sort', key === 'live' ? state.sort : 'scheduled');
      }
      payload = await getJson(key === 'streamers' ? '/api/streamers' : '/api/videos', params, controller.signal);
      if (!Array.isArray(payload.items)) throw new Error('Unexpected list response');
      items = payload.items.map(key === 'streamers' ? mapStreamer : mapVideo);
      if (key === 'streamers' && items.length) {
        // Status lookup covers this page, even when its live video is not loaded.
        try {
          const profiles = new Map((await favoriteProfiles(items.map(item => item.id), controller.signal)).map(item => [item.id, item]));
          items = items.map(item => ({ ...item, ...(profiles.has(item.id) ? {
            status: profiles.get(item.id).status, videoId: profiles.get(item.id).videoId, scheduled: profiles.get(item.id).scheduled,
          } : { status: 'unknown' }) }));
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          items = items.map(item => ({ ...item, status: 'unknown' }));
        }
      }
    }
    if (data.token !== token) return;
    const combined = append ? [...data.items, ...items] : items;
    data.items = [...new Map(combined.map(item => [item.id, item])).values()];
    data.offset = (append ? data.offset : 0) + payload.items.length;
    data.cursor = payload.nextCursor || null;
    data.hasNext = Boolean(payload.hasNextPage) && payload.items.length > 0;
    data.loaded = true;
    data.fetchedAt = Date.now();
    announce(`${key === 'streamers' ? '配信者' : key === 'favorites' ? 'お気に入り' : '配信情報'}を取得しました。`);
  } catch (error) {
    if (data.token !== token || error.name === 'AbortError') return;
    data.error = '情報の取得に失敗しました。時間をおいて再試行してください。';
    announce(data.error);
  } finally {
    if (data.token === token) { data.busy = false; render(); }
  }
}
function ensure(key) { if (!state[key].loaded && !state[key].busy && !state[key].error) void load(key); }
function query(view = state.view) { return normalize(state.queries[view] || ''); }
function matches(item) { return !query() || normalize(`${item.name || ''} ${item.title || ''} ${(item.characters || []).join(' ')}`).includes(query()); }
function matchesCharacter(item, id = state.character) { return id === 'all' || item.characters.some(name => characterId(name) === id); }
function filteredVideos(key) {
  return state[key].items.filter(item => matches(item) && matchesCharacter(item) && (key !== 'live' || state.category === 'all' || item.category === state.category))
    .sort((a, b) => key === 'upcoming' ? timeValue(a.scheduled, Infinity) - timeValue(b.scheduled, Infinity)
      : state.sort === 'newest' ? timeValue(b.discovered || b.started) - timeValue(a.discovered || a.started)
        : Number(b.viewers || 0) - Number(a.viewers || 0));
}
function button(label, attributes = '', className = 'action-button') { return `<button type="button" class="${className}" ${attributes}>${label}</button>`; }
function favoriteButton(id, name) {
  const selected = state.favoriteIds.includes(id);
  return button(selected ? '♥' : '♡', `data-fav="${esc(id)}" aria-pressed="${selected}" aria-label="${esc(name)}を${selected ? 'お気に入りから削除' : 'お気に入りに追加'}"`, `favorite ${selected ? 'on' : ''}`);
}
function imageMarkup(url, className, alt = '') { return url ? `<img src="${esc(url)}" class="${className}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer">` : '<span class="avatar-placeholder" aria-hidden="true">SF</span>'; }
function videoCard(item, upcoming = false) {
  const names = item.characters.join(' / ');
  return `<article class="${upcoming ? 'upcoming-card' : 'stream-card'}" data-video-id="${esc(item.id)}">
    <a class="card-media-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">
      <div class="${upcoming ? 'upcoming-thumb' : 'thumb'}">${imageMarkup(item.image, 'video-image')}
        ${upcoming ? `<span class="upcoming-time">${esc(formatDate(item.scheduled))} JST</span>` : '<span class="live-pill">● LIVE</span>'}
      </div>
    </a>
    <div class="card-body"><div class="title-row"><a class="stream-title" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}<span class="sr-only">（YouTube・新しいタブ）</span></a>${favoriteButton(item.channelId, item.name)}</div>
      <div class="stream-channel">${esc(item.name)}</div><div class="meta">${names ? `<span>${esc(names)}</span>` : ''}
      ${upcoming ? '<span>配信予定</span>' : `<span>${esc(LIVE_CATEGORIES[item.category] || 'その他')}</span>${item.viewers != null ? `<span>${Number(item.viewers).toLocaleString()}人が視聴中</span>` : ''}`}</div>
    </div></article>`;
}
function streamerCard(item) {
  const knownLive = state.live.items.find(video => video.channelId === item.id);
  const status = item.status || (knownLive ? 'live' : 'unknown');
  const videoId = item.videoId || knownLive?.id;
  const url = ['live', 'upcoming'].includes(status) && videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : `https://www.youtube.com/channel/${encodeURIComponent(item.id)}`;
  const label = { live: 'LIVE', upcoming: '配信予定', offline: 'オフライン', unknown: '状況未取得', missing: '情報なし' }[status] || '状況未取得';
  return `<article class="streamer-card ${status === 'live' ? 'is-live' : ''}" data-channel-id="${esc(item.id)}">
    <a class="card-media-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true"><div class="channel-avatar-wrap">${imageMarkup(item.image, 'channel-icon')}<span class="status-badge" data-status="${status}">${label}</span></div></a>
    <div class="streamer-row"><a class="streamer-name" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(item.name)}<span class="sr-only">（YouTube・新しいタブ）</span></a>${favoriteButton(item.id, item.name)}</div>
    <div class="streamer-stats"><span><b>登録者</b>${item.subscribers != null ? Number(item.subscribers).toLocaleString() : '—'}</span><span><b>カテゴリ</b>${esc(CATEGORIES[item.category] || '未分類')}</span></div>
    ${item.affiliation || item.organization ? `<small>${esc(({ corporate: '企業勢', independent: '個人勢' })[item.affiliation] || '')} ${esc(item.organization || '')}</small>` : ''}
    ${item.tags?.length ? `<div class="streamer-profile-tags">${item.tags.slice(0, 6).map(tag => `<span>${esc(tag)}</span>`).join('')}</div>` : ''}
    ${item.lp != null || item.mr != null ? `<small>${item.lp != null ? `LP ${esc(item.lp)}` : ''} ${item.mr != null ? `MR ${esc(item.mr)}` : ''}</small>` : ''}
    ${status === 'upcoming' ? `<p class="favorite-scheduled">開始予定 ${esc(formatDate(item.scheduled))}${item.scheduled ? ' JST' : ''}</p>` : ''}
    ${status === 'offline' ? '<small>現在は配信していません</small>' : ''}
    ${status === 'missing' ? '<small>配信者情報が見つかりません。お気に入りは解除できます。</small>' : ''}
  </article>`;
}
function sectionHead(title, description, count = '') {
  return `<div class="section-head"><div><h2>${esc(title)}</h2><p>${esc(description)}</p></div>${count ? `<span class="result-count">${esc(count)}</span>` : ''}</div>`;
}
function countLabel(data, count) { return data.loaded ? `表示中 ${count}件${data.hasNext ? '・続きあり' : ''}` : ''; }
function stateNotice(key) {
  const data = state[key];
  if (data.error) return `<div class="state-message error-message" role="alert"><p>${data.error}${data.items.length ? ' 前回取得した情報を表示しています。' : ''}</p>${button('再試行', `data-retry="${key}"`)}</div>`;
  if (data.busy) return `<div class="state-message" role="status">${data.items.length ? '情報を更新中…' : '読み込み中…'}</div>`;
  return '';
}
function emptyMessage(key, filtered, noun) {
  const data = state[key];
  if (data.busy || data.error || !data.loaded) return '';
  return `<div class="empty"><p>${filtered ? `条件に一致する${noun}が${data.hasNext ? '読み込み済みの一覧に' : ''}ありません。` : `${noun}はありません。`}</p>${filtered ? button('条件をクリア', 'data-reset') : ''}</div>`;
}
function loadMore(key) {
  const data = state[key];
  return data.hasNext ? button(data.busy ? '読み込み中…' : 'もっと見る', `data-load-more="${key}" ${data.busy ? 'disabled' : ''}`, 'load-more') : '';
}
function characterSelect() {
  return `<label class="filter-control">キャラクター<select data-character-select><option value="all">すべてのキャラクター</option>${CHARACTERS.map(c => `<option value="${c.id}" ${state.character === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}</select></label>`;
}
function characterCount(key, id) {
  const data = state[key];
  if (!data.loaded) return '—';
  const count = data.items.filter(item => matchesCharacter(item, id)).length;
  return `${count}${data.hasNext ? '以上' : ''}`;
}
function characterTabs() {
  if (state.character === 'all') return '';
  return `<div class="character-tabs" aria-label="選択したキャラクターの配信">${['home', 'upcoming'].map(view => button(`${TITLES[view]} ${characterCount(view === 'home' ? 'live' : 'upcoming', state.character)}件`, `data-character-view="${view}" aria-pressed="${state.view === view}"`, `chip ${state.view === view ? 'active' : ''}`)).join('')}</div>`;
}
function videosPage(key) {
  const isLive = key === 'live';
  const data = state[key];
  const items = filteredVideos(key);
  const filters = Boolean(query()) || state.character !== 'all' || (isLive && state.category !== 'all');
  return `<section class="section" aria-busy="${data.busy}">${sectionHead(isLive ? 'いま見られるスト6配信' : 'これから始まるスト6配信', isLive ? 'キャラクターや遊び方から、見たい配信を探そう。' : '開始予定の日時は日本時間（JST）です。', countLabel(data, items.length))}
    <div class="filter-controls">${characterSelect()}${isLive ? `<label class="filter-control">並び順<select data-sort><option value="viewers" ${state.sort === 'viewers' ? 'selected' : ''}>視聴者数順</option><option value="newest" ${state.sort === 'newest' ? 'selected' : ''}>新着順</option></select></label>` : ''}</div>
    ${isLive ? `<div class="filter-row" aria-label="配信カテゴリ">${[['all', 'すべて'], ...Object.entries(LIVE_CATEGORIES)].map(([id, label]) => button(label, `data-live-category="${id}" aria-pressed="${state.category === id}"`, `chip ${state.category === id ? 'active' : ''}`)).join('')}</div>` : ''}
    ${characterTabs()}${filters ? `<div class="filter-summary">条件を絞り込んでいます ${button('条件をクリア', 'data-reset', 'text-button')}</div>` : ''}
    ${stateNotice(key)}${items.length ? `<div class="${isLive ? 'live-grid' : 'upcoming-grid'}">${items.map(item => videoCard(item, !isLive)).join('')}</div>` : emptyMessage(key, filters, isLive ? '配信中の動画' : '配信予定')}${loadMore(key)}
  </section>`;
}
function streamersPage() {
  const data = state.streamers;
  const filters = Boolean(query()) || state.streamerCategory !== 'all' || state.affiliation !== 'all';
  return `<section class="section" aria-busy="${data.busy}">${sectionHead('配信者', 'スト6の配信者を探して、お気に入りを見つけよう。', countLabel(data, data.items.length))}
    <div class="filter-controls"><label class="filter-control">配信者カテゴリ<select data-streamer-category><option value="all">すべて</option>${Object.entries(CATEGORIES).map(([id, label]) => `<option value="${id}" ${state.streamerCategory === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    <label class="filter-control">活動形態<select data-affiliation><option value="all">すべて</option><option value="corporate" ${state.affiliation === 'corporate' ? 'selected' : ''}>企業勢</option><option value="independent" ${state.affiliation === 'independent' ? 'selected' : ''}>個人勢</option></select></label>${filters ? button('条件をクリア', 'data-reset', 'text-button') : ''}</div>
    ${stateNotice('streamers')}${data.items.some(item => item.status === 'unknown') ? '<p class="state-message">一部の配信状況を取得できませんでした。「更新」で再取得できます。</p>' : ''}
    ${data.items.length ? `<div class="streamer-grid">${data.items.map(streamerCard).join('')}</div>` : emptyMessage('streamers', filters, '配信者')}${loadMore('streamers')}
  </section>`;
}
function favoritesPage() {
  const data = state.favorites;
  const byId = new Map(data.items.map(item => [item.id, item]));
  const priority = { live: 0, upcoming: 1, offline: 2, unknown: 3, missing: 4 };
  const items = state.favoriteIds.map(id => byId.get(id) || { id, name: id, status: 'missing' }).filter(matches).sort((a, b) => priority[a.status] - priority[b.status] || (a.status === 'upcoming' ? timeValue(a.scheduled, Infinity) - timeValue(b.scheduled, Infinity) : 0));
  return `<section class="section" aria-busy="${data.busy}">${sectionHead('お気に入り', '配信中 → 配信予定 → オフラインの順に表示します。このブラウザに保存されます。', data.loaded ? `表示中 ${items.length}件` : '')}
    ${stateNotice('favorites')}${!state.favoriteIds.length ? `<div class="empty"><p>お気に入りの配信者はまだいません。カードの♡から登録できます。</p>${button('配信者を探す', 'data-go="streamers"')}</div>` : data.loaded ? (items.length ? `<div class="streamer-grid">${items.map(streamerCard).join('')}</div>` : emptyMessage('favorites', true, 'お気に入り')) : ''}
  </section>`;
}
function charactersPage() {
  const items = CHARACTERS.filter(c => !query() || normalize(`${c.name} ${c.id}`).includes(query()));
  return `<section class="section">${sectionHead('キャラクターから探す', 'キャラクターを選ぶと、配信中と配信予定を切り替えて確認できます。')}
    ${stateNotice('live')}${stateNotice('upcoming')}<div class="character-grid">${items.map(c => `<button type="button" class="character-card" data-character="${c.id}"><span class="character-art image-art" style="background-image:url('./assets/characters/character_${c.id}_l.png')" aria-hidden="true"></span><strong>${c.name}</strong><small>配信中 ${characterCount('live', c.id)}件</small><small>配信予定 ${characterCount('upcoming', c.id)}件</small></button>`).join('')}</div>
    ${!items.length ? `<div class="empty">該当するキャラクターはありません。${button('条件をクリア', 'data-reset')}</div>` : ''}
    ${state.live.hasNext || state.upcoming.hasNext ? '<p class="state-message">件数は読み込み済みの配信から集計しています。続きも確認できます。</p>' : ''}
    ${state.live.hasNext ? `<p>配信中の続きを取得</p>${loadMore('live')}` : ''}${state.upcoming.hasNext ? `<p>配信予定の続きを取得</p>${loadMore('upcoming')}` : ''}
  </section>`;
}
function explorePage() {
  return `<section class="section">${sectionHead('見たい配信を探す', '配信者やキャラクターから探せます。')}<div class="explore-grid">${[['streamers', '配信者から探す', '名前・カテゴリ・活動形態で見つける'], ['characters', 'キャラクターから探す', '使いたいキャラクターの配信をチェック'], ['notice', 'お知らせ', 'サイトの更新情報'], ['settings', '設定', 'お気に入りの保存について'], ['help', '使い方', '検索や表示情報について']].map(([view, title, text]) => `<button type="button" class="explore-card" data-go="${view}"><strong>${title}</strong><span>${text}</span><span aria-hidden="true">→</span></button>`).join('')}</div></section>`;
}
function infoPage() {
  if (state.view === 'settings') return `<section class="page-card"><h2>お気に入りの保存</h2><p>お気に入りはこのブラウザに保存されます。ログインは不要です。別の端末やブラウザとは共有されません。</p><p>ブラウザのサイトデータを削除すると、お気に入りも消えます。</p>${button('お気に入りを確認する', 'data-go="favorites"')}</section>`;
  if (state.view === 'notice') return `<section class="page-card"><h2>お知らせ</h2><div class="notice"><strong>2026/09/04</strong><p>スマホでの検索、配信者の絞り込み、お気に入りの配信状況表示を改善しました。</p></div><div class="notice"><strong>2026/09/03</strong><p>配信カテゴリによる絞り込みに対応しました。</p></div><div class="notice"><strong>2026/09/02</strong><p>配信者情報を定期的に更新し、より新しい情報を表示できるようにしています。</p></div><div class="notice"><strong>2026/09/01</strong><p>SF6 LIVE RESEARCHERを公開しました。</p></div></section>`;
  return `<section class="page-card"><h2>使い方</h2><h3>見たい配信を探す</h3><p>配信中・配信予定では、タイトル、配信者名、キャラクターで検索できます。キャラクターとカテゴリを組み合わせて絞り込めます。配信者ページでは、一覧の続きも含めて名前を検索します。</p><h3>配信を見る</h3><p>サムネイルやタイトルを選ぶと、YouTubeを新しいタブで開きます。キーボードではTabキーでリンクを選び、Enterキーで開けます。</p><h3>お気に入り</h3><p>カードの♡で配信者を登録できます。♥で解除できます。オフラインの配信者も表示され、配信予定があれば開始時刻を確認できます。</p><h3>表示情報について</h3><p>YouTubeの公開情報を自動収集しています。実際の配信状況や視聴者数とは時間差があります。キャラクター情報は配信タイトルなどから推定するため、実際の使用キャラクターと異なる場合があります。</p><p>最終取得は、この画面で情報を受け取った時刻です。情報は最大5分程度キャッシュされ、収集間隔による遅れもあります。「更新」を押してもすぐに変わらない場合があります。開始予定の日時は日本時間（JST）です。</p></section>`;
}
function visibleResources() {
  if (state.view === 'home') return ['live'];
  if (state.view === 'upcoming') return ['upcoming'];
  if (state.view === 'characters') return ['live', 'upcoming'];
  if (state.view === 'streamers' || state.view === 'favorites') return [state.view];
  return [];
}
function focusKey(element) {
  if (!element || !$('#app').contains(element)) return null;
  if (element.matches('a[href]')) return { key: 'href', value: element.getAttribute('href') };
  for (const key of ['data-fav', 'data-character-select', 'data-sort', 'data-streamer-category', 'data-affiliation', 'data-live-category', 'data-character-view', 'data-load-more', 'data-retry', 'data-reset']) {
    if (element.hasAttribute(key)) return { key, value: element.getAttribute(key) };
  }
  return null;
}
function render() {
  const focus = focusKey(document.activeElement);
  $('#page-title').textContent = TITLES[state.view];
  document.querySelectorAll('.nav-item').forEach(item => {
    const active = item.dataset.view === state.view || (item.dataset.view === 'explore' && ['streamers', 'characters', 'notice', 'settings', 'help'].includes(state.view));
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  });
  const searchable = ['home', 'upcoming', 'streamers', 'characters', 'favorites'].includes(state.view);
  const searchText = state.view === 'streamers' ? '配信者名・チャンネル名を検索' : state.view === 'characters' ? 'キャラクター名を検索' : state.view === 'favorites' ? 'お気に入りの配信者を検索' : '配信者・タイトル・キャラクターを検索';
  $('#search-input').disabled = !searchable;
  $('#search-input').placeholder = searchable ? searchText : '配信中・配信者ページなどで検索できます';
  $('#search-input').value = state.queries[state.view] || '';
  $('#search-label').textContent = searchText;
  $('#search-hint').textContent = state.view === 'streamers' ? '一覧の続きも含めて配信者名・チャンネル名を検索します。' : 'この画面の読み込み済みの一覧を検索します。';
  const keys = visibleResources();
  const times = keys.map(key => state[key].fetchedAt).filter(Boolean);
  $('#last-fetched').textContent = times.length ? `最終取得 ${formatDate(Math.min(...times))} JST` : '最終取得: —';
  $('#refresh-button').disabled = !keys.length || keys.some(key => state[key].busy);
  $('#refresh-button').hidden = !keys.length;
  $('#last-fetched').hidden = !keys.length;
  $('#app').innerHTML = state.view === 'home' ? videosPage('live') : state.view === 'upcoming' ? videosPage('upcoming') : state.view === 'streamers' ? streamersPage() : state.view === 'favorites' ? favoritesPage() : state.view === 'characters' ? charactersPage() : state.view === 'explore' ? explorePage() : infoPage();
  if (keys.length) $('#app').insertAdjacentHTML('beforeend', '<p class="freshness-note">最終取得は画面で情報を受け取った時刻です。情報の反映には時間差があり、更新しても最大5分程度は同じ情報が表示される場合があります。</p>');
  if (focus) {
    const replacement = [...$('#app').querySelectorAll(`[${focus.key}]`)].find(element => element.getAttribute(focus.key) === focus.value && element.getAttribute('tabindex') !== '-1');
    if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
    else $('#app').focus({ preventScroll: true });
  }
}
function navigate(view, { preserveCharacter = false } = {}) {
  if (!TITLES[view]) return;
  clearTimeout(searchTimer);
  if (state.view === 'streamers' && state.streamers.busy) cancelRequest('streamers');
  state.view = view;
  if (!preserveCharacter) { state.character = 'all'; state.category = 'all'; }
  render();
  visibleResources().forEach(ensure);
  $('#app').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function resetFilters() {
  state.queries[state.view] = '';
  state.character = 'all';
  state.category = 'all';
  if (state.view === 'streamers') { state.streamerCategory = 'all'; state.affiliation = 'all'; clearTimeout(searchTimer); void load('streamers', { clear: true }); }
  else render();
}
function toggleFavorite(id) {
  const selected = state.favoriteIds.includes(id);
  state.favoriteIds = selected ? state.favoriteIds.filter(value => value !== id) : [...state.favoriteIds, id];
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favoriteIds)); }
  catch { announce('このブラウザでは保存できません。今回の画面内だけでお気に入りを保持します。'); }
  if (state.view !== 'favorites') {
    cancelRequest('favorites');
    state.favorites.loaded = false;
    state.favorites.error = '';
  }
  render();
}
document.addEventListener('click', event => {
  const control = event.target.closest('button');
  if (!control || control.disabled) return;
  if (control.matches('.nav-item')) return navigate(control.dataset.view);
  if (control.hasAttribute('data-go')) return navigate(control.dataset.go);
  if (control.hasAttribute('data-fav')) return toggleFavorite(control.dataset.fav);
  if (control.hasAttribute('data-load-more')) return void load(control.dataset.loadMore, { append: true });
  if (control.hasAttribute('data-retry')) return void load(control.dataset.retry, { append: state[control.dataset.retry].append });
  if (control.hasAttribute('data-reset')) return resetFilters();
  if (control.hasAttribute('data-live-category')) { state.category = control.dataset.liveCategory; render(); }
  if (control.hasAttribute('data-character')) { state.character = control.dataset.character; state.category = 'all'; state.queries.home = ''; navigate('home', { preserveCharacter: true }); ensure('upcoming'); }
  if (control.hasAttribute('data-character-view')) { state.queries[control.dataset.characterView] = ''; navigate(control.dataset.characterView, { preserveCharacter: true }); }
});
$('#app').addEventListener('change', event => {
  const control = event.target;
  if (control.hasAttribute('data-character-select')) { state.character = control.value; render(); if (state.character !== 'all') { ensure('live'); ensure('upcoming'); } }
  if (control.hasAttribute('data-sort')) { state.sort = control.value; void load('live', { clear: true }); }
  if (control.hasAttribute('data-streamer-category')) { state.streamerCategory = control.value; clearTimeout(searchTimer); void load('streamers', { clear: true }); }
  if (control.hasAttribute('data-affiliation')) { state.affiliation = control.value; clearTimeout(searchTimer); void load('streamers', { clear: true }); }
});
$('#search-input').addEventListener('input', event => {
  state.queries[state.view] = event.target.value;
  if (state.view === 'streamers') {
    clearTimeout(searchTimer);
    cancelRequest('streamers');
    Object.assign(state.streamers, { items: [], loaded: false, busy: true, error: '', fetchedAt: null });
    render();
    searchTimer = setTimeout(() => { if (state.view === 'streamers') void load('streamers', { clear: true }); }, 250);
  } else render();
});
$('#refresh-button').addEventListener('click', () => { visibleResources().forEach(key => void load(key)); });
window.addEventListener('storage', event => {
  if (event.key === FAVORITES_KEY || event.key === null) {
    state.favoriteIds = readFavorites();
    state.favorites.loaded = false;
    if (state.view === 'favorites') void load('favorites'); else render();
  }
});
render();
ensure('live');
