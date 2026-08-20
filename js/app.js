const state = { data: null, filter: 'all', characterFilter: null };

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>\"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;' }[c]));

function getCharacter(id) {
  return state.data.characters.find((character) => character.id === id);
}

function bubbleTier(population) {
  if (population >= 30) return 'giant';
  if (population >= 15) return 'large';
  if (population >= 7) return 'medium';
  if (population >= 3) return 'small';
  return 'tiny';
}

function satelliteSize(subscribers) {
  return Math.max(7, Math.min(18, 5 + Math.log10(Math.max(10000, subscribers)) * 1.55));
}

function visibleStreams() {
  return state.data.streams.filter((stream) => {
    if (state.characterFilter && stream.characterId !== state.characterFilter) return false;
    if (state.filter === 'live') return stream.status === 'live';
    if (state.filter === 'upcoming') return stream.status === 'scheduled';
    return true;
  });
}

function renderMap() {
  const map = $('#planet-map');
  const streams = visibleStreams();
  const characters = state.data.characters;

  map.innerHTML = `
    <div class="vita-home-hint">
      <span>COMMUNITY BUBBLES</span>
      <small>タップしてコミュニティを開く</small>
    </div>
    ${characters.map((character, index) => {
      const characterStreams = state.data.streams.filter((stream) => stream.characterId === character.id);
      const currentVisibleStreams = streams.filter((stream) => stream.characterId === character.id).slice(0, 5);
      const liveCount = characterStreams.filter((stream) => stream.status === 'live').length;
      const upcomingCount = characterStreams.filter((stream) => stream.status === 'scheduled').length;
      const active = currentVisibleStreams.length > 0;
      const tier = bubbleTier(character.population);
      const size = { giant: 150, large: 128, medium: 108, small: 90, tiny: 76 }[tier];
      const angleOffset = (index * 137.5) % 360;
      const row = Math.floor(index / 6);
      const col = index % 6;
      const x = 9 + col * 16.3 + (row % 2 ? 7 : 0);
      const y = 14 + row * 20.5;
      const satellites = currentVisibleStreams.map((stream, satelliteIndex) => {
        const angle = angleOffset + (360 / Math.max(1, currentVisibleStreams.length)) * satelliteIndex;
        const radius = size * 0.56;
        const rad = angle * Math.PI / 180;
        const sx = 50 + Math.cos(rad) * (radius / size * 100);
        const sy = 50 + Math.sin(rad) * (radius / size * 100);
        const satSize = satelliteSize(stream.subscribers);
        return `<button class="satellite ${stream.status}" title="${escapeHtml(stream.streamer)} · ${stream.subscribers.toLocaleString()} subscribers" data-stream-id="${stream.id}" style="width:${satSize}px;height:${satSize}px;left:calc(${sx}% - ${satSize/2}px);top:calc(${sy}% - ${satSize/2}px)"></button>`;
      }).join('');

      return `<button class="character-bubble ${tier} ${active ? 'active' : ''} ${liveCount ? 'has-live' : ''}" data-character-id="${character.id}" style="--x:${x}%;--y:${y}%;--bubble-size:${size}px">
        <span class="bubble-glow"></span>
        <span class="bubble-orbit"></span>
        ${satellites}
        <span class="bubble-core">
          <strong>${escapeHtml(character.name)}</strong>
          <small>${character.population} streamers</small>
          ${liveCount ? `<em>● ${liveCount} LIVE</em>` : upcomingCount ? `<em class="upcoming">◷ ${upcomingCount}</em>` : '<em class="quiet">OFFLINE</em>'}
        </span>
      </button>`;
    }).join('')}`;

  map.querySelectorAll('.character-bubble').forEach((node) => {
    node.addEventListener('click', (event) => {
      const satellite = event.target.closest('.satellite');
      if (satellite) {
        event.stopPropagation();
        openStream(satellite.dataset.streamId);
        return;
      }
      openCharacter(node.dataset.characterId);
    });
  });
}

function renderSchedule() {
  const schedule = $('#schedule');
  const streams = visibleStreams().sort((a, b) => a.start.localeCompare(b.start));
  const grouped = new Map();
  streams.forEach((stream) => {
    if (!grouped.has(stream.start)) grouped.set(stream.start, []);
    grouped.get(stream.start).push(stream);
  });
  if (!grouped.size) {
    schedule.innerHTML = '<div style="padding:30px;color:#8d96aa">該当する配信はありません。</div>';
    return;
  }
  schedule.innerHTML = [...grouped.entries()].map(([time, items]) => `
    <div class="time-row"><div class="time">${escapeHtml(time)}</div><div class="streams">
      ${items.map((stream) => {
        const character = getCharacter(stream.characterId);
        const status = stream.status === 'live' ? `🔴 LIVE · ${stream.viewers.toLocaleString()} viewers` : '📅 UPCOMING';
        return `<article class="stream-card ${stream.status}" data-stream-id="${stream.id}"><div class="stream-main"><span class="streamer">${escapeHtml(stream.streamer)}</span><span class="status ${stream.status}">${status}</span></div><div class="stream-title">${escapeHtml(stream.title)}</div><div class="stats"><span>◉ ${escapeHtml(character.name)}</span><span>👥 ${stream.subscribers.toLocaleString()}</span></div></article>`;
      }).join('')}
    </div></div>`).join('');
  schedule.querySelectorAll('.stream-card').forEach((card) => card.addEventListener('click', () => openStream(card.dataset.streamId)));
}

function openCharacter(characterId) {
  const character = getCharacter(characterId);
  if (!character) return;
  const streams = state.data.streams.filter((stream) => stream.characterId === characterId);
  $('#detail-content').innerHTML = `<div class="detail-hero"><div class="detail-bubble ${bubbleTier(character.population)}"><strong>${escapeHtml(character.name)}</strong><span>${character.population} streamers</span></div><p class="eyebrow">COMMUNITY LIVEAREA</p><h3>${escapeHtml(character.name)}</h3><div class="detail-stats"><div class="detail-stat"><strong>${character.population}</strong><span>配信者</span></div><div class="detail-stat"><strong>${streams.filter((s) => s.status === 'live').length}</strong><span>LIVE</span></div><div class="detail-stat"><strong>${streams.reduce((sum, s) => sum + (s.viewers || 0), 0).toLocaleString()}</strong><span>LIVE同接</span></div></div><p class="section-note">惑星の大きさはコミュニティ規模。衛星は配信者で、登録者が多いほど大きくなります。</p><div>${streams.map(streamRow).join('') || '<p class="section-note">現在表示できる配信はありません。</p>'}</div></div>`;
  openPanel();
}

function streamRow(stream) {
  const status = stream.status === 'live' ? `🔴 LIVE · ${stream.viewers.toLocaleString()} viewers` : `📅 ${stream.start}`;
  return `<div class="detail-stream"><a href="${stream.youtubeUrl}" target="_blank" rel="noopener noreferrer"><div class="name">${escapeHtml(stream.streamer)} · ${stream.subscribers.toLocaleString()} subscribers</div><div class="small">${status} · ${escapeHtml(stream.title)}</div></a></div>`;
}

function openStream(streamId) {
  const stream = state.data.streams.find((item) => item.id === streamId);
  if (!stream) return;
  const character = getCharacter(stream.characterId);
  $('#detail-content').innerHTML = `<div class="detail-hero"><p class="eyebrow">${stream.status === 'live' ? '🔴 NOW LIVE' : 'UPCOMING STREAM'}</p><h3>${escapeHtml(stream.streamer)}</h3><p class="section-note">${escapeHtml(stream.title)}</p><div class="detail-stats"><div class="detail-stat"><strong>${escapeHtml(character.name)}</strong><span>CHARACTER</span></div><div class="detail-stat"><strong>${stream.subscribers.toLocaleString()}</strong><span>SUBSCRIBERS</span></div><div class="detail-stat"><strong>${stream.status === 'live' ? stream.viewers.toLocaleString() : stream.start}</strong><span>${stream.status === 'live' ? 'VIEWERS' : 'START'}</span></div></div><a class="filter-btn active" style="display:inline-block;text-decoration:none" href="${stream.youtubeUrl}" target="_blank" rel="noopener noreferrer">YouTubeで見る ↗</a></div>`;
  openPanel();
}

function openPanel() { $('#detail-panel').classList.add('open'); $('#overlay').classList.add('open'); $('#detail-panel').setAttribute('aria-hidden', 'false'); }
function closePanel() { $('#detail-panel').classList.remove('open'); $('#overlay').classList.remove('open'); $('#detail-panel').setAttribute('aria-hidden', 'true'); }

function setFilter(filter) {
  state.filter = filter;
  state.characterFilter = null;
  document.querySelectorAll('.filter-btn[data-filter]').forEach((button) => button.classList.toggle('active', button.dataset.filter === filter));
  renderMap();
  renderSchedule();
}

async function init() {
  const response = await fetch('./data/streams.json');
  state.data = await response.json();
  renderMap();
  renderSchedule();
  document.querySelectorAll('.filter-btn[data-filter]').forEach((button) => button.addEventListener('click', () => setFilter(button.dataset.filter)));
  $('#reset-filter').addEventListener('click', () => setFilter('all'));
  $('#close-panel').addEventListener('click', closePanel);
  $('#overlay').addEventListener('click', closePanel);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closePanel(); });
}

init().catch((error) => {
  console.error(error);
  $('#schedule').innerHTML = '<div style="padding:30px;color:#ff8b99">データの読み込みに失敗しました。</div>';
});
