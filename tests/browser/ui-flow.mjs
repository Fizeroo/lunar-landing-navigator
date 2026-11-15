// SUPERSEDED for the immersive layout: this script targets the earlier side-panel UI and is kept for reference only.
// The current real-browser check is tests/browser/immersive-flow.mjs.
// Optional real-browser check (not part of `npm test`). Needs Microsoft Edge and `npm i --no-save playwright-core`.
// Usage: node tests/browser/ui-flow.mjs [url] [screenshot-dir]
//   url default http://127.0.0.1:4173/ ; screenshots default ./artifacts
// The viewport is the CONTENT size of a maximised window on a 1440x852 screen.
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const shots = process.argv[3] ?? 'artifacts';
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 772 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const text = (sel) => page.locator(sel).first().innerText();
const val = (sel) => page.locator(sel).inputValue();
const cursorLeft = () => page.evaluate(() => parseFloat(document.querySelector('.tl-cursor').style.left));
const layout = () => page.evaluate(() => {
  const d = document.documentElement;
  const s = document.getElementById('sites');
  const r = document.querySelector('.viewport').getBoundingClientRect();
  const clipped = [...document.querySelectorAll('.cmp-num, .cmp-label, .readout-value, .readout-state, .site-coords, .tl-label, .event-when, .event-countdown, .tab, .top-actions .btn')]
    .filter((n) => n.offsetParent !== null && n.scrollWidth > n.clientWidth + 1).map((n) => `${n.className}:${n.textContent}`);
  return { pageFits: d.scrollHeight <= d.clientHeight && d.scrollWidth <= d.clientWidth, sitesFit: s.scrollHeight <= s.clientHeight && s.scrollWidth <= s.clientWidth, moon: [Math.round(r.width), Math.round(r.height)], clipped };
});
const setSite = async (card, lat, lon, height) => {
  await page.evaluate((c) => { document.querySelector(`${c} details.site-fold`).open = true; }, card);
  await page.fill(`${card} input[aria-label*="latitude"]`, String(lat));
  await page.fill(`${card} input[aria-label*="longitude"]`, String(lon));
  if (height !== undefined) await page.fill(`${card} input[aria-label*="height"]`, String(height));
  await page.click(`${card} .site-form button[type=submit]`);
  await page.waitForTimeout(250);
  await page.evaluate((c) => { document.querySelector(`${c} details.site-fold`).open = false; }, card);
};
const goTo = async (utc) => {
  await page.fill('#utc-input', utc);
  await page.press('#utc-input', 'Enter');
  await page.waitForTimeout(150);
};

await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(() => window.localStorage.clear());
await page.goto(url, { waitUntil: 'networkidle' });
// Since the mission-window layout, Sites A/B, the timeline and the comparison are folded by default.
// This script checks that earlier detail, so it opens the three folds after every load.
const openFolds = (p) => p.evaluate(() => { for (const id of ['fold-sites', 'fold-timeline', 'fold-comparison']) document.getElementById(id).open = true; });
await openFolds(page);
await page.waitForSelector('.tl-bar', { timeout: 20000 });
await page.waitForTimeout(1500);

// ---------- Moon overview: layout, timeline, comparison ----------
let m = await layout();
check('overview: no page or site-card scrolling at 1440x772', m.pageFits && m.sitesFit, `moon ${m.moon.join('x')}`);
check('overview: no clipped text in cards, tabs, table', m.clipped.length === 0, m.clipped.join(' | '));
check('extended dataset loaded', /2026-10-01 to 2027-02-01/.test(await text('#data-status')), await text('#data-status'));
check('header no longer shows frame/kernel details', !/MOON_ME|SPICE|frame/i.test(await text('#data-status')));
check('six timeline rows and 3x2 comparison shares', (await page.locator('.tl-track').count()) === 6 && (await page.locator('strong.cmp-num').count()) === 6);
const rowPct = await page.locator('.tl-summary').allInnerTexts();
const tablePct = await page.locator('strong.cmp-num').allInnerTexts();
check('timeline shares equal table shares', rowPct[0] === tablePct[0] && rowPct[3] === tablePct[1] && rowPct[1] === tablePct[2] && rowPct[4] === tablePct[3] && rowPct[2] === tablePct[4] && rowPct[5] === tablePct[5]);
check('comparison and timeline are labelled reference-sphere', /reference-sphere/i.test(await text('#fold-timeline summary')) && /reference-sphere/i.test(await text('#fold-comparison summary')));
await page.screenshot({ path: `${shots}/01-moon-overview.png` });

// ---------- events and countdowns ----------
await goTo('2026-11-01T00:00:00Z');
const eventsB = (await page.locator('.site-b .events').innerText()).replace(/\s+/g, ' ');
check('Site B lists sunrise, sunset, earthrise, earthset and a Sun + Earth row with countdowns', /Sunrise 20\d\d-\d\d-\d\d \d\d:\d\d UTC in ≈/.test(eventsB) && /Sunset/.test(eventsB) && /Earthrise/.test(eventsB) && /Earthset/.test(eventsB) && /Sun \+ Earth/.test(eventsB), eventsB.slice(0, 160));
check('events are labelled as searched in all available data', /Searched in all available data \(2026-10-01 to 2027-02-01\)/.test(await text('.site-b .events-note')));
const sunriseText = (await page.locator('.site-b .event-when').first().innerText()).trim();
await page.locator('.site-b .events .btn').first().click();
await page.waitForTimeout(200);
const afterJump = await val('#utc-input');
check('Go jumps the shared time to that event (to the minute)', afterJump.slice(0, 16).replace('T', ' ') === sunriseText.slice(0, 16) || Math.abs(Date.parse(afterJump) - Date.parse(sunriseText.slice(0, 16).replace(' ', 'T') + ':00Z')) <= 60000, `${sunriseText} -> ${afterJump}`);
const altAtRise = await text('.site-b .readout-value');
check('at the sunrise event the Sun altitude is ~0', /alt [+−]?0\.0\d°/.test(altAtRise), altAtRise);
await setSite('.site-a', -89.67, 129.78, 0);
const eventsA = (await page.locator('.site-a .events').innerText()).replace(/\s+/g, ' ');
check('missing events say "Not found within available data", never "never"', !/never/i.test(eventsA), eventsA.slice(0, 140));

// ---------- time controls ----------
await page.click('#period-full');
const box = await page.locator('.tl-tracks').boundingBox();
await page.mouse.click(box.x + box.width * 0.5, box.y + 30);
await page.waitForTimeout(200);
const cur = await cursorLeft();
const slider = await page.evaluate(() => { const s = document.getElementById('time-slider'); return (Number(s.value) - Number(s.min)) / (Number(s.max) - Number(s.min)); });
check('timeline click moves cursor, slider and UTC field together', Math.abs(cur - 50) < 0.5 && Math.abs(slider * 100 - cur) < 0.01, `cursor ${cur.toFixed(2)}% utc ${await val('#utc-input')}`);
await page.locator('.tl-bar').first().hover();
await page.waitForTimeout(150);
check('bar tooltip shows minute-rounded UTC and approximate duration', /UTC → .*UTC/.test(await text('.tl-tooltip')) && /approximate/.test(await text('.tl-tooltip')));
await page.evaluate(() => { window.__bar = document.querySelector('.tl-bar'); });
const before = await val('#utc-input');
await page.click('#play');
await page.waitForTimeout(1400);
const playing = await text('#play');
await page.click('#play');
check('play advances time; bars are not rebuilt (analysis cached)', (await val('#utc-input')) !== before && /Pause/.test(playing) && (await page.evaluate(() => window.__bar === document.querySelector('.tl-bar'))));
await goTo('2027-03-01T00:00:00Z');
check('out-of-coverage UTC rejected in English', /outside supported coverage/i.test(await text('#time-error')), await text('#time-error'));
await goTo('2026-11-14 00:00');
check('UTC without Z rejected', /ending in Z/.test(await text('#time-error')));
await goTo('2027-02-01T00:00:00Z');
check('exact end of coverage accepted', (await val('#utc-input')) === '2027-02-01T00:00:00Z');
const atEnd = (await page.locator('.site-b .events').innerText()).replace(/\s+/g, ' ');
check('at the end of data no event is invented', (atEnd.match(/Not found within available data/g) ?? []).length === 4, atEnd.slice(0, 200));

// ---------- site input, fixture, pole, height ----------
await goTo('2026-11-14T00:00:00Z');
await setSite('.site-a', -89, 0, 0);
const readA = (await page.locator('.site-a .readout').innerText()).replace(/\s+/g, ' ');
check('reference fixture 89S 0E 2026-11-14: Sun +0.96/126.6, Earth -3.65/358.8', /alt \+0\.96°/.test(readA) && /az 126\.6°/.test(readA) && /alt −3\.65°/.test(readA) && /az 358\.8°/.test(readA), readA);
await setSite('.site-a', -89, 0, 1000);
const model = await text('.site-a .site-model');
check('height 1000 m: card states reference-sphere model and the 1.94° limb dip', /observer 1000 m/.test(model) && /1\.94°/.test(model), model);
const readHigh = (await page.locator('.site-a .readout').innerText()).replace(/\s+/g, ' ');
check('height keeps the same reference plane: angles change by under 0.01°', /alt \+0\.9[56]°/.test(readHigh) && /alt −3\.6[45]°/.test(readHigh), readHigh);
await setSite('.site-a', -90, 0, 0);
check('exact pole: azimuth undefined', ((await page.locator('.site-a .readout').innerText()).match(/az undefined/g) ?? []).length === 2);
await setSite('.site-a', 95, 0, 0);
check('invalid latitude rejected', /Latitude must be/.test(await text('.site-a .field-error')));
await page.evaluate(() => { document.querySelector('.site-a details.site-fold').open = false; });

// ---------- catalogue ----------
await page.click('#open-catalogue');
await page.waitForTimeout(200);
const groups = await page.locator('#catalogue-body h3').allInnerTexts();
check('catalogue has south-pole, historical and CLPS groups', groups.length === 3 && /south polar/i.test(groups[0]) && /historical/i.test(groups[1]) && /CLPS/i.test(groups[2]), groups.join(' | '));
const sourceLinks = await page.locator('#catalogue-body .catalogue-row a').evaluateAll((nodes) => nodes.map((n) => n.href));
check('every catalogue row links to its gazetteer page', sourceLinks.length >= 15 && sourceLinks.every((h) => /^https:\/\/planetarynames\.wr\.usgs\.gov\/Feature\/\d+$/.test(h)), `${sourceLinks.length} links`);
check('catalogue calls the points illustrative', /illustrative/i.test(await text('#catalogue-body .panel-intro')));
await page.locator('.catalogue-row', { hasText: 'Malapert A' }).locator('text=Set as A').click();
await page.waitForTimeout(300);
check('catalogue sets Site A', /Malapert A/.test(await text('.site-a h2')) && /80\.1800° S, 3\.7900° W/.test(await text('.site-a .site-coords')));
await page.locator('.site-a').getByText('Catalogue…').click();
await page.locator('.catalogue-row', { hasText: 'Shackleton' }).first().locator('text=Set as A').click();
await page.waitForTimeout(300);

// ---------- picking ----------
await page.click('.site-b .pick');
const vp = await page.locator('.viewport').boundingBox();
const aBefore = await text('.site-a .site-coords');
const bBefore = await text('.site-b .site-coords');
await page.mouse.click(vp.x + vp.width * 0.5, vp.y + vp.height * 0.5);
await page.waitForTimeout(400);
const bAfter = await text('.site-b .site-coords');
check('globe click moves only the active Site B', bAfter !== bBefore && (await text('.site-a .site-coords')) === aBefore, `${bBefore} -> ${bAfter}`);
const readB = await page.locator('.site-b .readout').innerText();
await page.mouse.move(vp.x + 120, vp.y + 160);
await page.mouse.down();
await page.mouse.move(vp.x + 320, vp.y + 220, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
check('camera drag changes no coordinates or angles', (await text('.site-b .site-coords')) === bAfter && (await page.locator('.site-b .readout').innerText()) === readB);
await page.click('.site-a .pick');

// ---------- period ----------
await page.fill('#period-start', '2026-11-20T00:00:00Z');
await page.fill('#period-end', '2026-11-27T00:00:00Z');
await page.click('#period-apply');
await page.waitForTimeout(400);
check('period change clamps the current time and relabels the axis', (await val('#utc-input')) === '2026-11-20T00:00:00Z' && (await page.locator('.tl-tick-label').first().innerText()).startsWith('2026-11-20'));
check('events still searched in all data after narrowing the period', /2026-10-01 to 2027-02-01/.test(await text('.site-a .events-note')));
await page.fill('#period-start', '2026-11-27T00:00:00Z');
await page.fill('#period-end', '2026-11-20T00:00:00Z');
await page.click('#period-apply');
check('reversed period rejected', /earlier than/.test(await text('#time-error')));
await page.click('#period-full');
await goTo('2026-11-01T00:00:00Z');

// ---------- scenarios ----------
await page.click('#open-scenarios');
await page.waitForTimeout(400);
const rows = page.locator('.scenario-table tbody tr');
check('three default scenarios: A now, A +3 days, B now', (await rows.count()) === 3);
const names = await page.locator('.scenario-table tbody input[aria-label="Scenario name"]').evaluateAll((n) => n.map((i) => i.value));
const starts = await page.locator('.scenario-table tbody input[aria-label^="Start of"]').evaluateAll((n) => n.map((i) => i.value));
check('default names and starts', /A · .*now/.test(names[0]) && /\+3 days/.test(names[1]) && /^B · /.test(names[2]) && starts[0] === '2026-11-01T00:00:00Z' && starts[1] === '2026-11-04T00:00:00Z' && starts[2] === starts[0], `${names.join(' | ')} / ${starts.join(', ')}`);
const windows = await page.locator('.scenario-table tbody tr td:nth-child(5)').allInnerTexts();
const spans = windows.map((w) => { const [a, b] = w.split('→').map((t) => Date.parse(t.trim().slice(0, 16).replace(' ', 'T') + ':00Z')); return b - a; });
check('all scenarios have the same duration (7 days)', spans.every((s) => s === 7 * 86400000), windows.join(' | '));
check('scenario panel states the reference-sphere model, never terrain', /reference-sphere model/.test(await text('#scenarios-body .panel-intro')) && /never terrain/.test(await text('#scenarios-body .panel-intro')));
await page.fill('#scenarios-body input[aria-label="Duration for all scenarios, days"]', '3');
await page.locator('#scenarios-body .panel-toolbar').getByText('Apply', { exact: true }).click();
await page.waitForTimeout(300);
await page.locator('.scenario-table tbody input[aria-label^="Observer height"]').first().fill('500');
await page.locator('.scenario-table tbody input[aria-label^="Observer height"]').first().press('Tab');
await page.waitForTimeout(300);
const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('lunar-landing-navigator.scenarios.v1')));
check('localStorage holds validated scenarios with height, model and equal 3-day duration', stored.version === 1 && stored.scenarios.length === 3 && stored.scenarios[0].observerHeightM === 500 && stored.scenarios.every((s) => s.model === 'reference-sphere' && s.durationSeconds === 3 * 86400 && s.site.heightAboveReferenceSphereM === 0));
check('stored scenarios contain only public fields', stored.scenarios.every((s) => Object.keys(s).sort().join() === 'datasetId,durationSeconds,id,model,name,observerHeightM,site,startUtc,version'));
// invalid edits and imports
await page.locator('.scenario-table tbody input[aria-label^="Start of"]').first().fill('2029-01-01T00:00:00Z');
await page.locator('.scenario-table tbody input[aria-label^="Start of"]').first().press('Tab');
await page.waitForTimeout(300);
check('scenario outside the dataset is not analysed and says so', /outside the available data/.test(await page.locator('.scenario-table tbody tr').first().innerText()));
await page.click('text=Reset to defaults');
await page.waitForTimeout(300);
const fileInput = page.locator('#scenarios-body input[type=file]');
await fileInput.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"scenarios":[{"version":1,"id":"x","name":"<img src=x onerror=alert(1)>","site":{"latDeg":-200,"lonDeg":0,"heightAboveReferenceSphereM":0},"startUtc":"2026-11-01T00:00:00Z","durationSeconds":86400,"observerHeightM":0,"model":"reference-sphere","datasetId":"d"}]}') });
await page.waitForTimeout(300);
check('invalid import rejected with a reason, scenarios unchanged', /Import failed: Scenario 1: Scenario latitude/.test(await text('#scenarios-body .panel-message')) && (await rows.count()) === 3, await text('#scenarios-body .panel-message'));
const good = { version: 1, scenarios: [{ version: 1, id: 'imp-1', name: 'Imported <b>ridge</b>', site: { latDeg: -85, lonDeg: 11.4, heightAboveReferenceSphereM: 0 }, startUtc: '2026-12-10T00:00:00Z', durationSeconds: 5 * 86400, observerHeightM: 250, model: 'reference-sphere', datasetId: 'x', extra: 'ignored' }] };
await fileInput.setInputFiles({ name: 'other-dataset.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(good)) });
await page.waitForTimeout(300);
check('a scenario saved for another dataset is not analysed and cannot be loaded', /Not analysed: Saved for dataset x/.test(await rows.first().innerText()) && await rows.first().getByText('→ B').isDisabled());
good.scenarios[0].datasetId = stored.scenarios[0].datasetId;
const late = { ...good.scenarios[0], id: 'imp-late', name: 'Runs past the data', startUtc: '2027-01-30T00:00:00Z' };
await fileInput.setInputFiles({ name: 'late.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, scenarios: [late] })) });
await page.waitForTimeout(300);
check('a window running past the data is refused, never moved or shortened', /Not analysed: The window extends beyond the available data/.test(await rows.first().innerText()) && (await page.locator('.scenario-table .badge').count()) === 0 && (await page.locator('.scenario-table tbody input[aria-label^="Start of"]').first().inputValue()) === '2027-01-30T00:00:00Z');
await fileInput.setInputFiles({ name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(good)) });
await page.waitForTimeout(300);
const importedName = await page.locator('.scenario-table tbody input[aria-label="Scenario name"]').first().inputValue();
check('valid import accepted; markup in names is neutralised to plain text', (await rows.count()) === 1 && importedName === 'Imported b ridge /b' && (await page.locator('.scenario-table b').count()) === 0, importedName);
check('import preserves height and drops unknown fields', await page.evaluate(() => { const s = JSON.parse(window.localStorage.getItem('lunar-landing-navigator.scenarios.v1')).scenarios[0]; return s.observerHeightM === 250 && !('extra' in s); }));
await page.locator('.scenario-table tbody tr').first().getByText('→ B').click();
await page.waitForTimeout(400);
check('loading a scenario sets site, height, period and time', /85\.0000° S, 11\.4000° E/.test(await text('.site-b .site-coords')) && (await val('#period-start')) === '2026-12-10T00:00:00Z' && (await val('#period-end')) === '2026-12-15T00:00:00Z' && (await val('#utc-input')) === '2026-12-10T00:00:00Z' && /observer 250 m/.test(await text('.site-b .site-model')));
// share link + persistence
await page.click('#open-scenarios');
await page.click('text=Copy share link');
await page.waitForTimeout(300);
const shared = await page.evaluate(() => navigator.clipboard.readText());
check('share link carries scenarios in the fragment only', /#scenarios=[A-Za-z0-9_-]+$/.test(shared) && !shared.includes('?'), shared.slice(0, 80));
await page.reload({ waitUntil: 'networkidle' });
await openFolds(page);
await page.waitForSelector('.tl-bar');
await page.click('#open-scenarios');
await page.waitForTimeout(300);
check('scenarios persist across a reload', (await rows.count()) === 1 && (await page.locator('.scenario-table tbody input[aria-label="Scenario name"]').first().inputValue()) === 'Imported b ridge /b');
await page.click('#dialog-scenarios [data-close]');
const other = await context.newPage();
await other.goto(shared, { waitUntil: 'networkidle' });
await other.waitForSelector('.scenario-table');
await other.waitForTimeout(500);
check('opening the share link loads the scenarios and shows them', (await other.locator('#dialog-scenarios').getAttribute('open')) !== null && (await other.locator('.scenario-table tbody tr').count()) === 1 && /Loaded 1 scenario from the link/.test(await other.locator('#scenarios-body .panel-message').innerText()));
await other.goto(url.replace(/#.*$/, '') + '#scenarios=AAAA', { waitUntil: 'networkidle' });
await other.waitForSelector('.scenario-table', { state: 'attached' });
check('a corrupt share link is ignored safely', (await other.locator('.scenario-table tbody tr').count()) >= 1);
await other.close();

// ---------- Data & accuracy ----------
await page.click('#open-data');
await page.waitForTimeout(300);
const dataText = await text('#data-body');
check('Data & accuracy holds frame, kernels, model limits and sources', /MOON_ME_DE440_ME421/.test(dataText) && /de440s\.bsp/.test(dataText) && /Not found within available data/.test(dataText) && /CGI Moon Kit/.test(dataText) && /localStorage/.test(dataText));
check('terrain section states frames without claiming exact alignment, and the three statuses', /Local terrain patch/i.test(dataText) && /MOON_ME_DE421/.test(dataText) && /Approximate alignment/.test(dataText) && /Coverage insufficient/i.test(dataText) && !/exactly aligned|identical frames/i.test(dataText));
await page.screenshot({ path: `${shots}/05-data-and-accuracy.png` });
await page.click('#dialog-data [data-close]');

// ---------- Space view ----------
await page.click('#period-full');
await goTo('2026-11-14T00:00:00Z');
await page.click('#tab-space');
await page.waitForTimeout(1800);
check('space view: caption says distances and sizes are not to scale', /Distances and sizes not to scale/.test(await text('#layer-space')) && (await page.locator('#tab-space').getAttribute('aria-selected')) === 'true');
m = await layout();
check('space view: no scrolling', m.pageFits && m.sitesFit);
await page.screenshot({ path: `${shots}/02-space-view.png` });

// ---------- Surface view (reference sphere) ----------
await page.click('.site-a .pick');
await page.locator('.site-a').getByText('Catalogue…').click();
await page.locator('.catalogue-row', { hasText: 'Mons Mouton' }).locator('text=Set as A').click();
await page.waitForTimeout(300);
await page.click('#tab-surface');
await page.waitForTimeout(2800);
check('surface view opens for the active site', (await page.locator('#tab-surface').getAttribute('aria-selected')) === 'true' && /Site A · Mons Mouton/.test(await text('#surface-title')), await text('#surface-title'));
const heading = async () => (await text('#surface-compass'));
const sunLine = (await text('#surface-status')).split('\n')[0];
const sunAz = Number(/azimuth ([\d.]+)°/.exec(sunLine)?.[1]);
await page.click('#look-sun');
await page.waitForTimeout(1000);
const hSun = Number(/heading (\d+)°/.exec(await heading())?.[1]);
check('Look at Sun turns the camera to the Sun azimuth from the science module', Math.abs(((hSun - sunAz + 540) % 360) - 180) <= 1, `${await heading()} vs ${sunLine}`);
const earthLine = (await text('#surface-status')).split('\n')[1];
const earthAz = Number(/azimuth ([\d.]+)°/.exec(earthLine)?.[1]);
await page.click('#look-earth');
await page.waitForTimeout(1000);
const hEarth = Number(/heading (\d+)°/.exec(await heading())?.[1]);
check('Look at Earth turns the camera to the Earth azimuth', Math.abs(((hEarth - earthAz + 540) % 360) - 180) <= 1, `${await heading()} vs ${earthLine}`);
await page.click('#look-north');
await page.waitForTimeout(1000);
check('Look north', /heading 0° N/.test(await heading()), await heading());
const sv = await page.locator('#surface').boundingBox();
await page.mouse.move(sv.x + sv.width / 2, sv.y + 120);
await page.mouse.down();
await page.mouse.move(sv.x + sv.width / 2 - 200, sv.y + 120, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(200);
check('mouse drag turns the view (heading changes)', !/heading 0° N/.test(await heading()), await heading());
check('surface: Sun and Earth statuses use reference-horizon wording', /reference horizon|smooth-sphere limb/.test(await text('#surface-status')), (await text('#surface-status')).replace(/\n/g, ' | '));
await page.click('.surface-about summary');
const noteLow = await text('#surface-note');
check('camera clearance is explained separately from the observer height', /camera eye is drawn 2 m up \(display minimum\)/.test(noteLow) && /Observer 0 m above the sphere/.test(noteLow), noteLow.slice(0, 200));
check('terrain coverage insufficient is stated away from the patch', /Terrain coverage insufficient here/.test(noteLow));
await page.click('.surface-about summary');
check('terrain button disabled outside the patch', await page.locator('.ground-toggle').getByText('Real terrain patch').isDisabled());
await page.screenshot({ path: `${shots}/03-surface-view-sphere.png` });
// height: find a time when the Sun is just below the reference plane and raise the observer
await page.click('#surface-back');
await page.waitForTimeout(900);
check('Back to orbit returns to the Moon overview', (await page.locator('#tab-overview').getAttribute('aria-selected')) === 'true');
await page.locator('.site-a .events .btn').nth(1).click();   // jump to the next sunset at Site A
await page.waitForTimeout(200);
await page.click('#step-fwd-hour');
await page.click('#step-fwd-hour');
await page.locator('.site-a').getByText('Explore surface').click();
await page.waitForTimeout(2800);
const lowStatus = (await text('#surface-status')).split('\n')[0];
await page.locator('#surface-height').focus();
await page.locator('#surface-height').fill('6300');   // ≈ 2.5 km on the non-linear slider
await page.locator('#surface-height').dispatchEvent('change');
await page.waitForTimeout(400);
const highStatus = (await text('#surface-status')).split('\n')[0];
check('two hours after sunset at 0 m the Sun is below the smooth-sphere limb', /Below the smooth-sphere limb|below the reference horizon/i.test(lowStatus), lowStatus);
check('raised observer: below the reference horizon but above the dipped limb, explained', /Below the reference horizon \(the tangent plane used for timelines and events\), but still above the smooth-sphere limb, which lies \d+\.\d\d° lower/.test(highStatus), highStatus);
check('height readout and site card follow the slider', /km|m/.test(await text('#surface-height-out')) && /observer \d+ m up/.test(await text('.site-a .site-model')), `${await text('#surface-height-out')} / ${await text('.site-a .site-model')}`);
await page.locator('#surface-height').fill('0');
await page.locator('#surface-height').dispatchEvent('change');

// ---------- Surface view (real terrain patch) ----------
await page.click('text=Go to terrain test point');
await page.waitForTimeout(1500);
const terrainStatus = (await text('#surface-status')).replace(/\n/g, ' | ');
check('terrain test point: status comes from the terrain check with allowed words only', /Terrain check: (Blocked|Clear|Terrain coverage insufficient)/.test(terrainStatus) && (await page.locator('.ground-toggle').getByText('Real terrain patch').getAttribute('aria-pressed')) === 'true', terrainStatus.slice(0, 220));
check('terrain view never claims Clear from a finite patch here', !/Terrain check: Clear/.test(terrainStatus));
await page.click('.surface-about summary');
const noteTerrain = await text('#surface-note');
check('terrain note: ground height relative to the sphere, edge of data, reference-sphere reminder', /ground is −\d+\.\d m relative to the 1737\.4 km sphere/.test(noteTerrain) && /Beyond the amber line there is no terrain data/.test(noteTerrain) && /stay on the reference-sphere model/.test(noteTerrain), noteTerrain.slice(0, 160));
await page.click('.surface-about summary');
check('terrain skyline strip is shown', await page.locator('.terrain-profile-host').isVisible() && (await page.locator('.tp-skyline').getAttribute('d')).length > 100);
check('site card still says reference-sphere model at the terrain point', /Reference-sphere model/.test(await text('.site-a .site-model')));
await page.click('#look-north');
await page.waitForTimeout(1200);
m = await layout();
check('surface view: no scrolling, no clipped text', m.pageFits && m.sitesFit && m.clipped.length === 0, m.clipped.join(' | '));
check('terrain skyline strip names the Sun and Earth markers', (await page.locator('.tp-body-label').allTextContents()).join() === 'Sun,Earth' || (await page.locator('.tp-body-label').allTextContents()).join() === 'Earth,Sun');
await page.screenshot({ path: `${shots}/04-surface-view-terrain.png` });
await page.locator('.ground-toggle').getByText('Reference sphere', { exact: true }).click();
await page.waitForTimeout(400);
check('switching back to the reference sphere works at the same point', /reference horizon|smooth-sphere limb/.test(await text('#surface-status')) && !(await page.locator('.terrain-profile-host').isVisible()));

// ---------- language and console ----------
const all = await page.evaluate(() => document.body.innerText + [...document.querySelectorAll('[title],[aria-label],[placeholder]')].map((e) => (e.getAttribute('title') ?? '') + (e.getAttribute('aria-label') ?? '') + (e.getAttribute('placeholder') ?? '')).join(' '));
check('no Cyrillic text in UI, titles or ARIA', !/[А-Яа-яЁё]/.test(all));
check('html lang is en; disclaimer visible', (await page.evaluate(() => document.documentElement.lang)) === 'en' && await page.locator('.disclaimer').isVisible());
check('no console errors', errors.length === 0, errors.join(' | '));

console.log(results.join('\n'));
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
await browser.close();
