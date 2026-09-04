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
  assert.equal(await page.locator('.zapping-navigation span').innerText(), '1 / 1');
  assert.equal(requests.length, 1, 'start reuses loaded list');
  await page.screenshot({ path: path.join(output, 'zapping-desktop.png'), fullPage: true });
  await page.locator('[data-player="play"]').click();
  assert.equal(await page.locator('[data-player="play"]').innerText(), '停止');
  await page.locator('[data-player="play"]').click();
  assert.equal(await page.locator('[data-player="play"]').innerText(), '再生');
  await page.locator('[data-player="mute"]').click();
  assert.equal(await page.locator('[data-player="mute"]').innerText(), 'ミュート');

  await page.locator('[data-zap-home]').click();
  await page.locator('#persistent-player iframe').evaluate(el => { window.__iframeBeforeReturn = el; });
  assert.equal(await page.locator('#persistent-player').evaluate(el => el.classList.contains('is-mini')), true);
  await page.screenshot({ path: path.join(output, 'zapping-mini.png'), fullPage: true });
  await page.locator('.nav-item[data-view="zapping"]').click();
  await wait(page, '.zapping-page');
  assert.equal(await page.locator('#persistent-player iframe').evaluate(el => el === window.__iframeBeforeReturn), true, 'large return keeps iframe node');
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
  assert.equal(await page.locator('[data-player="mute"]').innerText(), 'ミュート', 'unmuted state carries to next video');
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
  for (let i = 0; i < 10; i++) await page.locator('[data-zapping-gesture]').first().dispatchEvent('wheel', { deltaY: -100 });
  await page.waitForTimeout(30);
  assert.equal(await page.evaluate(n => window.__yt.loads.length - n, beforeWheel), 1, 'wheel burst advances once');
  await page.locator('[data-zapping-gesture]').first().dispatchEvent('wheel', { deltaY: 1 });
  assert.equal(await page.evaluate(n => window.__yt.loads.length - n, beforeWheel), 1, 'small wheel is ignored');
  await page.locator('[data-zapping-gesture]').first().dispatchEvent('wheel', { deltaX: 100, deltaY: 100 });
  assert.equal(await page.evaluate(n => window.__yt.loads.length - n, beforeWheel), 1, 'horizontal wheel is ignored');
  await page.locator('[data-zap-home]').click();
  await page.locator('[data-zap-start="b"]').click();
  const beforeTouch = await page.evaluate(() => window.__yt.loads.length);
  await page.evaluate(() => {
    const target = document.querySelector('[data-zapping-gesture]');
    const touch = (type, x, y) => target.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: type === 'touchstart' ? [new Touch({ identifier: 1, target, clientX: x, clientY: y })] : [], changedTouches: [new Touch({ identifier: 1, target, clientX: x, clientY: y })] }));
    touch('touchstart', 120, 220); touch('touchend', 120, 120);
  });
  await page.waitForTimeout(20);
  assert.equal(await page.evaluate(n => window.__yt.loads.length - n, beforeTouch), 1, 'vertical swipe advances');
  const afterTouch = await page.evaluate(() => window.__yt.loads.length);
  await page.evaluate(() => {
    const target = document.querySelector('[data-zapping-gesture]');
    const touch = (type, x, y) => target.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: type === 'touchstart' ? [new Touch({ identifier: 2, target, clientX: x, clientY: y })] : [], changedTouches: [new Touch({ identifier: 2, target, clientX: x, clientY: y })] }));
    touch('touchstart', 120, 220); touch('touchend', 220, 220);
  });
  await page.waitForTimeout(20);
  assert.equal(await page.evaluate(n => window.__yt.loads.length - n, afterTouch), 0, 'horizontal swipe ignored');
  await page.waitForTimeout(700); // cooldown from the previous wheel burst
  await page.locator('[data-zapping-gesture]').first().dispatchEvent('wheel', { deltaY: -100 });
  await page.waitForTimeout(20);
  assert.match(await page.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/b/);
  await page.locator('[data-zapping-gesture]').first().press('ArrowDown');
  await page.waitForTimeout(20);
  assert.match(await page.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/a/);
  const beforeRepeat = await page.evaluate(() => window.__yt.loads.length);
  await page.locator('[data-zapping-gesture]').first().evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, repeat: true })));
  assert.equal(await page.evaluate(n => window.__yt.loads.length - n, beforeRepeat), 0, 'keydown repeat ignored');
  await page.waitForTimeout(700);
  for (let i = 0; i < 10; i++) await page.locator('.zapping-gesture').dispatchEvent('wheel', { deltaY: -5 });
  assert.match(await page.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/b/);
  assert.equal(requests.length, beforeZappingAPI, 'gestures cause zero API requests');
  await page.locator('[data-player="close"]').click();
  assert.equal(await page.evaluate(() => window.__yt.destroys), 1, 'close destroys player');
  await page.locator('[data-character-select]').selectOption('juri');
  await page.waitForFunction(() => document.querySelector('[data-character-view="upcoming"]').textContent.includes('1件'));
  await page.locator('#search-input').fill('Bravo');
  const beforeFilteredStart = requests.length;
  await page.locator('[data-zap-start="b"]').click();
  assert.equal(await page.locator('.zapping-navigation span').innerText(), '1 / 1', 'character and search are inherited together');
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
  await direct.locator('.zapping-gesture').evaluate(target => {
    const point = y => new Touch({ identifier: 1, target, clientX: 100, clientY: y });
    target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [point(220)] }));
    target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [point(120)] }));
  });
  assert.match(await direct.locator('#persistent-player iframe').getAttribute('src'), /\/embed\/d/);
  await direct.screenshot({ path: path.join(output, 'zapping-mobile-390.png'), fullPage: true });
  await direct.evaluate(() => history.pushState({}, '', '?view=zapping&video=unknown'));
  await direct.evaluate(() => dispatchEvent(new PopStateEvent('popstate')));
  await wait(direct, '.zapping-page');
  assert.match(await direct.locator('.zapping-page').innerText(), /現在の一覧|先頭/);
  await direct.setViewportSize({ width: 320, height: 760 });
  await direct.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await direct.locator('#persistent-player iframe').evaluate(el => el.getBoundingClientRect().right <= innerWidth && el.getBoundingClientRect().height >= 200), true, '320px iframe stays fully visible with the required minimum height');
  assert.equal(await direct.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '320px no overflow');
  await direct.screenshot({ path: path.join(output, 'zapping-mobile-320.png'), fullPage: true });
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
  await delayed.locator('[data-player="close"]').click();
  await delayed.locator('[data-zap-start="b"]').click();
  await delayed.locator('[data-player="close"]').click();
  await delayed.waitForTimeout(400);
  assert.equal(await delayed.locator('#persistent-player').isHidden(), true, 'late onReady cannot reopen a closed player');
  assert.equal(await delayed.locator('#persistent-player iframe').count(), 0);
  await delayed.close();
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log('PASS: zapping queue/filter order, persistent iframe, mini/large return, favorites, gestures, URL/popstate and mobile overflow.');
} finally { await browser.close(); }
