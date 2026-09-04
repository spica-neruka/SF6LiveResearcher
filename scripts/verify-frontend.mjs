import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Isolated browser regression checks: no production API or external images.
const { chromium } = await import(process.env.UI_PLAYWRIGHT_PATH ? pathToFileURL(process.env.UI_PLAYWRIGHT_PATH).href : 'playwright');
const root = path.resolve(import.meta.dirname, '..');
const output = process.env.UI_OUTPUT_DIR || path.join(root, '.ui-verification');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.UI_CHROMIUM_PATH ? { executablePath: process.env.UI_CHROMIUM_PATH } : {}) });
const requests = [];
const errors = [];
const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#23384c"/><text x="48" y="205" fill="#e8eff8" font-family="sans-serif" font-size="64">SF6 LIVE</text></svg>';
const art = 'http://frontend.test/test-art.svg';
const streamers = [
  { channel_id: 'c1', channel_title: '蒼いゲーム部屋', sf6_player_name: 'Aoi', main_character: 'リュウ', streamer_category: 'pro_gamer', affiliation_type: 'corporate', subscriber_count: 10000, channel_thumbnail_url: art },
  { channel_id: 'c2', channel_title: 'ジュリ研究所', main_character: 'ジュリ', streamer_category: 'vtuber', affiliation_type: 'independent', subscriber_count: 2000, channel_thumbnail_url: art },
  { channel_id: 'c3', channel_title: '週末の対戦会', main_character: 'ジュリ', streamer_category: 'game_streamer', subscriber_count: 300, channel_thumbnail_url: art },
];
const live = [
  { video_id: 'v1', channel_id: 'c1', channel_title: '蒼いゲーム部屋', sf6_player_name: 'Aoi', title: 'リュウでランクマッチ', main_characters: ['リュウ'], category: 'ranked', status: 'live', concurrent_viewers: 120, actual_start_time: '2026-09-04T01:00:00Z', thumbnail_url: art },
  { video_id: 'v2', channel_id: 'c2', channel_title: 'ジュリ研究所', title: 'ジュリのランクマッチ', main_characters: ['ジュリ'], category: 'ranked', status: 'live', concurrent_viewers: 450, actual_start_time: '2026-09-04T02:00:00Z', thumbnail_url: art },
];
const upcoming = [{ video_id: 'v3', channel_id: 'c3', channel_title: '週末の対戦会', title: 'ジュリで参加型対戦会', main_characters: ['ジュリ'], status: 'upcoming', category: 'custom', scheduled_start_time: '2026-09-05T10:00:00Z', thumbnail_url: art }];
const favorites = [
  { channelId: 'c2', name: 'ジュリ研究所', status: 'live', videoId: 'v2', thumbnailUrl: art },
  { channelId: 'c3', name: '週末の対戦会', status: 'upcoming', videoId: 'v3', scheduledStartTime: '2026-09-05T10:00:00Z', thumbnailUrl: art },
  { channelId: 'c4', name: 'お休みゲーム部', status: 'offline', thumbnailUrl: art },
  { channelId: 'c1', name: 'Aoi', status: 'live', videoId: 'v1', thumbnailUrl: art },
];
let failLive = false;
let failStreamers = false;
let failFavorites = false;
let emptyLive = false;
let legacyPagination = false;
let largeDirectory = false;
const largeStreamers = [...streamers, ...Array.from({ length: 197 }, (_, index) => ({
  channel_id: `extra-${index}`, channel_title: index === 196 ? '取得済み末尾のチャンネル' : `配信者 ${index}`,
  sf6_player_name: `Player ${index}`, streamer_category: 'game_streamer', channel_thumbnail_url: art,
})), { channel_id: 'next-channel', channel_title: '次の200件の配信者', channel_thumbnail_url: art }];
async function setupPage(viewport = { width: 1440, height: 1000 }, stored = ['c3', 'c4', 'c1']) {
  const page = await browser.newPage({ viewport, locale: 'ja-JP' });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(value => {
    window.SF6_API_BASE = location.origin;
    localStorage.setItem('sf6-live-favorites', JSON.stringify(value));
  }, stored);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      assert.equal(url.hostname, 'frontend.test');
      requests.push(url);
      if (url.pathname === '/api/videos') {
        assert.equal(url.searchParams.get('limit'), '200');
        assert.equal(url.searchParams.has('q'), false);
        const isLive = url.searchParams.get('status') === 'live';
        if (isLive && failLive) return route.fulfill({ status: 503, json: { error: 'test failure' } });
        return route.fulfill({ json: { items: isLive ? (emptyLive ? [] : live) : upcoming, total: null, hasNextPage: false, nextCursor: null } });
      }
      if (url.pathname === '/api/streamers') {
        assert.equal(url.searchParams.get('limit'), '200', 'All directory pages request 200 rows');
        assert.equal(url.searchParams.has('q'), false, 'Keyword must never be sent to the API');
        if (failStreamers) return route.fulfill({ status: 503, json: { error: 'test failure' } });
        const category = url.searchParams.get('category');
        const affiliation = url.searchParams.get('affiliation_type');
        const filtered = (largeDirectory ? largeStreamers : streamers).filter(item => (!category || item.streamer_category === category) && (!affiliation || item.affiliation_type === affiliation));
        const next = url.searchParams.has('cursor') || Number(url.searchParams.get('offset')) > 0;
        const hasNextPage = !next && !category && !affiliation;
        const size = largeDirectory ? 200 : 2;
        return route.fulfill({ json: { items: hasNextPage ? filtered.slice(0, size) : next ? filtered.slice(size) : filtered, total: null, hasNextPage, ...(legacyPagination ? {} : { nextCursor: hasNextPage ? 'streamer-next' : null }) } });
      }
      if (url.pathname === '/api/favorites') {
        if (failFavorites) return route.fulfill({ status: 503, json: { error: 'test failure' } });
        const ids = (url.searchParams.get('ids') || '').split(',');
        return route.fulfill({ json: favorites.filter(item => ids.includes(item.channelId)) });
      }
      throw new Error('Unexpected API ' + url.pathname);
    }
    if (url.hostname !== 'frontend.test' || url.pathname === '/test-art.svg' || url.pathname.startsWith('/assets/')) return route.fulfill({ body: artwork, contentType: 'image/svg+xml' });
    const file = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'text/plain';
    return route.fulfill({ body: await readFile(path.join(root, file)), contentType });
  });
  await page.goto('http://frontend.test/');
  return page;
}

const navigate = async (page, view) => {
  await page.locator(`.nav-item[data-view="${view}"]:visible`).first().click();
};
const waitCards = (page, selector, count) => page.waitForFunction(({ selector, count }) => document.querySelectorAll(selector).length === count, { selector, count });

try {
  const page = await setupPage();
  await waitCards(page, '.live-grid .stream-card', 2);
  assert.equal(requests.filter(url => url.pathname === '/api/streamers').length, 0, 'Initial live view must not wait for streamer directory');
  await page.screenshot({ path: path.join(output, 'desktop-live.png'), fullPage: true });
  const initialRequests = requests.length;
  await page.locator('#search-input').fill('ジュリ');
  await waitCards(page, '.stream-card', 1);
  await page.locator('#search-input').fill('');
  await waitCards(page, '.stream-card', 2);
  assert.equal(requests.length, initialRequests, 'Live keyword search is local');
  assert.equal(await page.locator('.stream-card').first().getAttribute('data-video-id'), 'v2');
  await page.locator('[data-character-select]').selectOption('juri');
  await waitCards(page, '.live-grid .stream-card', 1);
  await page.waitForFunction(() => document.querySelector('[data-character-view="upcoming"]').textContent.includes('1件'));
  await page.locator('[data-character-view="upcoming"]').click();
  await waitCards(page, '.upcoming-card', 1);
  assert.equal(await page.locator('[data-character-select]').inputValue(), 'juri');
  await navigate(page, 'characters');
  const juri = page.locator('[data-character="juri"]');
  assert.match(await juri.innerText(), /配信中 1件/);
  assert.match(await juri.innerText(), /配信予定 1件/);
  await juri.focus();
  await page.keyboard.press('Enter');
  await waitCards(page, '.live-grid .stream-card', 1);
  await page.locator('[data-live-category="custom"]').click();
  assert.match(await page.locator('.empty').innerText(), /条件に一致/);
  await page.locator('[data-reset]').first().click();
  await waitCards(page, '.live-grid .stream-card', 2);
  await page.locator('[data-sort]').selectOption('newest');
  await page.waitForFunction(() => document.querySelector('.section').getAttribute('aria-busy') === 'false');
  assert.equal(requests.filter(url => url.pathname === '/api/videos').at(-1).searchParams.get('sort'), 'newest');
  await page.locator('[data-sort]').selectOption('viewers');
  await page.waitForFunction(() => document.querySelector('.section').getAttribute('aria-busy') === 'false');
  const favoriteAction = page.locator('[data-fav="c2"]');
  await favoriteAction.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-fav="c2"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.fav), 'c2');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-fav="c2"]').getAttribute('aria-pressed'), 'false');
  await navigate(page, 'streamers');
  await waitCards(page, '.streamer-grid .streamer-card', 2);
  assert.doesNotMatch(await page.locator('#app').innerText(), /Cloudflare|D1/);
  assert.ok(await page.locator('.streamer-card .favorite').count());
  await page.getByRole('button', { name: /もっと見る/ }).click();
  await waitCards(page, '.streamer-grid .streamer-card', 3);
  const cursorRequest = requests.filter(url => url.pathname === '/api/streamers').at(-1);
  assert.equal(cursorRequest.searchParams.get('cursor'), 'streamer-next');
  assert.equal(cursorRequest.searchParams.has('offset'), false);
  assert.equal(requests.filter(url => url.pathname === '/api/favorites').length, 0, 'Directory reuses videos instead of looking up favorites');
  const beforeSearch = requests.length;
  await page.locator('#search-input').fill('週末');
  await waitCards(page, '.streamer-grid .streamer-card', 1);
  assert.equal(await page.locator('.status-badge').getAttribute('data-status'), 'upcoming');
  await page.waitForTimeout(400); // Catch the old delayed server-search regression.
  assert.equal(requests.length, beforeSearch, 'Directory keyword search does not issue any API requests');
  await page.locator('[data-reset]').click();
  await waitCards(page, '.streamer-card', 3);
  assert.equal(requests.length, beforeSearch, 'Clearing only the keyword reuses all loaded pages');
  await page.locator('#search-input').fill('蒼いゲーム部屋');
  await waitCards(page, '.streamer-card', 1);
  assert.match(await page.locator('.streamer-name').innerText(), /Aoi/);
  await page.locator('#search-input').fill('');
  await waitCards(page, '.streamer-card', 3);
  assert.equal(requests.length, beforeSearch, 'Channel name is searchable even when the card uses a player name');
  await page.locator('[data-streamer-category]').selectOption('pro_gamer');
  await waitCards(page, '.streamer-card', 1);
  assert.equal(await page.locator('[data-streamer-category]').inputValue(), 'pro_gamer');
  assert.equal(await page.locator('.status-badge').getAttribute('data-status'), 'live');
  assert.ok(await page.locator('.streamer-card .favorite').count());
  assert.equal(await page.locator('.streamer-name').getAttribute('href'), 'https://www.youtube.com/watch?v=v1');
  await page.locator('[data-affiliation]').selectOption('corporate');
  await page.waitForFunction(() => document.querySelector('.section').getAttribute('aria-busy') === 'false');
  const filteredRequest = requests.filter(url => url.pathname === '/api/streamers').at(-1);
  assert.equal(filteredRequest.searchParams.get('category'), 'pro_gamer');
  assert.equal(filteredRequest.searchParams.get('affiliation_type'), 'corporate');
  failStreamers = true;
  await page.locator('#refresh-button').click();
  await page.waitForSelector('.error-message');
  assert.equal(await page.locator('.streamer-card').count(), 1);
  failStreamers = false;
  await page.locator('[data-retry="streamers"]').click();
  await page.waitForFunction(() => !document.querySelector('.error-message'));
  await navigate(page, 'favorites');
  await waitCards(page, '.streamer-grid .streamer-card', 3);
  const favoriteText = await page.locator('.streamer-card').allInnerTexts();
  assert.match(favoriteText[0], /Aoi/);
  assert.match(favoriteText[1], /週末/);
  assert.match(favoriteText[1], /9\/5|9月5日/);
  assert.match(favoriteText[2], /お休み/);
  assert.equal(await page.locator('.favorite-scheduled').isVisible(), true);
  const beforeFavoriteSearch = requests.length;
  await page.locator('#search-input').fill('週末');
  await waitCards(page, '.streamer-card', 1);
  await page.locator('#search-input').fill('');
  await waitCards(page, '.streamer-card', 3);
  assert.equal(requests.length, beforeFavoriteSearch, 'Favorites keyword search is local');
  await page.screenshot({ path: path.join(output, 'desktop-favorites.png'), fullPage: true });
  assert.equal(await page.locator('.streamer-card a[href*="watch?v=v1"]').count() > 0, true);
  await page.locator('.streamer-card').first().locator('.favorite').click();
  await waitCards(page, '.streamer-grid .streamer-card', 2);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sf6-live-favorites'))), ['c3', 'c4']);
  failFavorites = true;
  await page.locator('#refresh-button').click();
  await page.waitForSelector('.error-message');
  assert.equal(await page.locator('.streamer-card').count(), 2);
  failFavorites = false;
  await page.locator('[data-retry="favorites"]').click();
  await page.waitForFunction(() => !document.querySelector('.error-message'));
  await navigate(page, 'home');
  failLive = true;
  await page.locator('#refresh-button').click();
  await page.waitForFunction(() => /失敗|取得でき|読み込め/.test(document.getElementById('app').textContent));
  assert.equal(await page.locator('.live-grid .stream-card').count(), 2, 'Refresh failure retains previous results');
  assert.doesNotMatch(await page.locator('#app').innerText(), /現在LIVE中の配信はありません/);
  failLive = false;
  await page.locator('[data-retry="live"]').click();
  await page.waitForFunction(() => !document.querySelector('.error-message'));
  await page.close();

  const mobile = await setupPage({ width: 390, height: 844 });
  await waitCards(mobile, '.live-grid .stream-card', 2);
  assert.equal(await mobile.locator('#search-input').isVisible(), true);
  assert.equal(await mobile.locator('.nav-item:visible').count(), 4);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal page overflow');
  await mobile.screenshot({ path: path.join(output, 'mobile-live.png'), fullPage: true });
  await navigate(mobile, 'explore');
  assert.match(await mobile.locator('#app').innerText(), /配信者/);
  assert.match(await mobile.locator('#app').innerText(), /キャラクター/);
  await mobile.locator('[data-go="streamers"]').click();
  await waitCards(mobile, '.streamer-card', 2);
  await mobile.screenshot({ path: path.join(output, 'mobile-streamers.png'), fullPage: true });
  await mobile.setViewportSize({ width: 320, height: 760 });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '320px has no horizontal page overflow');
  await mobile.screenshot({ path: path.join(output, 'mobile-320.png'), fullPage: true });
  await mobile.setViewportSize({ width: 1024, height: 768 });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Tablet has no horizontal page overflow');
  await mobile.close();

  failLive = true;
  const failed = await setupPage();
  await failed.waitForFunction(() => /失敗|取得でき|読み込め/.test(document.getElementById('app').textContent));
  assert.equal(await failed.locator('.stream-card').count(), 0);
  assert.doesNotMatch(await failed.locator('#app').innerText(), /現在LIVE中の配信はありません/);
  await navigate(failed, 'streamers');
  await waitCards(failed, '.streamer-card', 2);
  assert.equal(await failed.locator('[data-channel-id="c1"] .status-badge').getAttribute('data-status'), 'unknown', 'Missing shared live data must not imply offline');
  failLive = false;
  await failed.close();
  legacyPagination = true;
  const legacy = await setupPage();
  await navigate(legacy, 'streamers');
  await waitCards(legacy, '.streamer-card', 2);
  await legacy.locator('[data-load-more="streamers"]').click();
  await waitCards(legacy, '.streamer-card', 3);
  assert.equal(requests.filter(url => url.pathname === '/api/streamers').at(-1).searchParams.get('offset'), '2');
  legacyPagination = false;
  await legacy.close();
  largeDirectory = true;
  const large = await setupPage();
  await waitCards(large, '.stream-card', 2);
  const beforeDirectory = requests.length;
  await navigate(large, 'streamers');
  await waitCards(large, '.streamer-card', 24);
  await large.waitForFunction(() => !document.getElementById('refresh-button').disabled);
  assert.equal(requests.slice(beforeDirectory).filter(url => url.pathname === '/api/streamers').length, 1);
  assert.equal(requests.slice(beforeDirectory).filter(url => url.pathname === '/api/favorites').length, 0);
  assert.match(await large.locator('.search-scope').innerText(), /200件/);
  const bufferedRequests = requests.length;
  await large.locator('[data-load-more="streamers"]').click();
  await waitCards(large, '.streamer-card', 48);
  assert.equal(requests.length, bufferedRequests, 'Showing buffered rows must not fetch');
  await large.locator('#search-input').fill('取得済み末尾');
  await waitCards(large, '.streamer-card', 1);
  assert.equal(await large.locator('.streamer-card').getAttribute('data-channel-id'), 'extra-196');
  assert.equal(requests.length, bufferedRequests, 'Search includes fetched but not yet displayed rows');
  await large.locator('#search-input').fill('次の200件');
  await waitCards(large, '.streamer-card', 0);
  await large.waitForTimeout(400);
  assert.equal(requests.length, bufferedRequests, 'No matches must not automatically fetch the next page');
  assert.match(await large.locator('.empty').innerText(), /読み込み済み/);
  await large.locator('[data-reset]').first().click();
  await waitCards(large, '.streamer-card', 24);
  for (const count of [48, 72, 96, 120, 144, 168, 192, 200]) {
    await large.locator('[data-load-more="streamers"]').click();
    await waitCards(large, '.streamer-card', count);
  }
  assert.equal(requests.length, bufferedRequests, 'All first 200 rows are displayed without more API calls');
  await large.locator('[data-load-more="streamers"]').click();
  await waitCards(large, '.streamer-card', 201);
  assert.equal(requests.length, bufferedRequests + 1, 'Only exhaustion fetches the next batch, with no status lookup');
  assert.equal(requests.at(-1).searchParams.get('limit'), '200');
  assert.equal(requests.at(-1).searchParams.get('cursor'), 'streamer-next');
  await large.locator('#search-input').fill('次の200件');
  await waitCards(large, '.streamer-card', 1);
  assert.equal(requests.length, bufferedRequests + 1, 'Newly fetched data becomes searchable locally');
  await large.close();
  largeDirectory = false;
  emptyLive = true;
  const empty = await setupPage();
  await empty.waitForSelector('.empty');
  assert.match(await empty.locator('.empty').innerText(), /配信中の動画はありません/);
  assert.equal(await empty.locator('.error-message').count(), 0);
  await empty.close();
  emptyLive = false;
  assert.deepEqual(errors, [], 'No uncaught browser exceptions');
  console.log('PASS: 200-row batches, buffered 24-card rendering, local keyword search without requests, shared live/upcoming status, cursor and legacy paging, category/filter, favorites, retry, keyboard and mobile layout.');
  console.log('Screenshots: ' + output);
} finally {
  await browser.close();
}
