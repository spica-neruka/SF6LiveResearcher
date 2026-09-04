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

async function setupPage(viewport, url = 'http://frontend.test/', { empty = false, readyDelay = 0, apiDelay = 0 } = {}) {
  const page = await browser.newPage({ viewport, locale: 'ja-JP' });
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(({ readyDelay, apiDelay }) => {
    window.SF6_API_BASE = location.origin;
    localStorage.setItem('sf6-live-favorites', '[]');
    window.__yt = { players: 0, loads: [], destroys: 0 };
    window.__mockYT = { Player: class {
      constructor(id, options) {
        window.__yt.players++;
        window.__yt.lastPlayer = this;
        this.videoId = options.videoId; this.muted = false;
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
    if (requestUrl.hostname !== 'frontend.test') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<body style="margin:0;display:grid;place-items:center;background:#111c2c;color:#92a7c3;font:14px sans-serif">YouTube player - test fixture</body>' });
    const file = requestUrl.pathname === '/' ? 'index.html' : decodeURIComponent(requestUrl.pathname).slice(1);
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'text/plain';
    return route.fulfill({ body: await readFile(path.join(root, file)), contentType });
  });
  await page.goto(url);
  return page;
}
const wait = (page, selector, count = 1) => page.waitForFunction(({ selector, count }) => document.querySelectorAll(selector).length === count, { selector, count });
const playerCenter = async page => page.locator('#persistent-player .player-video').evaluate(el => {
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
    const video = shell.querySelector('.player-video');
    const frame = shell.querySelector('iframe');
    const controls = shell.querySelector('.player-controls');
    const gesture = shell.querySelector('.player-gesture[data-zapping-gesture]');
    const steps = shell.querySelectorAll('[data-zap-step]');
    const buttons = [...shell.querySelectorAll('.player-controls button, .player-close')].filter(button => button.getClientRects().length > 0);
    const sr = shell.getBoundingClientRect();
    const vr = video?.getBoundingClientRect();
    const fr = frame?.getBoundingClientRect();
    const cr = controls?.getBoundingClientRect();
    return {
      frame: !!frame, gesture: !!gesture, steps: [...steps].map(step => step.dataset.zapStep),
      noLegacyAppOverlay: !document.querySelector('.zapping-navigation, .zapping-gesture'),
      shellHeight: sr.height,
      videoHeight: vr?.height, frameHeight: fr?.height,
      controlsInside: !!cr && cr.top >= vr.top && cr.bottom <= vr.bottom,
      buttonsInside: buttons.every(button => { const r = button.getBoundingClientRect(); return r.top >= vr.top && r.bottom <= vr.bottom && r.left >= vr.left && r.right <= vr.right; }),
      frameInside: !!fr && fr.left >= vr.left && fr.right <= vr.right && fr.top >= vr.top && fr.bottom <= vr.bottom,
      playerVars: window.__yt.lastPlayer?.options?.playerVars
    };
  });
  assert.equal(result.frame, true, `${width}px player has iframe`);
  assert.equal(result.gesture, true, `${width}px player has gesture overlay`);
  assert.equal(result.noLegacyAppOverlay, true, `${width}px app has no legacy gesture/navigation panel`);
  assert.deepEqual(result.steps, ['-1', '1'], `${width}px player owns previous/next controls`);
  assert.ok(Math.abs(result.shellHeight - result.videoHeight) < 1, `${width}px player shell has no lower panel`);
  assert.ok(Math.abs(result.videoHeight - result.frameHeight) < 1, `${width}px iframe fills video height`);
  assert.equal(result.controlsInside, true, `${width}px controls stay over video`);
  assert.equal(result.buttonsInside, true, `${width}px all player buttons stay inside video`);
  assert.equal(result.frameInside, true, `${width}px iframe stays inside video`);
  assert.equal(result.playerVars?.controls, 0, 'YouTube controls are disabled');
  assert.equal(result.playerVars?.disablekb, 1, 'YouTube keyboard controls are disabled');
};

try {
  const page = await setupPage({ width: 1440, height: 1000 });
  await wait(page, '.stream-card', 4);
  assert.equal(requests.length, 1, 'one initial live API request');
  assert.deepEqual(await page.locator('.stream-card').evaluateAll(es => es.map(e => e.dataset.videoId)), ['b', 'c', 'd', 'a']);
  await page.locator('[data-live-category="custom"]').click();
  await page.locator('[data-zap-start=""]').click();
  await wait(page, '#persistent-player iframe');
  await page.waitForTimeout(30);
  assert.match(await page.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/b/);
  assert.equal(await page.locator('.player-position').innerText(), '1 / 1');
  await assertPlayerShell(page, 1440);
  assert.equal(requests.length, 1, 'start reuses loaded list');
  await page.screenshot({ path: path.join(output, 'zapping-desktop.png'), fullPage: true });
  await page.locator('[data-player="play"]').click();
  assert.match(await page.locator('[data-player="play"]').getAttribute('aria-label'), /一時停止|停止/);
  await page.locator('[data-player="play"]').click();
  assert.match(await page.locator('[data-player="play"]').getAttribute('aria-label'), /再生/);
  await page.locator('[data-player="mute"]').click();
  assert.equal(await page.locator('[data-player="mute"]').getAttribute('aria-label'), 'ミュート');
  for (const action of ['play', 'mute', 'close', 'return']) {
    const button = page.locator(`[data-player="${action}"]`);
    assert.equal(await button.locator('svg').count(), 1, `${action} uses an SVG icon`);
    assert.ok(await button.getAttribute('title'), `${action} has a title`);
  }

  await page.locator('[data-zap-home]').click();
  await page.locator('#persistent-player iframe').evaluate(el => { window.__iframeBeforeReturn = el; });
  assert.equal(await page.locator('#persistent-player').evaluate(el => el.classList.contains('is-mini')), true);
  await assertPlayerShell(page, 'desktop mini');
  assert.equal(await page.locator('[data-player="return"]').isVisible(), true);
  assert.equal(await page.locator('[data-zap-step="1"]').isHidden(), true);
  assert.equal(await page.locator('[data-player="return"]').isVisible(), true, 'mini player shows large return control');
  assert.equal(await page.locator('[data-zap-step]').first().isHidden(), true, 'mini player hides zap navigation controls');
  await page.screenshot({ path: path.join(output, 'zapping-mini.png'), fullPage: true });
  await page.locator('.nav-item[data-view="zapping"]').click();
  await wait(page, '.zapping-page');
  assert.equal(await page.locator('#persistent-player iframe').evaluate(el => el === window.__iframeBeforeReturn), true, 'large return keeps iframe node');
  assert.equal(await page.locator('[data-player="return"]').isHidden(), true, 'large player hides return control');
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
  await page.locator('[data-zap-step="1"]').click();
  assert.match(await page.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/c/);
  assert.equal(await page.locator('[data-player="mute"]').getAttribute('aria-label'), 'ミュート', 'unmuted state carries to next video');
  const beforeFav = requests.length;
  await page.locator('[data-fav="cc"]').click();
  assert.equal(requests.length, beforeFav, 'favorite does not fetch');
  await page.locator('.nav-item[data-view="zapping"]').click();
  await page.locator('[data-zap-home]').click();

  await page.locator('[data-sort]').selectOption('newest');
  await page.waitForFunction(() => document.querySelector('.section')?.getAttribute('aria-busy') === 'false');
  const beforeZappingAPI = requests.length;
  await page.locator('[data-zap-start=""]').click();
  assert.match(await page.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/d/);
  const beforeRapid = await page.evaluate(() => window.__yt.loads.length);
  await page.locator('[data-zap-step="1"]').click();
  await page.locator('[data-zap-step="1"]').click();
  await page.locator('[data-zap-step="1"]').click();
  assert.match(await page.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/a/);
  assert.equal(await page.evaluate(n => window.__yt.loads.length - n, beforeRapid), 3, 'four feeds can be switched consecutively');
  assert.equal(requests.length, beforeZappingAPI, 'starting and switching across four feeds causes zero API requests');
  const beforeWheel = await page.evaluate(() => window.__yt.loads.length);
  const gesture = page.locator('.player-gesture[data-zapping-gesture]');
  const center = await playerCenter(page);
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
  const touchStart = await playerCenter(page);
  await dispatchTouch(page, 'touchStart', touchStart);
  await dispatchTouch(page, 'touchMove', { x: touchStart.x, y: touchStart.y - 100 });
  await dispatchTouch(page, 'touchEnd', { x: touchStart.x, y: touchStart.y - 100 });
  await page.waitForTimeout(20);
  assert.equal(await page.evaluate(n => window.__yt.loads.length - n, beforeTouch), 1, 'vertical swipe advances');
  const afterTouch = await page.evaluate(() => window.__yt.loads.length);
  const horizontalStart = await playerCenter(page);
  await dispatchTouch(page, 'touchStart', horizontalStart, 2);
  await dispatchTouch(page, 'touchMove', { x: horizontalStart.x + 100, y: horizontalStart.y }, 2);
  await dispatchTouch(page, 'touchEnd', { x: horizontalStart.x + 100, y: horizontalStart.y }, 2);
  await page.waitForTimeout(20);
  assert.equal(await page.evaluate(n => window.__yt.loads.length - n, afterTouch), 0, 'horizontal swipe ignored');
  await page.waitForTimeout(700); // cooldown from the previous wheel burst
  const wheelPoint = await playerCenter(page);
  await page.mouse.move(wheelPoint.x, wheelPoint.y);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(20);
  assert.match(await page.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/b/);
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
  await page.locator('[data-player="close"]').click();
  assert.equal(await page.evaluate(() => window.__yt.destroys), 1, 'close destroys player');
  await page.locator('[data-character-select]').selectOption('juri');
  await page.waitForFunction(() => document.querySelector('[data-character-view="upcoming"]').textContent.includes('1件'));
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
  const directTouch = await playerCenter(direct);
  await dispatchTouch(direct, 'touchStart', directTouch);
  await dispatchTouch(direct, 'touchMove', { x: directTouch.x, y: directTouch.y - 100 });
  assert.match(await direct.locator('.player-swipe-preview').innerText(), /NEXT.*Delta.*D stream/s);
  await direct.screenshot({ path: path.join(output, 'zapping-swipe-preview.png') });
  await dispatchTouch(direct, 'touchEnd', { x: directTouch.x, y: directTouch.y - 100 });
  assert.match(await direct.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/d/);
  await direct.screenshot({ path: path.join(output, 'zapping-mobile-390.png'), fullPage: true });
  await dispatchTouch(direct, 'touchStart', directTouch);
  await dispatchTouch(direct, 'touchMove', { x: directTouch.x, y: directTouch.y + 75 });
  assert.match(await direct.locator('.player-swipe-preview').innerText(), /PREV.*Charlie/s);
  await dispatchTouch(direct, 'touchEnd', { x: directTouch.x, y: directTouch.y + 75 });
  assert.match(await direct.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/c/, 'mobile downward flick goes to previous stream');
  await direct.evaluate(() => window.__yt.lastPlayer.playVideo());
  await direct.evaluate(() => document.activeElement?.blur());
  await direct.waitForTimeout(2700);
  assert.equal(await direct.locator('#persistent-player').evaluate(el => el.classList.contains('controls-visible')), false, 'mobile controls auto-hide');
  await dispatchTouch(direct, 'touchStart', directTouch);
  await dispatchTouch(direct, 'touchEnd', directTouch);
  assert.equal(await direct.locator('#persistent-player').evaluate(el => el.classList.contains('controls-visible')), true, 'real mobile tap restores hidden controls');
  assert.equal(requests.length, mobileRequests, 'mobile swipes and control changes never fetch data');
  await direct.evaluate(() => history.pushState({}, '', '?view=zapping&video=unknown'));
  await direct.evaluate(() => dispatchEvent(new PopStateEvent('popstate')));
  await wait(direct, '.zapping-page');
  assert.match(await direct.locator('.zapping-page').innerText(), /現在の一覧|先頭/);
  await direct.setViewportSize({ width: 320, height: 760 });
  await direct.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await assertPlayerShell(direct, 320);
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
  await delayed.locator('[data-zap-start="b"]').click();
  await delayed.locator('[data-zap-step="1"]').click();
  await delayed.locator('[data-zap-step="1"]').click();
  await delayed.waitForFunction(() => window.__yt.loads.at(-1) === 'd');
  assert.equal(await delayed.evaluate(() => window.__yt.players), 1, 'rapid selections during API/player loading create only one player');
  assert.equal(requests.length, delayedRequests);
  await delayed.evaluate(() => window.__yt.lastPlayer.options.events.onAutoplayBlocked());
  assert.match(await delayed.locator('.player-message').innerText(), /再生ボタン/);
  await delayed.evaluate(() => window.__yt.lastPlayer.options.events.onError());
  assert.match(await delayed.locator('.player-message').innerText(), /埋め込みで再生できません/);
  await delayed.waitForTimeout(2700);
  assert.equal(await delayed.locator('#persistent-player').evaluate(el => el.classList.contains('controls-visible')), true, 'player error keeps controls visible');
  await delayed.locator('[data-player="close"]').click();
  await delayed.locator('[data-zap-start="b"]').click();
  await delayed.locator('[data-player="close"]').click();
  await delayed.waitForTimeout(400);
  assert.equal(await delayed.locator('#persistent-player').isHidden(), true, 'late onReady cannot reopen a closed player');
  assert.equal(await delayed.locator('#persistent-player iframe').count(), 0);
  await delayed.close();
  for (const width of [1024, 1440]) {
    const responsive = await setupPage({ width, height: 900 }, 'http://frontend.test/?view=zapping&video=a');
    await wait(responsive, '.zapping-page');
    await wait(responsive, '#persistent-player iframe');
    await assertPlayerShell(responsive, width);
    await responsive.evaluate(() => window.__yt.lastPlayer.options.events.onStateChange({ target: window.__yt.lastPlayer, data: 1 }));
    const gestureBox = await playerCenter(responsive);
    await responsive.mouse.move(gestureBox.x, gestureBox.y);
    assert.equal(await responsive.locator('#persistent-player').evaluate(el => el.classList.contains('controls-visible')), true, `${width}px mouse movement reveals controls`);
    await responsive.mouse.click(gestureBox.x, gestureBox.y);
    assert.equal(await responsive.locator('#persistent-player').evaluate(el => el.classList.contains('controls-visible')), true, `${width}px tap keeps controls visible`);
    await responsive.locator('[data-player="play"]').evaluate(button => button.focus({ focusVisible: true }));
    await responsive.waitForTimeout(2700);
    assert.equal(await responsive.locator('#persistent-player').evaluate(el => el.classList.contains('controls-visible')), true, `${width}px focused control stays visible`);
    await responsive.evaluate(() => document.activeElement?.blur());
    await responsive.mouse.move(gestureBox.x + 1, gestureBox.y + 1);
    await responsive.waitForTimeout(2700);
    assert.equal(await responsive.locator('#persistent-player').evaluate(el => el.classList.contains('controls-visible')), false, `${width}px controls auto-hide`);
    await responsive.close();
  }
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log('PASS: zapping queue/filter order, persistent iframe, mini/large return, favorites, gestures, URL/popstate and mobile overflow.');
} finally { await browser.close(); }
