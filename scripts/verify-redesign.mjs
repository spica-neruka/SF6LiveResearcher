import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.UI_PLAYWRIGHT_PATH ? pathToFileURL(process.env.UI_PLAYWRIGHT_PATH).href : 'playwright');
const root = path.resolve(import.meta.dirname, '..');
const output = process.env.UI_OUTPUT_DIR || path.join(root, '.ui-verification/redesign');
await mkdir(output, { recursive:true });
const browser = await chromium.launch({ headless:true, ...(process.env.UI_CHROMIUM_PATH ? { executablePath:process.env.UI_CHROMIUM_PATH } : {}) });
const errors = [];
const evidence = {};
const videos = Array.from({ length:8 }, (_, i) => ({ video_id:`v${i}`, channel_id:`c${i}`, channel_title:`配信者 ${i}`, title:`${i % 2 ? 'ジュリ' : 'キャミィ'}でランクマッチ ${i}`, main_characters:i === 0 ? ['キャミィ', 'ジュリ'] : [i % 2 ? 'ジュリ' : 'キャミィ'], category:i % 2 ? 'ranked' : 'custom', concurrent_viewers:800-i*50, status:'live', thumbnail_url:'https://art.test/thumbnail.svg' }));

async function setup({ width=1440, height=1000, mode='normal', url='http://redesign.test/', partial=false, imageFailure=false } = {}) {
  const page = await browser.newPage({ viewport:{ width,height }, locale:'ja-JP' });
  const requests = [];
  let currentMode = mode;
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.SF6_API_BASE = location.origin;
    window.__loads = [];
    window.YT = { Player:class {
      constructor(id, options) { this.options=options; this.frame=document.createElement('iframe'); this.frame.srcdoc='<body>Test player</body>'; document.getElementById(id).replaceWith(this.frame); setTimeout(()=>options.events.onReady({ target:this }),0); }
      getIframe() { return this.frame; }
      loadVideoById(id) { window.__loads.push(id); }
      destroy() { this.frame.remove(); }
    } };
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      requests.push(url.pathname+url.search);
      if (currentMode === 'error') return route.fulfill({ status:503, body:'Unavailable' });
      if (currentMode === 'loading') await new Promise(resolve => setTimeout(resolve,800));
      return route.fulfill({ json:{ items:url.searchParams.get('status')==='upcoming' || currentMode==='empty' ? [] : currentMode==='one' ? videos.slice(0,1) : videos, hasNextPage:partial, nextCursor:partial ? 'next' : null } });
    }
    if (route.request().resourceType()==='image') return route.fulfill({ status:imageFailure?404:200, contentType:'image/svg+xml', body:imageFailure ? '' : '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#34354c"/><text x="40" y="205" fill="white" font-size="52">SF6 · SAMPLE</text></svg>' });
    if(url.hostname!=='redesign.test') return route.abort();
    const file = url.pathname==='/' ? 'index.html' : url.pathname.slice(1);
    return route.fulfill({ body:await readFile(path.join(root,file)), contentType:{ '.html':'text/html', '.js':'text/javascript', '.css':'text/css' }[path.extname(file)] });
  });
  await page.goto(url);
  return { page, requests, setMode:m=>{currentMode=m;} };
}
const cards = async (page, count) => page.waitForFunction(count=>document.querySelectorAll('.stream-card').length===count,count);
try {
  const { page, requests } = await setup();
  await cards(page,4);
  assert.equal(requests.length,1);
  assert.equal(await page.locator('#app>section').count(),3,'home has only three content sections');
  assert.equal(await page.locator('.home-character[data-character="juri"] .home-character-count').innerText(),'5','multi-character videos count once within each character');
  await page.locator('.hero-primary').click();
  await page.waitForSelector('#persistent-player iframe');
  assert.equal(await page.locator('.player-position').innerText(),'1 / 8','home cap does not cap playback queue');
  await page.locator('#persistent-player iframe').evaluate(el=>window.__originalFrame=el);
  for(let i=0;i<4;i++) await page.locator('[data-zap-step="1"]').click();
  assert.equal(await page.locator('.player-position').innerText(),'5 / 8');
  await page.locator('[data-zap-home]').click();
  await cards(page,8);
  assert.equal(requests.length,1,'home/start/switch/full list reuse a single LIVE request');
  assert.equal(await page.locator('#persistent-player iframe').evaluate(el=>el===window.__originalFrame),true);
  evidence.homeToPlaybackToList={ requests:requests.length, queueSize:8, homeCards:4 };
  await page.locator('.nav-item[data-view="home"]').click();
  await page.locator('.home-character[data-character="juri"]').click();
  await cards(page,5);
  assert.equal(new URL(page.url()).searchParams.get('character'),'juri');
  assert.equal(new URL(page.url()).searchParams.get('view'),'explore');
  assert.equal(requests.length,1,'home character route does not fetch upcoming');
  await page.locator('#search-input').fill('ランクマッチ 3');
  await cards(page,1);
  const filteredUrl=page.url();
  assert.equal(new URL(filteredUrl).searchParams.get('q'),'ランクマッチ 3');
  await page.locator('.stream-title').click();
  assert.equal(await page.locator('.player-position').innerText(),'1 / 1');
  await page.goBack();
  await cards(page,1);
  assert.equal(await page.locator('#search-input').inputValue(),'ランクマッチ 3');
  await page.goForward();
  await page.waitForSelector('.zapping-page');
  assert.equal(requests.length,1,'search and browser history are local');
  const restored = await setup({ url:filteredUrl });
  await cards(restored.page,1);
  assert.equal(await restored.page.locator('[data-character-select]').inputValue(),'juri');
  assert.equal(restored.requests.length,1,'direct filtered route only needs initial LIVE');
  await restored.page.locator('[data-reset]').click();
  await cards(restored.page,8);
  assert.equal(new URL(restored.page.url()).searchParams.has('q'),false);
  assert.equal(new URL(restored.page.url()).searchParams.has('character'),false);
  evidence.characterSearchHistory={ requests:requests.length, restoredRequests:restored.requests.length };
  await restored.page.close(); await page.close();

  for(const mode of ['empty','one','error','loading']) {
    const test = await setup({ mode });
    if(mode==='loading') assert.equal(await test.page.locator('.hero-primary').isDisabled(),true);
    if(mode==='error') {
      await test.page.waitForSelector('.error-message');
      assert.equal(await test.page.locator('.hero-primary').isDisabled(),true);
      assert.equal(await test.page.locator('.empty').count(),0,'failure is distinct from no live streams');
      test.setMode('normal'); await test.page.locator('[data-retry="live"]').click(); await cards(test.page,4);
    } else if(mode==='empty') {
      await test.page.waitForSelector('.empty-actions');
      assert.equal(await test.page.locator('.hero-primary').isDisabled(),true);
      assert.equal(await test.page.locator('.empty-actions [data-go="upcoming"]').isVisible(),true);
      assert.equal(test.requests.length,1,'empty home does not fetch upcoming');
    } else await cards(test.page,mode==='one'?1:4);
    await test.page.close();
  }
  const partial=await setup({ partial:true });
  await cards(partial.page,4);
  assert.match(await partial.page.locator('.home-section-actions').innerText(),/8\+/);
  assert.match(await partial.page.locator('.home-character[data-character="juri"]').innerText(),/以上/);
  await partial.page.close();

  evidence.layouts=[];
  for(const [width,height] of [[320,760],[390,844],[760,1000],[820,900],[1024,768],[1440,1000],[2560,1440]]) {
    const test=await setup({ width,height, imageFailure:width===320 });
    await cards(test.page,4);
    if(width===320) {
      await test.page.waitForFunction(()=>document.querySelector('.hero-art img').complete);
      assert.equal(await test.page.locator('.hero-art img').isHidden(),true,'failed decorative artwork leaves no broken-image icon');
    }
    assert.equal(await test.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width} no page overflow`);
    assert.equal(await test.page.locator('.nav-item:visible').count(),4);
    if(width<=760) {
      const layout=await test.page.evaluate(()=>({ first:document.querySelector('.home-live-rail .thumb').getBoundingClientRect().top, nav:document.querySelector('.sidebar nav').getBoundingClientRect().top, rail:document.querySelector('.home-live-rail').scrollWidth>document.querySelector('.home-live-rail').clientWidth }));
      assert.ok(layout.first < layout.nav-30,`${width}: LIVE thumbnail begins in first viewport`);
      assert.equal(layout.rail,true,'mobile is a manual horizontal rail');
      await test.page.locator('.hero-primary').click();
      await test.page.waitForSelector('#persistent-player iframe');
      await test.page.locator('[data-zap-home]').click();
      const geometry=await test.page.evaluate(()=>({ player:document.querySelector('#persistent-player').getBoundingClientRect().bottom,nav:document.querySelector('.sidebar nav').getBoundingClientRect().top }));
      assert.ok(geometry.player<=geometry.nav,`${width}: mini-player clears nav`);
      await test.page.locator('[data-player="close"]').click();
      await test.page.locator('.nav-item[data-view="home"]').click();
    }
    await test.page.screenshot({ path:path.join(output,`home-${width}.png`),fullPage:true });
    evidence.layouts.push({ width,height,pass:true });
    await test.page.close();
  }
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'results.json'),JSON.stringify(evidence,null,2));
  console.log('PASS: homepage cap/full queue, one-request journey, character counts, filter URL/reload/history, empty/error/loading/partial states, responsive home and mini-player clearance.');
} finally { await browser.close(); }
