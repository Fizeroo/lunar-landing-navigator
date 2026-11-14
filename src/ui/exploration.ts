import type { EphemerisData, Site, TimeInterval, SiteAnalysis } from '../contracts';
import { MoonScene, type SiteId } from '../scene/MoonScene';
import { SurfaceScene } from '../scene/SurfaceScene';
import { etToUtc, utcToEt } from '../science/index';
import { observeObserver, analyzeObserver, sphereHorizonDipDeg } from '../science/observer';
import { getUpcomingEvents } from '../science/events';
import { validateTerrainPatch, terrainVertices, sampleTerrain, observeTerrain, type TerrainPatch, type TerrainVisibility } from '../science/terrain';
import { el, make, button, link, setupDialog, errorText } from './dom';
import { CATALOGUE_GROUPS, entriesInGroup } from './catalogue';
import { formatDuration, formatPercent, formatUtcMinute, formatUtcSecond } from './format';
import { defaultScenarios, parseScenarioSet, serializeScenarioSet, validateScenarioSet, encodeScenarioFragment, decodeScenarioFragment, SCENARIO_STORAGE_KEY, newScenarioId, type ScenarioSet } from './scenario';

export interface ExplorerBridge {
  moon: MoonScene;
  getState(): { data: EphemerisData|null; sites: Record<SiteId,{site:Site;presetId:string|null}>; active: SiteId; et:number|null; period:TimeInterval|null };
  getHeight(id:SiteId):number;
  setHeight(id:SiteId,height:number):void;
  setSite(id:SiteId,site:Site,presetId?:string):void;
  setActive(id:SiteId):void;
  setPeriod(period:TimeInterval):void;
  seek(et:number):void;
}
export interface Explorer { refresh():void; loaded():void }

export function createExplorer(bridge:ExplorerBridge):Explorer {
  const surface = new SurfaceScene(el('surface'));
  let mode:'overview'|'space'|'surface' = 'overview';
  let transitioning = false;
  let terrain:TerrainPatch|null=null;
  let terrainEnabled=false;
  let terrainMeshKey='';
  const terrainButton=button('Explore real LOLA terrain','btn');
  terrainButton.disabled=true;
  const smoothButton=button('Use smooth sphere','btn');
  el('surface-back').parentElement!.append(terrainButton,smoothButton);
  const terrainDetails=make('details','terrain-details');terrainDetails.hidden=true;
  const terrainSummary=make('summary',undefined,'Local terrain horizon • limited coverage');
  const terrainReadout=make('p');
  const profileHost=make('div');terrainDetails.append(terrainSummary,terrainReadout,profileHost);
  const events = make('section','upcoming');
  events.setAttribute('aria-label','Upcoming changes at the active site');
  el('sites').append(events);
  const eventTitle = make('h2');
  const eventText = make('div','event-grid');
  const actions = make('div','event-actions');
  const eventButtons = Object.fromEntries(['sunrise','sunset','earthrise','earthset','joint'].map(key=> {
    const name = {sunrise:'Next sunrise',sunset:'Next sunset',earthrise:'Next Earthrise',earthset:'Next Earthset',joint:'Next joint window'}[key]!;
    const b=button(name,'btn'); b.disabled=true; actions.append(b); return [key,b];
  })) as Record<string,HTMLButtonElement>;
  events.append(eventTitle,eventText,actions,make('p','muted','Reference-plane events • search entire prepared dataset • approximate minutes. Coverage limits are not rise/set events.'));
  events.append(terrainDetails);
  terrainButton.onclick=()=>{if(!terrain)return;bridge.setSite(bridge.getState().active,terrain.observer.site);terrainEnabled=true;terrainMeshKey='';void setMode('surface');refresh();};
  smoothButton.onclick=()=>{terrainEnabled=false;terrainMeshKey='';surface.setTerrain(null);terrainDetails.hidden=true;refresh();};
  void fetch('/data/terrain-pgda90-southpolar.json').then(async response=>{if(!response.ok)throw Error(`HTTP ${response.status}`);terrain=validateTerrainPatch(await response.json());terrainButton.disabled=false;terrainButton.title='Real LOLA DEM: 8 km patch, 80 m source grid; not a designated landing site';}).catch(error=>{terrainButton.textContent='Terrain unavailable';terrainButton.title=errorText(error);});
  const fullCache = new Map<string,SiteAnalysis>();
  let lastEventKey='';
  const panels = ['catalogue','scenarios','data'].map(id=>el<HTMLDialogElement>(`dialog-${id}`));
  panels.forEach(setupDialog);
  for(const id of ['catalogue','scenarios','data']) el(`open-${id}`).addEventListener('click',()=> {
    if(id==='catalogue') renderCatalogue(); if(id==='scenarios') renderScenarios(); if(id==='data') renderData();
    el<HTMLDialogElement>(`dialog-${id}`).showModal();
  });
  el('open-data-footer').addEventListener('click',()=>{renderData();el<HTMLDialogElement>('dialog-data').showModal();});

  async function setMode(next:typeof mode):Promise<void> {
    if(transitioning) return;
    if(next==='surface' && mode!=='surface') {
      transitioning=true;
      bridge.moon.setMode('overview');
      await Promise.race([bridge.moon.approachSite(bridge.getState().active),new Promise(resolve=>setTimeout(resolve,1500))]);
      transitioning=false;
    }
    mode=next;
    terrainDetails.hidden=next!=='surface'||!terrainEnabled;
    el('sites').dataset['mode']=next;
    for(const id of ['overview','space','surface'] as const) {
      el(`tab-${id}`).setAttribute('aria-selected',String(next===id));
      el(`layer-${id}`).hidden=next!==id;
    }
    el('scene').hidden=next==='surface'; el('surface').hidden=next!=='surface';
    surface.setActive(next==='surface'); bridge.moon.setActive(next!=='surface');
    if(next!=='surface') bridge.moon.setMode(next);
    refresh();
  }
  for(const id of ['overview','space','surface'] as const) el(`tab-${id}`).addEventListener('click',()=>void setMode(id));
  el('explore-surface').addEventListener('click',()=>void setMode('surface'));
  el('surface-back').addEventListener('click',()=>void setMode('overview'));
  el('look-sun').addEventListener('click',()=>surface.lookAt('sun'));
  el('look-earth').addEventListener('click',()=>surface.lookAt('earth'));
  el('look-north').addEventListener('click',()=>surface.lookHeading(0));
  el<HTMLInputElement>('surface-height').addEventListener('input',event=>bridge.setHeight(bridge.getState().active,Number((event.target as HTMLInputElement).value)));
  surface.onView(view=> {
    el('surface-compass').textContent=`Look direction ${view.headingDeg===null?'undefined':`${view.headingDeg.toFixed(0)}°`} • pitch ${view.pitchDeg.toFixed(0)}° • N 0° / E 90° / S 180° / W 270°`;
  });

  function fullAnalysis(data:EphemerisData,site:Site,height:number):SiteAnalysis {
    const key=[data.id,site.latDeg,site.lonDeg,height].join('|');
    let result=fullCache.get(key);
    if(!result){ result=analyzeObserver(data,site,{startEt:data.coverage.startEt,endEt:data.coverage.endEt},height); if(fullCache.size>24)fullCache.clear();fullCache.set(key,result); }
    return result;
  }
  const when=(data:EphemerisData,et:number)=>formatUtcMinute(etToUtc(data,et));
  function refresh():void {
    const s=bridge.getState(); if(!s.data || s.et===null) {eventTitle.textContent='Upcoming changes: waiting for data';return;}
    const data=s.data, et=s.et, site=s.sites[s.active].site, height=bridge.getHeight(s.active);
    let observation=observeObserver(data,et,site,height);
    const dip=sphereHorizonDipDeg(height);
    if(mode==='surface') {
      let terrainResult:ReturnType<typeof observeTerrain>|null=null;
      if(terrainEnabled&&terrain){
        const vetted=terrain.observer.site;
        if(Math.abs(site.latDeg-vetted.latDeg)>1e-8||Math.abs(site.lonDeg-vetted.lonDeg)>1e-8){
          terrainEnabled=false;terrainMeshKey='';surface.setTerrain(null);terrainDetails.hidden=true;
          el('surface-status').textContent='Terrain coverage insufficient at this site. Smooth sphere used. Choose Explore real LOLA terrain for the vetted point.';
        }else try{
          terrainResult=observeTerrain(data,et,site,height,terrain);observation=terrainResult.observation;
          const ground=sampleTerrain(terrain,site)!;const key=`${terrain.id}|${site.latDeg}|${site.lonDeg}`;
          if(key!==terrainMeshKey){const grid=terrainVertices(terrain);surface.setTerrain({...grid,originM:ground.positionM,latDeg:site.latDeg,lonDeg:site.lonDeg});terrainMeshKey=key;}
          terrainDetails.hidden=false;
          const status=(body:TerrainVisibility)=>body.status==='blocked'?'Blocked by terrain':body.status==='clear'?'Above terrain horizon':'Terrain coverage insufficient';
          terrainReadout.textContent=`Sun: alt ${observation.sun.altDeg.toFixed(2)}°, az ${observation.sun.azDeg?.toFixed(1)??'undefined'}° — ${status(terrainResult.sun)}. Earth: alt ${observation.earth.altDeg.toFixed(2)}°, az ${observation.earth.azDeg?.toFixed(1)??'undefined'}° — ${status(terrainResult.earth)}. Local centre-ray test; no eclipse or terrain disk fraction.`;
          const profileKey=`${key}|${height}`;
          if(profileHost.dataset['key']!==profileKey){
            const ns='http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 600 130');svg.setAttribute('role','img');svg.setAttribute('aria-label','Known local terrain horizon by azimuth, not a certified complete horizon');
            const x=(az:number)=>20+az/360*560,y=(alt:number)=>65-Math.max(-15,Math.min(15,alt))*3;
            const line=document.createElementNS(ns,'path');line.setAttribute('d',terrainResult.profile.samples.filter(p=>p.horizonAltDeg!==null).map((p,i)=>`${i?'L':'M'}${x(p.azDeg)},${y(p.horizonAltDeg!)}`).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','#f4ba63');line.setAttribute('stroke-width','2');svg.append(line);
            for(const [az,label] of [[0,'N'],[90,'E'],[180,'S'],[270,'W'],[360,'N']] as const){const text=document.createElementNS(ns,'text');text.setAttribute('x',String(x(az)));text.setAttribute('y','118');text.setAttribute('fill','#cdd8eb');text.textContent=label;svg.append(text);}
            const horizon=document.createElementNS(ns,'path');horizon.setAttribute('d','M20,65 L580,65');horizon.setAttribute('stroke','#657b99');svg.append(horizon);
            profileHost.replaceChildren(svg,make('p','muted','Known DEM only • vertical display ±15° • reference line 0° • azimuth bins 2° • unknown terrain beyond orange boundary. No mesh shadow rendering.'));
            profileHost.dataset['key']=profileKey;
          }
          const svg=profileHost.querySelector('svg');
          if(svg){
            svg.querySelectorAll('[data-body]').forEach(node=>node.remove());
            for(const [name,body,color] of [['Sun',observation.sun,'#ffc94a'],['Earth',observation.earth,'#7fbaff']] as const){
              if(body.azDeg===null)continue;
              const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('data-body',name);circle.setAttribute('cx',String(20+body.azDeg/360*560));circle.setAttribute('cy',String(65-Math.max(-15,Math.min(15,body.altDeg))*3));circle.setAttribute('r','4');circle.setAttribute('fill',color);
              const label=document.createElementNS('http://www.w3.org/2000/svg','text');label.setAttribute('data-body',name);label.setAttribute('x',String(20+body.azDeg/360*560));label.setAttribute('y',String(57-Math.max(-15,Math.min(15,body.altDeg))*3));label.setAttribute('fill',color);label.setAttribute('text-anchor',body.azDeg>330?'end':'start');label.textContent=name;svg.append(circle,label);
            }
          }
        }catch(error){terrainReadout.textContent=`Terrain coverage insufficient: ${errorText(error)}. Smooth sphere used.`;surface.setTerrain(null);terrainEnabled=false;terrainDetails.hidden=false;}
      }
      surface.update({observation,latDeg:site.latDeg,lonDeg:site.lonDeg,observerHeightM:height,compassDefined:Math.abs(site.latDeg)!==90,
        hiddenReason:{sun:terrainResult?'Blocked by terrain':'Below smooth-sphere horizon',earth:terrainResult?'Blocked by terrain':'Below smooth-sphere horizon'},
        hidden:{sun:terrainResult?terrainResult.sun.status==='blocked':observation.sun.altDeg+observation.sun.angularRadiusDeg < -dip,earth:terrainResult?terrainResult.earth.status==='blocked':observation.earth.altDeg+observation.earth.angularRadiusDeg < -dip}});
      el('surface-title').textContent=`Site ${s.active.toUpperCase()} • ${site.latDeg.toFixed(4)}°, ${site.lonDeg.toFixed(4)}° E • ${terrainResult?'Real LOLA terrain':'smooth sphere'}`;
      el('surface-status').textContent=terrainResult?`Sun centre: ${terrainResult.sun.status==='blocked'?'Blocked by terrain':'Terrain coverage insufficient'}; Earth centre: ${terrainResult.earth.status==='blocked'?'Blocked by terrain':'Terrain coverage insufficient'}. Ground ${terrainResult.groundHeightM.toFixed(1)} m relative to R; A/B and events remain reference-sphere results.`:`Sun ${observation.sun.altDeg>0?'Above':'Below'} reference horizon; ${observation.sun.altDeg>-dip?'above':'below'} smooth-sphere limb. Earth ${observation.earth.altDeg>0?'Above':'Below'} reference horizon; ${observation.earth.altDeg>-dip?'above':'below'} smooth-sphere limb.`;
      el('surface-height').setAttribute('aria-label',`Observer height above ${terrainResult?'local DEM':'the reference sphere'}, metres`);
      el('surface-height').parentElement!.querySelector('span')!.textContent=`Observer height above ${terrainResult?'local DEM':'the sphere'}`;
      el('surface-note').textContent=terrainResult?`Scientific eye height ${height} m above DEM; camera ${surface.eyeHeightM.toFixed(0)} m (minimum 2 m). Real vertical scale; 80 m grid, effective resolution/uncertainty unverified. Orange edge = coverage boundary, no walls. Unseen distant mountains remain unknown. No terrain shadows or fine rocks claimed.`:`Reference plane = 0°. Visible sphere limb = −${dip.toFixed(2)}°. Scientific height ${height} m; camera clearance ${surface.eyeHeightM.toFixed(0)} m (minimum 2 m for safe viewing). Drag to look; scroll to zoom. Body angular sizes are approximate; no eclipse calculation.`;
    }
    el<HTMLInputElement>('surface-height').value=String(height); el('surface-height-out').textContent=`${height} m`;
    const eventKey=[s.active,site.latDeg,site.lonDeg,height,Math.floor(et)].join('|');
    if(eventKey===lastEventKey)return;lastEventKey=eventKey;
    eventTitle.textContent=`Next changes • Site ${s.active.toUpperCase()} • ${height} m • full data coverage`;
    const full=fullAnalysis(data,site,height);
    const upcoming=getUpcomingEvents(full,et);
    eventText.replaceChildren();
    for(const key of ['sunrise','sunset','earthrise','earthset'] as const) {
      const value=upcoming[key]; const label={sunrise:'Sunrise',sunset:'Sunset',earthrise:'Earthrise',earthset:'Earthset'}[key];
      eventText.append(make('p',undefined,`${label}: ${value?`${when(data,value.et)} • in ${formatDuration(value.et-et)}`:'Not found within available data'}`));
      eventButtons[key]!.disabled=!value; eventButtons[key]!.onclick=value?()=>bridge.seek(value.et):null;
    }
    const joint=upcoming.joint;
    eventText.append(make('p','joint-event',joint?`${joint.ongoing?'Current':'Next'} joint window: ${when(data,joint.startEt)} → ${when(data,joint.endEt)} • ${formatDuration(joint.endEt-joint.startEt)}${joint.startClipped||joint.endClipped?' • clipped by data coverage':''}`:'Joint window: Not found within available data'));
    const nextJoint=full.both.intervals.find(span=>span.startEt>et);
    eventButtons.joint!.disabled=!nextJoint;eventButtons.joint!.title=nextJoint?'Jump to the next joint window start':'No later joint window found within available data';eventButtons.joint!.onclick=nextJoint?()=>bridge.seek(nextJoint.startEt):null;
  }

  function renderCatalogue():void {
    const host=el('catalogue-body');host.replaceChildren(make('p',undefined,'Choose A or B explicitly. Feature centres are illustrative, not approved landing sites.'));
    for(const group of CATALOGUE_GROUPS){host.append(make('h3',undefined,group.title),make('p',undefined,group.description),link(group.contextLabel,group.contextUrl));
      for(const entry of entriesInGroup(group.id)){
        const row=make('article','catalogue-row');row.append(make('strong',undefined,entry.name),make('span',undefined,`${entry.latDeg}°, ${entry.lonDeg}° E • ${entry.kind} • ${entry.note}`),link('Coordinate source',entry.sourceUrl));
        for(const id of ['a','b'] as const){const b=button(`Use as ${id.toUpperCase()}`);b.onclick=()=>{bridge.setSite(id,{latDeg:entry.latDeg,lonDeg:entry.lonDeg,heightAboveReferenceSphereM:0},entry.id);bridge.setActive(id);el<HTMLDialogElement>('dialog-catalogue').close();};row.append(b);}host.append(row);
      }
    }
  }
  let scenarios:ScenarioSet|null=null;
  let scenarioMessage='';
  function save():void {if(scenarios)try{localStorage.setItem(SCENARIO_STORAGE_KEY,serializeScenarioSet(scenarios));}catch{scenarioMessage='Local storage unavailable; export your scenarios to keep them.';}}
  function newDefaults():void {
    const s=bridge.getState(); if(!s.data||s.et===null)return;
    const start=s.et;
    scenarios=defaultScenarios({name:'Site A',...s.sites.a.site,observerHeightM:bridge.getHeight('a')},{name:'Site B',...s.sites.b.site,observerHeightM:bridge.getHeight('b')},formatUtcSecond(etToUtc(s.data,start)),s.data.id);
    save();
  }
  function renderScenarios():void {
    const s=bridge.getState(), data=s.data;const host=el('scenarios-body');host.replaceChildren();
    if(!data||s.et===null){host.append(make('p',undefined,'Wait for ephemeris data.'));return;}
    if(!scenarios)newDefaults();
    const tools=make('div','scenario-tools');
    const defaults=button('A now / A +3 days / B now');defaults.onclick=()=>{newDefaults();renderScenarios();};
    const capture=button('Save active scenario');capture.onclick=()=>{if(!scenarios||scenarios.scenarios.length>=12){scenarioMessage='At most 12 scenarios can be stored.';}else{const site=s.sites[s.active].site; scenarios=validateScenarioSet({version:1,scenarios:[...scenarios.scenarios,{version:1,id:newScenarioId(),name:`Site ${s.active.toUpperCase()} saved`,site,startUtc:formatUtcSecond(etToUtc(data,s.period?.startEt??s.et!)),durationSeconds:(s.period?.endEt??s.et!+7*86400)-(s.period?.startEt??s.et!),observerHeightM:bridge.getHeight(s.active),model:'reference-sphere',datasetId:data.id}]});save();}renderScenarios();};
    const exportButton=button('Export JSON');exportButton.onclick=()=>{if(!scenarios)return;const url=URL.createObjectURL(new Blob([serializeScenarioSet(scenarios)],{type:'application/json'}));const a=make('a');a.href=url;a.download='lunar-scenarios.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    const share=button('Create share link');const shareField=make('textarea');shareField.readOnly=true;shareField.setAttribute('aria-label','Scenario share link');shareField.hidden=true;
    share.onclick=()=>{if(scenarios){shareField.value=`${location.origin}${location.pathname}#${encodeScenarioFragment(scenarios)}`;shareField.hidden=false;shareField.select();}};
    const file=make('input');file.type='file';file.hidden=true;const importButton=button('Import JSON');importButton.onclick=()=>file.click();file.accept='.json,application/json';file.setAttribute('aria-label','Import scenarios JSON');file.onchange=async()=>{try{const f=file.files?.[0];if(!f)return;if(f.size>200000)throw Error('File is too large.');scenarios=parseScenarioSet(await f.text());save();scenarioMessage='Imported scenarios validated. Unsupported dates are flagged individually.';}catch(error){scenarioMessage=errorText(error);}renderScenarios();};
    tools.append(defaults,capture,exportButton,share,importButton,file);host.append(make('p',undefined,'Reference-sphere comparisons. Defaults use the same 7-day duration; saved scenarios retain explicit height/model. Imported dates are never silently shifted.'),tools,shareField,make('p','field-error',scenarioMessage));
    const list=make('div','scenario-list');
    const analyses:Array<{name:string;result:SiteAnalysis}>=[];
    for(const scenario of scenarios?.scenarios??[]){
      const row=make('article','scenario-card');row.append(make('h3',undefined,scenario.name));
      const form=make('form');const name=make('input');name.value=scenario.name;name.setAttribute('aria-label','Scenario name');
      const start=make('input');start.value=scenario.startUtc;start.setAttribute('aria-label','Scenario start UTC');
      const days=make('input');days.type='number';days.min=String(600/86400);days.step='any';days.value=String(scenario.durationSeconds/86400);days.setAttribute('aria-label','Scenario duration days');
      const height=make('input');height.type='number';height.min='0';height.max='10000';height.value=String(scenario.observerHeightM);height.setAttribute('aria-label','Scenario observer height metres');
      const update=button('Update');update.type='submit';form.append(name,start,days,height,update);form.onsubmit=e=>{e.preventDefault();try{const updated=validateScenarioSet({version:1,scenarios:[{...scenario,name:name.value,startUtc:start.value,durationSeconds:Number(days.value)*86400,observerHeightM:Number(height.value)}]}).scenarios[0]!;scenarios!.scenarios=scenarios!.scenarios.map(x=>x.id===scenario.id?updated:x);save();scenarioMessage='Saved locally.';}catch(error){scenarioMessage=errorText(error);}renderScenarios();};
      row.append(make('p',undefined,`${scenario.site.latDeg}°, ${scenario.site.lonDeg}° E • start UTC / duration days / observer metres • ${scenario.model}`),form);
      try{if(scenario.datasetId!==data.id)throw Error('Dataset differs from available data.');const from=utcToEt(data,scenario.startUtc),to=from+scenario.durationSeconds;if(to>data.coverage.endEt)throw Error('Scenario extends beyond available data.');const analysis=analyzeObserver(data,scenario.site,{startEt:from,endEt:to},scenario.observerHeightM);analyses.push({name:scenario.name,result:analysis});
        for(const key of ['sun','earth','both'] as const)row.append(make('p',undefined,`${key==='both'?'Sun + Earth':key==='sun'?'Sun':'Earth'}: ${formatPercent(analysis[key].fraction)} • total ${formatDuration(analysis[key].totalSeconds)} • longest ${formatDuration(analysis[key].longestSeconds)}`));
        const open=button('Explore this scenario');open.onclick=()=>{bridge.setSite(s.active,scenario.site);bridge.setHeight(s.active,scenario.observerHeightM);bridge.setPeriod({startEt:from,endEt:to});bridge.seek(from);el<HTMLDialogElement>('dialog-scenarios').close();};row.append(open);
      }catch(error){row.append(make('p','field-error',errorText(error)));}
      const remove=button('Remove');remove.onclick=()=>{if(scenarios!.scenarios.length===1){scenarioMessage='Keep at least one scenario, or replace with the default examples.';}else{scenarios!.scenarios=scenarios!.scenarios.filter(x=>x.id!==scenario.id);save();}renderScenarios();};row.append(remove);list.append(row);
    }
    host.append(list);
    if(analyses.length>1){const equal=analyses.every(a=>Math.abs((a.result.period.endEt-a.result.period.startEt)-(analyses[0]!.result.period.endEt-analyses[0]!.result.period.startEt))<.001);host.append(make('h3',undefined,'What differs?'),make('p',undefined,equal?'Equal-duration comparison.':'Durations differ: compare percentages as well as total time.'));
      for(const key of ['sun','earth','both'] as const){const sorted=[...analyses].sort((a,b)=>b.result[key].fraction-a.result[key].fraction);host.append(make('p',undefined,`${key==='both'?'Joint visibility':key==='sun'?'Sun visibility':'Earth visibility'}: ${sorted[0]!.name} has the largest share (${formatPercent(sorted[0]!.result[key].fraction)}); ${sorted.at(-1)!.name} has ${formatPercent(sorted.at(-1)!.result[key].fraction)}. This ranks this metric only, not landing safety.`));}
    }
  }
  function renderData():void {
    const data=bridge.getState().data;const host=el('data-body');host.replaceChildren(make('h3',undefined,'Data & sources'));
    const sources=[['NASA/JPL SPICE','https://naif.jpl.nasa.gov/naif/data.html','Pinned DE440 kernels, lunar orientation and leap seconds → offline Cartesian vectors → all observations, intervals, events and scenarios. Libration already included; no additional wobble.'],['JPL Horizons','https://ssd.jpl.nasa.gov/horizons/','Control comparison of related ephemerides, not independent observations and not a runtime API.'],['NASA SVS CGI Moon Kit','https://svs.gsfc.nasa.gov/4720/','LROC/LOLA texture → globe appearance only; no calculated crater shadows.'],['LRO LOLA / NASA PGDA90','https://pgda.gsfc.nasa.gov/products/90','Real 80 m source DEM subset → local curved mesh and limited-coverage horizon. Unknown distant relief cannot be declared clear.'],['IAU/USGS Gazetteer','https://planetarynames.wr.usgs.gov/','Published feature-centre coordinates → labelled catalogue, including historical named sites and illustrative context points.']];
    for(const [name,url,text] of sources)host.append(link(name!,url!),make('p',undefined,text!));
    host.append(make('h3',undefined,'Model and accuracy'),make('p',undefined,`Altitude is the body centre angle above the local tangent plane; azimuth is clockwise from north toward east. Exact poles/zenith/nadir have undefined azimuth. Elevated sphere horizon dips below this plane. A/B/scenario events use the reference plane even when Surface view shows local terrain.`),make('p',undefined,'No eclipses, atmospheric refraction, power calculation, guaranteed radio links or landing-safety assessment. Event times are approximate to minutes from 600-second Cartesian samples. Height affects topocentric directions; camera minimum clearance may differ from the scientific height. Terrain resolution is not individual rocks.'),make('p',undefined,`Dataset ${data?.id??'not loaded'} • ${data?.coverage.startUtc??'?'} to ${data?.coverage.endUtc??'?'} • MOON_ME_DE440_ME421 • origin 301 • Sun 10 / Earth 399 • geometric NONE. Prepared JSON includes pinned source hashes and versions.`));
    host.append(make('p',undefined,'The local DEM uses 80 m grid spacing; effective resolution, fill quality and local uncertainty are unverified. DE421 ME coordinates approximately align to the application frame: maximum documented difference about 1.02 m over 1900-2051. No extra PA-to-ME rotation. Catalogue points are source-rounded named features, not precise surveyed lander positions.'));
  }
  function loaded():void {
    try{const shared=decodeScenarioFragment(location.hash);const stored=localStorage.getItem(SCENARIO_STORAGE_KEY);scenarios=shared??(stored?parseScenarioSet(stored):null);if(shared){save();scenarioMessage='Shared scenarios imported locally.';}}catch(error){scenarioMessage=`Saved/shared scenarios could not be loaded: ${errorText(error)}`;}
    refresh();
  }
  return {refresh,loaded};
}
