import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {defaultScenarios,validateScenarioSet,serializeScenarioSet,parseScenarioSet,encodeScenarioFragment,decodeScenarioFragment} from '../src/ui/scenario.ts';
import {CATALOGUE} from '../src/ui/catalogue.ts';
import {bodyToLocalScene,headingPitchToLocal,localToHeadingPitch} from '../src/scene/coords.ts';
import {observeObserver} from '../src/science/observer.ts';
import {validateEphemeris,utcToEt} from '../src/science/index.ts';

const data=validateEphemeris(JSON.parse(readFileSync(new URL('../public/data/ephemeris-2026-10_2027-02.json',import.meta.url))));
const seed={name:'A',latDeg:-89,lonDeg:0,observerHeightM:2};
test('default scenarios compare equal duration A now/A later/B now and preserve explicit height/model',()=>{
 const set=defaultScenarios(seed,{...seed,name:'B',latDeg:-85.3},'2026-11-14T00:00:00Z',data.id);
 assert.equal(new Set(set.scenarios.map(s=>s.durationSeconds)).size,1);
 assert.equal(set.scenarios[1].startUtc,'2026-11-17T00:00:00Z');
 assert.equal(set.scenarios[2].site.latDeg,-85.3);
 assert.ok(set.scenarios.every(s=>s.model==='reference-sphere'&&s.observerHeightM===2));
});
test('scenario export/share roundtrips only public fields and rejects malformed imports',()=>{
 const set=defaultScenarios(seed,{...seed,name:'B'},'2026-11-14T00:00:00Z',data.id);
 set.scenarios[0].privateToken='must-not-export';
 const serialized=serializeScenarioSet(set);
 assert.ok(!serialized.includes('privateToken')&&!serialized.includes('must-not-export'));
 assert.deepEqual(decodeScenarioFragment('#'+encodeScenarioFragment(set)),parseScenarioSet(serialized));
 assert.throws(()=>parseScenarioSet('{bad'),/JSON/);
 assert.throws(()=>decodeScenarioFragment('#scenarios=%%%'),/valid/);
 for(const override of [{startUtc:'2026-02-30T00:00:00Z'},{startUtc:'2026-11-14T00:00:00'},{observerHeightM:-1},{model:'imaginary-terrain'},{durationSeconds:0}])
  assert.throws(()=>validateScenarioSet({version:1,scenarios:[{...set.scenarios[0],...override}]}));
 assert.throws(()=>validateScenarioSet({version:1,scenarios:[set.scenarios[0],set.scenarios[0]]}),/duplicate/);
});
test('expanded real dataset spans more than four lunar cycles without replacing the original',()=>{
 assert.equal(data.coverage.startUtc,'2026-10-01T00:00:00Z');assert.equal(data.coverage.endUtc,'2027-02-01T00:00:00Z');
 assert.ok(data.samples.length>17000);
 assert.ok(data.coverage.endEt-data.coverage.startEt>4*29.53*86400);
});
test('surface ENU projection matches science altitude and heading at different sites, times and observer heights',()=>{
 for(const [latDeg,lonDeg] of [[-89,0],[-84.6,31],[0,23.47],[42,-179.9]])for(const utc of ['2026-10-01T00:00:00Z','2026-11-14T00:00:00Z','2027-01-20T00:00:00Z'])for(const height of [0,2,10000]){
  const obs=observeObserver(data,utcToEt(data,utc),{latDeg,lonDeg,heightAboveReferenceSphereM:0},height);
  for(const body of [obs.sun,obs.earth]){const scene=bodyToLocalScene(body.direction,latDeg,lonDeg);const v=localToHeadingPitch(scene);
   assert.ok(Math.abs(v.pitchDeg-body.altDeg)<1e-9);
   if(body.azDeg!==null)assert.ok(Math.abs(((v.headingDeg-body.azDeg+540)%360)-180)<1e-9);
   assert.ok(headingPitchToLocal(v.headingDeg??0,v.pitchDeg).distanceTo(scene)<1e-10);
  }
 }
});
test('catalogue distinguishes feature centres from named historical sites and cites official sources',()=>{
 assert.ok(CATALOGUE.some(x=>x.group==='historical'&&x.kind==='named landing site'));
 assert.ok(CATALOGUE.filter(x=>x.group==='south-pole').length>=3);
 assert.equal(new Set(CATALOGUE.map(x=>x.id)).size,CATALOGUE.length);
 for(const entry of CATALOGUE){assert.match(entry.sourceUrl,/^https:\/\/planetarynames\.wr\.usgs\.gov\/Feature\/\d+$/);assert.ok(Number.isFinite(entry.latDeg)&&entry.latDeg>=-90&&entry.latDeg<=90);}
});
