const state = { data: null, filter: 'all', characterFilter: null };

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>\"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;' }[c]));

function getCharacter(id) {
  return state.data.characters.find((character) => character.id === id);
}

function satelliteSize(subscribers) {
  return Math.max(8, Math.min(25, 7 + Math.log10(Math.max(10000, subscribers)) * 2));
}

function planetSize(population) {
  return Math.max(46, Math.min(106, 42 + Math.sqrt(population) * 9));
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
  const activeCharacterIds = new Set(streams.map((stream) => stream.characterId));
  const characters = state.data.characters.filter((character) => activeCharacterIds.has(character.id));

  if (!characters.length) {
    map.innerHTML = '<div style="padding:40px;color:#8d96aa">この条件に該当するコミュニティはありません。</div>';
    return;
  }

  const positions = [
    [13, 22], [32, 20], [53, 23], [75, 18], [90, 34],
    [22, 49], [45, 50], [68, 49], [84, 62], [10, 76],
    [35, 78], [58, 76], [78, 83]
  ];

  map.innerHTML = characters.map((character, index) => {
    const [x, y] = positions[index % positions.length];
    const planet = planetSize(character.population);
    const characterStreams = streams.filter((stream) => stream.characterId === character.id).slice(0, 5);
    const satellites = characterStreams.map((stream, satelliteIndex) => {
      const angle = (360 / Math.max(1, characterStreams.length)) * satelliteIndex - 45;
      const radius = 72 + (satelliteIndex % 2) * 16;
      const rad = angle * Math.PI / 180;
      const sx = 110 + Math.cos(rad) * radius;
      const sy = 110 + Math.sin(rad) * radius;
      const size = satelliteSize(stream.subscribers);
      return `<button class="satellite ${stream.status}" title="${escapeHtml(stream.streamer)} · ${stream.subscribers.toLocaleString()} subscribers" data-stream-id="${stream.id}" style="width:${size}px;height:${size}px;left:${sx - size/2}px;top:${sy - size/2}px"></button>`;
    }).join('');

    return `<div class="planet-system" data-character-id="${character.id}" style="left:${x}%;top:${y}%">
      <div class="orbit" style="width:${planet + 125}px;height:${planet + 125}px"></div>
      ${satellites}
      <div class="planet" style="width:${planet}px;height:${planet}px"></div>
      <div class="planet-name">${escapeHtml(character.name)}<span class="planet-meta">${character.population} streamers</span></div>
    </div>`;
  }).join('');

  map.querySelectorAll('.planet-system').forEach((node) => {
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
    <div class="time-row">
      <div class="time">${escapeHtml(time)}</div>
      <div class="streams">
        ${items.map((stream) => {
          const character = getCharacter(stream.characterId);
          const status = stream.status === 'live' ? `🔴 LIVE · ${stream.viewers.toLocaleString()} viewers` : '📅 UPCOMING';
          return `<article class="stream-card ${stream.status}" data-stream-id="${stream.id}">
            <div class="stream-main"><span class="streamer">${escapeHtml(stream.streamer)}</span><span class="status ${stream.status}">${status}</span></div>
            <div class="stream-title">${escapeHtml(stream.title)}</div>
            <div class="stats"><span>🪐 ${escapeHtml(character.name)}</span><span>👥 ${stream.subscribers.toLocaleString()}</span></div>
          </article>`;
        }).join('')}
      </div>
    </div>`).join('');

  schedule.querySelectorAll('.stream-card').forEach((card) => card.addEventListener('click', () => openStream(card.dataset.streamId)));
}

function openCharacter(characterId) {
  const character = getCharacter(characterId);
  if (!character) return;
  const streams = state.data.streams.filter((stream) => stream.characterId === characterId);
  $('#detail-content').innerHTML = `
    <div class="detail-hero">
      <div class="planet-preview"></div>
      <p class="eyebrow">COMMUNITY</p>
      <h3>${escapeHtml(character.name)}</h3>
      <div class="detail-stats">
        <div class="detail-stat"><strong>${character.population}</strong><span>配信者</span></div>
        <div class="detail-stat"><strong>${streams.filter((s) => s.status === 'live').length}</strong><span>LIVE</span></div>
        <div class="detail-stat"><strong>${streams.reduce((sum, s) => sum + (s.viewers || 0), 0).toLocaleString()}</strong><span>LIVE同接</span></div>
      </div>
      <p class="section-note">この惑星を拠点にする配信者。衛星の大きさは登録者規模、赤い発光はLIVE中を表します。</p>
      <div>${streams.map(streamRow).join('') || '<p class="section-note">現在表示できる配信はありません。</p>'}</div>
    </div>`;
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
  $('#detail-content').innerHTML = `
    <div class="detail-hero">
      <p class="eyebrow">${stream.status === 'live' ? '🔴 NOW LIVE' : 'UPCOMING STREAM'}</p>
      <h3>${escapeHtml(stream.streamer)}</h3>
      <p class="section-note">${escapeHtml(stream.title)}</p>
      <div class="detail-stats">
        <div class="detail-stat"><strong>${escapeHtml(character.name)}</strong><span>CHARACTER</span></div>
        <div class="detail-stat"><strong>${stream.subscribers.toLocaleString()}</strong><span>SUBSCRIBERS</span></div>
        <div class="detail-stat"><strong>${stream.status === 'live' ? stream.viewers.toLocaleString() : stream.start}</strong><span>${stream.status === 'live' ? 'VIEWERS' : 'START'}</span></div>
      </div>
      <a class="filter-btn active" style="display:inline-block;text-decoration:none" href="${stream.youtubeUrl}" target="_blank" rel="noopener noreferrer">YouTubeで見る ↗</a>
    </div>`;
  openPanel();
}

function openPanel() {
  $('#detail-panel').classList.add('open');
  $('#overlay').classList.add('open');
  $('#detail-panel').setAttribute('aria-hidden', 'false');
}
function closePanel() {
  $('#detail-panel').classList.remove('open');
  $('#overlay').classList.remove('open');
  $('#detail-panel').setAttribute('aria-hidden', 'true');
}

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
