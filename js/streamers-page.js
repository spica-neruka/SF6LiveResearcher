(() => {
  const API_BASE = window.SF6_API_BASE || 'https://sf6-live-researcher.u-ambers.workers.dev';
  const PAGE_SIZE = 100;
  const CATEGORY_LABELS = { pro_gamer: 'プロゲーマー', vtuber: 'VTuber', game_streamer: 'ゲーム配信者' };
  const SORT_LABELS = { newest: '更新順', subscribers_desc: '登録者数が多い順', subscribers_asc: '登録者数が少ない順', name_asc: '名前順（A→Z）', name_desc: '名前順（Z→A）' };
  const escapeHtml = (v) => String(v ?? '').replace(/[&<>\"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;' }[c]));
  const label = (v) => CATEGORY_LABELS[v] || v || '--';
  // デフォルトは登録者数の多い順。ユーザーがセレクトボックスから変更可能。
  const state = { page: 0, sort: 'subscribers_desc', category: 'all', total: 0, loading: false, lastKey: '', favoriteKey: '' };

  function isStreamerPage() { return document.querySelector('#page-title')?.textContent === '配信者'; }
  function isFavoritesPage() { return document.querySelector('#page-title')?.textContent === 'お気に入り'; }
  function icon(url, name) { return url ? `<img class="channel-icon" src="${escapeHtml(url)}" alt="${escapeHtml(name)} のYouTubeチャンネルアイコン" loading="lazy" referrerpolicy="no-referrer">` : ''; }

  async function fetchPage() {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(state.page * PAGE_SIZE), sort: state.sort });
    if (state.category !== 'all') params.set('category', state.category);
    const response = await fetch(`${API_BASE}/api/streamers?${params}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`streamers API ${response.status}`);
    return response.json();
  }

  function isFavorite(id) { try { return JSON.parse(localStorage.getItem('sf6-live-favorites') || '[]').includes(id); } catch { return false; } }
  function toggleFavorite(id) {
    let favorites = [];
    try { favorites = JSON.parse(localStorage.getItem('sf6-live-favorites') || '[]'); } catch {}
    favorites = favorites.includes(id) ? favorites.filter(x => x !== id) : [...favorites, id];
    localStorage.setItem('sf6-live-favorites', JSON.stringify(favorites));
  }

  function render(items, total) {
    const app = document.querySelector('#app');
    if (!app || !isStreamerPage()) return;
    state.total = total;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const cards = items.length ? items.map(x => {
      const name = x.sf6_player_name || x.channel_title || x.channel_id;
      return `<article class="streamer-card" data-streamer-channel="${escapeHtml(x.channel_id)}"><div class="channel-avatar-wrap">${icon(x.channel_thumbnail_url, name)}</div><div class="streamer-row"><strong>${escapeHtml(name)}</strong><button class="favorite ${isFavorite(x.channel_id) ? 'on' : ''}" data-streamer-fav="${escapeHtml(x.channel_id)}" aria-label="お気に入り">${isFavorite(x.channel_id) ? '♥' : '♡'}</button></div><div class="streamer-stats"><span><b>登録者</b>${x.subscriber_count != null ? Number(x.subscriber_count).toLocaleString() : '--'}</span><span><b>カテゴリ</b>${escapeHtml(label(x.streamer_category))}</span></div><small>${x.lp != null ? `LP ${escapeHtml(x.lp)}` : ''}${x.mr != null ? ` · MR ${escapeHtml(x.mr)}` : ''}</small></article>`;
    }).join('') : '<div class="empty">該当する配信者はいません。</div>';
    const categories = [['all', 'すべて'], ['pro_gamer', 'プロゲーマー'], ['vtuber', 'VTuber'], ['game_streamer', 'ゲーム配信者']];
    const pagination = totalPages > 1 ? `<div class="streamer-pagination"><button class="chip" data-streamer-page="prev" ${state.page === 0 ? 'disabled' : ''}>← 前へ</button><span>${state.page + 1} / ${totalPages} ページ</span><button class="chip" data-streamer-page="next" ${state.page >= totalPages - 1 ? 'disabled' : ''}>次へ →</button></div>` : '';
    app.innerHTML = `<section class="section"><div class="section-head"><div><h2>配信者</h2><p>登録されている全配信者を100件ずつ表示</p></div><span class="result-count">${total.toLocaleString()} streamers</span></div><div class="streamer-toolbar"><div class="filter-row">${categories.map(([value, text]) => `<button class="chip ${state.category === value ? 'active' : ''}" data-streamer-category="${value}">${text}</button>`).join('')}</div><label class="streamer-sort">並び順 <select id="streamer-sort">${Object.entries(SORT_LABELS).map(([value, text]) => `<option value="${value}" ${state.sort === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label></div><div class="streamer-grid">${cards}</div>${pagination}</section>`;
  }

  async function load() {
    if (!isStreamerPage() || state.loading) return;
    const key = `${state.page}|${state.sort}|${state.category}`;
    if (state.lastKey === key) return;
    state.loading = true; state.lastKey = key;
    try { const data = await fetchPage(); render(data.items || [], Number(data.total || 0)); }
    catch (error) { console.error('Failed to render streamer page', error); const app = document.querySelector('#app'); if (app) app.innerHTML = '<section class="section"><div class="empty">配信者情報を取得できませんでした。</div></section>'; }
    finally { state.loading = false; }
  }

  window.renderOfflineFavorites = async () => {};
  document.addEventListener('change', (event) => {
    if (!isStreamerPage() || event.target.id !== 'streamer-sort') return;
    state.sort = event.target.value; state.page = 0; state.lastKey = ''; load();
  });
  document.addEventListener('click', (event) => {
    if (!isStreamerPage()) return;
    const fav = event.target.closest('[data-streamer-fav]');
    if (fav) { event.stopPropagation(); toggleFavorite(fav.dataset.streamerFav); state.lastKey = ''; load(); return; }
    const category = event.target.closest('[data-streamer-category]');
    if (category) { state.category = category.dataset.streamerCategory; state.page = 0; state.lastKey = ''; load(); return; }
    const page = event.target.closest('[data-streamer-page]');
    if (page) { const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE)); if (page.dataset.streamerPage === 'prev') state.page = Math.max(0, state.page - 1); if (page.dataset.streamerPage === 'next') state.page = Math.min(totalPages - 1, state.page + 1); state.lastKey = ''; load(); }
  });
  const observer = new MutationObserver(() => { if (isStreamerPage()) setTimeout(load, 0); else state.lastKey = ''; });
  observer.observe(document.body, { childList: true, subtree: true });
})();
