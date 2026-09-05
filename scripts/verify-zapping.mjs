import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.UI_PLAYWRIGHT_PATH ? pathToFileURL(process.env.UI_PLAYWRIGHT_PATH).href : 'playwright');
const root = path.resolve(import.meta.dirname, '..');
const output = process.env.UI_OUTPUT_DIR || path.join(root, '.ui-verification');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.UI_CHROMIUM_PATH ? { executablePath: process.env.UI_CHROMIUM_PATH } : {}) });
const requests = [];
const errors = [];
const videos = [
  { video_id: 'a', channel_id: 'ca', channel_title: 'Alpha', title: 'A stream', main_characters: ['リュウ'], category: 'ranked', concurrent_viewers: 100, actual_start_time: '2026-09-04T01:00:00Z' },
  { video_id: 'b', channel_id: 'cb', channel_title: 'Bravo', title: 'B stream', main_characters: ['ジュリ'], category: 'custom', concurrent_viewers: 400, actual_start_time: '2026-09-04T02:00:00Z' },
  { video_id: 'c', channel_id: 'cc', channel_title: 'Charlie', title: 'C stream', main_characters: ['ケン'], category: 'casual', concurrent_viewers: 300, actual_start_time: '2026-09-04T03:00:00Z' },
  { video_id: 'd', channel_id: 'cd', channel_title: 'Delta', title: 'D stream', main_characters: ['ガイル'], category: 'training', concurrent_viewers: 200, actual_start_time: '2026-09-04T04:00:00Z' },
];

async function setupPage(viewport, url = 'http://frontend.test/', { empty = false, readyDelay = 0, apiDelay = 0, now } = {}) {
  const page = await browser.newPage({ viewport, locale: 'ja-JP' });
  if (now) await page.clock.setFixedTime(new Date(now));
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(({ readyDelay, apiDelay }) => {
    window.SF6_API_BASE = location.origin;
    localStorage.setItem('sf6-live-favorites', '[]');
    window.__yt = { players: 0, loads: [], destroys: 0 };
    window.__mockYT = { Player: class {
      constructor(id, options) {
        window.__yt.players++;
        window.__yt.lastPlayer = this;
        this.videoId = options.videoId; this.muted = false; this.volume = 100;
        this.iframe = document.createElement('iframe');
        this.iframe.src = `https://www.youtube.com/embed/${this.videoId}`;
        document.getElementById(id).replaceWith(this.iframe);
        this.options = options;
        setTimeout(() => options.events?.onReady?.({ target: this }), readyDelay);
      }
      getIframe() { return this.iframe; }
      loadVideoById(id) { this.videoId = id; window.__yt.loads.push(id); this.iframe.src = `https://www.youtube.com/embed/${id}`; this.options.events?.onStateChange?.({ target: this, data: 2 }); }
      pauseVideo() { this.options.events?.onStateChange?.({ target: this, data: 2 }); }
      playVideo() { this.options.events?.onStateChange?.({ target: this, data: 1 }); }
      isMuted() { return this.muted; }
      mute() { this.muted = true; }
      unMute() { this.muted = false; }
      getVolume() { return this.volume; }
      setVolume(value) { this.volume = value; }
      destroy() { window.__yt.destroys++; this.iframe.remove(); }
    } };
    if (!apiDelay) window.YT = window.__mockYT;
  }, { readyDelay, apiDelay });
  await page.route('**/*', async route => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.href === 'https://www.youtube.com/iframe_api') return route.fulfill({ contentType: 'text/javascript', body: `setTimeout(() => { window.YT = window.__mockYT; window.onYouTubeIframeAPIReady(); }, ${apiDelay});` });
    if (requestUrl.pathname.startsWith('/api/')) {
      requests.push(requestUrl);
    }
    if (requestUrl.pathname === '/api/videos') {
      return route.fulfill({ json: { items: empty ? [] : videos, total: empty ? 0 : videos.length, hasNextPage: false, nextCursor: null } });
    }
    if (requestUrl.pathname.startsWith('/api/')) return route.fulfill({ json: { items: [], hasNextPage: false, nextCursor: null } });
    if (requestUrl.hostname.includes('googleapis.com') && requestUrl.pathname.includes('/youtube/v3/')) throw new Error('Unexpected YouTube Data API request');
    if (route.request().resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#23384c"/><text x="40" y="205" fill="#e8eff8" font-size="60">SF6 LIVE</text></svg>' });
    if (requestUrl.hostname !== 'frontend.test') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<body style="margin:0;display:grid;place-items:center;background:#111c2c;color:#92a7c3;font:14px sans-serif"><main><button data-frame-play type="button">frame play</button><button data-frame-mute type="button">frame mute</button><input data-frame-seek type="range" min="0" max="100" value="50"></main></body>' });
    const file = requestUrl.pathname === '/' ? 'index.html' : decodeURIComponent(requestUrl.pathname).slice(1);
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'text/plain';
    return route.fulfill({ body: await readFile(path.join(root, file)), contentType });
  });
  await page.goto(url);
  return page;
}
const wait = (page, selector, count = 1) => page.waitForFunction(({ selector, count }) => document.querySelectorAll(selector).length === count, { selector, count });
const playerCenter = async page => page.locator('#persistent-player iframe').evaluate(el => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
const cdpSessions = new WeakMap();
const dispatchTouch = async (page, type, point, id = 1) => {
  let client = cdpSessions.get(page);
  if (!client) {
    client = await page.context().newCDPSession(page);
    cdpSessions.set(page, client);
  }
  await client.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x: point.x, y: point.y, radiusX: 1, radiusY: 1, force: 1, id }],
    modifiers: 0
  });
};
const assertPlayerShell = async (page, width) => {
  const result = await page.locator('#persistent-player').evaluate(shell => {
    const frame = shell.querySelector('iframe');
    const sr = shell.getBoundingClientRect();
    const fr = frame?.getBoundingClientRect();
    const close = document.querySelector('#app [data-zap-close]');
    const toolbar = shell.querySelector('.player-toolbar');
    const miniButtons = [...shell.querySelectorAll('.player-toolbar [data-player]')];
    return {
      frameCount: shell.querySelectorAll('iframe').length,
      noLegacyOverlay: !shell.querySelector('.player-gesture, .player-swipe-preview, .player-controls, .zapping-navigation, .zapping-gesture'),
      closeOutside: shell.classList.contains('is-mini') || (!!close && !shell.contains(close)),
      closeOutsideFrame: !close || (() => { const r = close.getBoundingClientRect(); return !fr || r.bottom <= fr.top || r.top >= fr.bottom || r.right <= fr.left || r.left >= fr.right; })(),
      toolbarAboveFrame: !shell.classList.contains('is-mini') || (() => { const r = toolbar?.getBoundingClientRect(); return !!r && !!fr && r.bottom <= fr.top + 1; })(),
      miniButtons: miniButtons.map(button => button.dataset.player).sort(),
      shellHeight: sr.height,
      frameHeight: fr?.height,
      playerVars: window.__yt.lastPlayer?.options?.playerVars
    };
  });
  assert.equal(result.frameCount, 1, `${width}px player has exactly one iframe`);
  assert.equal(result.noLegacyOverlay, true, `${width}px player has no overlay or custom controls`);
  assert.equal(result.closeOutside, true, `${width}px large close is outside persistent player`);
  assert.equal(result.closeOutsideFrame, true, `${width}px large close is outside iframe bounds`);
  assert.equal(result.toolbarAboveFrame, true, `${width}px mini toolbar is outside iframe bounds`);
  assert.deepEqual(result.miniButtons, ['close', 'return'], `${width}px mini toolbar only has return/close`);
  assert.equal(result.playerVars?.controls, 1, 'YouTube controls are enabled');
  assert.equal(result.playerVars?.disablekb, 0, 'YouTube keyboard controls are enabled');
  assert.equal(result.playerVars?.fs, 1, 'YouTube fullscreen is enabled');
  assert.equal(result.playerVars?.playsinline, 1, 'YouTube inline playback is enabled');
};
const carouselState = page => page.locator('#app .zapping-carousel').evaluate(carousel => ({
  gesture: carousel.hasAttribute('data-zapping-gesture'),
  edges: [...carousel.querySelectorAll('.carousel-edge')].map(edge => ({
    className: edge.className,
    step: edge.querySelector('.carousel-card')?.dataset.zapStep,
    disabled: edge.querySelector('.carousel-card')?.classList.contains('disabled'),
    visible: edge.getClientRects().length > 0
  })),
  slot: !!carousel.querySelector('#zapping-player-slot, #slot'),
  order: [...carousel.children].map(el => el.className || el.id)
}));
const carouselCardPoint = async (page, direction = 'next') => page.locator(`.carousel-edge.is-${direction} .carousel-card`).evaluate(el => {
  const edge = el.closest('.carousel-edge');
  const r = (edge || el).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
const assertCarouselVisual = async (page, width) => {
  const result = await page.locator('#app .zapping-carousel').evaluate(carousel => {
    const previous = carousel.querySelector('.carousel-edge.is-previous');
    const next = carousel.querySelector('.carousel-edge.is-next');
    const slot = carousel.querySelector('#zapping-player-slot, #slot');
    const cards = [...carousel.querySelectorAll('.carousel-card')];
    const box = el => el?.getBoundingClientRect();
    return {
      previous: box(previous), next: box(next), slot: box(slot),
      overflowHidden: [previous, next].every(el => getComputedStyle(el).overflow === 'hidden'),
      scaled: cards.every(el => getComputedStyle(el).transform !== 'none'),
      shadowed: cards.every(el => getComputedStyle(el).boxShadow !== 'none'),
      animations: cards.map(el => getComputedStyle(el).animationName)
    };
  });
  assert.equal(result.overflowHidden, true, `${width}px carousel edges clip cards`);
  assert.equal(result.scaled, true, `${width}px cards are scaled below central player`);
  assert.equal(result.shadowed, true, `${width}px cards have shadows`);
  if (width <= 760) {
    assert.ok(result.previous.bottom <= result.slot.top + 2, 'mobile previous edge is above central slot');
    assert.ok(result.next.top >= result.slot.bottom - 2, 'mobile next edge is below central slot');
    assert.ok(result.previous.height <= 80 && result.next.height <= 80, 'mobile edges expose compact thumbnails');
  } else {
    assert.ok(result.previous.right <= result.slot.left + 2, 'desktop previous edge is left of central slot');
    assert.ok(result.next.left >= result.slot.right - 2, 'desktop next edge is right of central slot');
  }
};

try {
  const page = await setupPage({ width: 1440, height: 1000 });
  await wait(page, '.stream-card', 4);
  assert.equal(requests.length, 1, 'one initial live API request');
  assert.equal(await page.locator('.hero-primary[data-zap-start]').count(), 1, 'home exposes one primary watch CTA');
  assert.equal(await page.locator('.nav-item[data-view="zapping"]').count(), 0, 'watching remains a contextual destination');
  assert.equal(await page.locator('.stream-card a[target="_blank"]').count(), 0, 'LIVE cards have no external video links');
  assert.doesNotMatch(await page.locator('body').innerText(), /ザッピング/);
  await page.locator('.stream-card [data-fav="cb"]').click();
  assert.equal(await page.locator('#page-title').innerText(), 'ホーム', 'favorite does not open viewer');
  assert.equal(await page.locator('.stream-card [data-fav="cb"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.__yt.players), 0, 'favorite does not start playback');
  assert.deepEqual(await page.locator('.stream-card').evaluateAll(es => es.map(e => e.dataset.videoId)), ['b', 'c', 'd', 'a']);
  await page.locator('.nav-item[data-view="explore"]').click();
  await wait(page, '.live-grid .stream-card', 4);
  await page.locator('[data-live-category="custom"]').click();
  await page.locator('.stream-card .stream-title').first().click();
  await wait(page, '#persistent-player iframe');
  await page.waitForTimeout(30);
  assert.equal(await page.evaluate(() => window.__yt.lastPlayer.isMuted()), false, 'first playback is not forced muted');
  assert.equal(await page.locator('#page-title').innerText(), 'ライブ視聴');
  assert.equal(await page.locator('.zapping-page a[target="_blank"], .zapping-page button[data-zap-streamer]').count(), 0, 'viewer has no duplicate external/profile buttons');
  assert.equal(await page.locator('a[data-zap-streamer]').innerText(), 'Bravo', 'streamer name is the profile link');
  assert.equal(await page.locator('.zapping-footnote').innerText(), '前後の配信を選んで切り替えられます。');
  assert.match(await page.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/b/);
  assert.equal(await page.locator('.player-position').innerText(), '1 / 1');
  await assertPlayerShell(page, 1440);
  const carousel = await carouselState(page);
  assert.equal(carousel.gesture, true, 'carousel owns zapping gesture');
  assert.equal(carousel.edges.length, 2, 'carousel has previous and next edges');
  assert.equal(carousel.slot, true, 'carousel has a central player slot');
  await assertCarouselVisual(page, 1440);
  assert.equal(requests.length, 1, 'start reuses loaded list');
  await page.screenshot({ path: path.join(output, 'zapping-desktop.png'), fullPage: true });
  const frame = page.locator('#persistent-player iframe');
  const frameCenter = await playerCenter(page);
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, frameCenter), 'IFRAME', 'iframe remains the topmost center surface');
  const frameView = await frame.contentFrame();
  const beforeFrameInput = await page.evaluate(() => window.__yt.loads.length);
  await frameView.locator('[data-frame-play]').click();
  await frameView.locator('[data-frame-seek]').fill('80');
  await frameView.locator('body').press('ArrowDown');
  await frameView.locator('body').evaluate(() => dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 300 })));
  assert.equal(await page.evaluate(n => window.__yt.loads.length, beforeFrameInput), beforeFrameInput, 'iframe input does not change parent queue');

  await page.locator('[data-zap-home]').click();
  await page.locator('#persistent-player iframe').evaluate(el => { window.__iframeBeforeReturn = el; });
  assert.equal(await page.locator('#persistent-player').evaluate(el => el.classList.contains('is-mini')), true);
  await assertPlayerShell(page, 'desktop mini');
  assert.equal(await page.locator('[data-player="return"]').isVisible(), true);
  assert.equal(await page.locator('.player-toolbar [data-player="return"]').isVisible(), true, 'mini player shows return control');
  assert.equal(await page.locator('.player-toolbar [data-player="close"]').isVisible(), true, 'mini player shows close control');
  await page.screenshot({ path: path.join(output, 'zapping-mini.png'), fullPage: true });
  await page.locator('[data-player="return"]').click();
  await wait(page, '.zapping-page');
  assert.equal(await page.locator('#persistent-player iframe').evaluate(el => el === window.__iframeBeforeReturn), true, 'large return keeps iframe node');
  assert.equal(await page.locator('.player-toolbar [data-player="return"]').isHidden(), true, 'large player hides mini return control');
  await page.locator('[data-zap-home]').click();
  await page.locator('[data-live-category="all"]').click();
  await page.locator('[data-zap-start="b"]').click();
  await page.locator('[data-zap-streamer]').click();
  await page.locator('[data-player="return"]').click();
  assert.equal(await page.locator('#persistent-player iframe').count(), 1, 'streamer return keeps player');
  assert.equal(await page.locator('#persistent-player iframe').evaluate(el => el === window.__iframeBeforeReturn), true, 'profile and mini return keep the original iframe');
  assert.equal(await page.evaluate(() => window.__yt.loads.length), 1, 'streamer return does not reload video');
  assert.equal(requests.length, 1, 'start, mini, profile and return do not fetch any data');
  await page.screenshot({ path: path.join(output, 'zapping-desktop.png'), fullPage: true });
  await page.evaluate(() => { window.__yt.lastPlayer.mute(); window.__yt.lastPlayer.setVolume(37); });
  await page.locator('.carousel-edge.is-next .carousel-card[data-zap-step="1"]').click();
  assert.deepEqual(await page.evaluate(() => [window.__yt.lastPlayer.isMuted(), window.__yt.lastPlayer.getVolume()]), [true, 37], 'video changes preserve native mute and volume');
  assert.match(await page.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/c/);
  assert.equal(await page.locator('#persistent-player iframe').count(), 1, 'next video keeps the same iframe shell');
  const beforeFav = requests.length;
  await page.locator('[data-fav="cc"]').click();
  assert.equal(requests.length, beforeFav, 'favorite does not fetch');
  await page.locator('[data-zap-home]').click();

  await page.locator('[data-sort]').selectOption('newest');
  await page.waitForFunction(() => document.querySelector('.section')?.getAttribute('aria-busy') === 'false');
  const beforeZappingAPI = requests.length;
  await page.locator('.stream-card .stream-title').first().click();
  assert.match(await page.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/d/);
  const gesture = page.locator('#app .zapping-carousel[data-zapping-gesture]');
  const beforeRapid = await page.evaluate(() => window.__yt.loads.length);
  const frameQueueBeforeInput = await page.evaluate(() => window.__yt.loads.length);
  const queueFrame = page.locator('#persistent-player iframe').contentFrame();
  await queueFrame.locator('[data-frame-play]').click();
  await queueFrame.locator('[data-frame-seek]').fill('65');
  await queueFrame.locator('body').press('ArrowUp');
  assert.equal(await page.evaluate(n => window.__yt.loads.length, frameQueueBeforeInput), frameQueueBeforeInput, 'iframe controls do not step a multi-item queue');
  await page.locator('.carousel-edge.is-next .carousel-card[data-zap-step="1"]').click();
  await page.locator('.carousel-edge.is-next .carousel-card[data-zap-step="1"]').click();
  await page.locator('.carousel-edge.is-next .carousel-card[data-zap-step="1"]').click();
  assert.match(await page.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/a/);
  assert.equal(await page.evaluate(n => window.__yt.loads.length - n, beforeRapid), 3, 'four feeds can be switched consecutively');
  await gesture.focus();
  const beforeKeys = await page.evaluate(() => window.__yt.loads.length);
  for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
    await gesture.press(key);
    await page.waitForTimeout(10);
  }
  assert.equal(await page.evaluate(n => window.__yt.loads.length - n, beforeKeys), 4, 'all four direction keys advance one step');
  const beforePreviousThumb = await page.evaluate(() => window.__yt.loads.length);
  const beforePreviousSrc = await page.locator('#persistent-player iframe').getAttribute('src');
  await page.locator('.carousel-edge.is-previous .carousel-card[data-zap-step="-1"]').click();
  assert.notEqual(await page.locator('#persistent-player iframe').getAttribute('src'), beforePreviousSrc, 'previous thumbnail click changes stream');
  assert.equal(await page.evaluate(n => window.__yt.loads.length - n, beforePreviousThumb), 1, 'previous thumbnail click steps once');
  assert.equal(await page.locator('.carousel-card').first().evaluate(el => getComputedStyle(el).animationName), 'carousel-previous-x', 'desktop transition uses horizontal animation');
  assert.equal(requests.length, beforeZappingAPI, 'starting and switching across four feeds causes zero API requests');
  const beforeWheel = await page.evaluate(() => window.__yt.loads.length);
  const center = await carouselCardPoint(page, 'next');
  await page.mouse.move(center.x, center.y);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -100);
  await page.waitForTimeout(30);
  assert.equal(await page.evaluate(n => window.__yt.loads.length - n, beforeWheel), 1, 'wheel burst advances once');
  await page.mouse.wheel(0, 1);
  assert.equal(await page.evaluate(n => window.__yt.loads.length - n, beforeWheel), 1, 'small wheel is ignored');
  await page.mouse.wheel(100, 100);
  assert.equal(await page.evaluate(n => window.__yt.loads.length - n, beforeWheel), 1, 'horizontal wheel is ignored');
  await page.locator('[data-zap-home]').click();
  await page.locator('[data-zap-start="b"]').click();
  const beforeTouch = await page.evaluate(() => window.__yt.loads.length);
  const touchStart = await carouselCardPoint(page, 'next');
  await dispatchTouch(page, 'touchStart', touchStart);
  await dispatchTouch(page, 'touchMove', { x: touchStart.x, y: touchStart.y - 100 });
  await dispatchTouch(page, 'touchEnd', { x: touchStart.x, y: touchStart.y - 100 });
  await page.waitForTimeout(20);
  assert.equal(await page.evaluate(n => window.__yt.loads.length - n, beforeTouch), 1, 'vertical swipe advances');
  const afterTouch = await page.evaluate(() => window.__yt.loads.length);
  const horizontalStart = await carouselCardPoint(page, 'next');
  await dispatchTouch(page, 'touchStart', horizontalStart, 2);
  await dispatchTouch(page, 'touchMove', { x: horizontalStart.x + 100, y: horizontalStart.y }, 2);
  await dispatchTouch(page, 'touchEnd', { x: horizontalStart.x + 100, y: horizontalStart.y }, 2);
  await page.waitForTimeout(20);
  assert.equal(await page.evaluate(n => window.__yt.loads.length - n, afterTouch), 0, 'horizontal swipe ignored');
  await page.waitForTimeout(700); // cooldown from the previous wheel burst
  const wheelPoint = await carouselCardPoint(page, 'next');
  await page.mouse.move(wheelPoint.x, wheelPoint.y);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(20);
  assert.match(await page.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/b/);
  await gesture.focus();
  await gesture.press('ArrowDown');
  await page.waitForTimeout(20);
  assert.match(await page.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/a/);
  const beforeRepeat = await page.evaluate(() => window.__yt.loads.length);
  await gesture.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, repeat: true })));
  assert.equal(await page.evaluate(n => window.__yt.loads.length - n, beforeRepeat), 0, 'keydown repeat ignored');
  await page.waitForTimeout(700);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -5);
  assert.match(await page.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/b/);
  assert.equal(requests.length, beforeZappingAPI, 'gestures cause zero API requests');
  await page.locator('#app [data-zap-close]').click();
  assert.equal(await page.evaluate(() => window.__yt.destroys), 1, 'close destroys player');
  await page.locator('[data-character-select]').selectOption('juri');
  await page.waitForSelector('[data-character-view="upcoming"]');
  await page.locator('#search-input').fill('Bravo');
  const beforeFilteredStart = requests.length;
  await page.locator('[data-zap-start="b"]').click();
  assert.equal(await page.locator('.player-position').innerText(), '1 / 1', 'character and search are inherited together');
  assert.equal(requests.length, beforeFilteredStart);
  await page.close();

  const direct = await setupPage({ width: 390, height: 844 }, 'http://frontend.test/?view=zapping&video=c&zap_sort=viewers');
  await wait(direct, '.zapping-page');
  await wait(direct, '#persistent-player iframe');
  assert.match(await direct.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/c/);
  assert.equal(await direct.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '390px no overflow');
  const mobileRequests = requests.length;
  await direct.locator('#persistent-player iframe').evaluate(el => { window.__originalFrame = el; });
  await direct.locator('[data-zap-home]').click();
  await direct.goBack();
  await wait(direct, '.zapping-page');
  assert.equal(await direct.locator('#persistent-player iframe').evaluate(el => el === window.__originalFrame), true, 'browser back restores large view without replacing iframe');
  assert.equal(requests.length, mobileRequests);
  await assertPlayerShell(direct, 390);
  await assertCarouselVisual(direct, 390);
  const beforeTaps = await direct.evaluate(() => window.__yt.loads.length);
  for (const [direction, id] of [['next', 'd'], ['previous', 'c']]) {
    const point = await carouselCardPoint(direct, direction);
    await dispatchTouch(direct, 'touchStart', point);
    await dispatchTouch(direct, 'touchEnd', point);
    await direct.waitForFunction(id => window.__yt.loads.at(-1) === id, id);
  }
  assert.equal(await direct.evaluate(n => window.__yt.loads.length - n, beforeTaps), 2, 'mobile thumbnail taps each step once');
  assert.equal(await direct.locator('.carousel-card').first().evaluate(el => getComputedStyle(el).animationName), 'carousel-previous-y', 'mobile transition uses vertical animation');
  await direct.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await direct.locator('.carousel-card').first().evaluate(el => getComputedStyle(el).animationName), 'none', 'reduced motion disables carousel animation');
  await direct.emulateMedia({ reducedMotion: 'no-preference' });
  const directTouch = await carouselCardPoint(direct, 'next');
  await dispatchTouch(direct, 'touchStart', directTouch);
  await dispatchTouch(direct, 'touchMove', { x: directTouch.x, y: directTouch.y - 100 });
  await direct.screenshot({ path: path.join(output, 'zapping-swipe-preview.png') });
  await dispatchTouch(direct, 'touchEnd', { x: directTouch.x, y: directTouch.y - 100 });
  assert.match(await direct.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/d/);
  await direct.screenshot({ path: path.join(output, 'zapping-mobile-390.png'), fullPage: true });
  const previousTouch = await carouselCardPoint(direct, 'previous');
  await dispatchTouch(direct, 'touchStart', previousTouch);
  await dispatchTouch(direct, 'touchMove', { x: previousTouch.x, y: previousTouch.y + 75 });
  await dispatchTouch(direct, 'touchEnd', { x: previousTouch.x, y: previousTouch.y + 75 });
  assert.match(await direct.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/c/, 'mobile downward flick goes to previous stream');
  assert.equal(await direct.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, await playerCenter(direct)), 'IFRAME', 'mobile iframe remains unobstructed');
  assert.equal(requests.length, mobileRequests, 'mobile swipes and control changes never fetch data');
  await direct.evaluate(() => history.pushState({}, '', '?view=zapping&video=unknown'));
  await direct.evaluate(() => dispatchEvent(new PopStateEvent('popstate')));
  await wait(direct, '.zapping-page');
  assert.match(await direct.locator('.zapping-page').innerText(), /現在の一覧|先頭/);
  await direct.setViewportSize({ width: 320, height: 760 });
  await direct.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await assertPlayerShell(direct, 320);
  await assertCarouselVisual(direct, 320);
  assert.equal(await direct.locator('#persistent-player iframe').evaluate(el => el.getBoundingClientRect().right <= innerWidth && el.getBoundingClientRect().height >= 200), true, '320px iframe stays fully visible with the required minimum height');
  assert.equal(await direct.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '320px no overflow');
  await direct.screenshot({ path: path.join(output, 'zapping-mobile-320.png'), fullPage: true });
  await direct.locator('[data-zap-home]').click();
  await assertPlayerShell(direct, '320px mini');
  await direct.screenshot({ path: path.join(output, 'zapping-mini-320.png'), fullPage: true });
  const beforeMiniReturn = await direct.evaluate(() => window.__yt.loads.length);
  await direct.locator('[data-player="return"]').click();
  assert.equal(await direct.evaluate(() => window.__yt.loads.length), beforeMiniReturn, 'mobile mini return does not reload video');
  assert.equal(await direct.locator('#persistent-player iframe').evaluate(el => el === window.__originalFrame), true);
  await direct.close();
  const empty = await setupPage({ width: 320, height: 760 }, 'http://frontend.test/?view=zapping', { empty: true });
  await wait(empty, '.empty');
  assert.match(await empty.locator('.empty').innerText(), /LIVE配信がありません/);
  assert.equal(await empty.locator('#persistent-player').isHidden(), true, 'empty URL does not create player');
  await empty.close();

  const delayed = await setupPage({ width: 1440, height: 1000 }, 'http://frontend.test/', { readyDelay: 300, apiDelay: 100 });
  await wait(delayed, '.stream-card', 4);
  const delayedRequests = requests.length;
  await delayed.locator('.stream-card[data-video-id="b"] .stream-title').click();
  await delayed.locator('.carousel-edge.is-next .carousel-card[data-zap-step="1"]').click();
  await delayed.locator('.carousel-edge.is-next .carousel-card[data-zap-step="1"]').click();
  await delayed.waitForFunction(() => window.__yt.loads.at(-1) === 'd');
  assert.equal(await delayed.evaluate(() => window.__yt.players), 1, 'rapid selections during API/player loading create only one player');
  assert.equal(requests.length, delayedRequests);
  await delayed.evaluate(() => window.__yt.lastPlayer.options.events.onAutoplayBlocked());
  assert.match(await delayed.locator('.player-message').innerText(), /再生ボタン/);
  assert.equal(await delayed.evaluate(() => window.__yt.lastPlayer.isMuted()), false, 'blocked autoplay never falls back to mute');
  await delayed.evaluate(() => window.__yt.lastPlayer.options.events.onError());
  assert.match(await delayed.locator('.player-message').innerText(), /埋め込みで再生できません/);
  await delayed.waitForTimeout(100);
  assert.equal(await delayed.locator('#persistent-player iframe').count(), 1, 'player error keeps iframe mounted');
  await delayed.locator('#app [data-zap-close]').click();
  await delayed.locator('[data-zap-start="b"]').click();
  await delayed.locator('#app [data-zap-close]').click();
  await delayed.waitForTimeout(400);
  assert.equal(await delayed.locator('#persistent-player').isHidden(), true, 'late onReady cannot reopen a closed player');
  assert.equal(await delayed.locator('#persistent-player iframe').count(), 0);
  await delayed.close();
  for (const width of [1024, 1440]) {
    const responsive = await setupPage({ width, height: 900 }, 'http://frontend.test/?view=zapping&video=a');
    await wait(responsive, '.zapping-page');
    await wait(responsive, '#persistent-player iframe');
    await assertPlayerShell(responsive, width);
    await assertCarouselVisual(responsive, width);
    const responsiveFramePoint = await playerCenter(responsive);
    assert.equal(await responsive.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, responsiveFramePoint), 'IFRAME', `${width}px iframe is unobstructed`);
    const responsiveCarousel = await carouselState(responsive);
    assert.equal(responsiveCarousel.edges.length, 2, `${width}px carousel has two edges`);
    assert.equal(responsiveCarousel.slot, true, `${width}px carousel keeps centered slot`);
    await responsive.close();
  }
  const viewingLayouts = [];
  for (const viewport of [{ width: 2560, height: 1440 }, { width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    const responsive = await setupPage(viewport, 'http://frontend.test/?view=zapping&video=b');
    await wait(responsive, '.zapping-page');
    await wait(responsive, '#persistent-player iframe');
    const metrics = await responsive.locator('.zapping-page').evaluate(page => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const app = rect('#app');
      const slot = rect('#zapping-player-slot');
      const info = rect('.zapping-info');
      return {
        app, slot, info,
        overflow: document.documentElement.scrollWidth > innerWidth,
        playerAspect: slot.width / slot.height,
        catchphrase: page.textContent.includes('次の「見たい」へ。'),
        centerDelta: Math.abs((slot.left + slot.right) / 2 - (app.left + app.right) / 2),
      };
    });
    assert.equal(metrics.overflow, false, `${viewport.width}x${viewport.height} viewer has no horizontal overflow`);
    assert.equal(metrics.catchphrase, false, 'viewer catchphrase is removed');
    assert.ok(metrics.centerDelta <= 2, `${viewport.width}px carousel player is centered`);
    assert.ok(Math.abs(metrics.playerAspect - 16 / 9) < .02, 'player remains 16:9');
    assert.ok(metrics.info.bottom <= viewport.height, `${viewport.width}x${viewport.height} primary stream info fits without scrolling`);
    viewingLayouts.push({ viewport, ...metrics });
    await responsive.screenshot({ path: path.join(output, `responsive-viewing-${viewport.width}x${viewport.height}.png`), fullPage: true });
    await responsive.close();
  }
  assert.ok(viewingLayouts[0].slot.width >= viewingLayouts[1].slot.width * 1.25, 'WQHD player grows materially beyond Full HD');
  assert.ok(viewingLayouts[2].slot.height <= 430, 'short laptop viewport keeps player height compact');
  for (const width of [1440, 1200, 1024, 820, 761, 760, 390, 320]) {
    const home = await setupPage({ width, height: 900 }, 'http://frontend.test/', { now: '2026-09-04T17:20:00Z' });
    await wait(home, '.stream-card', 4);
    assert.equal(await home.locator('#last-fetched').innerText(), '02:20 更新', 'same-day Japan time omits date');
    const header = await home.locator('.topbar').evaluate(el => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      const topbar = el.getBoundingClientRect();
      return { top: topbar.top, bottom: topbar.bottom, height: topbar.height, title: rect('#page-title'), search: rect('.search'), refresh: rect('#refresh-button'), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(header.overflow, false, `${width}px home has no horizontal overflow`);
    assert.ok(header.refresh.width >= 44 && header.refresh.height >= 44, 'refresh has a 44px tap target');
    assert.ok(header.search.width >= (width <= 760 ? Math.min(width - 34, 200) : 160), `${width}px search retains usable width`);
    assert.ok(header.search.right <= width + 1 && header.refresh.right <= width + 1, `${width}px search and refresh stay inside the viewport`);
    if (width > 760) {
      assert.ok(header.title.width === 0 || header.title.right <= header.search.x + 1, `${width}px title and search do not overlap`);
      assert.ok(header.height < 110, `${width}px desktop header stays compact`);
    } else {
      assert.ok(header.search.height >= 42, 'mobile search keeps a usable control height');
      assert.ok(header.height < 180, `${width}px mobile header stays compact`);
    }
    await home.screenshot({ path: path.join(output, `header-${width}.png`), fullPage: true });
    const beforeEntry = requests.length;
    // Exercise real pointer hits on the title, thumbnail (including LIVE badge), and card body.
    const card = home.locator('.stream-card[data-video-id="c"]');
    if (width === 1440) await card.locator('.stream-title').press('Enter');
    else {
      const target = card.locator(width === 390 ? '.live-pill' : width === 320 ? '.stream-channel' : '.thumb');
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      await home.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await wait(home, '#persistent-player iframe');
    await home.waitForFunction(() => window.__yt.loads.at(-1) === 'c');
    assert.equal(await home.locator('.player-position').innerText(), '2 / 4', 'clicked video starts in the filtered queue');
    assert.equal(requests.length, beforeEntry, 'card entry reuses cached data');
    await home.goBack();
    await wait(home, '.stream-card', 4);
    await home.goForward();
    await wait(home, '.zapping-page');
    assert.equal(await home.locator('.player-position').innerText(), '2 / 4', 'forward restores selected video');
    assert.equal(requests.length, beforeEntry, 'history does not fetch');
    await home.close();
  }
  const dates = await setupPage({ width: 1024, height: 900 }, 'http://frontend.test/', { now: '2026-09-04T14:55:00Z' });
  await wait(dates, '.stream-card', 4);
  assert.equal(await dates.locator('#last-fetched').innerText(), '23:55 更新');
  const beforeMidnight = requests.length;
  await dates.clock.setFixedTime(new Date('2026-09-04T15:05:00Z'));
  await dates.locator('#search-input').fill('Bravo');
  assert.equal(await dates.locator('#last-fetched').innerText(), '9/4 23:55 更新', 'Japan midnight adds the old date even on the same UTC day');
  assert.equal(requests.length, beforeMidnight, 'formatting does not fetch data');
  await dates.locator('.utility-menu summary').click();
  await dates.locator('.utility-menu [data-go="help"]').click();
  assert.doesNotMatch(await dates.locator('body').innerText(), /ザッピング|最終取得/);
  await dates.close();
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log('PASS: LIVE card entry, queue/filter order, native audio, persistent iframe, mini/large return, favorites, gestures, URL/popstate, responsive headers and Japan update dates.');
} finally { await browser.close(); }
