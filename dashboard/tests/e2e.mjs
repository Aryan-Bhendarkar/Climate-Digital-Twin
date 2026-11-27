// End-to-end check of the guided view in a real browser, against the live model server through devserver.py.
//   python serve.py --port 8000
//   python dashboard/devserver.py --port 8765
//   node dashboard/tests/e2e.mjs [--base http://127.0.0.1:8765] [--shots DIR]
// Uses whichever Playwright is installed (a local `playwright`, or the one inside a global @playwright/cli) and any
// Chromium or Edge it can find, so nothing has to be downloaded for it.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg('--base', 'http://127.0.0.1:8765'), SHOTS = arg('--shots', null), URL0 = `${BASE}/?server=api`;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

function playwright() {
  const require = createRequire(import.meta.url), tries = ['playwright', 'playwright-core'];
  try { const root = execSync('npm root -g').toString().trim(); for (const d of ['playwright', 'playwright-core', '@playwright/cli/node_modules/playwright']) tries.push(path.join(root, d)); } catch { /* no npm */ }
  for (const t of tries) { try { return require(t); } catch { /* next */ } }
  throw new Error('Playwright not found. Install it with: npm i -g playwright');
}
async function launch(chromium) {
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(process.env.LOCALAPPDATA || `${process.env.HOME}/.cache`, 'ms-playwright');
  const found = !existsSync(cache) ? [] : readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()
    .flatMap((d) => ['chrome-win64/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome'].map((x) => path.join(cache, d, x))).filter(existsSync);
  let last;
  for (const o of [{}, ...found.map((executablePath) => ({ executablePath })), { channel: 'msedge' }, { channel: 'chrome' }]) {
    try { return await chromium.launch({ ...o, args }); } catch (e) { last = e; }
  }
  throw last;
}

const fails = []; let passed = 0, shots = 0;
const check = (ok, msg) => { if (ok) passed++; else fails.push(msg); console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${String(++shots).padStart(2, '0')}_${name}.png`) }); };

const browser = await launch(playwright().chromium);
async function open(url, { width = 1440, height = 900, motion = 'reduce' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: motion }), page = await context.newPage();
  const bag = { errors: [], hosts: new Set() };
  page.on('console', (m) => { if (m.type() === 'error') bag.errors.push(m.text()); });
  page.on('pageerror', (e) => bag.errors.push(e.message));
  page.on('request', (r) => { if (!r.url().startsWith('data:')) bag.hosts.add(new URL(r.url()).hostname); });
  await page.goto(url);
  return { page, bag, context };
}
const ready = async (page) => { await page.waitForFunction(() => window.__story?.prime && !window.__story.busy, null, { timeout: 60000 }); await page.waitForTimeout(700); };
const idle = (page) => page.waitForFunction(() => !window.__story.busy, null, { timeout: 60000 });
const S = (page, key) => page.evaluate((k) => window.__story[k], key);
/** A point on the map that is the canvas itself (not covered by a panel) and, if asked, lies on the data grid. */
const mapPoint = (page, onGrid) => page.evaluate((grid) => {
  const c = document.getElementById('sMap');
  for (let y = 200; y < innerHeight - 250; y += 25) for (let x = grid ? 300 : 20; x < innerWidth - 480; x += 25) {
    if (document.elementFromPoint(x, y) !== c) continue;
    if (!!window.__app.map.cellAt({ clientX: x, clientY: y }) === grid) return { x, y };
  }
  return null;
}, onGrid);

// ---------------------------------------------------------------- days
{
  const { page, bag, context } = await open(`${URL0}#from=onset&sc=bob`);
  await ready(page);
  await page.click('#sDays [data-day="4"]');
  check(await S(page, 'day') === 4 && (await page.textContent('#dayDate')) === '1 Jun', 'day button: day 4 is 1 June');
  await page.click('#sNext'); check(await S(page, 'day') === 5, 'next arrow: day 5');
  await page.click('#sPrev'); await page.click('#sPrev'); check(await S(page, 'day') === 3, 'previous arrow: day 3');
  await page.keyboard.press('ArrowRight'); check(await S(page, 'day') === 4, 'arrow key with a player button focused');
  await page.click('#sDays [data-day="1"]'); await page.click('#sPrev', { force: true });
  check(await S(page, 'day') === 1 && (await page.getAttribute('#sPrev', 'aria-disabled')) === 'true', 'previous stops at day 1');
  await page.click('#sDays [data-day="7"]'); await page.click('#sPlay');
  check(await S(page, 'playing') === true && (await page.getAttribute('#sPlay', 'data-tip')) === 'Pause', 'play starts and offers Pause');
  await page.waitForFunction(() => !window.__story.playing, null, { timeout: 30000 });
  check(await S(page, 'day') === 10, 'play runs on to day 10 and stops there');
  await page.click('#sPlay'); await page.waitForTimeout(600);
  check(await S(page, 'day') < 10, 'play again starts over');
  await page.click('#sPlay'); check(await S(page, 'playing') === false, 'pause');
  await shot(page, 'days');

  // ------------------------------------------------------------ zoom and map buttons
  const dist = () => page.evaluate(() => window.__app.map.goal.dist);
  await page.click('#mcHome'); await page.waitForTimeout(900);
  const on = await mapPoint(page, true); const d0 = await dist();
  await page.mouse.move(on.x, on.y); await page.mouse.wheel(0, -100); await page.waitForTimeout(500);
  const ratio = (await dist()) / d0; check(ratio > 0.7 && ratio < 0.78, `one wheel notch zooms to ${ratio.toFixed(2)} of the distance`);
  const d1 = await dist(); await page.click('#mcIn'); await page.waitForTimeout(600);
  check(Math.abs((await dist()) / d1 - 0.58) < 0.03, 'zoom-in button');
  await page.click('#mcTop'); await page.waitForTimeout(1500);
  check((await page.textContent('#mcTop')).trim() === '3D', '2D button looks straight down and then offers 3D');
  await page.click('#mcTop'); await page.waitForTimeout(1500); check((await page.textContent('#mcTop')).trim() === '2D', '3D tilts back');
  await page.click('#mcHome'); await page.waitForTimeout(900);

  // ------------------------------------------------------------ every control explains itself
  const bare = await page.evaluate(() => [...document.querySelectorAll('#story button')].filter((b) => b.offsetParent && !b.textContent.trim().match(/[A-Za-z]{2}/) && !b.classList.contains('s-pin'))
    .map((b) => ({ id: b.id || b.className || b.textContent, name: b.getAttribute('aria-label') || b.title, tip: b.dataset.tip || b.title })).filter((b) => !b.name || !b.tip));
  check(!bare.length, `every icon button has a name and a hover tip ${JSON.stringify(bare)}`);
  const long = await page.evaluate(() => [...document.querySelectorAll('[data-tip]')].map((e) => e.dataset.tip).filter((t) => t.split(/\s+/).length > 2));
  check(!long.length, `hover tips are one or two words ${long}`);
  await page.hover('#mcHome'); await page.waitForTimeout(400);
  check(await page.evaluate(() => getComputedStyle(document.getElementById('mcHome'), '::after').opacity) === '1', 'tooltip shows on hover');
  await shot(page, 'tooltip');

  // ------------------------------------------------------------ places are clickable
  const label = await page.evaluate(() => {
    const m = window.__app.map, c = document.getElementById('sMap'), r = c.getBoundingClientRect();
    for (const h of m.hits) { if (h.place.kind !== 'city') continue; const x = r.left + h.x + h.w - 8, y = r.top + h.y + h.h / 2; if (document.elementFromPoint(x, y) === c && m.placeAt({ clientX: x, clientY: y }) === h.place) return { x, y, name: h.place.name }; }
    return null;
  });
  check(!!label, 'a city name is on the map');
  await page.mouse.click(label.x, label.y); await page.waitForSelector('#placeCard:not([hidden])'); await page.waitForTimeout(400);
  check((await page.textContent('#placeCard h3')) === label.name, `clicking the name opens ${label.name}`);
  const lines = await page.$$eval('.s-feels p', (p) => p.map((x) => x.textContent));
  check(lines.length === 2 && lines.every((l) => l.length > 30 && /\.$/.test(l)), `two lines on how it feels: ${lines.join(' ')}`);
  await page.click('#sDays [data-day="4"]'); const before = await page.textContent('.s-dayline b');
  await page.click('.s-dayline [data-step="1"]');
  check(await S(page, 'day') === 5 && (await page.textContent('.s-dayline b')) !== before, 'the report steps a day forward');
  check(await page.evaluate(() => document.activeElement?.dataset.step) === '1', 'focus stays on the step button');
  await page.click('.s-dayline [data-step="-1"]'); check(await S(page, 'day') === 4, 'and a day back');
  await shot(page, 'place_report');
  await page.click('#pcClose'); await page.click('#sSteps .s-pl'); await page.waitForTimeout(500);
  check(await page.isVisible('#placeCard'), 'a city named in the headline is a button');
  check(!bag.errors.length, `no console errors ${bag.errors.slice(0, 3)}`);
  check([...bag.hosts].every((h) => h === new URL(BASE).hostname), `only local requests: ${[...bag.hosts]}`);
  await context.close();
}

// ---------------------------------------------------------------- drawing an area
{
  const { page, bag, context } = await open(URL0);
  await ready(page);
  await page.click('#segGroup [data-group="mix"]');
  const cursor = async () => { const p = await mapPoint(page, true); await page.mouse.move(p.x, p.y); await page.waitForTimeout(150); return page.evaluate(() => getComputedStyle(document.getElementById('sMap')).cursor); };
  check(await S(page, 'drawing') === false && (await cursor()) !== 'crosshair', 'opening "Build your own" does not take over the cursor');
  await page.click('#cuDraw'); check(await S(page, 'drawing') === true && (await cursor()) === 'crosshair' && await page.isVisible('#drawHint'), 'Draw switches drawing on, with a hint');
  await shot(page, 'drawing');
  const a = await page.evaluate(() => { // a drag that starts and ends on the data grid, clear of everything
    const c = document.getElementById('sMap'), ok = (x, y) => document.elementFromPoint(x, y) === c && !!window.__app.map.cellAt({ clientX: x, clientY: y });
    for (let y = 250; y < innerHeight - 350; y += 20) for (let x = 250; x < innerWidth - 650; x += 20) if (ok(x, y) && ok(x + 140, y + 100)) return { x, y };
    return null;
  });
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 140, a.y + 100, { steps: 6 }); await page.mouse.up();
  check(await S(page, 'drawing') === false && await page.inputValue('#cuWhere') === 'drawn' && !!(await S(page, 'drawn')), 'one drag picks the area and ends drawing');
  check((await cursor()) !== 'crosshair', 'the cursor is back to normal');
  const drawn = await S(page, 'drawn');
  await page.mouse.move(a.x + 140, a.y + 100); await page.mouse.down(); await page.mouse.move(a.x + 40, a.y + 60, { steps: 5 }); await page.mouse.up();
  check(JSON.stringify(await S(page, 'drawn')) === JSON.stringify(drawn), 'a later drag moves the map and leaves the area alone');
  await page.click('#cuDraw'); await page.click('#mixRows'); check(await S(page, 'drawing') === false, 'a click outside the map stops drawing');
  await page.click('#mcDraw'); check(await S(page, 'drawing') === true, 'the map toolbar starts drawing');
  await page.keyboard.press('Escape'); check(await S(page, 'drawing') === false, 'Esc stops drawing');
  await page.click('#mcHome'); await page.waitForTimeout(900);
  await page.click('#mcDraw'); const off = await mapPoint(page, false);
  if (off) { await page.mouse.click(off.x, off.y); check(await S(page, 'drawing') === false, 'a click off the map data stops drawing'); } else check(false, 'found no point off the grid');
  await page.click('#mcDraw'); await page.click('#tab-test'); check(await S(page, 'drawing') === false, 'changing tab stops drawing');
  await page.click('#tab-ask'); await page.click('#segGroup [data-group="mix"]');
  await page.locator('#mx-t2m').fill('2'); await page.click('#cuRun'); await idle(page); await page.waitForTimeout(500);
  check((await page.textContent('#capTitle')).includes('area you drew'), 'the drawn area runs as a change');
  check(!bag.errors.length, `no console errors ${bag.errors.slice(0, 3)}`);
  await context.close();
}

// ---------------------------------------------------------------- product tour
async function tour(page, label, size) { // size: the context options of this run
  await page.click('#btnTour');
  const total = +(await page.textContent('#tourCount')).split(' of ')[1];
  check(total >= 30, `${label}: the tour has ${total} stops`); // phones skip the stops for things they do not have
  const bad = [];
  for (let n = 1; n <= total; n++) {
    await page.waitForFunction((k) => document.getElementById('sTour').dataset.step === String(k) && !document.getElementById('sTour').classList.contains('busy'), n, { timeout: 60000 });
    await page.waitForTimeout(size?.motion === 'no-preference' ? 2200 : 900);
    const r = await page.evaluate(() => {
      const c = document.getElementById('sTour').getBoundingClientRect(), s = document.getElementById('sSpot').getBoundingClientRect();
      const over = Math.max(0, Math.min(c.right, s.right) - Math.max(c.left, s.left)) * Math.max(0, Math.min(c.bottom, s.bottom) - Math.max(c.top, s.top));
      return { title: document.getElementById('tourTitle').textContent, inside: c.left >= 0 && c.top >= 0 && c.right <= innerWidth + 1 && c.bottom <= innerHeight + 1, lit: s.width > 20 && s.height > 20 && s.bottom > 0 && s.top < innerHeight && s.right > 0 && s.left < innerWidth, covered: s.width > 20 && s.height > 20 ? over / (s.width * s.height) : 0, card: [c.left, c.top, c.right, c.bottom].map(Math.round).join(), spot: [s.left, s.top, s.right, s.bottom].map(Math.round).join() };
    });
    const why = [!r.inside && 'card off screen', n > 1 && !r.lit && 'nothing lit', r.covered > 0.75 && `card covers ${Math.round(r.covered * 100)} % of its target`].filter(Boolean);
    if (why.length) bad.push(`${n} "${r.title}": ${why.join(', ')} [card ${r.card} spot ${r.spot}]`);
    await shot(page, `${label}_tour_${String(n).padStart(2, '0')}`);
    if (n < total) await page.click('#sTour [data-act="next"]');
  }
  check(!bad.length, `${label}: every stop lights its target with the card on screen ${bad.join(' | ')}`);
  return total;
}
{
  const { page, bag, context } = await open(URL0);
  await ready(page);
  const total = await tour(page, 'wide');
  check(await page.isVisible('#sTour [data-act="tech"]'), 'the last stop offers the technical walkthrough');
  await page.click('#sTour [data-act="back"]'); await page.waitForTimeout(500);
  check((await page.textContent('#tourCount')).startsWith(`${total - 1} of`), 'Back goes back');
  await page.click('#tourChapters [data-chapter="Build your own"]'); await page.waitForTimeout(1500);
  check((await page.textContent('#tourTitle')) === 'Mix any change' && await page.isVisible('#mix'), 'a chapter jumps straight to its first stop');
  await page.click('#tourChapters [data-chapter="Who feels it"]'); await idle(page); await page.waitForTimeout(800);
  check(await page.isVisible('#hdMain') && !(await page.isVisible('#mix')), 'jumping back restores that screen');
  await page.keyboard.press('Escape'); check(await page.isHidden('#sTour') && await page.isHidden('#sSpot'), 'Esc ends the tour');
  check(await S(page, 'drawing') === false && await S(page, 'playing') === false, 'nothing is left running');
  await page.click('#btnTour'); await page.click('#tourChapters [data-chapter="Tools"]'); await page.waitForTimeout(500);
  await page.click('#tourChapters [data-chapter="Tools"]'); await page.waitForTimeout(500);
  for (let k = 0; k < 2; k++) { await page.click('#sTour [data-act="next"]'); await page.waitForTimeout(500); }
  await page.click('#sTour [data-act="tech"]'); await page.waitForSelector('#tkWalk:not([hidden])');

  // ------------------------------------------------------------ technical screen and walkthrough
  const sections = await page.$$eval('.tk-nav button', (b) => b.length);
  check(sections >= 8 && (await page.textContent('#tkCount')) === `1 of ${sections}`, `walkthrough starts at 1 of ${sections}`);
  for (let n = 1; n <= sections; n++) {
    await page.waitForTimeout(450);
    const v = await page.evaluate(() => ({ shown: [...document.querySelectorAll('#tkMain section')].filter((s) => s.offsetParent).length, wide: document.getElementById('tkMain').scrollWidth - document.getElementById('tkMain').clientWidth }));
    check(v.shown === 1 && v.wide <= 1, `walkthrough ${n}: one section, no sideways scroll`);
    await shot(page, `tech_${n}`);
    await page.click('#tkWalk [data-tk="next"]');
  }
  check(await page.isHidden('#tkWalk'), 'Finish ends the walkthrough');
  await page.click('.tk-nav [data-go="reach"]'); await page.click('[data-reach="3"]');
  check((await page.textContent('#tkReachText')).includes('24 squares'), 'the reach diagram answers a click');
  await page.click('.tk-nav [data-go="serving"]'); await page.waitForTimeout(600);
  check((await page.textContent('#tkLive')).includes('monsoon-multiverse'), 'live model name from the server');
  await page.keyboard.press('Escape'); check(await page.isHidden('#tech'), 'Esc closes How it works');
  await page.click('#tab-test'); await page.click('[data-tech="metrics"]'); await page.waitForSelector('#tech:not([hidden])');
  check(await page.getAttribute('.tk-nav [data-go="metrics"]', 'aria-current') === 'true', 'Proof links to the scores');
  await page.click('[data-tk="close"]');
  await page.click('#btnExpert'); await page.waitForFunction(() => !document.getElementById('expert').hidden); await page.waitForTimeout(1500);
  await page.click('#btnHow'); await page.waitForSelector('#tech:not([hidden])'); check(true, 'How it works opens from the Expert view');
  await page.click('[data-tk="close"]'); await page.click('#btnStory'); check(await page.isVisible('#story'), 'back to the map');
  check(!bag.errors.length, `tour and tech: no console errors ${bag.errors.slice(0, 3)}`);
  check([...bag.hosts].every((h) => h === new URL(BASE).hostname), `tour and tech: only local requests: ${[...bag.hosts]}`);
  await context.close();
}

// ---------------------------------------------------------------- with motion on, smaller screens, flat map
for (const [label, size, url] of [['motion_1366', { width: 1366, height: 768, motion: 'no-preference' }, URL0], ['phone', { width: 390, height: 844 }, URL0], ['flat', { width: 1440, height: 900 }, `${URL0}&flat=1`]]) {
  const { page, bag, context } = await open(url, size);
  await ready(page);
  await tour(page, label, size);
  await page.click('#sTour [data-act="next"]');
  await page.click('#btnTech'); await page.waitForTimeout(600); await shot(page, `${label}_tech`);
  await page.click('[data-tk="close"]');
  const over = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, document.getElementById('story').scrollWidth - document.getElementById('story').clientWidth));
  check(over <= 1, `${label}: no sideways scroll (${over}px)`);
  check(!bag.errors.length, `${label}: no console errors ${bag.errors.slice(0, 3)}`);
  await context.close();
}

// ---------------------------------------------------------------- server down
{
  const { page, context } = await open(`${BASE}/?server=http://127.0.0.1:9`);
  await page.waitForSelector('#sBanner:not([hidden])', { timeout: 30000 });
  await page.click('#btnTour'); check(await page.isHidden('#sTour') && (await page.textContent('#sBannerTxt')).includes('serve.py'), 'server down: the tour says how to start it');
  await page.click('#sDays [data-day="3"]'); check(await S(page, 'day') === 3, 'server down: days still respond');
  await page.click('#btnTech'); await page.waitForTimeout(4000); check((await page.textContent('#tkLive')).includes('not reachable'), 'server down: How it works still opens');
  await context.close();
}

// ---------------------------------------------------------------- same figures as the second UI
{
  const lead = (s) => (s.replace(/ /g, ' ').match(/^\s*([+−-]?[\d.]+)/) || [])[1];
  const { page, context } = await open(URL0); await ready(page);
  const ours = [];
  for (const id of ['bob', 'weak', 'arab', 'dry', 'lowp']) { await page.click(`.s-card[data-id="${id}"]`); await idle(page); await page.waitForTimeout(400); ours.push([await page.textContent('#farmBig'), await page.textContent('#windBig')].map(lead)); }
  await context.close();
  const v2 = await open(`${BASE}/v2/?server=api&auto=none`); await v2.page.waitForSelector('.rows', { timeout: 30000 }); await v2.page.waitForTimeout(1500);
  for (let i = 0; i < 5; i++) {
    await v2.page.locator('.rows .row').nth(i).click(); await v2.page.waitForFunction(() => !document.querySelector('.busy-veil'), null, { timeout: 30000 }); await v2.page.waitForTimeout(900);
    const theirs = (await v2.page.locator('.fig .big').allInnerTexts()).map(lead);
    check(ours[i][0] === theirs[0] && ours[i][1] === theirs[2], `scenario ${i + 1}: rain and wind figures match the second UI (${ours[i]} / ${[theirs[0], theirs[2]]})`);
  }
  await v2.context.close();
}

await browser.close();
console.log(`\n${passed} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
