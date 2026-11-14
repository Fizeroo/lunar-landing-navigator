// Optional real-browser check (not part of `npm test`). Needs Microsoft Edge and `npm i --no-save playwright-core`.
// Usage: node tests/browser/ui-flow.mjs [url]   (default http://127.0.0.1:4173/; screenshots go to $UI_FLOW_SHOTS or cwd)
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 772 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const text = (sel) => page.locator(sel).first().innerText();
const val = (sel) => page.locator(sel).inputValue();
const cursorLeft = () => page.evaluate(() => parseFloat(document.querySelector('.tl-cursor').style.left));

await page.goto(process.argv[2] ?? 'http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.tl-bar');
await page.waitForTimeout(1500);

// layout
const m = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sites: [document.getElementById('sites').scrollHeight, document.getElementById('sites').clientHeight], vp: (() => { const r = document.querySelector('.viewport').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(), cmp: (() => { const r = document.querySelector('.comparison').getBoundingClientRect(); const p = document.querySelector('.timepanel').getBoundingClientRect(); return [Math.round(r.bottom), Math.round(p.bottom)]; })() }));
check('no page or site-card scroll at 1440x772 content size', m.sh <= m.ch && m.sw <= m.cw && m.sites[0] <= m.sites[1], JSON.stringify(m));
check('six timeline rows', (await page.locator('.tl-track').count()) === 6);
check('three conditions x two sites in table', (await page.locator('strong.cmp-num').count()) === 6);
check('three conclusion sentences', (await page.locator('.cmp-sentences li').count()) === 3);
await page.screenshot({ path: (process.env.UI_FLOW_SHOTS ?? '.') + '/flow-1-initial.png' });

// bar percent vs table percent consistency
const rowPct = await page.locator('.tl-summary').allInnerTexts();
const tablePct = await page.locator('strong.cmp-num').allInnerTexts();
// rows: A sun, A earth, A both, B sun, B earth, B both ; table: sunA, sunB, earthA, earthB, bothA, bothB
check('timeline shares equal table shares', rowPct[0] === tablePct[0] && rowPct[3] === tablePct[1] && rowPct[1] === tablePct[2] && rowPct[4] === tablePct[3] && rowPct[2] === tablePct[4] && rowPct[5] === tablePct[5], rowPct.slice(0, 6).join(',') + ' | ' + tablePct.join(','));

// timeline click sets time and syncs slider + utc input
const box = await page.locator('.tl-tracks').boundingBox();
await page.mouse.click(box.x + box.width * 0.5, box.y + 30);
await page.waitForTimeout(200);
const utcMid = await val('#utc-input');
const cur = await cursorLeft();
const slider = await page.evaluate(() => { const s = document.getElementById('time-slider'); return (Number(s.value) - Number(s.min)) / (Number(s.max) - Number(s.min)); });
check('timeline click moves cursor to ~50%', Math.abs(cur - 50) < 0.5, `cursor ${cur.toFixed(2)}% utc ${utcMid}`);
check('slider synchronised with cursor', Math.abs(slider * 100 - cur) < 0.01);
check('UTC field shows mid-period time', utcMid.startsWith('2026-11-1'), utcMid);

// tooltip on bar hover
await page.locator('.tl-bar').first().hover();
await page.waitForTimeout(150);
const tip = await text('.tl-tooltip');
check('bar tooltip shows minute-rounded UTC and approximate duration', /UTC → .*UTC/.test(tip) && /approximate/.test(tip), tip.replace(/\n/g, ' / '));

// playing advances time, cursor, readouts; analysis not recomputed (bars DOM nodes identical)
await page.evaluate(() => { window.__bar = document.querySelector('.tl-bar'); });
const altBefore = await text('.site-a .readout-value');
await page.click('#play');
await page.waitForTimeout(1500);
const playingLabel = await text('#play');
await page.click('#play');
const utcAfter = await val('#utc-input');
const curAfter = await cursorLeft();
const altAfter = await text('.site-a .readout-value');
const sameBar = await page.evaluate(() => window.__bar === document.querySelector('.tl-bar'));
check('play advances time and cursor', utcAfter !== utcMid && curAfter > cur, `${utcMid} -> ${utcAfter}`);
check('play button shows Pause while playing', /Pause/.test(playingLabel));
check('readouts change during playback', altBefore !== altAfter, `${altBefore} -> ${altAfter}`);
check('bars not rebuilt during playback (analysis cached)', sameBar);

// typed UTC
await page.fill('#utc-input', '2026-11-14T00:00:00Z');
await page.press('#utc-input', 'Enter');
await page.waitForTimeout(150);
check('typed UTC accepted', (await val('#utc-input')) === '2026-11-14T00:00:00Z');
await page.fill('#utc-input', '2026-12-05T00:00:00Z');
await page.press('#utc-input', 'Enter');
const err1 = await text('#time-error');
check('out-of-coverage UTC rejected with English error', /outside supported coverage/i.test(err1), err1);
await page.fill('#utc-input', '2026-11-14 00:00');
await page.press('#utc-input', 'Enter');
check('UTC without Z rejected', /ending in Z/.test(await text('#time-error')));

// exact reference check carried from the first slice: lat -89 lon 0 at 2026-11-14T00:00:00Z
await page.fill('#utc-input', '2026-11-14T00:00:00Z');
await page.press('#utc-input', 'Enter');
await page.fill('.site-a input[aria-label*="latitude"]', '-89');
await page.fill('.site-a input[aria-label*="longitude"]', '0');
await page.click('.site-a .site-form button[type=submit]');
await page.waitForTimeout(300);
const readA = (await page.locator('.site-a .readout').innerText()).replace(/\s+/g, ' ');
check('reference fixture: Sun az 126.6 alt +0.96; Earth az 358.8 alt -3.65', /alt \+0\.96°/.test(readA) && /az 126\.6°/.test(readA) && /alt −3\.65°/.test(readA) && /az 358\.8°/.test(readA), readA);
check('custom point labelled as custom', /custom point/.test(await text('.site-a h2')));

// exact pole: azimuth undefined, no invented marker
await page.fill('.site-a input[aria-label*="latitude"]', '-90');
await page.click('.site-a .site-form button[type=submit]');
await page.waitForTimeout(300);
const poleRead = (await page.locator('.site-a .readout').innerText()).replace(/\s+/g, ' ');
const discsShown = await page.evaluate(() => [...document.querySelectorAll('.site-a .sky-disc')].filter((d) => d.style.display !== 'none').length);
const bandText = await page.evaluate(() => [...document.querySelectorAll('.site-a .sky-band-label')].filter((d) => d.style.display !== 'none').map((d) => d.textContent).join(' | '));
check('exact pole: azimuth undefined in readout', (poleRead.match(/az undefined/g) ?? []).length === 2, poleRead);
check('exact pole: no disc drawn at invented azimuth, altitude band explained', discsShown === 0 && /azimuth undefined/.test(bandText), bandText);
await page.screenshot({ path: (process.env.UI_FLOW_SHOTS ?? '.') + '/flow-2-pole.png' });

// invalid coordinates
await page.fill('.site-a input[aria-label*="latitude"]', '95');
await page.click('.site-a .site-form button[type=submit]');
check('invalid latitude rejected', /Latitude must be/.test(await text('.site-a .field-error')));

// preset select
await page.selectOption('.site-a select', 'malapert');
await page.waitForTimeout(300);
check('preset sets coordinates and source link', /Malapert/.test(await text('.site-a h2')) && /85\.0000° S, 11\.4000° E/.test(await text('.site-a .site-coords')) && (await page.locator('.site-a .site-source a').getAttribute('href')) === 'https://planetarynames.wr.usgs.gov/Feature/3603');

// pick on globe for site B
await page.click('.site-b .pick');
const hint = await text('#pick-hint');
const vp = await page.locator('.viewport').boundingBox();
const coordsBefore = await text('.site-b .site-coords');
const aBefore = await text('.site-a .site-coords');
await page.mouse.click(vp.x + vp.width * 0.5, vp.y + vp.height * 0.55);
await page.waitForTimeout(400);
const coordsAfter = await text('.site-b .site-coords');
check('globe click moves active Site B only', coordsAfter !== coordsBefore && (await text('.site-a .site-coords')) === aBefore && /Site B/.test(hint), `${coordsBefore} -> ${coordsAfter}`);
check('picked site becomes custom point', /custom point/.test(await text('.site-b h2')));

// orbit drag must not change coordinates or angles
const before = (await page.locator('.site-b .readout').innerText());
await page.mouse.move(vp.x + 100, vp.y + 200);
await page.mouse.down();
await page.mouse.move(vp.x + 300, vp.y + 260, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
check('camera drag changes no coordinates or angles', (await text('.site-b .site-coords')) === coordsAfter && (await page.locator('.site-b .readout').innerText()) === before);

// period change: both sites same period, time clamped
await page.fill('#period-start', '2026-11-20T00:00:00Z');
await page.fill('#period-end', '2026-11-27T00:00:00Z');
await page.click('#period-apply');
await page.waitForTimeout(400);
const utcClamped = await val('#utc-input');
const ticks = await page.locator('.tl-tick-label').allInnerTexts();
check('period change clamps current time into period', utcClamped === '2026-11-20T00:00:00Z', utcClamped);
check('axis shows new period', ticks[0].startsWith('2026-11-20'), ticks.join(','));
const total = await page.locator('.cmp-num').allInnerTexts();
check('totals bounded by 7-day period', total.every((t) => !/\b([89]|[1-9]\d) d/.test(t)), total.join(' | '));
await page.screenshot({ path: (process.env.UI_FLOW_SHOTS ?? '.') + '/flow-3-week.png' });
await page.fill('#period-start', '2026-11-27T00:00:00Z');
await page.fill('#period-end', '2026-11-20T00:00:00Z');
await page.click('#period-apply');
check('reversed period rejected', /earlier than/.test(await text('#time-error')));
await page.click('#period-full');
await page.waitForTimeout(300);
check('full range restores dataset bounds', (await val('#period-start')) === '2026-11-01T00:00:00Z' && (await val('#period-end')) === '2026-12-01T00:00:00Z');

// end of coverage reachable
await page.fill('#utc-input', '2026-12-01T00:00:00Z');
await page.press('#utc-input', 'Enter');
await page.waitForTimeout(150);
check('exact end of coverage accepted', (await val('#utc-input')) === '2026-12-01T00:00:00Z' && Math.abs((await cursorLeft()) - 100) < 1e-6);

// language
const body = await page.evaluate(() => document.body.innerText + [...document.querySelectorAll('[title],[aria-label],[placeholder]')].map((e) => (e.getAttribute('title') ?? '') + (e.getAttribute('aria-label') ?? '') + (e.getAttribute('placeholder') ?? '')).join(' '));
check('no Cyrillic text in UI, titles or ARIA', !/[А-Яа-яЁё]/.test(body));
check('html lang is en', (await page.evaluate(() => document.documentElement.lang)) === 'en');
check('disclaimer visible', await page.locator('.disclaimer').isVisible());
check('no console errors', errors.length === 0, errors.join(' | '));

console.log(results.join('\n'));
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
await browser.close();
