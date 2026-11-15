import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { bodyToLocalScene, localSceneToBody, bodyToLatLon } from '../src/scene/coords.ts';
import { sampleTerrainWalk, validateTerrainPatch } from '../src/science/terrain.ts';

const patch=validateTerrainPatch(JSON.parse(readFileSync(new URL('../public/data/terrain-pgda90-southpolar.json',import.meta.url),'utf8')));
const near=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} versus ${b}`);

test('walking inverse rotation preserves independent equatorial cardinal directions',()=>{
  assert.deepEqual(localSceneToBody(new Vector3(1,0,0),0,0),[0,1,0]);
  assert.deepEqual(localSceneToBody(new Vector3(0,1,0),0,0),[1,0,0]);
  const north=localSceneToBody(new Vector3(0,0,-1),0,0);
  north.forEach((v,i)=>near(v,[0,0,1][i]));
  for(const [lat,lon]of [[-89,4],[-89,-5],[0,90],[45,-170]]) {
    for(const body of [[1,0,0],[0,1,0],[0,0,1],[0.3,-0.2,0.9]]) {
      const result=localSceneToBody(bodyToLocalScene(body,lat,lon),lat,lon);
      result.forEach((v,i)=>near(v,body[i]));
    }
  }
});

test('a half-kilometre local walk retains real facet ground and 1.7m eye clearance in a fixed origin',()=>{
  const origin=sampleTerrainWalk(patch,-88.986,4,1.7);
  assert.ok(origin);
  let current=origin;
  const east=localSceneToBody(new Vector3(1,0,0),origin.site.latDeg,origin.site.lonDeg);
  for(let i=0;i<500;i++) {
    const nextSite=bodyToLatLon(current.positionBodyM.map((value,k)=>value+east[k]));
    const next=sampleTerrainWalk(patch,nextSite.latDeg,nextSite.lonDeg,1.7);
    assert.ok(next && next.coverageMarginM>=160,'the test walk stays on supported interior terrain');
    const ground=bodyToLocalScene(next.positionBodyM.map((v,k)=>v-origin.positionBodyM[k]),origin.site.latDeg,origin.site.lonDeg);
    const eye=bodyToLocalScene(next.eyePositionBodyM.map((v,k)=>v-origin.positionBodyM[k]),origin.site.latDeg,origin.site.lonDeg);
    near(eye.distanceTo(ground),1.7,1e-6);
    const clearance=next.eyePositionBodyM.reduce((sum,v,k)=>sum+(v-next.positionBodyM[k])*next.faceNormalBody[k],0);
    assert.ok(clearance>1,'the eye remains strictly above the actual facet, not inside the reference sphere');
    assert.ok(Math.hypot(...next.positionBodyM.map((v,k)=>v-current.positionBodyM[k]))<1.3,'continuous ground has no nearest-pixel jump');
    current=next;
  }
  const distance=Math.hypot(...current.positionBodyM.map((v,k)=>v-origin.positionBodyM[k]));
  assert.ok(distance>495 && distance<505);
});
