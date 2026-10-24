import React, {useEffect, useMemo, useState} from 'react';
import {getDecisionTrace} from '../api/client';
import '../styles/final-three.css';

const ICONS={
 shield:<><path d="M12 2 3 5.5v7c0 5.3 3.6 8 9 10 5.4-2 9-4.7 9-10v-7L12 2Z"/><path d="M12 2v20"/></>,
 twin:<><rect x="10" y="2" width="4" height="4"/><path d="M12 6v7M4 18v-5h16v5"/><rect x="1" y="18" width="6" height="4"/><rect x="17" y="18" width="6" height="4"/></>,
 cubes:<><path d="m12 2 8 4.5v9L12 20 4 15.5v-9Z M4 6.5 12 11l8-4.5M12 11v9"/><path d="m12 2-4 2.5"/></>,
 flask:<><path d="M8 2h8M10 2v7L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-10V2M7 16h10"/></>,
 gauge:<><path d="M4 19a10 10 0 1 1 16 0M12 12l5-4"/><circle cx="12" cy="13" r="1.5"/></>,
 proof:<><path d="m12 2 8 3v7c0 5-3 8-8 10-5-2-8-5-8-10V5Z M9 12l2 2 4-4"/></>,
 db:<><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/></>,
 wind:<><path d="M2 8h15a3 3 0 1 0-3-3M2 12h19M2 16h13a3 3 0 1 1-3 3"/></>,
 fan:<><circle cx="12" cy="12" r="2"/><path d="M10 10C3 8 4 1 9 3c3 1 4 4 3 7M14 11c5-6 11-1 8 3-2 2-5 1-8 0M11 14c1 7-6 9-8 5-1-3 2-5 7-6"/></>,
 search:<><circle cx="10" cy="10" r="7"/><path d="m15.5 15.5 6 6"/></>,
 check:<path d="M5 12l5 5 9-10"/>,
 checkcircle:<><circle cx="12" cy="12" r="9"/><path d="m7 12 3.5 3.5L17 9"/></>,
 alert:<><path d="m12 2 10 19H2L12 2Z"/><path d="M12 9v5m0 4v.1"/></>,
 timer:<><circle cx="12" cy="13" r="9"/><path d="M12 7v6l4 3M9 2h6"/></>,
 play:<><circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4Z"/></>,
 reset:<><path d="M3 12a9 9 0 1 0 3-7M3 3v7h7"/></>,
 flame:<path d="M12 2c2 5-1 7 1 10 1-3 5-5 5-8 7 8 5 18-6 18C3 22 1 13 7 8c0 4 1 5 2 6 0-6 0-8 3-12Z"/>,
 bolt:<path d="m13 2-9 12h8l-1 8 9-12h-8l1-8Z"/>,
 leaf:<><path d="M20 4C9 4 4 8 4 15c0 4 4 6 7 4 6-3 9-9 9-15Z"/><path d="M3 21c4-6 8-10 14-13"/></>,
 settings:<><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3M19 5l-3 3M8 16l-3 3"/></>,
 bars:<><path d="M3 20V4m0 16h18M7 17v-5m5 5V8m5 9V4"/></>,
 doc:<><rect x="4" y="2" width="16" height="20" rx="1"/><path d="M8 7h8M8 12h8M8 17h6"/></>,
 dot:<circle cx="12" cy="12" r="5"/>,
 chevron:<path d="m6 9 6 6 6-6"/>,
 arrow:<path d="M4 12h16m-6-6 6 6-6 6"/>,
 pause:<><path d="M8 5v14M16 5v14"/></>,
 info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/></>,
 chart:<><path d="M2 20h20M4 17l6-6 4 3 6-8"/></>,
 sliders:<><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="18" r="2"/></>,
};
const icon=(name,size=21)=><svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[name]||ICONS.dot}</svg>;
const NAV=[['twin','TWIN INSPECTOR','twin'],['command','COMMAND CENTER','cubes'],['scenario','SCENARIO LAB','flask'],['energy','ENERGY','gauge'],['evidence','EVIDENCE','proof']];
const timeString=stamp=>{if(!stamp)return 'NO TIMESTAMP';const d=new Date(stamp);return Number.isNaN(d.getTime())?'NOT AVAILABLE':d.toLocaleTimeString('en-US')};
const fmt=(v,d=3)=>v==null||!Number.isFinite(Number(v))?'—':Number(v).toFixed(d);
function Notice({children,kind='info'}){return <div className={`mxf-notice mxf-${kind}`} role={kind==='error'?'alert':undefined}>{icon(kind==='error'?'alert':'info',16)}{children}</div>}
function Frame({children,className=''}){return <section className={`mxf-frame ${className}`}>{children}</section>}
function FrameTitle({children,aside,iconName}){return <div className="mxf-panel-title"><strong>{iconName&&icon(iconName,20)}{children}</strong><span>{aside}</span></div>}
function Header({view,setView,data}){
 const [now,setNow]=useState(new Date());useEffect(()=>{const t=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(t)},[]);
 return <header className="mxf-header"><button type="button" className="mxf-brand" onClick={()=>setView('command')}><span className="mxf-logo">{icon('shield',37)}</span><span><b>MINEGUARD X</b><small>DIGITAL TWIN · REAL-TIME AIRFLOW &amp; HAZARD MONITOR</small></span><em>ULTRA<br/>3D</em></button>
 <nav aria-label="MineGuard sections" className="mxf-navigation">{NAV.map(([id,label,i])=><button type="button" key={id} className={view===id?'mxf-active':''} onClick={()=>setView(id)}>{icon(i,18)}<span>{label}</span></button>)}</nav>
 <div className="mxf-header-status"><label className="mxf-live-badge">{data?'LIVE · DITTO':'BACKEND OFFLINE'}</label><strong className={data?'online':'offline'}>● {data?'SYSTEM ONLINE':'NO DATA'}</strong><time>{now.toLocaleTimeString('en-US')}</time></div></header>
}
function Footer({data}){return <footer className="mxf-footer"><span className="online">● {data?'DITTO STATE RECEIVED':'BACKEND DISCONNECTED'}</span><span>SOURCE: <b>{data?.source||'UNAVAILABLE'}</b></span><span>{data?.tick!=null?`DITTO TICK: ${data.tick}`:'TICK: UNAVAILABLE'}</span><span>SIMULATION ONLY · NOT FOR OPERATIONAL SAFETY USE</span></footer>}
function TwinInspector({data}){
 const [filter,setFilter]=useState('');const [selected,setSelected]=useState('mine-01');
 const zones=data?.zones||[];
 const allEntities=useMemo(()=>{
  const a=[{id:'mine-01',label:'mine-01',subtitle:'Mine aggregate',kind:'mine'}];
  for(const z of zones){const slug=String(z.id).toLowerCase().replace(/^zone-/,'');a.push({id:`zone-${slug}`,label:`zone-${slug}`,subtitle:z.name||'Mine zone',kind:'zone',zone:z});}
  for(const fan of data?.fans||[]) {const slug=String(fan.id).toLowerCase().replaceAll('_','-');a.push({id:slug,label:slug,subtitle:slug==='fan-main'?'Main ventilation fan':'Auxiliary ventilation fan',kind:'fan',fan});}
  if(!(data?.fans||[]).length)a.push({id:'fan-main',label:'fan-main',subtitle:'Main ventilation fan',kind:'fan',fan:data?.fan});
  return a;
 },[zones,data?.fans,data?.fan]);
 const current=allEntities.find(e=>e.id===selected)||allEntities[0];
 const zone=current?.zone;
 const fan=current?.fan||data?.fan;
 const thingId=current?.kind==='mine'?'mineguard:mine-01':`mineguard:${current?.id}`;
 const asObject=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 const ditto=asObject(data?.twinReadbacks?.[thingId]);
 const dittoAttributes=asObject(ditto.attributes);const dittoFeatures=asObject(ditto.features);
 const mineAttrs=[['ISTYPE','NO'],['SIMULATION ONLY',data?.simulated?'YES':'NOT DECLARED'],['MODEL STAGE','AWAITING DITTO READBACK'],['SCHEMA VERSION','AWAITING DITTO READBACK'],['ASSUMPTION SOURCE','Awaiting Eclipse Ditto attributes'],['NAME','MineGuard X underground mine'],['KIND','underground-mine']];
 const fallbackAttrs=current?.kind==='mine'?mineAttrs:current?.kind==='zone'? [['ENTITY',current.id],['NAME',zone?.name||current.subtitle],['SOURCE',zone?.source||'NOT AVAILABLE'],['QUALITY',zone?.quality||'UNKNOWN'],['UPDATED',timeString(zone?.updatedAt)],['KIND','mine-zone']]:[['ENTITY',current.id],['NAME',current.subtitle],['RPM',`${fmt(fan?.rpm,0)} RPM`],['ACTUAL SPEED',`${fmt(fan?.override,0)}%`],['HEALTH',fan?.healthy?'HEALTHY':'FAULTED'],['KIND','ventilation-fan']];
 const liveAttrs=Object.entries(dittoAttributes).map(([key,value])=>[key.replaceAll('_',' ').toUpperCase(),Array.isArray(value)?value.join(', '):typeof value==='object'?JSON.stringify(value):String(value)]);
 const attrs=liveAttrs.length?liveAttrs:fallbackAttrs;
 const fallbackFeatures=current?.kind==='mine'?[["Simulation run / value",data?.scenario||'—'],['max_methane / value',zones.length?fmt(Math.max(...zones.map(z=>Number(z.ch4)||0)),4):'—'],['max_methane / unit','% volume'],['max_methane / source type',data?.source||'UNAVAILABLE'],['max_CO / value',fmt(data?.atmosphere?.co,2)],['max_CO / unit','ppm'],['total_airflow / value',fmt(data?.fan?.flow,4)],['twin count / value',String(allEntities.length)]]:current?.kind==='zone'? [['methane / value',fmt(zone?.ch4,3)],['methane / unit','% vol'],['CO / value',fmt(zone?.co,2)],['O₂ / value',fmt(zone?.oxygen,1)],['airflow / value',fmt(zone?.airflow,1)],['airflow / unit','m³/s'],['sensor / quality',zone?.quality||'UNKNOWN'],['sensor / source',zone?.source||'NOT PROVIDED']]:[['fan / rpm',fmt(fan?.rpm,0)],['fan / flow',fmt(fan?.flow,1)],['fan / health',String(fan?.healthy??'UNKNOWN')],['actual speed',fmt(fan?.override,0)+'%']];
 const liveFeatures=Object.entries(dittoFeatures).flatMap(([feature,value])=>Object.entries(asObject(asObject(value).properties)).filter(([,item])=>['string','number','boolean'].includes(typeof item)).map(([key,item])=>[`${feature} / ${key}`,String(item)]));
 const valuesFirst=[...liveFeatures.filter(([k])=>k.endsWith('/ value')),...liveFeatures.filter(([k])=>!k.endsWith('/ value'))];
 const features=liveFeatures.length?valuesFirst.slice(0,16):fallbackFeatures;
 return <div className="mxf-twin-page"><div className="mxf-twin-hero"><span className="mxf-overline">ECLIPSE DITTO · AUTHENTICATED TWIN READBACK</span><h1>Twin Inspector</h1><p>Inspect synchronized mine, zone, and fan entities without losing access to the underlying platform record.</p><div className="mxf-readback">{icon('dot',16)} <span>{data?'READBACK RECEIVED':'AWAITING READBACK'}</span><small>{allEntities.length} managed entities</small></div><div className="mxf-hero-art" aria-hidden="true"/></div>
 <div className="mxf-twin-columns"><Frame className="mxf-entity-panel"><div className="mxf-entity-head"><strong>Managed twins</strong><small>{allEntities.length}</small></div><label className="mxf-search">{icon('search',16)}<input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Search entities" aria-label="Search managed twins"/></label><div className="mxf-entity-list">{allEntities.filter(e=>`${e.label} ${e.subtitle}`.toLowerCase().includes(filter.toLowerCase())).map(e=><button className={`mxf-entity ${e.id===current?.id?'selected':''}`} type="button" key={e.id} onClick={()=>setSelected(e.id)}><span className="mxf-entity-icon">{icon(e.kind==='fan'?'fan':e.kind==='mine'?'cubes':'wind',20)}</span><span><b>{e.label}</b><small>{e.subtitle}</small></span></button>)}</div></Frame>
 <Frame className="mxf-twin-detail"><div className="mxf-detail-heading"><small>SELECTED DIGITAL TWIN</small><div><strong>{thingId}</strong><span>{icon('db',15)} {ditto.thingId?'ECLIPSE DITTO RESPONSE':'VALIDATED LIVE SNAPSHOT'}</span></div></div><div className="mxf-summary-features"><div>{icon('db',20)}<small>Thing ID</small><b>{ditto.thingId||thingId}</b></div><div>{icon('proof',20)}<small>Policy</small><b>{ditto.policyId||'NOT PROVIDED'}</b></div><div>{icon('chart',20)}<small>Features</small><b>{Object.keys(dittoFeatures).length||features.length}</b></div><div>{icon('cubes',20)}<small>Entity kind</small><b>{current?.kind==='mine'?'underground-mine':current?.kind==='fan'?'ventilation-fan':'mine-zone'}</b></div></div><div className="mxf-detail-cols"><div><FrameTitle aside={`${attrs.length} FIELDS`}>Attributes</FrameTitle><div className="mxf-attrs">{attrs.map(([k,v])=><div key={k}><span>{k}</span><strong>{v}</strong></div>)}</div></div><div><FrameTitle aside={ditto.thingId?'DITTO FEATURE VALUES':'VALIDATED SNAPSHOT VALUES'}>Live feature values</FrameTitle><div className="mxf-feature-grid">{features.map(([k,v])=><div className="mxf-feature" key={k}><small>{k}</small><strong>{v}</strong></div>)}</div></div></div></Frame></div></div>
}
const SCENARIOS=[{id:'S1_METHANE_LEAK',test:'TEST 01 · S1_METHANE_LEAK',name:'Production-face methane release',desc:'Increase the fictional Z04 methane source and observe transport, risk, and simulated safety response.',duration:180,injection:'Z04',image:'methane-mine.jpg',icon:'flame'}, {id:'S2_MAIN_FAN_FAILURE',test:'TEST 02 · S2_MAIN_FAN_FAILURE',name:'Main ventilation fan failure',desc:'Fail the simulated main fan after ten seconds and observe airflow loss and emergency precedence.',duration:90,injection:'FAN_MAIN',image:'fan-mine.jpg',icon:'fan'}];
function ScenarioLab({data,mode,pending,startScenario,pause,reset}){
 const [localError,setLocalError]=useState('');
 const active=SCENARIOS.find(s=>s.id===data?.scenario);
 const elapsed=Math.max(0,Number(data?.scenario_elapsed_seconds)||0);
 const percent=active?Math.min(100,elapsed/active.duration*100):0;
 const apply=async(id)=>{setLocalError('');try{await startScenario(id);}catch(e){setLocalError(e.message)}};
 const resetAll=async()=>{setLocalError('');try{await reset()}catch(e){setLocalError(e.message)}};
 const recent=Array.isArray(data?.events)?data.events.slice(0,5):[];
 return <div className="mxf-scenario-page"><div className="mxf-scenario-intro"><div><div className="mxf-overline">CONTROLLED SCENARIO TESTING</div><h1>{icon('flask',40)}Scenario Laboratory</h1><p>Run controlled, resettable mine events and observe the physics, risk decisions, and simulated safety response.</p></div><span className="mxf-simulation-pill">{icon('proof',24)}<span><b>SIMULATION ONLY</b><small>No physical equipment connection</small></span></span></div>
 <Frame className="mxf-progress"><span className="mxf-progress-play">{icon('play',29)}</span><div className="mxf-run-desc"><small>CURRENT RUN</small><strong>{active?active.name:'Baseline ready'}</strong><span>{String(data?.status).toUpperCase()==='PAUSED'?'PAUSED':active?'SIMULATION ACTIVE':'IDLE'} · T+{elapsed.toFixed(1)}s</span></div><div className="mxf-progress-track"><div><span>Scenario progress</span><b>{Math.round(percent)}%</b></div><div className="mxf-track"><span style={{width:`${percent}%`}}/></div></div><button className="mxf-ghost-button" disabled={pending} onClick={resetAll}>Reset baseline</button></Frame>
 <div className="mxf-scenario-cards">{SCENARIOS.map(s=><Frame key={s.id} className="mxf-scenario-card"><div className="mxf-card-picture" style={{backgroundImage:`linear-gradient(90deg,#031620 4%,#021b2a55 88%),url('/final-reference/${s.image}')`}}/><div className="mxf-card-head"><small>{s.test}</small><span className="mxf-ready">{active?.id===s.id?'RUNNING':'READY'}</span><i>{icon(s.icon,30)}</i></div><h2>{s.name}</h2><p>{s.desc}</p><div className="mxf-scenario-meta"><div>{icon('timer',20)}<span>Duration<b>{s.duration}s</b></span></div><div>{icon('alert',20)}<span>Injection<b>{s.injection}</b></span></div><div>{icon('checkcircle',20)}<span>Resettable<b>Yes</b></span></div></div><button type="button" disabled={pending||!data} className="mxf-start-button" onClick={()=>apply(s.id)}>{icon('play',20)} Start controlled run</button></Frame>)}</div>
 <Frame className="mxf-applied"><FrameTitle aside="AUDITABLE SIMULATION TRACE">Applied actions · sequence</FrameTitle><div className="mxf-applied-body">{recent.length?recent.map((e,i)=><div key={`${i}-${e.at||''}`}>{icon('checkcircle',18)}<time>{timeString(e.at)}</time><span>{e.description||e.message||e.type||'Scenario event'}</span></div>):<div>{icon('checkcircle',21)} No scenario action has been applied. Baseline remains active.</div>}</div><div className="mxf-scenario-actions"><button type="button" disabled={pending||!active} onClick={pause}>{icon('pause',15)} Pause / Resume</button><button type="button" disabled={pending} onClick={resetAll}>{icon('reset',15)} Reset</button></div></Frame>
 {localError&&<Notice kind="error">{localError}</Notice>}</div>;
}
function extractLiveCandidates(record){const decision=record?.vod_decision??record;const array=Array.isArray(decision)?decision:Array.isArray(decision?.candidates)?decision.candidates:Array.isArray(decision?.items)?decision.items:[];const selected=decision?.selected;return array.map((c,i)=>{const speeds=Array.isArray(c.fan_speeds)?c.fan_speeds:[];const speed=id=>{const match=speeds.find(f=>String(f.fan_id).toUpperCase().includes(id));return match?Number(match.speed_fraction)*100:undefined};const isSelected=c.selected===true||(selected&&JSON.stringify(c)===JSON.stringify(selected));return {id:c.id??i+1,aux:c.aux??c.aux_percent??c.fans?.aux??speed('AUX'),main:c.main??c.main_percent??c.fans?.main??speed('MAIN'),ch4:c.ch4??c.max_methane??(c.forecast_max_methane_fraction==null?null:Number(c.forecast_max_methane_fraction)*100),co:c.co??c.max_co??c.forecast_max_co_ppm,flow:c.flow??c.min_airflow??c.forecast_min_airflow_m3s,energy:c.energy??c.energy_kwh??c.fan_energy_kwh,switchCost:c.switchCost??c.switch_cost_kwh??c.switching_penalty_kwh,feasible:c.feasible===true,selected:isSelected,reason:c.reason||c.reason_code||(Array.isArray(c.reason_codes)?c.reason_codes.join(', '):'NOT_VERIFIED')}})}
function useDecisionCandidates(){const [record,setRecord]=useState(null);const [error,setError]=useState('');useEffect(()=>{let cancel=false;const load=async()=>{try{const d=await getDecisionTrace();if(!cancel){setRecord(d);setError('')}}catch(e){if(!cancel){setRecord(null);setError(`Decision trace: ${e.message}`)}}};load();const t=setInterval(load,5000);return()=>{cancel=true;clearInterval(t)}},[]);return {candidates:extractLiveCandidates(record),decision:record?.vod_decision??null,constraints:record?.constraints??null,modelSeconds:record?.simulated_seconds,error}}
function Metric({label,value,unit,iconName,accent}){return <Frame className={`mxf-energy-metric ${accent?'mxf-accent-'+accent:''}`}><i>{icon(iconName,25)}</i><div><span>{label}</span><strong>{value}</strong><small>{unit}</small></div></Frame>}
const constraintLabel=(met)=>met===true?'Satisfied (forecast)':met===false?'Violated (forecast)':'Not evaluated';
function EnergyIntelligence({data}){
 const {candidates,decision,constraints,modelSeconds,error}=useDecisionCandidates();
 const [display,setDisplay]=useState('all'); const filtered=candidates.filter(c=>display==='all'||display==='feasible'&&c.feasible||display==='rejected'&&!c.feasible||display==='selected'&&c.selected);
 const comparison=decision?.comparison??null;
 const baseline=comparison?.baseline_energy_kwh,optimized=comparison?.optimized_energy_kwh;
 const horizon=comparison?.horizon_seconds??constraints?.forecast_horizon_seconds;
 const saving=comparison?.savings_percent??null;
 const status=decision?.status??'UNAVAILABLE',command=decision?.command_status??'UNAVAILABLE';
 const feasibleCount=candidates.filter(c=>c.feasible).length;
 const reason=decision?.reason_codes?.length?decision.reason_codes.join(', '):'NO_DECISION';
 const why=status==='SELECTED'?`${reason}: the selected setting has the lowest modeled energy plus switching penalty among ${feasibleCount} candidates that met every forecast constraint.`:status==='DISABLED_BY_SAFETY'?`${reason}: a WARNING, EMERGENCY or UNKNOWN_DATA zone blocks energy optimization; safety ventilation takes precedence.`:status==='NO_FEASIBLE_SAFE_OPTIMIZATION'?`${reason}: no candidate met the methane, CO and airflow forecast constraints, so no optimized setting is proposed.`:'The decision trace is unavailable, so no optimization result is shown.';
 return <div className="mxf-energy-page"><div className="mxf-energy-topline"><div className="mxf-energy-intro"><div className="mxf-overline">CONSTRAINT-FIRST VENTILATION ON DEMAND</div><h1>Energy Intelligence</h1><p>Compare modeled fan-energy strategies only after every configured safety constraint has been evaluated.</p></div><Metric label="Current-speed baseline" value={fmt(baseline)} unit={`kWh · ${horizon??'—'}s horizon`} iconName="bolt"/><Metric label="Constraint-first VOD" value={fmt(optimized)} unit="kWh · identical horizon" iconName="leaf" accent="cyan"/><Metric label="Modeled difference" value={saving==null?'—':saving.toFixed(1)+'%'} unit={`${baseline!=null&&optimized!=null?fmt(baseline-optimized):'—'} kWh · uncalibrated`} iconName="bars" accent="green"/><Frame className="mxf-strategy-mini"><strong>Strategy comparison</strong><small>Same model state, sources and constraints</small><div>● Keep current fan speeds <b>{fmt(baseline)} kWh</b></div><div className="green">● Constraint-first VOD <b>{fmt(optimized)} kWh</b></div><p>Both estimates roll the same synthetic model forward from the same state over the same horizon. No comparison is shown while safety blocks optimization.</p></Frame></div>
 <div className="mxf-energy-content"><Frame className="mxf-safety-card"><FrameTitle iconName="proof">Safety feasibility</FrameTitle><small className="mxf-safety-sub">Optimization gate · {status}</small><div className="mxf-feasibility"><div>{icon('checkcircle',19)}<span>Baseline constraints</span><b>{constraintLabel(comparison?.baseline_constraints_met)}</b></div><div>{icon('checkcircle',19)}<span>VOD constraints</span><b>{constraintLabel(comparison?.optimized_constraints_met)}</b></div></div><p>Energy selection is rejected whenever configured methane, CO, airflow, telemetry, or actuator constraints cannot be met.</p><Notice kind="warning">Uncalibrated synthetic-model estimate. Not measured industrial energy savings.</Notice><details className="mxf-why"><summary>Why this ventilation setting? {icon('chevron',15)}</summary><p>{why}</p></details></Frame>
 <Frame className="mxf-candidate-panel"><div className="mxf-candidate-top"><div><h2>{icon('bars',21)} Candidate decision explorer</h2><span>Show</span></div><div className="mxf-candidate-filters"><select value={display} aria-label="Candidate filter" onChange={e=>setDisplay(e.target.value)}><option value="all">All candidates ({candidates.length})</option><option value="feasible">Feasible only</option><option value="rejected">Rejected only</option><option value="selected">Selected only</option></select><span>{icon('timer',15)} Model T+{fmt(modelSeconds,1)}s</span><span>{icon('timer',15)} {horizon??'—'}s forecast</span><span>Command: <b>{command}</b></span><strong className={feasibleCount?'green':'warn'}>{feasibleCount}/{candidates.length} feasible</strong></div></div>
 <p className="mxf-candidate-reason">{status}. A PROPOSED setting is a model recommendation, not an issued actuator command; simulated safety fan feedback is shown in the Command Center.</p><p className="mxf-candidate-limits">Demonstration constraints: CH₄ &lt; {constraints?fmt(constraints.warning_methane_fraction*100,2):'—'}% vol · CO &lt; {constraints?fmt(constraints.warning_co_fraction*1e6,0):'—'} ppm · airflow ≥ {constraints?fmt(constraints.minimum_airflow_m3s,0):'—'} m³/s</p>
 <div className="mxf-table-scroll"><table className="mxf-candidate-table"><thead><tr><th>#</th><th>Fan settings</th><th>CH₄ max</th><th>CO max</th><th>Airflow min</th><th>Energy</th><th>Switch cost</th><th>Decision</th></tr></thead><tbody>{filtered.map(c=><tr key={c.id} className={c.selected?'mxf-selected-row':''}><td>{c.id}</td><td>AUX {fmt(c.aux,0)}% / MAIN {fmt(c.main,0)}%</td><td>{fmt(c.ch4)}%</td><td>{fmt(c.co,1)} ppm</td><td>{fmt(c.flow,1)} m³/s</td><td>{fmt(c.energy)} kWh</td><td>{fmt(c.switchCost)} kWh</td><td><span className="mxf-decision-tag">{c.selected?'SELECTED':c.feasible?'FEASIBLE':'REJECTED'}</span><small>{c.reason}</small></td></tr>)}</tbody></table>{!filtered.length&&<div className="mxf-no-candidates">{status==='DISABLED_BY_SAFETY'?'Optimization is disabled by the current safety state; no candidates are evaluated.':'No validated candidates match this filter.'}</div>}</div>
 {error&&<div className="mxf-fetch-note">{error}</div>}</Frame></div></div>
}
export default function FinalThreePages({view,setView,data,error,pending,startScenario,pause,reset}){
 return <div className="mxf-root"><Header view={view} setView={setView} data={data}/>{error&&<Notice kind="error">Backend error: {error}</Notice>}<main className="mxf-workspace">{view==='twin'?<TwinInspector data={data}/>:view==='scenario'?<ScenarioLab data={data} pending={pending} startScenario={startScenario} pause={pause} reset={reset}/>:<EnergyIntelligence data={data}/>}</main><Footer data={data}/></div>;
}
