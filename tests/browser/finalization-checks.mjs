// Optional bounded replay of the eight legacy browser-test discrepancies.
// npm i --no-save --package-lock=false playwright-core
// node tests/browser/finalization-checks.mjs [url] [report.json]
// Headless only: never captures the user's mouse or opens a visible browser.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
const targetUrl = process.argv[2] ?? 'http://127.0.0.1:4173/';
const reportPath = process.argv[3] ?? 'artifacts/finalization-focused.json';
const browser=await chromium.launch({channel:'msedge',headless:true,args:process.platform === 'win32' ? ['--use-angle=d3d11','--disable-background-timer-throttling'] : []});
const page=await browser.newPage({viewport:{width:1440,height:772}});
const checks=[], errors=[];
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
page.on('pageerror',e=>errors.push(String(e)));
const check=(name,ok,detail='')=>{checks.push({name,passed:!!ok,detail});console.log(JSON.stringify(checks.at(-1)));};
const probe=()=>page.evaluate(()=>window.__lln.probe());
const text=async sel=>page.locator(sel).first().innerText();
const coordinateFrom=value=>value.match(/[0-9.]+° [NS], [0-9.]+° [EW]/)?.[0]??'';
const waitDone=async view=>page.waitForFunction(v=>{const p=window.__lln.probe();return p.view===v&&p.transit===null},view,{timeout:60000});
await page.goto(targetUrl,{waitUntil:'networkidle'});await page.evaluate(()=>localStorage.clear());await page.goto(targetUrl,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__lln?.probe().utc==='2026-11-24T04:00:00.000Z',{timeout:30000});
await page.click('#find-candidates');await page.waitForSelector('.candidate-choice',{timeout:30000});
let rows=await page.locator('.candidate-choice').allInnerTexts();let coords=rows.map(coordinateFrom);
check('candidate coordinates parse uniquely',rows.length<=3&&rows.length>0&&coords.every(Boolean)&&new Set(coords).size===rows.length,JSON.stringify(coords));
await page.locator('.candidate-choice').first().click();await page.waitForTimeout(400);let firstCoord=coordinateFrom(await page.locator('.candidate-choice').first().innerText());let card=await text('#point-card');
check('selected card keeps its numbered name and actual coordinate',/Option 1/.test(card)&&card.includes(firstCoord),card);
await page.click('#point-card .point-action');await waitDone('surface');await page.waitForTimeout(200);let p=await probe();
check('descent settles at requested eye height',p.surface.model==='terrain'&&Math.abs(p.surface.eyeClearanceM-1.7)<=0.02&&Math.abs(p.heightM-1.7)<1e-6,JSON.stringify({eye:p.surface.eyeClearanceM,height:p.heightM,transit:p.transit}));
const arrivalAimsAtBody=['sun','earth'].some(b=>Math.abs(((p.surface.headingDeg-p.bodies[b].azDeg+540)%360)-180)<=0.5&&Math.abs(p.surface.pitchDeg-p.bodies[b].altDeg)<=0.5);
check('arrival faces a calculated Sun/Earth direction',Math.abs(p.surface.fovDeg-65)<0.05&&arrivalAimsAtBody,JSON.stringify({heading:p.surface.headingDeg,pitch:p.surface.pitchDeg,fov:p.surface.fovDeg,sun:p.bodies.sun,earth:p.bodies.earth}));
const setSiteA=async(lat,lon,height)=>{if(!(await page.locator('#analysis').isVisible()))await page.click('#open-analysis');await page.evaluate(()=>{document.getElementById('fold-sites').open=true;document.querySelector('.site-a details.site-fold').open=true});await page.fill('.site-a input[aria-label*="latitude"]',String(lat));await page.fill('.site-a input[aria-label*="longitude"]',String(lon));if(height!==undefined)await page.fill('.site-a input[aria-label*="height"]',String(height));await page.click('.site-a .site-form button[type=submit]');await page.waitForTimeout(300);await page.click('#close-analysis');await page.waitForTimeout(200)};
await setSiteA(-88.873,0);if((await probe()).view!=='surface')await page.click('#tab-surface');await waitDone('surface');await page.click('#look-north');await page.waitForTimeout(800);await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyW');let reached=false;for(let i=0;i<40&&!reached;i++){await page.waitForTimeout(250);reached=/Edge of terrain data/.test(await text('#surface-keys'))}const edgeAt=await probe();await page.waitForTimeout(700);const edgeStop=await probe();await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');const edgeMove=Math.hypot(edgeStop.surface.cameraLocalM[0]-edgeAt.surface.cameraLocalM[0],edgeStop.surface.cameraLocalM[2]-edgeAt.surface.cameraLocalM[2]);check('near-160m walk guard stops with message',reached&&edgeMove<1.5,JSON.stringify({reached,edgeMove,site:edgeStop.site,keys:await text('#surface-keys')}));
await page.click('#return-point');await page.waitForTimeout(300);await setSiteA((await probe()).subsolar.latDeg.toFixed(4),(await probe()).subsolar.lonDeg.toFixed(4));await page.click('#point-card .point-action');await page.waitForSelector('dialog[open]');await page.locator('dialog[open] button',{hasText:'Smooth sphere only'}).click();await waitDone('surface');await page.click('#look-sun');await page.waitForTimeout(1200);p=await probe();const compass=await text('#surface-compass');check('near-zenith direction is reached and rounded honestly to 90 degrees',p.bodies.sun.altDeg>89&&/heading —|pitch \+9\d°/.test(compass),JSON.stringify({alt:p.bodies.sun.altDeg,pitch:p.surface.pitchDeg,compass}));
await page.click('#point-card .point-action');await waitDone('overview');await page.click('#open-data');const dataText=await text('#data-body');check('accuracy copy describes finite terrain and picture-only surroundings',/Explorer model & appearance/i.test(dataText)&&/finite 8 km patch cannot certify distant horizon clearance or route safety/i.test(dataText)&&/These surroundings are a picture only/i.test(dataText)&&/visibility results, slopes, candidates and the ground you walk on never use them/i.test(dataText)&&/No visible fraction of a disc is calculated/i.test(dataText));await page.click('#dialog-data [data-close]');await page.click('#tab-space');await page.waitForFunction(()=>window.__lln.probe().view==='space',undefined,{timeout:15000});const space=await text('#layer-space');check('Space view is secondary and labels scale',(await probe()).view==='space'&&/Distances and sizes not to scale/i.test(space),space);
check('no console or page errors',errors.length===0,errors.slice(0,3).join(' | '));await browser.close();const failed=checks.filter(x=>!x.passed);const report={passed:checks.length-failed.length,total:checks.length,checks}; await mkdir(dirname(reportPath), {recursive:true}); await writeFile(reportPath,JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));if(failed.length)process.exitCode=1;
