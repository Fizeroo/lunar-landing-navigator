// Optional real-browser check of the immersive explorer (not part of `npm test`).
// Needs Microsoft Edge and `npm i --no-save playwright-core`.
// Usage: node tests/browser/immersive-flow.mjs [url] [screenshot-dir]
//   url default http://127.0.0.1:4173/ ; screenshots default artifacts/immersive
// Headless Edge renders with SwiftShader (software), so frame rates here are a lower bound, not a
// statement about a real GPU. State is read through window.__lln.probe(), which is read-only.
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const shots = process.argv[3] ?? 'artifacts/immersive';
await mkdir(shots, { recursive: true });
const DEMO_UTC = '2026-11-24T04:00:00.000Z';

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
const notes = [];
const errors = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const note = (text) => notes.push(`NOTE ${text}`);
const near = (a, b, tolerance) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tolerance;
const angleNear = (a, b, tolerance) => typeof a === 'number' && typeof b === 'number' && Math.abs(((a - b + 540) % 360) - 180) <= tolerance;
// The numbered badge and assessment precede coordinates; fixed newline offsets are obsolete.
const coordinateFrom = (value) => value.match(/[0-9.]+° [NS], [0-9.]+° [EW]/)?.[0] ?? '';

async function open(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction((utc) => window.__lln?.probe().utc === utc, DEMO_UTC, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return page;
}

const page = await open(1440, 772);
const probe = () => page.evaluate(() => window.__lln.probe());
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const text = (selector) => page.locator(selector).first().innerText();
const visible = (selector) => page.locator(selector).first().isVisible();
const goTo = async (utc) => { await page.fill('#utc-input', utc); await page.press('#utc-input', 'Enter'); await page.waitForTimeout(250); };
/** Move the one displayed time by typing a UTC instant, as a user would (the ±step buttons are not in the compact bar). */
const shift = async (seconds, pause = 250) => {
  const utc = (await probe()).utc;
  await page.fill('#utc-input', new Date(Date.parse(utc) + seconds * 1000).toISOString());
  await page.press('#utc-input', 'Enter');
  await page.waitForTimeout(pause);
};
const waitView = (view) => page.waitForFunction((v) => { const p = window.__lln.probe(); return p.view === v && p.transit === null; }, view, { timeout: 60000 });
/** Share of the scene covered by floating controls (union of their boxes, sampled on a grid). */
const coverage = () => page.evaluate(() => {
  const boxes = [...document.querySelectorAll('.hud, .view-layer:not([hidden]) > *, .surface-pointer')]
    .filter((n) => n.offsetParent !== null && getComputedStyle(n).visibility !== 'hidden')
    .map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  const w = window.innerWidth, h = window.innerHeight, step = 4;
  let covered = 0, total = 0;
  for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) {
    total += 1;
    if (boxes.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) covered += 1;
  }
  const d = document.documentElement;
  return { covered: covered / total, fits: d.scrollWidth <= d.clientWidth && d.scrollHeight <= d.clientHeight };
});
const setSiteA = async (lat, lon, height) => {
  if (!(await visible('#analysis'))) await page.click('#open-analysis');
  await page.evaluate(() => { document.getElementById('fold-sites').open = true; document.querySelector('.site-a details.site-fold').open = true; });
  await page.fill('.site-a input[aria-label*="latitude"]', String(lat));
  await page.fill('.site-a input[aria-label*="longitude"]', String(lon));
  if (height !== undefined) await page.fill('.site-a input[aria-label*="height"]', String(height));
  await page.click('.site-a .site-form button[type=submit]');
  await page.waitForTimeout(300);
  await page.click('#close-analysis');
  await page.waitForTimeout(200);
};
const search = async () => {
  const started = Date.now();
  await page.click('#find-candidates');
  await page.waitForSelector('.candidate-choice', { timeout: 30000 });
  return Date.now() - started;
};

// ---------- 1. start: full-bleed scene, compact controls, no stale results ----------
let p = await probe();
let c = await coverage();
check('start: Orbit at the reproducible example instant', p.view === 'overview' && p.utc === DEMO_UTC, p.utc);
check('start: prepared ridge is the selected measured point', p.ground === 'terrain' && p.site.latDeg === -88.89822426645465 && p.site.lonDeg === 1.440668007133082 && /Prepared ridge/.test(await text('#point-card')), JSON.stringify(p.site));
check('start: Orbit frames the whole Moon, not the detailed patch', p.orbit.framing === 'globe' && p.regionShown === false, JSON.stringify({ framing: p.orbit.framing, regionShown: p.regionShown }));
check('start: scene at least 80% unobscured at 1440x772', c.covered <= 0.2 && c.fits, `controls cover ${(c.covered * 100).toFixed(1)}%`);
check('start: title, Orbit/Surface, time, search and point card visible', (await visible('.hud-top-left h1')) && (await visible('#tab-surface')) && (await visible('#utc-input')) && (await visible('#play')) && (await visible('#find-candidates')) && (await visible('#point-card')));
check('start: no candidate list, Analysis closed', !(await visible('#candidates')) && !(await visible('#analysis')) && p.candidates === 0);
check('start: card never shows unknown terrain as a pass', /terrain unknown/.test(await text('#point-card')) && !/above horizon|clear of terrain/.test(await text('#point-card')), (await text('#point-card')).replace(/\n/g, ' | '));
check('start: eye height 1.7 m shown, not rounded to 2 m', /eyes 1\.7 m/.test(await text('#point-card')));
await shot('01-orbit-start');

// ---------- 2. search the named 25-point candidate grid ----------
const coldMs = await search();
await page.waitForTimeout(600);
p = await probe();
const choices = await page.locator('.candidate-choice').allInnerTexts();
check('search: 25 points evaluated at the displayed instant', p.candidates === 25 && /25 points evaluated · 2026-11-24 04:00 UTC · eyes 1\.7 m/.test(await text('#candidates')), (await text('#candidates .candidate-meta')));
check('search: at most three choices, all at distinct coordinates', choices.length > 0 && choices.length <= 3 && choices.every((t) => coordinateFrom(t)) && new Set(choices.map(coordinateFrom)).size === choices.length, choices.map(coordinateFrom).join(' ; '));
const candidateText = await text('#candidates');
check('search: no point is presented as terrain-confirmed or a landing recommendation', /Lighting & Earth visibility options/.test(candidateText) && /No point is confirmed on the measured terrain/.test(candidateText) && /provisional reference-sphere options/.test(candidateText) && !/Best candidate|recommended|safest/i.test(candidateText));

check('search: rows identify reference-only terrain-unknown results', choices.length > 0 && choices.every((t) => /Reference option.*terrain unknown/.test(t) && /Reference result only.*terrain unknown: Sun and Earth/.test(t)));
check('search: candidate search keeps whole-Moon framing', p.orbit.framing === 'globe' && p.regionShown === false, JSON.stringify({ framing: p.orbit.framing, regionShown: p.regionShown }));
c = await coverage();
check('search: scene still at least 70% unobscured with the list open', c.covered <= 0.3, `controls cover ${(c.covered * 100).toFixed(1)}%`);
note(`candidate search click-to-list ${coldMs} ms (cold, includes 25 points and the list render)`);
await shot('02-search-results');

// stale results: a time change removes them at once; a superseded search never lands
await shift(3600);
p = await probe();
check('stale: changing the time removes the list and markers', p.candidates === 0 && !(await visible('#candidates')));
await page.click('#find-candidates');
await shift(-3600, 2500);
p = await probe();
check('stale: a search superseded by a time change shows nothing', p.candidates === 0 && !(await visible('#candidates')));
await goTo(DEMO_UTC);
const warmMs = await search();
note(`candidate search click-to-list ${warmMs} ms (warm)`);

// ---------- 3. choose a candidate ----------
await page.locator('.candidate-choice').first().click();
await page.waitForTimeout(400);
p = await probe();
const firstCoords = coordinateFrom(await page.locator('.candidate-choice').first().innerText());
check('choice: card follows the selected candidate', /Option 1/.test(await text('#point-card')) && (await text('#point-card')).includes(firstCoords), firstCoords);
check('choice: list kept after selecting', p.candidates === 25 && (await visible('#candidates')));
await shot('03-candidate-selected');

// ---------- 4. descend ----------
await page.click('#point-card .point-action');
await waitView('surface');
await page.waitForTimeout(900);
p = await probe();
check('descent: standing on the measured terrain', p.view === 'surface' && p.ground === 'terrain' && p.surface.model === 'terrain');
check('descent: eyes 1.7 m above the rendered triangle', near(p.surface.eyeClearanceM, 1.7, 0.02) && near(p.heightM, 1.7, 1e-6), `${p.surface.eyeClearanceM?.toFixed(4)} m`);
check('descent: same instant and point as in Orbit', p.utc === DEMO_UTC && near(p.site.latDeg, -88.972, 1e-3));
const arrivalAimsAtBody = ['sun', 'earth'].some((body) => angleNear(p.surface.headingDeg, p.bodies[body].azDeg, 0.5) && near(p.surface.pitchDeg, p.bodies[body].altDeg, 0.5));
check('descent: first look follows a calculated Sun/Earth direction', near(p.surface.fovDeg, 65, 0.05) && arrivalAimsAtBody, JSON.stringify({ heading: p.surface.headingDeg, pitch: p.surface.pitchDeg }));
check('descent: candidate list hidden on the surface', !(await visible('#candidates')));
const agrees = (q) => ['sun', 'earth'].every((b) => (q.terrainStatus[b] === 'blocked') === q.surface.centreRayHitsMesh[b]);
check('descent: science centre-ray result equals the rendered mesh', agrees(p), JSON.stringify({ science: p.terrainStatus, mesh: p.surface.centreRayHitsMesh }));
check('descent: bodies drawn on their directions, hidden only by the mesh', p.surface.bodyDrawn.sun && p.surface.bodyDrawn.earth);
c = await coverage();
check('surface: scene at least 80% unobscured', c.covered <= 0.2 && c.fits, `controls cover ${(c.covered * 100).toFixed(1)}%`);
await shot('04-surface-arrival');

for (const body of ['sun', 'earth']) {
  await page.click(`#look-${body}`);
  await page.waitForTimeout(1100);
  p = await probe();
  check(`look at ${body}: camera on the calculated direction`, angleNear(p.surface.headingDeg, p.bodies[body].azDeg, 0.2) && near(p.surface.pitchDeg, p.bodies[body].altDeg, 0.2), `az ${p.bodies[body].azDeg.toFixed(2)}°, alt ${p.bodies[body].altDeg.toFixed(2)}°`);
  await shot(body === 'sun' ? '05-surface-sun' : '06-surface-earth');
}
await page.click('#look-relief');
await page.waitForTimeout(1100);
check('look at terrain: field of view restored after the Earth close-up', (await probe()).surface.fovDeg === 65);

// ---------- 5. mouse look ----------
await page.click('#mouse-look');
await page.waitForTimeout(700);
p = await probe();
if (p.surface.pointerLocked) {
  check('mouse look: pointer captured after the explicit button', /Escape to release/.test(await text('#mouse-look')));
  const before = p.surface.headingDeg;
  await page.mouse.move(700, 380);
  await page.mouse.move(820, 380, { steps: 6 });
  await page.waitForTimeout(200);
  note(`mouse look heading ${before.toFixed(1)}° → ${(await probe()).surface.headingDeg.toFixed(1)}° after a synthetic move`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  p = await probe();
  check('mouse look: Escape releases the pointer', !p.surface.pointerLocked && /Enter mouse look/.test(await text('#mouse-look')));
} else {
  note(`pointer lock was not granted in this headless browser; message shown: "${await text('#surface-keys')}"`);
  check('mouse look: refusal is reported and drag-to-look remains', /drag to look/.test(await text('#surface-keys')));
}
const dragFrom = (await probe()).surface.headingDeg;
await page.mouse.move(720, 300);
await page.mouse.down();
await page.mouse.move(560, 300, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(200);
check('drag to look: heading changes without pointer lock', !angleNear((await probe()).surface.headingDeg, dragFrom, 1));

// ---------- 6. walk ----------
await page.click('#look-north'); // focus stays on a button: walking must still work
await page.waitForTimeout(1000);
const start = await probe();
await page.keyboard.down('ShiftLeft');
await page.keyboard.down('KeyW');
await page.waitForTimeout(2500);
let walking = await probe();
await page.keyboard.up('KeyW');
await page.keyboard.up('ShiftLeft');
await page.waitForTimeout(400);
p = await probe();
const moved = Math.hypot(p.surface.cameraLocalM[0] - start.surface.cameraLocalM[0], p.surface.cameraLocalM[2] - start.surface.cameraLocalM[2]);
check('walk: W moves along the heading on the ground', moved > 5 && p.hasWalked && walking.surface.pressedKeys === 2, `${moved.toFixed(1)} m in 2.5 s of fast traverse`);
check('walk: eyes stay 1.7 m above the rendered triangle', near(p.surface.eyeClearanceM, 1.7, 0.02), `${p.surface.eyeClearanceM?.toFixed(4)} m`);
check('walk: current point and card follow the walker', p.site.latDeg !== start.site.latDeg && /walked away/.test(await text('#point-card')), `lat ${start.site.latDeg.toFixed(5)} → ${p.site.latDeg.toFixed(5)}`);
check('walk: still the terrain model, science equals mesh at the new point', p.ground === 'terrain' && agrees(p));
await page.keyboard.down('KeyD');
await page.waitForTimeout(150);
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
await page.waitForTimeout(100);
check('walk: pressed keys are dropped when the window loses focus', (await probe()).surface.pressedKeys === 0);
await page.keyboard.up('KeyD');
await shot('07-surface-walked');
await page.click('#return-point');
await page.waitForTimeout(400);
p = await probe();
check('return to point: back at exactly the selected point', !p.hasWalked && Math.hypot(p.surface.cameraLocalM[0], p.surface.cameraLocalM[2]) < 0.01 && p.site.latDeg === start.site.latDeg && p.site.lonDeg === start.site.lonDeg && !/walked away/.test(await text('#point-card')), JSON.stringify({ camera: p.surface.cameraLocalM, lat: p.site.latDeg, was: start.site.latDeg }));

// ---------- 7. eye height ----------
const setEye = async (value) => {
  await page.evaluate((v) => { const input = document.querySelector('.eye-control input'); input.value = String(v); input.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  await page.waitForTimeout(250);
  return probe();
};
for (const height of [3, 0.5, 1.7]) {
  p = await setEye(height);
  check(`eye height ${height} m: camera and science both use it`, near(p.heightM, height, 1e-6) && near(p.surface.eyeClearanceM, height, 0.02), `${p.surface.eyeClearanceM?.toFixed(3)} m`);
}
check('eye height: changing it invalidated the candidate list', (await probe()).candidates === 0);

// ---------- 8. time on the surface ----------
const altBefore = (await probe()).bodies.sun.altDeg;
await shift(86400);
p = await probe();
check('time: +1 d on the surface moves the calculated Sun', p.utc.startsWith('2026-11-25T04:00') && p.bodies.sun.altDeg !== altBefore && p.view === 'surface', `Sun ${altBefore.toFixed(2)}° → ${p.bodies.sun.altDeg.toFixed(2)}°`);
await page.click('#play');
await page.waitForTimeout(1500);
await page.click('#play');
const played = await probe();
check('time: Play advances on the surface and Pause stops it', played.et > p.et && (await text('#play')).includes('Play'), `${((played.et - p.et) / 3600).toFixed(1)} h`);

// A blocked body centre: step through the data until the science module reports one.
let blocked = null;
let mismatches = 0;
let steps = 0;
await goTo('2026-12-20T00:00:00Z');
for (; steps < 160 && !blocked; steps += 1) {
  await shift(3600, 40);
  const q = await probe();
  if (!agrees(q)) mismatches += 1;
  for (const body of ['sun', 'earth']) if (!blocked && q.terrainStatus[body] === 'blocked' && q.bodies[body].altDeg > -1.5) blocked = { body, q };
}
check('occlusion: science centre ray equals the rendered mesh at every sampled hour', mismatches === 0, `${steps} hours sampled, ${mismatches} disagreements`);
if (blocked) {
  await page.click(`#look-${blocked.body}`);
  await page.waitForTimeout(1200);
  p = await probe();
  check('occlusion: a blocked centre is hidden by the mesh, not removed or lifted', p.terrainStatus[blocked.body] === 'blocked' && p.surface.centreRayHitsMesh[blocked.body] === true && p.surface.bodyDrawn[blocked.body] && /blocked by terrain/.test(await text('#point-card')), `${blocked.body} altitude ${p.bodies[blocked.body].altDeg.toFixed(2)}° at ${p.utc}`);
  check('occlusion: camera still looks at the hidden body', angleNear(p.surface.headingDeg, p.bodies[blocked.body].azDeg, 0.2) && near(p.surface.pitchDeg, p.bodies[blocked.body].altDeg, 0.2));
  await shot('08-surface-body-behind-terrain');
} else note('no grazing blocked body centre found in the sampled hours; occlusion screenshot skipped');

// sky appearance never changes a calculation
const beforeSky = await probe();
await page.evaluate(() => { document.querySelector('.surface-settings').open = true; });
await page.click('#sky-natural');
await page.waitForTimeout(300);
p = await probe();
check('sky: Natural/Enhanced changes appearance only', p.bodies.sun.altDeg === beforeSky.bodies.sun.altDeg && p.terrainStatus.sun === beforeSky.terrainStatus.sun && /Natural exposure/.test(await text('.model-chip')));
await shot('09-surface-natural-sky');
await page.click('#sky-enhanced');
await page.evaluate(() => { document.querySelector('.surface-settings').open = false; });

// frame pacing on the surface (software rendering here)
const fps = await page.evaluate(() => new Promise((resolve) => { let n = 0; const t0 = performance.now(); const f = () => { n += 1; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else resolve(n / 2); }; requestAnimationFrame(f); }));
note(`surface view ${fps.toFixed(0)} frames/s in headless SwiftShader (software rendering; a GPU is faster)`);

// ---------- 9. return to Orbit; a still-valid list comes back ----------
await goTo(DEMO_UTC);
await page.click('#find-candidates');
await waitView('overview');
await page.waitForSelector('.candidate-choice');
await page.locator('.candidate-choice').nth(1).click();
await page.click('#point-card .point-action');
await waitView('surface');
await page.waitForTimeout(600);
await page.keyboard.down('KeyS');
await page.waitForTimeout(700);
await page.keyboard.up('KeyS');
await page.click('#point-card .point-action');
await waitView('overview');
await page.waitForTimeout(900);
p = await probe();
check('back to orbit: the unchanged search returns in whole-Moon framing', p.candidates === 25 && (await visible('#candidates')) && p.orbit.framing === 'globe' && !p.regionShown && (await page.locator('.candidate-choice').count()) <= 3);
check('back to orbit: the selected point is restored after a walk', /Option 2/.test(await text('#point-card')) && !/walked away/.test(await text('#point-card')) && !p.hasWalked);
await shot('10-orbit-after-return');

// ---------- 10. terrain boundary ----------
// In-coverage coordinate edits now preserve Surface. Do not press its Back action.
await setSiteA(-88.873, 0);
if ((await probe()).view !== 'surface') await page.click('#tab-surface');
await waitView('surface');
await page.click('#look-north');
await page.waitForTimeout(1000);
await page.keyboard.down('ShiftLeft');
await page.keyboard.down('KeyW');
let reached = false;
for (let i = 0; i < 120 && !reached; i += 1) {
  await page.waitForTimeout(500);
  reached = /Edge of terrain data/.test(await text('#surface-keys'));
}
const atEdge = await probe();
await page.waitForTimeout(1500);
const held = await probe();
await page.keyboard.up('KeyW');
await page.keyboard.up('ShiftLeft');
check('boundary: walking stops at the coverage margin with a message', reached && Math.hypot(held.surface.cameraLocalM[0] - atEdge.surface.cameraLocalM[0], held.surface.cameraLocalM[2] - atEdge.surface.cameraLocalM[2]) < 1.5, await text('#surface-keys'));
check('boundary: still on the terrain mesh, eyes 1.7 m, no sphere substituted', held.ground === 'terrain' && held.surface.model === 'terrain' && near(held.surface.eyeClearanceM, 1.7, 0.02), `${held.surface.eyeClearanceM?.toFixed(4)} m`);
await shot('11-surface-coverage-edge');

// An observer height from Analysis (as a loaded scenario would set) outside the 0.5–3 m slider:
// camera, model and read-out agree on it, and standing height is one explicit press away.
await setSiteA(-88.99, 1, 1000);
await page.waitForTimeout(600);
await page.evaluate(() => { document.querySelector('.surface-settings').open = true; });
p = await probe();
check('legacy height: camera, science and read-out all use 1000 m', p.view === 'surface' && near(p.heightM, 1000, 1e-6) && near(p.surface.eyeClearanceM, 1000, 0.5) && /1 km · set in Analysis/.test(await text('.eye-control')) && /eyes 1 km/.test(await text('#point-card')), `${p.surface.eyeClearanceM?.toFixed(2)} m; ${await text('.eye-control output')}`);
await page.click('#eye-reset');
await page.waitForTimeout(300);
p = await probe();
check('legacy height: Reset eyes returns to 1.7 m everywhere', near(p.heightM, 1.7, 1e-6) && near(p.surface.eyeClearanceM, 1.7, 0.02) && !(await visible('#eye-reset')) && /eyes 1\.7 m/.test(await text('#point-card')));
await page.evaluate(() => { document.querySelector('.surface-settings').open = false; });

// Scientific height below the 0.2 m camera minimum (valid in scenarios and the site form): the calculation
// height must stay exactly as set through arrival, Return to point, a walk and another return, while the
// camera is drawn 0.2 m up and says so. 1.7 m is the ordinary case.
for (const height of [0, 0.1, 1.7]) {
  await setSiteA(-88.99, 1, height);
  await page.waitForTimeout(500);
  const drawn = Math.max(height, 0.2);
  const stays = async (when) => {
    const q = await probe();
    const card = await text('#point-card');
    const labelled = height < 0.2 ? card.includes(`calculated at ${height.toFixed(1)} m · camera drawn 0.2 m up (display minimum)`) : /eyes 1\.7 m/.test(card);
    check(`height ${height} m, ${when}: calculation height unchanged, camera ${drawn} m, labelled`, q.heightM === height && near(q.surface.eyeClearanceM, drawn, 0.02) && near(q.cameraEyeM, drawn, 1e-9) && labelled && q.ground === 'terrain', `state ${q.heightM} m, ray-cast clearance ${q.surface.eyeClearanceM?.toFixed(4)} m`);
    return q;
  };
  await stays('on arrival');
  await page.click('#return-point');
  await page.waitForTimeout(300);
  await stays('after Return to point without moving');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(400);
  const walked = await stays('after walking');
  check(`height ${height} m: the walk really moved the point`, walked.hasWalked && walked.site.latDeg !== -88.99);
  await page.click('#return-point');
  await page.waitForTimeout(300);
  await stays('after walking and Return to point');
  await page.click('#open-analysis');
  check(`height ${height} m: site form still holds the set height`, Number(await page.inputValue('.site-a input[aria-label*="height"]')) === height);
  await page.click('#close-analysis');
}

// ---------- 11. Analysis moves the point while standing on terrain ----------
await setSiteA(10, 20);
await page.waitForTimeout(1500);
await waitView('overview');
p = await probe();
check('unsupported point from Analysis: surface is left, never a silent sphere', p.view === 'overview' && p.ground === 'terrain' && /Detailed terrain is not prepared at the new point/.test(await text('#pick-hint')), await text('#pick-hint'));
check('unsupported point: card is labelled reference sphere', /Smooth reference sphere/.test(await text('#point-card')) && /above horizon|below horizon/.test(await text('#point-card')));
await page.click('#point-card .point-action');
await page.waitForSelector('dialog[open]');
check('unsupported point: Explore asks before using a sphere', /Detailed terrain is not prepared here/.test(await text('dialog[open]')));
await shot('12-explore-unsupported-dialog');

// near-zenith look: the sub-solar point on the labelled smooth sphere
await page.locator('dialog[open] button', { hasText: 'Cancel' }).click();
const sub = (await probe()).subsolar;
await setSiteA(sub.latDeg.toFixed(4), sub.lonDeg.toFixed(4));
await page.click('#point-card .point-action');
await page.locator('dialog[open] button', { hasText: 'Smooth sphere only' }).click();
await waitView('surface');
await page.click('#look-sun');
await page.waitForTimeout(1200);
p = await probe();
check('zenith: Look at Sun reaches the real direction above 85°', p.bodies.sun.altDeg > 89 && near(p.surface.pitchDeg, p.bodies.sun.altDeg, 0.05) && p.ground === 'sphere', `Sun altitude ${p.bodies.sun.altDeg.toFixed(3)}°, camera pitch ${p.surface.pitchDeg.toFixed(3)}°`);
check('zenith: compass reports no heading straight up', /heading —|pitch \+9\d°/.test(await text('#surface-compass')), await text('#surface-compass'));
await shot('13-zenith-sun-smooth-sphere');
await page.click('#point-card .point-action');
await waitView('overview');

// ---------- 12. retained tools ----------
await page.click('#open-analysis');
check('Analysis: mission form, Sites A/B, timeline and comparison retained', (await page.locator('#mission-host form').count()) > 0 && (await page.locator('#sites .site-a').count()) === 1 && (await page.locator('#timeline').count()) === 1 && (await page.locator('#comparison').count()) === 1);
await page.click('#open-scenarios');
check('Analysis: scenarios dialog opens', await visible('#dialog-scenarios[open]'));
await page.click('#dialog-scenarios [data-close]');
await page.click('#close-analysis');
await page.click('#open-data');
const dataText = await text('#data-body');
check('Data & accuracy: finite terrain, picture-only context and model limits explained', /Explorer model & appearance/i.test(dataText) && /finite 8 km patch cannot certify distant horizon clearance or route safety/i.test(dataText) && /These surroundings are a picture only/i.test(dataText) && /visibility results, slopes, candidates and the ground you walk on never use them/i.test(dataText) && /No visible fraction of a disc is calculated/i.test(dataText));
await shot('14-data-and-accuracy');
await page.click('#dialog-data [data-close]');
await page.click('#tab-space');
await waitView('space');
await page.waitForFunction(() => window.__lln.probe().view === 'space', undefined, { timeout: 15000 });
check('Space view: secondary, labelled not to scale', (await probe()).view === 'space' && /Distances and sizes not to scale/i.test(await text('#layer-space')));
await shot('15-space-view');
await page.click('#tab-space');
const nowBefore = (await probe()).utc;
await page.click('#time-now');
await page.waitForTimeout(300);
p = await probe();
const refused = /outside the prepared UTC range/.test(await text('#time-error'));
check('Now: uses the actual instant or refuses without moving the time', refused ? p.utc === nowBefore : Math.abs(Date.parse(p.utc) - Date.now()) < 120000, refused ? 'refused, time unchanged' : p.utc);
await page.close();

// ---------- Analysis: the mission start follows the view time until the user types or searches ----------
for (const freeze of ['typing', 'search']) {
  const m = await open(1440, 772);
  const startField = 'input[aria-label^="Mission start"]';
  const jump = async (utc) => { await m.fill('#utc-input', utc); await m.press('#utc-input', 'Enter'); await m.waitForTimeout(250); };
  const reopen = async () => { await m.click('#open-analysis'); await m.waitForTimeout(250); const value = await m.inputValue(startField); await m.click('#close-analysis'); return value; };
  const first = await reopen();
  await jump('2026-12-05T10:00:00Z');
  const followed = await reopen();
  check(`mission start (${freeze}): follows the view time before any input`, first === '2026-11-24T04:00:00Z' && followed === '2026-12-05T10:00:00Z', `${first} → ${followed}`);
  await m.click('#open-analysis');
  if (freeze === 'typing') await m.fill(startField, '2026-11-20T00:00:00Z');
  else {
    await m.click('#mission-host button[type=submit]');
    await m.waitForTimeout(2500);
  }
  const fixed = await m.inputValue(startField);
  await m.click('#close-analysis');
  await jump('2026-12-25T08:00:00Z');
  const after = await reopen();
  check(`mission start (${freeze}): stays fixed afterwards while the view time moves`, after === fixed && after !== '2026-12-25T08:00:00Z', `${fixed} → ${after}`);
  await m.close();
}

// ---------- 13. smaller windows ----------
for (const [width, height] of [[1280, 650], [935, 640]]) {
  const small = await open(width, height);
  const m = await small.evaluate(() => {
    const rect = (s) => document.querySelector(s).getBoundingClientRect();
    const d = document.documentElement;
    const h1 = document.querySelector('.hud-top-left h1');
    const clipped = [...document.querySelectorAll('.tab, .hud-top-right .btn, .point-card .readout-state, .point-coords, .timebar .btn')]
      .filter((n) => n.offsetParent !== null && n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent);
    return { fits: d.scrollWidth <= d.clientWidth && d.scrollHeight <= d.clientHeight, title: h1.offsetParent !== null && h1.getBoundingClientRect().width > 80, gap: rect('.hud-top-right').left - rect('.hud-top-left').right, cardAboveTime: rect('#point-card').bottom <= rect('.timebar').top + 1, clipped };
  });
  check(`${width}x${height}: title visible, top controls do not collide, no overflow`, m.fits && m.title && m.gap >= 4 && m.cardAboveTime && m.clipped.length === 0, JSON.stringify(m));
  await small.click('#find-candidates');
  await small.waitForSelector('.candidate-choice');
  await small.locator('.candidate-choice').first().click();
  await small.screenshot({ path: `${shots}/16-orbit-${width}x${height}.png` });
  await small.click('#point-card .point-action');
  await small.waitForFunction(() => window.__lln.probe().view === 'surface');
  await small.waitForTimeout(800);
  const s = await small.evaluate(() => {
    const boxes = ['#point-card', '.surface-panel', '.timebar', '.hud-top-left', '.hud-top-right', '.surface-compass'].map((sel) => [sel, document.querySelector(sel).getBoundingClientRect()]);
    const overlaps = [];
    for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
      const [a, ra] = boxes[i], [b, rb] = boxes[j];
      if (ra.left < rb.right - 1 && rb.left < ra.right - 1 && ra.top < rb.bottom - 1 && rb.top < ra.bottom - 1) overlaps.push(`${a} × ${b}`);
    }
    const d = document.documentElement;
    return { overlaps, fits: d.scrollWidth <= d.clientWidth && d.scrollHeight <= d.clientHeight };
  });
  check(`${width}x${height}: surface controls do not overlap`, s.fits && s.overlaps.length === 0, s.overlaps.join(', '));
  await small.screenshot({ path: `${shots}/17-surface-${width}x${height}.png` });
  await small.close();
}

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
for (const line of [...results, ...notes]) console.log(line);
const failed = results.filter((line) => line.startsWith('FAIL')).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
if (failed) process.exitCode = 1;
