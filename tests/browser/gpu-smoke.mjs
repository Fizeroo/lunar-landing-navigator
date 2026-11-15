// Optional headful performance smoke (not part of `npm test`). Needs Microsoft Edge and `npm i --no-save playwright-core`.
// Usage: node tests/browser/gpu-smoke.mjs [url]   (default http://127.0.0.1:4173/)
// Opens its own visible Edge window with a temporary profile, without forcing software rendering, reports the
// WebGL renderer the browser actually chose, the search latency and ~5 s of surface frame rate, then closes
// only that window. It measures this machine at this moment; it is not a general performance claim.
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1456,900'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 772 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__lln?.probe().utc === '2027-01-17T03:56:37.557Z', null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (!gl) return 'no WebGL context';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? `${gl.getParameter(info.UNMASKED_VENDOR_WEBGL)} | ${gl.getParameter(info.UNMASKED_RENDERER_WEBGL)}` : String(gl.getParameter(gl.RENDERER));
  });
  const frames = (seconds) => page.evaluate((s) => new Promise((resolve) => {
    const times = [];
    const t0 = performance.now();
    const f = (now) => { times.push(now); if (now - t0 < s * 1000) requestAnimationFrame(f); else resolve(times); };
    requestAnimationFrame(f);
  }), seconds).then((times) => {
    const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
    return { fps: (gaps.length / ((times.at(-1) - times[0]) / 1000)).toFixed(1), medianMs: gaps[Math.floor(gaps.length / 2)].toFixed(1), p95Ms: gaps[Math.floor(gaps.length * 0.95)].toFixed(1), worstMs: gaps.at(-1).toFixed(1) };
  });
  const search = async () => { const t = Date.now(); await page.click('#find-candidates'); await page.waitForSelector('.candidate-choice'); return Date.now() - t; };
  const cold = await search();
  await page.click('#candidates .candidate-heading .btn');
  const warm = await search();
  const orbit = await frames(3);
  await page.locator('.candidate-choice').first().click();
  await page.click('#point-card .point-action');
  await page.waitForFunction(() => window.__lln.probe().view === 'surface' && !document.getElementById('view-fade').classList.contains('on'));
  await page.waitForTimeout(800);
  const still = await frames(5);
  await page.click('#look-north');
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  const walking = await frames(5);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  console.log(JSON.stringify({ url, renderer, viewport: '1440x772', devicePixelRatio: dpr, searchClickToListMs: { cold, warm }, regionalOrbit3s: orbit, surfaceStill5s: still, surfaceWalking5s: walking }, null, 2));
} finally {
  await browser.close();
}
