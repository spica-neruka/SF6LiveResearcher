(() => {
  const API_BASE = window.SF6_API_BASE || 'https://sf6-live-researcher.u-ambers.workers.dev';
  const PAGE_SIZE = 100;
  const CATEGORY_LABELS = { pro_gamer: 'プロゲーマー', vtuber: 'VTuber', game_streamer: 'ゲーム配信者' };
  const SORT_LABELS = {
    newest: '更新順',
    subscribers_desc: '登録者数が多い順',
    subscribers_asc: '登録者数が少ない順',
    name_asc: '名前順（A→Z）',
    name_desc: '名前順（Z→A）'
  };

  const escapeHtml = (v) => String(v ?? '').replace(/[&<>\"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;' }[c]));
  const label = (v) => CATEGORY_LABELS[v] || v || '--';
  const state = { page: 0, sort: 'newest', category: 'all', total: 0, loading: false, lastKey: '' };

  function isStreamerPage() {
    return document.querySelector('#page-title')?.textContent === '配信者';
  }

  function isFavoritesPage() {
    return document.querySelector('#page-title')?.textContent === 'お気に入り';
  }

  function icon(url, name) {
    if (!url) return '';
    return `<img class="channel-icon" src="${escapeHtml(url)}" alt="${escapeHtml(name)} のYouTubeチャンネルアイコン" loading="lazy" referrerpolicy="no-referrer">`;
  }

  async function fetchPage() {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(state.page * PAGE_SIZE),
      sort: state.sort
    });
    if (state.category !== 'all') params.set('category', state.category);
    const response = await fetch(`${API_BASE}/api/streamers?${params}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`streamers API ${response.status}`);
    return response.json();
  }

  function render(items, total) {
    const app = document.querySelector('#app');
    if (!app || !isStreamerPage()) return;
    state.total = total;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const pageNumber = state.page + 1;
    const cards = items.length ? items.map(x => {
      const name = x.sf6_player_name || x.channel_title || x.channel_id;
      return `<article class="streamer-card" data-streamer-channel="${escapeHtml(x.channel_id)}">
        <div class="channel-avatar-wrap">${icon(x.channel_thumbnail_url, name)}</div>
        <div class="streamer-row"><strong>${escapeHtml(name)}</strong><button class="favorite ${isFavorite(x.channel_id) ? 'on' : ''}" data-streamer-fav="${escapeHtml(x.channel_id)}" aria-label="お気に入り">${isFavorite(x.channel_id) ? '♥' : '♡'}</button></div>
        <div class="streamer-stats"><span><b>登録者</b>${x.subscriber_count != null ? Number(x.subscriber_count).toLocaleString() : '--'}</span><span><b>カテゴリ</b>${escapeHtml(label(x.streamer_category))}</span></div>
        <small>${x.lp != null ? `LP ${escapeHtml(x.lp)}` : ''}${x.mr != null ? ` · MR ${escapeHtml(x.mr)}` : ''}</small>
      </article>`;
    }).join('') : '<div class="empty">該当する配信者はいません。</div>';

    const categories = [
      ['all', 'すべて'],
      ['pro_gamer', 'プロゲーマー'],
      ['vtuber', 'VTuber'],
      ['game_streamer', 'ゲーム配信者']
    ];

    const pagination = totalPages > 1 ? `<div class="streamer-pagination">
      <button class="chip" data-streamer-page="prev" ${state.page === 0 ? 'disabled' : ''}>← 前へ</button>
      <span>${pageNumber} / ${totalPages} ページ</span>
      <button class="chip" data-streamer-page="next" ${state.page >= totalPages - 1 ? 'disabled' : ''}>次へ →</button>
    </div>` : '';

    app.innerHTML = `<section class="section"><div class="section-head"><div><h2>配信者</h2><p>登録されている全配信者を100件ずつ表示</p></div><span class="result-count">${total.toLocaleString()} streamers</span></div>
      <div class="streamer-toolbar">
        <div class="filter-row">${categories.map(([value, text]) => `<button class="chip ${state.category === value ? 'active' : ''}" data-streamer-category="${value}">${text}</button>`).join('')}</div>
        <label class="streamer-sort">並び順 <select id="streamer-sort">${Object.entries(SORT_LABELS).map(([value, text]) => `<option value="${value}" ${state.sort === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>
      </div>
      <div class="streamer-grid">${cards}</div>${pagination}</section>`;
  }

  function isFavorite(id) {
    try { return JSON.parse(localStorage.getItem('sf6-live-favorites') || '[]').includes(id); } catch { return false; }
  }

  function toggleFavorite(id) {
    let favorites = [];
    try { favorites = JSON.parse(localStorage.getItem('sf6-live-favorites') || '[]'); } catch {}
    favorites = favorites.includes(id) ? favorites.filter(x => x !== id) : [...favorites, id];
    localStorage.setItem('sf6-live-favorites', JSON.stringify(favorites));
  }

  async function load() {
    if (!isStreamerPage() || state.loading) return;
    const key = `${state.page}|${state.sort}|${state.category}`;
    if (state.lastKey === key) return;
    state.loading = true;
    state.lastKey = key;
    try {
      const data = await fetchPage();
      render(data.items || [], Number(data.total || 0));
    } catch (error) {
      console.error('Failed to render streamer page', error);
      const app = document.querySelector('#app');
      if (app) app.innerHTML = '<section class="section"><div class="empty">配信者情報を取得できませんでした。</div></section>';
    } finally {
      state.loading = false;
    }
  }

  async function fetchAllFavoriteStreamers(favorites) {
    const found = new Map();
    let offset = 0;
    let total = 0;
    do {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset), sort: 'newest' });
      const response = await fetch(`${API_BASE}/api/streamers?${params}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`streamers API ${response.status}`);
      const data = await response.json();
      total = Number(data.total || 0);
      for (const streamer of data.items || []) {
        if (favorites.includes(streamer.channel_id)) found.set(streamer.channel_id, streamer);
      }
      offset += PAGE_SIZE;
      if (!data.hasNextPage || found.size === favorites.length) break;
    } while (offset < total && offset < 10000);
    return found;
  }

  async function renderOfflineFavorites() {
    if (!isFavoritesPage()) return;
    const app = document.querySelector('#app');
    if (!app) return;
    let favorites = [];
    try { favorites = JSON.parse(localStorage.getItem('sf6-live-favorites') || '[]'); } catch {}
    if (!favorites.length) {
      app.innerHTML = '<section class="section"><div class="section-head"><div><h2>お気に入り</h2><p>このブラウザだけに保存されます。アカウントは不要です。</p></div></div><div class="empty">お気に入りの配信者はありません。</div></section>';
      return;
    }
    try {
      const [streamers, liveResponse] = await Promise.all([
        fetchAllFavoriteStreamers(favorites),
        fetch(`${API_BASE}/api/videos?status=live&limit=200`, { cache: 'no-store' })
      ]);
      const liveItems = liveResponse.ok ? ((await liveResponse.json()).items || []) : [];
      const liveByChannel = new Map();
      for (const video of liveItems) if (video.channel_id && !liveByChannel.has(video.channel_id)) liveByChannel.set(video.channel_id, video);
      const items = favorites.map(channelId => {
        const streamer = streamers.get(channelId);
        return streamer ? { streamer, live: liveByChannel.get(channelId) || null } : null;
      }).filter(Boolean);
      app.innerHTML = `<section class="section"><div class="section-head"><div><h2>お気に入り</h2><p>登録した配信者を、配信中でなくても表示します。</p></div><span class="result-count">${items.length} streamers</span></div><div class="streamer-grid">${items.map(({ streamer, live }) => {
        const name = streamer.sf6_player_name || streamer.channel_title || streamer.channel_id;
        return `<article class="streamer-card" data-favorite-channel="${escapeHtml(streamer.channel_id)}" data-live-video="${escapeHtml(live?.video_id || '')}">
          <div class="channel-avatar-wrap">${icon(streamer.channel_thumbnail_url, name)}</div>
          <div class="streamer-row"><strong>${escapeHtml(name)}</strong><button class="favorite on" data-favorite-remove="${escapeHtml(streamer.channel_id)}" aria-label="お気に入りから削除">♥</button></div>
          <div class="streamer-stats"><span><b>登録者</b>${streamer.subscriber_count != null ? Number(streamer.subscriber_count).toLocaleString() : '--'}</span><span><b>カテゴリ</b>${escapeHtml(label(streamer.streamer_category))}</span></div>
          <small>${live ? '🔴 現在配信中' : 'YouTubeチャンネル'}</small>
        </article>`;
      }).join('')}</div></section>`;
    } catch (error) {
      console.error('Failed to render favorite streamers', error);
    }
  }

  // The existing index.html observer calls this global function when the Favorites page changes.
  window.renderOfflineFavorites = renderOfflineFavorites;

  document.addEventListener('click', (event) => {
    if (isFavoritesPage() && event.target.closest('[data-favorite-remove]')) {
      event.stopPropagation();
      const id = event.target.closest('[data-favorite-remove]').dataset.favoriteRemove;
      let favorites = [];
      try { favorites = JSON.parse(localStorage.getItem('sf6-live-favorites') || '[]'); } catch {}
      localStorage.setItem('sf6-live-favorites', JSON.stringify(favorites.filter(x => x !== id)));
      renderOfflineFavorites();
      return;
    }
    if (!isStreamerPage()) return;
    const fav = event.target.closest('[data-streamer-fav]');
    if (fav) {
      event.stopPropagation();
      toggleFavorite(fav.dataset.streamerFav);
      state.lastKey = '';
      load();
      return;
    }
    const category = event.target.closest('[data-streamer-category]');
    if (category) {
      state.category = category.dataset.streamerCategory;
      state.page = 0;
      state.lastKey = '';
      load();
      return;
    }
    const page = event.target.closest('[data-streamer-page]');
    if (page) {
      const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
      if (page.dataset.streamerPage === 'prev') state.page = Math.max(0, state.page - 1);
      if (page.dataset.streamerPage === 'next') state.page = Math.min(totalPages - 1, state.page + 1);
      state.lastKey = '';
      load();
    }
  });

  document.addEventListener('change', (event) => {
    if (!isStreamerPage() || event.target.id !== 'streamer-sort') return;
    state.sort = event.target.value;
    state.page = 0;
    state.lastKey = '';
    load();
  });

  const observer = new MutationObserver(() => {
    if (isStreamerPage()) setTimeout(load, 0);
    else if (isFavoritesPage()) setTimeout(renderOfflineFavorites, 0);
    else state.lastKey = '';
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
