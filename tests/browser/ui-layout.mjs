// SUPERSEDED for the immersive layout: this script targets the earlier side-panel UI and is kept for reference only.
// The current real-browser check is tests/browser/immersive-flow.mjs.
// Optional real-browser layout check (not part of `npm test`). Needs Microsoft Edge and `npm i --no-save playwright-core`.
// Usage: node tests/browser/ui-layout.mjs [url]   (default http://127.0.0.1:4173/; screenshots go to $UI_FLOW_SHOTS or cwd)
// Viewports are CONTENT sizes, i.e. what is left of a maximised window after browser chrome.
// Checked in the default state of the mission-window layout: mission panel visible, Sites A/B, timeline and comparison folded.
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const shots = process.env.UI_FLOW_SHOTS ?? '.';
const viewports = [[1440, 772], [1366, 768], [1366, 650], [1440, 900], [1920, 950]];
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;

for (const [width, height] of viewports) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('data-status').dataset.tone === 'ok');
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) };
    };
    const doc = document.documentElement;
    const visible = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight + 0.5 && r.left >= 0 && r.right <= window.innerWidth + 0.5;
    };
    const truncated = [...document.querySelectorAll('.tab, .top-actions .btn, .mf-label, .mission-form .btn, .fold-title')]
      .filter((n) => n.offsetParent !== null && n.scrollWidth > n.clientWidth + 1).map((n) => `${n.className}:${n.textContent}`);
    return {
      scrolling: getComputedStyle(document.body).overflowY !== 'hidden',
      page: { sh: doc.scrollHeight, ch: doc.clientHeight, sw: doc.scrollWidth, cw: doc.clientWidth },
      moon: rect('.viewport'),
      side: rect('.side'),
      mission: rect('.mission'),
      findVisible: visible('.mission-form button[type=submit]'),
      formVisible: visible('.mission-form'),
      timeControlsVisible: visible('.time-controls'),
      footerVisible: visible('.disclaimer'),
      truncated,
    };
  });
  const fits = m.page.sh <= m.page.ch && m.page.sw <= m.page.cw;
  // In the scrolling (small-window) layout only horizontal overflow is a failure.
  const ok = m.scrolling
    ? m.page.sw <= m.page.cw
    : fits && m.findVisible && m.formVisible && m.timeControlsVisible && m.footerVisible && m.truncated.length === 0 && m.moon.width > m.side.width * 2;
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${width}x${height} ${m.scrolling ? '(scrolling layout)' : '(fixed layout)'} 3D ${m.moon.width}x${m.moon.height} side ${m.side.width}x${m.side.height} mission ${m.mission.height} form visible ${m.formVisible} find visible ${m.findVisible} truncated ${JSON.stringify(m.truncated)}`);
  await page.screenshot({ path: `${shots}/layout-${width}x${height}.png` });
  await page.close();
}
await browser.close();
if (failed) process.exitCode = 1;
