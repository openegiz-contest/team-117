import React, {useEffect, useMemo, useState} from 'react';
import '../styles/evidence-exact.css';

// Responsive, real DOM implementation of the supplied 1672x941 art direction.
// Validation cards show only checks reported by the backend's runtime validation.
const EQUATIONS = [
  {number:'01', name:'FAN CURVE', code:'delta_p = shutoff_pressure * speed^2 - K * flow^2'},
  {number:'02', name:'FAN POWER', code:'power = rated_power * speed^3'},
  {number:'03', name:'GAS BALANCE', code:'V dc/dt = sum(q_in*c_in) - sum(q_out*c) + source'},
];
const LIMITATIONS = [
  'Fictional uncalibrated geometry and parameters',
  'No real equipment integration',
  'Calculated energy is a model estimate, not measured savings',
];
const NAV = [
  ['twin','TWIN INSPECTOR','network'],
  ['command','COMMAND CENTER','cube'],
  ['scenario','SCENARIO LAB','flask'],
  ['energy','ENERGY','bolt'],
  ['evidence','EVIDENCE','file'],
];
const PATHS={
  shield:<><path d="M12 2 3.7 5.4v6.5c0 5.2 3.4 8.2 8.3 10.1 4.9-1.9 8.3-4.9 8.3-10.1V5.4L12 2Z"/><path d="M12 2v20"/></>,
  file:<><rect x="4" y="2.5" width="15" height="19" rx="1"/><path d="M8 7h7M8 11h7M8 15h6M8 19h6M19 6h2"/></>,
  network:<><rect x="10" y="2" width="4" height="4"/><rect x="2" y="18" width="5" height="4"/><rect x="17" y="18" width="5" height="4"/><path d="M12 6v7M4.5 18v-5H19.5v5M12 13v5"/></>,
  cube:<><path d="m12 2 9 5.3v9.4L12 22l-9-5.3V7.3L12 2Z"/><path d="m3 7.3 9 5.3 9-5.3M12 12.6V22"/></>,
  flask:<><path d="M9 2h6M10 2v7l-6 10a2 2 0 0 0 1.7 3h12.6a2 2 0 0 0 1.7-3l-6-10V2M8 15h8"/></>,
  bolt:<path d="M14 2 5 13h7l-2 9 9-12h-7l2-8Z"/>,
  scales:<><path d="M12 2v19M4 21h16M4 7h16M6 7l-4 7a4 4 0 0 0 8 0L6 7ZM18 7l-4 7a4 4 0 0 0 8 0l-4-7Z"/></>,
  checkshield:<><path d="M12 2 3 5v6c0 5 4 8.5 9 11 5-2.5 9-6 9-11V5l-9-3Z"/><path d="m8 12 3 3 5-6"/></>,
  check:<path d="m4 12 5 5L20 6"/>,
  warning:<><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5M12 18v.1"/></>,
  database:<><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.8 4 3 9 3s9-1.2 9-3V5M3 12c0 4 18 4 18 0"/></>,
  eye:<><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  gear:<><path d="M10 2h4l.8 2.6 2 .9 2.4-1.2 2.8 2.8-1.2 2.4.9 2L24 12l-2.3 1-.9 2 1.2 2.4-2.8 2.8-2.4-1.2-2 .9L14 22h-4l-.8-2.6-2-.9-2.4 1.2L2 17l1.2-2.4-.9-2L0 12l2.3-1 .9-2L2 6.6l2.8-2.8L7.2 5l2-.9L10 2Z"/><circle cx="12" cy="12" r="3"/></>,
  chart:<><path d="M3 21V3M3 21h18M7 17v-4M12 17V9M17 17V5"/></>,
  trending:<><path d="M2 3v18h20M5 15l5-6 4 4 7-8"/></>,
  refresh:<><path d="M20 10a8 8 0 0 0-14-4L3 9M3 4v5h5M4 14a8 8 0 0 0 14 4l3-3M21 20v-5h-5"/></>,
  copy:<><rect x="7" y="4" width="12" height="15" rx="1"/><path d="M4 7v14h12"/></>,
  download:<><path d="M12 2v13m-4-4 4 4 4-4M4 17v4h16v-4"/></>,
  arrow:<><path d="M4 12h16m-6-6 6 6-6 6"/></>,
};
function Icon({name,size=22,className=''}){return <svg className={`evx-ico ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[name]||PATHS.file}</svg>}
const nowTime=(d)=>d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',second:'2-digit'});
function saveFile(filename,contents,mime){const blob=new Blob([contents],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
function asCSV(events){const escape=v=>'"'+String(v??'').replace(/"/g,'""')+'"';return [['timestamp','type','description'],...events.map(e=>[e.at||'',e.type||'',e.description||e.message||''])].map(r=>r.map(escape).join(',')).join('\r\n')}
function buildTrace(data){
  const trail=Array.isArray(data?.decisionTrace)?data.decisionTrace:Array.isArray(data?.evidence?.decisions)?data.evidence.decisions:[];
  const record=trail[0];
  if(record) return [
    {icon:'eye',label:'OBSERVATION',value:record.observation||'Not provided',date:record.timestamp},
    {icon:'file',label:'REASON CODE',value:record.reason_code||record.reason||'Not provided',date:record.timestamp},
    {icon:'gear',label:'DECISION',value:record.decision||'Not provided',date:record.timestamp},
    {icon:'chart',label:'OUTCOME',value:record.outcome||'Pending verification',date:record.outcome_time||record.timestamp}
  ];
  const event=Array.isArray(data?.events)&&data.events.length?data.events[0]:null;
  return [
    {icon:'eye',label:'OBSERVATION',value:event?.description||'No recorded observations supplied',date:event?.at},
    {icon:'file',label:'REASON CODE',value:'No reason code supplied',date:null},
    {icon:'gear',label:'DECISION',value:'No verified command recorded',date:null},
    {icon:'chart',label:'OUTCOME',value:'Awaiting traceable outcome',date:null},
  ];
}
const getTime=t=>{if(!t)return 'NO TIMESTAMP';const d=new Date(t);return Number.isNaN(d.getTime())?'UNKNOWN':nowTime(d)};
function Frame({children,className=''}){return <section className={`evx-frame ${className}`}>{children}</section>}
function FrameTitle({icon,title,end}){return <div className="evx-panel-title"><span className="evx-panel-label"><Icon name={icon} size={25}/><strong>{title}</strong></span><span className="evx-eyebrow">{end}</span></div>}
function Stat({icon,label,value,accent=false,graphic}){return <div className="evx-stat evx-corners"><Icon name={icon} size={35}/><div className="evx-stat-copy"><span>{label}</span><strong className={accent?'evx-positive':''}>{value}</strong></div><div aria-hidden="true" className={`evx-stat-art evx-art-${graphic}`} /></div>}
function LayoutHeader({onNavigate,data}){
  const [now,setNow]=useState(new Date());useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(timer)},[]);
  return <header className="evx-header evx-corners">
    <button className="evx-brand" onClick={()=>onNavigate('command')} aria-label="Go to command center"><span className="evx-brand-logo"><Icon name="shield" size={42}/></span><span className="evx-brand-words"><strong>MINEGUARD X</strong><small>DIGITAL TWIN · REAL-TIME AIRFLOW &amp;<br/>HAZARD MONITOR</small></span></button>
    <span className="evx-ultra">ULTRA<br/>3D</span>
    <nav aria-label="Dashboard navigation" className="evx-nav">{NAV.map(([id,text,icon])=><button key={id} type="button" className={`evx-nav-button ${id==='evidence'?'evx-current':''}`} onClick={()=>onNavigate(id)}><Icon name={icon} size={22}/><span>{text}</span></button>)}</nav>
    <div className="evx-header-right"><span className={`evx-source-tag ${data?'evx-live':'evx-demo'}`}>{data?'LIVE · DITTO':'BACKEND OFFLINE'}</span><span className={`evx-connection ${data?'':'evx-bad'}`}>● {data?'SYSTEM ONLINE':'NO DATA'}</span><time>{nowTime(now)}</time></div>
  </header>
}
function EvidenceContent({data,error,onNavigate}){
  const [copyText,setCopyText]=useState('');
  const trace=useMemo(()=>buildTrace(data),[data]);
  const tests=data?.validation||data?.evidence?.validation||{};
  const details=tests.details||{};
  const verified=typeof tests==='object' && tests.status==='PASS';
  const statuses=[
    ['gear','UNIT CHECKS','unit_checks'],
    ['refresh','SCENARIO REPEATABILITY','scenario_repeatability'],
    ['database','TELEMETRY FRESHNESS','telemetry_freshness'],
    ['trending','RESIDUAL BOUNDS','residual_bounds'],
    ['file','SOURCE TRACEABILITY','source_traceability'],
  ];
  const dataEvents=Array.isArray(data?.events)?data.events:[];
  const record={source:data?.source||'UNAVAILABLE',updatedAt:data?.updatedAt||null,validation:tests,trace:trace.map(x=>({label:x.label,value:x.value,time:x.date||null})),events:dataEvents,limitations:LIMITATIONS,declaredModelEquations:EQUATIONS};
  const doCopy=async(code)=>{try{await navigator.clipboard.writeText(code);setCopyText(code)}catch{setCopyText('Copy unavailable on this origin')}setTimeout(()=>setCopyText(''),1500)};
  const exportJson=()=>saveFile('mineguard-evidence.json',JSON.stringify(record,null,2),'application/json');
  const exportCsv=()=>saveFile('mineguard-audit-events.csv',asCSV(dataEvents),'text/csv;charset=utf-8');
  const exportReport=()=>saveFile('mineguard-evidence-report.txt',[`MineGuard X Engineering Evidence`,`Source: ${record.source}`,`Updated: ${record.updatedAt||'not available'}`,`Runtime validation: ${tests.status||'NOT VERIFIED'}`,...statuses.map(([,label,key])=>`  ${label}: ${tests[key]||'NOT VERIFIED'} - ${details[key]||'no detail'}`),'',...EQUATIONS.map(x=>`${x.name}: ${x.code}`),'',...LIMITATIONS.map(x=>`LIMITATION: ${x}`),'',...trace.map(x=>`${x.label}: ${x.value}`),'','Events:',...dataEvents.map(x=>`${x.at||''} ${x.type||''}: ${x.description||x.message||''}`)].join('\n'),'text/plain;charset=utf-8');
  const tick=data?.tick;
  return <div className="evx-page">
    <h1 className="sr-only">Engineering Evidence</h1>
    <LayoutHeader onNavigate={onNavigate} data={data}/>
    {error&&<div className="evx-error" role="alert">BACKEND ERROR: {error}</div>}
    <section className="evx-stats" aria-label="Evidence summary">
      <Stat icon="file" label="IMPLEMENTED EQUATIONS" value="3" graphic="chart"/>
      <Stat icon="scales" label="DECLARED LIMITATIONS" value="3" graphic="mountain"/>
      <Stat icon="flask" label="EVIDENCE SOURCE" value={data?.source||'UNAVAILABLE'} graphic="database"/>
      <Stat icon="checkshield" label="RUNTIME VALIDATION" value={verified?'VERIFIED PASS':tests.status||'NOT VERIFIED'} accent={verified} graphic="check"/>
    </section>
    <section className="evx-primary" aria-label="Equations and limits">
      <Frame className="evx-equation-panel"><FrameTitle icon="cube" title="Implemented Equations" end="EXECUTABLE MODEL BASIS"/>
        <div className="evx-equations">{EQUATIONS.map(eq=><div className="evx-eq" key={eq.number}><span className="evx-eq-number">{eq.number}</span><div className="evx-eq-body"><span>{eq.name}</span><div className="evx-formula"><code>{eq.code}</code><button aria-label={`Copy ${eq.name} formula`} title="Copy equation" type="button" onClick={()=>doCopy(eq.code)}><Icon name="copy" size={19}/></button></div></div></div>)}</div>
        <div aria-live="polite" className="evx-copy-toast">{copyText?(copyText==='Copy unavailable on this origin'?copyText:'Equation copied'):''}</div>
      </Frame>
      <Frame className="evx-limits-panel"><FrameTitle icon="warning" title="Declared Limitations" end="CLAIMS BOUNDARY"/>
        <div className="evx-lim-list">{LIMITATIONS.map(t=><div className="evx-limit" key={t}><Icon name="checkshield" size={20}/><span>{t}</span></div>)}</div>
        <div className="evx-model"><Icon name="database" size={24}/><div><small>Model source</small><strong>SYNTHETIC_PHYSICS <span>· published via MQTT, read back from Eclipse Ditto</span></strong></div></div>
      </Frame>
    </section>
    <Frame className="evx-evidence"><FrameTitle icon="trending" title="Live Decision Evidence" end="RAW AUDIT RECORD"/>
      <div className="evx-trace-area"><div className="evx-trace">
        {trace.map((s,i)=><React.Fragment key={s.label}><div className="evx-trace-unit"><div className="evx-trace-card"><div className="evx-trace-icon"><Icon name={s.icon} size={24}/></div><div><small>{s.label}</small><p>{s.value}</p></div></div><time>{getTime(s.date)}</time></div>{i!==trace.length-1&&<div aria-hidden="true" className="evx-flow-link"><Icon name="arrow" size={14}/></div>}</React.Fragment>)}
      </div><div className="evx-mine-art" role="img" aria-label="Decorative mine digital twin illustration from visual reference"/></div>
      <div className="evx-evidence-ribbon"><span className={data?'evx-positive':'evx-warning'}>◉ &nbsp;{data?'STATE RECEIVED':'DATA UNAVAILABLE'}</span><i/><span>SOURCE: <b>{data?.source||'UNAVAILABLE'}</b></span><i/><span>DITTO TICK: <b>{tick??'NOT PROVIDED'}</b></span><span className="evx-ribbon-tail">SCENARIO: {data?.scenario||'BASELINE'} &nbsp;│&nbsp; STATUS: {data?.status||'UNKNOWN'} &nbsp;│&nbsp; SIMULATION ONLY</span></div>
    </Frame>
    <Frame className="evx-provenance"><FrameTitle icon="checkshield" title="Model Provenance & Validation" end=""/><div className="evx-validation">
      {statuses.map(([icon,label,key])=>{const status=tests[key];const pass=status==='PASS';return <div key={label} className="evx-validation-card"><Icon name={icon} size={26}/><div><small>{label} <b className={pass?'evx-positive':'evx-warn'}>{pass?'● PASS':status==='FAIL'?'· FAIL':'· NOT VERIFIED'}</b></small><span>{details[key]||'No runtime check result'}</span></div></div>})}
      <div className="evx-exports"><button type="button" onClick={exportJson}><span>〈〉</span> EXPORT JSON</button><button type="button" onClick={exportCsv}><Icon name="file" size={17}/> EXPORT CSV</button><button className="evx-export-primary" type="button" onClick={exportReport}><Icon name="download" size={18}/> DOWNLOAD REPORT</button></div>
    </div></Frame>
    <footer className="evx-footer"><span className={data?'evx-positive':'evx-warn'}>● SYSTEM VIEW</span><span>SOURCE: <b>{data?.source||'UNAVAILABLE'}</b></span><span>LAST UPDATE: <b>{getTime(data?.updatedAt)}</b></span><span className="evx-footer-right">SIMULATION-ONLY COMMANDS · NOT FOR OPERATIONAL SAFETY USE</span></footer>
  </div>
}
export default function EvidenceDashboard(props){
  return <EvidenceContent {...props}/>;
}
