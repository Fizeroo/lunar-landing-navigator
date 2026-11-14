// Optional real-browser layout check (not part of `npm test`). Needs Microsoft Edge and `npm i --no-save playwright-core`.
// Usage: node tests/browser/ui-layout.mjs [url]   (default http://127.0.0.1:4173/; screenshots go to $UI_FLOW_SHOTS or cwd)
// Viewports are CONTENT sizes, i.e. what is left of a maximised window after browser chrome.
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const shots = process.env.UI_FLOW_SHOTS ?? '.';
const viewports = [[1440, 772], [1366, 768], [1366, 650], [1440, 900], [1920, 950]];
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;

for (const [width, height] of viewports) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tl-bar');
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) };
    };
    const doc = document.documentElement;
    const sites = document.getElementById('sites');
    const inView = (node) => {
      const r = node.getBoundingClientRect();
      const s = sites.getBoundingClientRect();
      return r.width > 0 && r.top >= s.top - 0.5 && r.bottom <= Math.min(s.bottom, window.innerHeight) + 0.5 && r.left >= s.left - 0.5 && r.right <= Math.min(s.right, window.innerWidth) + 0.5;
    };
    const truncated = [...document.querySelectorAll('.cmp-num, .cmp-label, .readout-value, .readout-state, .site-coords, .tl-label')].filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.className + ':' + n.textContent);
    return {
      scrolling: getComputedStyle(document.body).overflowY !== 'hidden',
      page: { sh: doc.scrollHeight, ch: doc.clientHeight, sw: doc.scrollWidth, cw: doc.clientWidth },
      sites: { sh: sites.scrollHeight, ch: sites.clientHeight, sw: sites.scrollWidth, cw: sites.clientWidth },
      moon: rect('.viewport'),
      panel: rect('.timepanel'),
      footer: rect('.disclaimer'),
      comparison: rect('.comparison'),
      keyVisible: {
        coords: [...document.querySelectorAll('.site-coords')].every(inView),
        sky: [...document.querySelectorAll('.sky')].every(inView),
        readouts: [...document.querySelectorAll('.readout')].every(inView),
      },
      comparisonInsidePanel: document.querySelector('.comparison').getBoundingClientRect().bottom <= document.querySelector('.timepanel').getBoundingClientRect().bottom + 0.5,
      truncated,
    };
  });
  const fits = m.page.sh <= m.page.ch && m.page.sw <= m.page.cw && m.sites.sh <= m.sites.ch && m.sites.sw <= m.sites.cw;
  const keys = m.keyVisible.coords && m.keyVisible.sky && m.keyVisible.readouts;
  // In the scrolling (small-window) layout only horizontal overflow is a failure.
  const ok = m.scrolling ? m.page.sw <= m.page.cw : fits && keys && m.comparisonInsidePanel && m.truncated.length === 0;
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${width}x${height} ${m.scrolling ? '(scrolling layout)' : '(fixed layout)'} moon ${m.moon.width}x${m.moon.height} panel ${m.panel.height} footer ${m.footer.height} sites ${m.sites.sh}/${m.sites.ch} keys ${JSON.stringify(m.keyVisible)} truncated ${JSON.stringify(m.truncated)}`);
  await page.screenshot({ path: `${shots}/layout-${width}x${height}.png` });
  await page.close();
}
await browser.close();
if (failed) process.exitCode = 1;
