// SUPERSEDED for the immersive layout: this script targets the earlier side-panel UI and is kept for reference only.
// The current real-browser check is tests/browser/immersive-flow.mjs.
// Optional real-browser check of the mission-window flow (not part of `npm test`).
// Needs Microsoft Edge and `npm i --no-save playwright-core`.
// Usage: node tests/browser/mission-flow.mjs [url] [screenshot-dir]
//   url default http://127.0.0.1:4173/ ; screenshots default ./artifacts
// The viewport is the CONTENT size of a maximised window on a 1440x852 screen.
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const shots = process.argv[3] ?? 'artifacts';
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 772 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const results = [];
process.on('exit', () => {
  console.log(results.join('\n'));
  console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
});
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const text = (sel) => page.locator(sel).first().innerText();
const state = () => page.locator('.mission-output').getAttribute('data-state');
const outputAttr = (name) => page.locator('.mission-output').getAttribute(name);
const fits = () => page.evaluate(() => {
  const d = document.documentElement;
  return d.scrollHeight <= d.clientHeight && d.scrollWidth <= d.clientWidth;
});
const utc = () => page.locator('#utc-input').inputValue();
const find = async () => {
  await page.click('.mission-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('.mission-output').dataset.state !== 'loading');
};

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.getElementById('data-status').dataset.tone === 'ok');
await page.waitForTimeout(600);

// ---- layout: prominent 3D, compact mission query, old detail folded ----
const box = await page.evaluate(() => {
  const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
  return { moon: r('.viewport'), side: r('.side'), mission: r('.mission'), sitesOpen: document.getElementById('fold-sites').open, tlOpen: document.getElementById('fold-timeline').open, cmpOpen: document.getElementById('fold-comparison').open };
});
check('page fits 1440x772 without scrolling', await fits());
check('3D view is the largest area', box.moon[0] >= 950 && box.moon[1] >= 560, `3D ${box.moon.join('x')}, side ${box.side.join('x')}, mission ${box.mission.join('x')}`);
check('Sites A/B, timeline and comparison are folded by default but present', !box.sitesOpen && !box.tlOpen && !box.cmpOpen && (await page.locator('.site-card').count()) === 2);
check('primary button reads "Find a window"', (await text('.mission-form button[type=submit]')) === 'Find a window');
check('idle state explains what to do', (await state()) === 'idle');
check('duration presets 6/12/24/48 h and custom', (await page.locator('.mf-body .btn.seg', { hasText: / h$/ }).allInnerTexts()).join() === '6 h,12 h,24 h,48 h' && (await page.locator('input[aria-label="Custom mission duration, hours"]').count()) === 1);

// ---- invalid input: explicit error, no result ----
await page.fill('input[aria-label^="Mission start"]', '2026-11-16 21:00');
await find();
check('start without Z is rejected in English', (await state()) === 'error' && /must be UTC/.test(await text('.mission-output')));
await page.fill('input[aria-label^="Mission start"]', '2027-03-01T00:00:00Z');
await find();
check('start outside the data is an explicit error, not shifted', (await state()) === 'error' && /Available range/.test(await text('.mission-output')));
await page.fill('input[aria-label^="Mission start"]', '2026-11-16T21:00:00Z');
await page.fill('input[aria-label="Custom mission duration, hours"]', 'abc');
await find();
check('bad custom duration is rejected', (await state()) === 'error' && /number of hours/.test(await text('.mission-output')));
await page.fill('input[aria-label="Custom mission duration, hours"]', '');

// ---- unsupported terrain: explicit, no fallback ----
await page.selectOption('select[aria-label="Ground model for the mission search"]', 'terrain');
await find();
const unsupported = await text('.mission-output');
check('terrain search is refused with the contract message', (await state()) === 'unsupported' && unsupported.includes('Terrain mission-window search is unavailable: local DEM coverage cannot certify continuous visibility. Explicitly choose Reference sphere.'));
check('no reference-sphere result is shown in its place', (await page.locator('.mission-verdict.ok, .mission-search').count()) === 0 && /No reference-sphere result is shown/.test(unsupported));
await page.click('text=Switch the form to Reference sphere');
check('switching the model is an explicit step and does not search by itself', (await state()) === 'idle' && (await page.locator('.mission-verdict').count()) === 0);

// ---- fixed start that fails; the search result is separate ----
await page.locator('.mf-body .btn.seg', { hasText: '48 h' }).click();
await page.selectOption('select[aria-label="What the mission needs"]', 'both');
await find();
const failText = await text('.mission-output');
check('fixed start 2026-11-16 21:00 fails as written', (await state()) === 'result' && (await outputAttr('data-requirement-met')) === 'false' && /^No — not from 2026-11-16 21:00 UTC/.test(await text('.mission-verdict strong')), (await text('.mission-verdict strong')));
check('search names the earliest suitable start separately', /Earliest start that works: 2026-11-17 20:39 UTC/.test(failText) && /Earth sets/.test(failText), failText.split('\n').slice(2, 5).join(' | ').slice(0, 200));
const ms = Number(await outputAttr('data-compute-ms'));
check('search states the allowed mission starts explicitly', /Allowed mission starts: 2026-11-17 20:39 UTC to 2026-11-27 20:48 UTC/.test(failText));
check('search latency is measured and shown', Number.isFinite(ms) && ms < 250 && /search \d+(\.\d)? ms/.test(await text('.mission-meta')), `${ms} ms; ${await text('.mission-meta')}`);
check('result action "Experience this window" exists', (await page.locator('.mission-result-actions button', { hasText: 'Experience this window' }).count()) === 1);
check('view time was not moved by the search', (await utc()) === '2026-10-01T00:00:00Z', await utc());
await page.screenshot({ path: `${shots}/06-mission-result.png` });

// ---- request ids: a second request supersedes the first ----
const idBefore = Number(await outputAttr('data-request-id'));
await page.evaluate(() => {
  const submit = document.querySelector('.mission-form button[type=submit]');
  submit.click();
  document.querySelector('input[aria-label="Custom mission duration, hours"]').value = '6';
  submit.click();
});
await page.waitForFunction(() => document.querySelector('.mission-output').dataset.state === 'result');
await page.waitForTimeout(150);
const idAfter = Number(await outputAttr('data-request-id'));
check('only the newest of two quick requests is shown', idAfter === idBefore + 2 && / 6 h · /.test(await text('.mission-meta')), `ids ${idBefore} -> ${idAfter}; ${await text('.mission-meta')}`);
await page.fill('input[aria-label="Custom mission duration, hours"]', '');
await find();

// ---- stale marking ----
await page.selectOption('select[aria-label="What the mission needs"]', 'sun');
check('editing the form marks the result stale', await page.locator('.mission-output.stale .mission-stale').isVisible() && await page.locator('.mission-result-actions button', { hasText: 'Experience this window' }).isDisabled());
await page.selectOption('select[aria-label="What the mission needs"]', 'both');
check('restoring the same inputs clears the stale mark', !(await page.locator('.mission-stale').isVisible()));
await page.locator('input[aria-label^="Observer height above the reference sphere"]').focus();
await page.keyboard.press('Control+A');
await page.keyboard.type('50');
check('typing a height marks the result stale before blur', await page.locator('.mission-stale').isVisible() && await page.locator('.mission-result-actions button', { hasText: 'Experience this window' }).isDisabled());
await page.locator('input[aria-label^="Observer height above the reference sphere"]').blur();
check('a height edit marks the result stale and reaches the site card', await page.locator('.mission-stale').isVisible() && (await page.locator('.site-a input[aria-label*="height"]').inputValue()) === '50');
await page.fill('input[aria-label^="Observer height above the reference sphere"]', '0');
await page.locator('input[aria-label^="Observer height above the reference sphere"]').blur();
await find();

// ---- What-if: frozen baseline, one explicit change, fixed start (not a searched start) ----
await page.click('.mission-whatif-fold summary');
check('What-if actions are labelled in words', (await page.locator('.mission-whatif-buttons button').allInnerTexts()).join('|') === 'Start one day later|Try Site B|Change observer height');
await page.click('text=Start one day later');
const whatIf = await text('.mission-compare');
check('What-if +1 day evaluates the fixed start 2026-11-17 21:00, not the searched 20:39', /start exactly 1 UTC day later \(2026-11-17 21:00 UTC\)/.test(whatIf) && /Yes — 48 h fits from 2026-11-17 21:00 UTC/.test(whatIf) && !/20:39/.test(whatIf), whatIf.split('\n')[0]);
check('What-if keeps the baseline failing and reports the delta and limiting factor', /Baseline — No — not from 2026-11-16 21:00 UTC/.test(whatIf) && /Gain: ≈ 11 d 24 h|Gain: ≈ 12 d/.test(whatIf) && /Limiting factor with the change: Earth sets/.test(whatIf), (whatIf.match(/Gain[^\n]*/) ?? [''])[0]);
check('the baseline result above is unchanged after What-if', /^No — not from 2026-11-16 21:00 UTC/.test(await text('.mission-verdict strong')) && (await page.locator('input[aria-label^="Mission start"]').inputValue()) === '2026-11-16T21:00:00Z');
await page.click('text=Try Site B');
check('What-if Site B changes only the site', /What if: use Site B/.test(await text('.mission-compare')));
await page.fill('input[aria-label="What-if observer height, metres"]', '0');
await page.click('text=Change observer height');
check('What-if with an unchanged height is refused', /equals the baseline height/.test(await text('.mission-whatif .field-error')));
await page.fill('input[aria-label="What-if observer height, metres"]', '2000');
await page.click('text=Change observer height');
check('What-if height 2000 m compares the same fixed start', /observer height 2000 m instead of 0 m/.test(await text('.mission-compare')), (await text('.mission-compare')).split('\n')[0]);
check('page still fits with result and What-if open', await fits());

// ---- Experience: enters Surface, controls stay usable, pauses at the end with a reason ----
await page.click('text=Start one day later');
await page.click('text=Experience the changed case');
await page.waitForFunction(() => document.body.dataset.view === 'surface', null, { timeout: 8000 });
await page.waitForTimeout(700);
check('Experience enters the Surface view at the fixed changed start', (await utc()) === '2026-11-17T21:00:00Z' && /Experience · Site A · the What-if case/.test(await text('#experience-text')), await text('#experience-text'));
check('Experience says what it is playing toward', /Playing toward Earthset at 2026-11-29 20:48 UTC/.test(await text('#experience-text')));
const heading0 = await text('#surface-compass');
await page.click('#look-north');
await page.waitForTimeout(700);
check('look controls work during the experience', (await text('#surface-compass')) !== heading0 && /heading 0° N/.test(await text('#surface-compass')), await text('#surface-compass'));
await page.selectOption('#experience-speed', '86400');
await page.click('#experience-play');
await page.waitForTimeout(1200);
check('playback runs and shows its speed', /Now 1 d per second/.test(await text('#experience-rate')) && (await utc()) > '2026-11-18T12:00:00Z', `${await text('#experience-rate')} at ${await utc()}`);
await page.click('#experience-play');
const pausedAt = await utc();
await page.waitForTimeout(400);
check('pause works mid-way', (await utc()) === pausedAt && (await text('#experience-rate')) === 'Paused');
await page.click('#step-fwd-day');
check('shared time controls stay usable during the experience', (await utc()) > pausedAt);
await page.click('#experience-play');
await page.waitForFunction(() => /slowed down near the end/.test(document.getElementById('experience-rate').textContent), null, { timeout: 30000 });
check('playback slows down near the end and says so', /10 min per second — slowed down near the end/.test(await text('#experience-rate')), await text('#experience-rate'));
await page.waitForFunction(() => /^Paused$/.test(document.getElementById('experience-rate').textContent), null, { timeout: 30000 });
const ended = await text('#experience-text');
check('playback pauses at the window end and explains what ended', /Paused at 2026-11-29 20:48 UTC: Earth just went below the reference horizon, so the window ended/.test(ended) && Math.abs(Date.parse(await utc()) - Date.parse('2026-11-29T20:47:47Z')) <= 1000, `${await utc()} · ${ended.slice(0, 160)}`);
const earthLine = (await page.locator('.surface-line').allInnerTexts()).find((line) => line.startsWith('Earth')) ?? '';
check('at the pause Earth is at the reference horizon (true direction, not lifted)', /altitude [+−]?0\.00°/.test(earthLine), earthLine);
await page.waitForTimeout(900);
await page.screenshot({ path: `${shots}/07-surface-experience.png` });
await page.click('#experience-restart');
check('Back to start returns to the fixed start', (await utc()) === '2026-11-17T21:00:00Z');
await page.click('#experience-end');
check('End experience hides the bar and keeps the Surface view', !(await page.locator('#experience').isVisible()) && (await page.evaluate(() => document.body.dataset.view)) === 'surface');
await page.click('#surface-back');
await page.waitForFunction(() => document.body.dataset.view === 'overview');

// ---- search range shorter than the mission: valid "no fit" with the longest span; range edge is not a set ----
await page.fill('#period-start', '2026-11-18T00:00:00Z');
await page.fill('#period-end', '2026-11-19T00:00:00Z');
await page.click('#period-apply');
await page.selectOption('select[aria-label="Where to search for a window"]', 'period');
await page.fill('input[aria-label^="Mission start"]', '2026-11-18T06:00:00Z');
await find();
const ranged = await text('.mission-output');
check('range shorter than the mission is a valid no-fit, blamed on the range', (await state()) === 'result' && /does not fit inside the search range/.test(ranged) && /The range, not the physical conditions, prevents it/.test(ranged), (await text('.mission-verdict strong')));
check('longest span is reported and its end is labelled as the range edge, not a set', /No window of 48 h exists in the search range\. The longest continuous span is ≈ 24 h/.test(ranged) && /the selected search range ends — not a physical end/.test(ranged));
await page.click('text=Experience my start');
await page.waitForFunction(() => document.body.dataset.view === 'surface', null, { timeout: 8000 });
check('Experience for a range-clipped case heads to the range edge, not a later set', /Playing toward the end of the selected search range at 2026-11-19 00:00 UTC/.test(await text('#experience-text')), await text('#experience-text'));
await page.click('#surface-back');
await page.waitForFunction(() => document.body.dataset.view === 'overview');
await page.click('#period-full');
await page.selectOption('select[aria-label="Where to search for a window"]', 'all');

// ---- guided demo: select -> failure -> change -> result -> surface, cancellable ----
await page.click('.mission-actions >> text=Guided demo');
await page.waitForFunction(() => document.getElementById('demo').dataset.step === 'select');
check('demo step 1 fills the form without calculating', /step 1 of 5/i.test(await text('.demo-step')) && (await page.locator('input[aria-label^="Mission start"]').inputValue()) === '2026-11-16T21:00:00Z' && /Shackleton-area illustrative point/.test(await text('.mission-site-text')));
await page.click('.demo-actions .btn.primary');
await page.waitForFunction(() => document.getElementById('demo').dataset.step === 'failure');
check('demo step 2 shows the real failure', /No — not from 2026-11-16 21:00 UTC/.test(await text('.demo-text')) && (await outputAttr('data-requirement-met')) === 'false');
await page.click('.demo-actions .btn.primary');
await page.waitForFunction(() => document.getElementById('demo').dataset.step === 'change');
check('demo step 3 names the single explicit change', /one explicit change: start exactly 1 UTC day later/.test(await text('.demo-text')));
await page.click('text=Cancel demo');
check('demo can be cancelled mid-way', !(await page.locator('#demo').isVisible()) && (await state()) === 'result');
await page.click('.mission-actions >> text=Guided demo');
for (const step of ['select', 'failure', 'change', 'result']) {
  await page.waitForFunction((s) => document.getElementById('demo').dataset.step === s, step);
  if (step === 'result') check('demo step 4 compares the two fixed starts', /The change makes the mission fit/.test(await text('.demo-text')) && (await page.locator('.mission-compare').getAttribute('data-alternative-met')) === 'true');
  await page.click('.demo-actions .btn.primary');
}
await page.waitForFunction(() => document.getElementById('demo').dataset.step === 'surface');
await page.waitForFunction(() => document.body.dataset.view === 'surface', null, { timeout: 8000 });
check('demo step 5 stands on the surface at the changed start', (await utc()) === '2026-11-17T21:00:00Z' && await page.locator('#experience').isVisible());
await page.click('.demo-actions .btn.primary');
check('Finish closes the demo and leaves the experience usable', !(await page.locator('#demo').isVisible()) && await page.locator('#experience-play').isEnabled());

// ---- previous detail is still reachable ----
await page.click('#surface-back');
await page.waitForFunction(() => document.body.dataset.view === 'overview');
await page.click('#fold-sites > summary');
check('Sites A/B fold opens with both cards', await page.locator('.site-card.site-a .readout').isVisible() && await page.locator('.site-card.site-b').count() === 1);
await page.click('#fold-sites > summary');
await page.click('#fold-timeline > summary');
check('timeline fold opens with interval bars', (await page.locator('.tl-bar').count()) > 0);
await page.click('#fold-timeline > summary');
await page.click('#open-scenarios');
check('Scenarios dialog still opens', await page.locator('#dialog-scenarios .scenario-table').isVisible());
await page.click('#dialog-scenarios [data-close]');

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
