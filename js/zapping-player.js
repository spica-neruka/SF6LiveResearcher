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

export function createZappingPlayer({ onReturn, onClose, onMessage }) {
  const shell = document.createElement('section');
  shell.id = 'persistent-player';
  shell.hidden = true;
  shell.setAttribute('aria-label', '視聴中のYouTube配信');
  shell.innerHTML = `<div class="player-video"><div id="youtube-player"></div></div>
    <div class="mini-caption"></div><div class="player-controls">
    <button type="button" data-player="play" disabled>再生</button>
    <button type="button" data-player="mute" disabled>ミュート解除</button>
    <button type="button" data-player="return">大型に戻る</button>
    <button type="button" data-player="close" aria-label="プレイヤーを閉じる">閉じる</button></div>
    <p class="player-message" role="status"></p>`;
  document.body.append(shell);
  let player, ready = false, current = null, generation = 0, creating = false;
  let playing = false, muted = true;
  function message(text) {
    shell.querySelector('.player-message').textContent = text;
    onMessage(text);
  }
  function controls() {
    shell.querySelector('[data-player="play"]').textContent = playing ? '停止' : '再生';
    shell.querySelector('[data-player="mute"]').textContent = muted ? 'ミュート解除' : 'ミュート';
    shell.querySelectorAll('[data-player="play"], [data-player="mute"]').forEach(el => { el.disabled = !ready; });
  }
  shell.addEventListener('click', event => {
    const action = event.target.closest('[data-player]')?.dataset.player;
    if (action === 'close') return onClose();
    if (action === 'return') return onReturn();
    if (!ready) return;
    if (action === 'play') { if (playing) player.pauseVideo(); else player.playVideo(); }
    if (action === 'mute') { muted = !player.isMuted(); if (muted) player.mute(); else player.unMute(); controls(); }
  });
  function layout() {
    if (shell.hidden) return;
    const anchor = document.querySelector('#zapping-player-slot');
    shell.classList.toggle('is-mini', !anchor);
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      Object.assign(shell.style, { left: `${rect.left + scrollX}px`, top: `${rect.top + scrollY}px`, width: `${rect.width}px` });
    } else {
      shell.style.left = shell.style.top = shell.style.width = '';
    }
    shell.querySelector('[data-player="return"]').hidden = Boolean(anchor);
    if (anchor) anchor.style.height = `${shell.getBoundingClientRect().height}px`;
  }
  const observer = new ResizeObserver(layout);
  observer.observe(document.querySelector('.main-content'));
  observer.observe(shell);
  window.addEventListener('resize', layout);
  async function show(item) {
    const changed = current?.id !== item.id;
    current = item;
    shell.hidden = false;
    shell.querySelector('.mini-caption').textContent = item.name;
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
        playerVars: { autoplay: 0, playsinline: 1, origin: location.origin, rel: 0 },
        events: {
          onReady(event) {
            if (attempt !== generation) return;
            ready = true; creating = false;
            event.target.getIframe().setAttribute('title', 'YouTube LIVE プレイヤー');
            event.target.getIframe().setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
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
    generation++;
    player?.destroy();
    player = null; ready = false; creating = false; current = null; playing = false;
    shell.querySelector('.player-video').innerHTML = '<div id="youtube-player"></div>';
    shell.hidden = true;
    controls();
  }
  return { show, layout, close };
}

// Events inside the cross-origin YouTube iframe cannot bubble to the page.
// Keep gestures on a dedicated strip and information area, preserving YouTube controls.
export function bindZappingGestures({ active, step }) {
  let lastWheel = -Infinity, lockedUntil = 0, wheelTotal = 0, wheelConsumed = false, touch = null;
  const interactive = target => target.closest('button, a, input, select, textarea, [contenteditable="true"], .zapping-next');
  document.addEventListener('wheel', event => {
    if (!active() || !event.target.closest('[data-zapping-gesture]') || interactive(event.target) || event.ctrlKey || event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
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
    if (!active() || !['ArrowUp', 'ArrowDown'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest('input, select, textarea, [contenteditable="true"], #persistent-player')) return;
    event.preventDefault();
    if (!event.repeat) step(event.key === 'ArrowDown' ? 1 : -1);
  });
  document.addEventListener('touchstart', event => {
    touch = null;
    if (!active() || event.touches.length !== 1 || !event.target.closest('[data-zapping-gesture]') || interactive(event.target)) return;
    const point = event.touches[0];
    touch = { x: point.clientX, y: point.clientY, time: performance.now() };
  }, { passive: true });
  document.addEventListener('touchend', event => {
    const start = touch;
    touch = null;
    if (!start || !active() || event.touches.length || !event.changedTouches.length) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    if (Math.abs(dy) >= 60 && Math.abs(dy) > Math.abs(dx) * 1.5 && performance.now() - start.time < 1000) step(dy < 0 ? 1 : -1);
  }, { passive: true });
  document.addEventListener('touchcancel', () => { touch = null; }, { passive: true });
}
