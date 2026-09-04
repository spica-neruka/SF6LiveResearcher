// One player lives outside #app: rerenders and internal navigation never move its iframe.
let apiPromise;
function youtubeAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => fail(), 15000);
    const previous = window.onYouTubeIframeAPIReady;
    function fail() {
      clearTimeout(timeout);
      script.remove();
      apiPromise = null;
      reject(new Error('YouTube player unavailable'));
    }
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      previous?.();
      resolve(window.YT);
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = fail;
    document.head.append(script);
  });
  return apiPromise;
}

const icons = {
  play: '<path d="m8 5 11 7-11 7Z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
  sound: '<path d="m11 5-6 4H2v6h3l6 4Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="m11 5-6 4H2v6h3l6 4Z"/><path d="m16 9 6 6m0-6-6 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>', expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
  up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const control = (action, label, symbol, extra = '') => `<button type="button" data-player="${action}" aria-label="${label}" title="${label}" ${extra}>${icon(symbol)}</button>`;

export function createZappingPlayer({ onReturn, onClose, onMessage }) {
  const shell = document.createElement('section');
  shell.id = 'persistent-player';
  shell.hidden = true;
  shell.setAttribute('aria-label', '視聴中のYouTube配信');
  shell.innerHTML = `<div class="player-video"><div id="youtube-player"></div></div>
    <div class="player-gesture" data-zapping-gesture tabindex="0" role="group" aria-label="映像操作。タップで操作表示、上下スワイプ・ホイール・上下キーで配信切替"></div>
    <div class="player-top"><a class="player-external" target="_blank" rel="noopener noreferrer" aria-label="YouTubeで開く" title="YouTubeで開く">${icon('external')}</a><span class="mini-caption"></span></div>
    ${control('close', 'プレイヤーを閉じる', 'close', 'class="player-close"')}
    <div class="player-controls" role="group" aria-label="動画操作">
      ${control('play', '再生', 'play', 'disabled')}${control('mute', 'ミュート解除', 'muted', 'disabled')}
      <span class="player-control-spacer"></span>
      <button type="button" data-zap-step="-1" aria-label="前の配信" title="前の配信">${icon('up')}</button>
      <span class="player-position" aria-live="polite"></span>
      <button type="button" data-zap-step="1" aria-label="次の配信" title="次の配信">${icon('down')}</button>
      ${control('return', '大型に戻る', 'expand')}
    </div><p class="player-message" role="status"></p>
    <div class="player-swipe-preview" hidden><strong></strong><span></span><small></small></div>`;
  document.body.append(shell);
  let player, ready = false, current = null, generation = 0, creating = false;
  let playing = false, muted = true;
  let hideTimer, previous = null, next = null;
  function reveal() {
    if (shell.hidden) return;
    clearTimeout(hideTimer);
    shell.classList.add('controls-visible');
    hideTimer = setTimeout(() => {
      if (shell.querySelector('button:focus-visible, a:focus-visible, .player-gesture:focus-visible') || shell.querySelector('.player-message').textContent) return;
      shell.classList.remove('controls-visible');
    }, 2500);
  }
  function preview(direction) {
    const box = shell.querySelector('.player-swipe-preview');
    const item = direction < 0 ? previous : next;
    box.hidden = !direction;
    if (!direction) return;
    reveal();
    box.querySelector('strong').textContent = direction < 0 ? '↑ PREV' : 'NEXT ↓';
    box.querySelector('span').textContent = item?.name || (direction < 0 ? '最初の配信です' : '最後の配信です');
    box.querySelector('small').textContent = item?.title || '';
  }
  function message(text) {
    shell.querySelector('.player-message').textContent = text;
    reveal();
    onMessage(text);
  }
  function controls() {
    for (const [action, label, symbol] of [['play', playing ? '一時停止' : '再生', playing ? 'pause' : 'play'], ['mute', muted ? 'ミュート解除' : 'ミュート', muted ? 'muted' : 'sound']]) {
      const button = shell.querySelector(`[data-player="${action}"]`);
      button.innerHTML = icon(symbol);
      button.setAttribute('aria-label', label);
      button.title = label;
    }
    shell.querySelectorAll('[data-player="play"], [data-player="mute"]').forEach(el => { el.disabled = !ready; });
  }
  shell.addEventListener('click', event => {
    reveal();
    const action = event.target.closest('[data-player]')?.dataset.player;
    if (action === 'close') return onClose();
    if (action === 'return') return onReturn();
    if (!ready) return;
    if (action === 'play') { if (playing) player.pauseVideo(); else player.playVideo(); }
    if (action === 'mute') { muted = !player.isMuted(); if (muted) player.mute(); else player.unMute(); controls(); }
  });
  shell.addEventListener('pointermove', event => { if (event.pointerType !== 'touch') reveal(); });
  shell.addEventListener('pointerenter', reveal);
  shell.addEventListener('touchstart', reveal, { passive: true });
  shell.addEventListener('touchend', event => {
    if (event.target.closest('.player-gesture') && !event.touches.length) {
      // A tap that reveals hidden controls must not also activate the newly visible button.
      event.preventDefault();
      reveal();
    }
  }, { passive: false });
  shell.addEventListener('focusin', reveal);
  shell.addEventListener('focusout', reveal);
  shell.addEventListener('keydown', event => {
    reveal();
    if (event.target.matches('.player-gesture') && [' ', 'Enter', 'k', 'm'].includes(event.key)) {
      event.preventDefault();
      if (!event.repeat) shell.querySelector(`[data-player="${event.key === 'm' ? 'mute' : 'play'}"]`).click();
    }
  });
  function layout() {
    if (shell.hidden) return;
    const anchor = document.querySelector('#zapping-player-slot');
    const changedMode = shell.classList.contains('is-mini') === Boolean(anchor);
    shell.classList.toggle('is-mini', !anchor);
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      Object.assign(shell.style, { left: `${rect.left + scrollX}px`, top: `${rect.top + scrollY}px`, width: `${rect.width}px` });
    } else {
      shell.style.left = shell.style.top = shell.style.width = '';
    }
    shell.querySelector('[data-player="return"]').hidden = Boolean(anchor);
    shell.querySelectorAll('[data-zap-step], .player-position').forEach(el => { el.hidden = !anchor; });
    if (anchor) anchor.style.height = `${shell.getBoundingClientRect().height}px`;
    if (changedMode) { preview(0); reveal(); }
  }
  const observer = new ResizeObserver(layout);
  observer.observe(document.querySelector('.main-content'));
  observer.observe(shell);
  window.addEventListener('resize', layout);
  async function show(item, { index = 0, total = 1, previous: prev = null, next: following = null } = {}) {
    const changed = current?.id !== item.id;
    current = item;
    previous = prev; next = following;
    shell.hidden = false;
    shell.querySelector('.mini-caption').textContent = item.name;
    shell.querySelector('.player-external').href = item.url;
    shell.querySelector('.player-position').textContent = `${index + 1} / ${total}`;
    shell.querySelector('[data-zap-step="-1"]').disabled = index === 0;
    shell.querySelector('[data-zap-step="1"]').disabled = index >= total - 1;
    layout();
    if (!changed && (ready || creating)) return;
    message('');
    if (ready) { muted = player.isMuted(); player.loadVideoById(item.id); return; }
    if (creating) return; // onReady reads the latest selection after rapid navigation.
    creating = true;
    message('プレイヤーを読み込み中…');
    const attempt = ++generation;
    try {
      const YT = await youtubeAPI();
      if (attempt !== generation || !current) return;
      player = new YT.Player('youtube-player', {
        width: '100%', height: '100%', videoId: current.id,
        // A same-document shield receives gestures; all playback goes through this API.
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, origin: location.origin, rel: 0 },
        events: {
          onReady(event) {
            if (attempt !== generation) return;
            ready = true; creating = false;
            event.target.getIframe().setAttribute('title', 'YouTube LIVE プレイヤー');
            event.target.getIframe().setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            event.target.getIframe().setAttribute('tabindex', '-1');
            if (muted) event.target.mute();
            event.target.loadVideoById(current.id);
            controls();
          },
          onStateChange(event) {
            if (attempt !== generation) return;
            playing = event.data === 1;
            muted = event.target.isMuted();
            controls();
            if (playing) message('');
            if (event.data === 0) message('配信が終了しました。次の配信を選べます。');
          },
          onAutoplayBlocked() { if (attempt === generation) message('再生ボタンを押して視聴を開始してください。'); },
          onError() { if (attempt === generation) message('この動画を埋め込みで再生できません。YouTubeで開くか、次の配信を選んでください。'); },
        },
      });
    } catch {
      if (attempt !== generation) return;
      creating = false;
      message('プレイヤーを読み込めませんでした。YouTubeで開くか、一覧からもう一度開始してください。');
    }
  }
  function close() {
    clearTimeout(hideTimer);
    preview(0);
    generation++;
    player?.destroy();
    player = null; ready = false; creating = false; current = null; playing = false;
    shell.querySelector('.player-video').innerHTML = '<div id="youtube-player"></div>';
    shell.hidden = true;
    controls();
  }
  return { show, layout, close, reveal, preview };
}

// Events inside the cross-origin YouTube iframe cannot bubble to the page.
// Capture them on the same-document transparent layer ABOVE the iframe instead.
export function bindZappingGestures({ active, step, preview = () => {}, reveal = () => {} }) {
  let lastWheel = -Infinity, lockedUntil = 0, wheelTotal = 0, wheelConsumed = false, touch = null;
  const interactive = target => target.closest('button, a, input, select, textarea, [contenteditable="true"], .zapping-next');
  document.addEventListener('wheel', event => {
    if (!active() || !event.target.closest('[data-zapping-gesture]') || interactive(event.target) || event.ctrlKey || event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    reveal();
    const now = performance.now();
    const idle = now - lastWheel > 220;
    lastWheel = now;
    if (idle) { wheelTotal = 0; wheelConsumed = false; }
    if (wheelConsumed || now < lockedUntil) return;
    wheelTotal += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
    if (Math.abs(wheelTotal) < 40) return;
    wheelConsumed = true;
    lockedUntil = now + 650;
    step(wheelTotal > 0 ? 1 : -1);
  }, { passive: false });
  document.addEventListener('keydown', event => {
    if (!active() || !['ArrowUp', 'ArrowDown'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
    reveal();
    if (!event.repeat) step(event.key === 'ArrowDown' ? 1 : -1);
  });
  document.addEventListener('touchstart', event => {
    touch = null;
    preview(0);
    if (!active() || event.touches.length !== 1 || !event.target.closest('[data-zapping-gesture]') || interactive(event.target)) return;
    const point = event.touches[0];
    touch = { x: point.clientX, y: point.clientY, time: performance.now() };
    reveal();
  }, { passive: true });
  document.addEventListener('touchmove', event => {
    if (!touch) return;
    if (!active() || event.touches.length !== 1) { touch = null; preview(0); return; }
    const dx = event.touches[0].clientX - touch.x;
    const dy = event.touches[0].clientY - touch.y;
    preview(Math.abs(dy) > 20 && Math.abs(dy) > Math.abs(dx) * 1.5 ? (dy < 0 ? 1 : -1) : 0);
  }, { passive: true });
  document.addEventListener('touchend', event => {
    const start = touch;
    touch = null;
    preview(0);
    if (!start || !active() || event.touches.length || !event.changedTouches.length) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    if (Math.abs(dy) >= 60 && Math.abs(dy) > Math.abs(dx) * 1.5 && performance.now() - start.time < 1000) step(dy < 0 ? 1 : -1);
  }, { passive: true });
  document.addEventListener('touchcancel', () => { touch = null; preview(0); }, { passive: true });
}
