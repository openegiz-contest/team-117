import { Boxes, FlaskConical, Gauge, Network, ShieldCheck, ShieldHalf } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { getReadiness } from '../api/client'
import type { Readiness } from '../api/contracts'

const navigation = [
  { to: '/twins', label: 'TWIN INSPECTOR', icon: Network },
  { to: '/', label: 'COMMAND CENTER', icon: Boxes, end: true },
  { to: '/scenarios', label: 'SCENARIO LAB', icon: FlaskConical },
  { to: '/energy', label: 'ENERGY', icon: Gauge },
  { to: '/evidence', label: 'EVIDENCE', icon: ShieldCheck },
]

export function AppLayout() {
  const location = useLocation()
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const refresh = () => { void getReadiness(controller.signal).then((value) => { if (active) setReadiness(value) }).catch(() => { if (active) setReadiness(null) }) }
    refresh()
    const healthTimer = window.setInterval(refresh, 5000)
    const clockTimer = window.setInterval(() => setClock(new Date()), 1000)
    return () => { active = false; controller.abort(); window.clearInterval(healthTimer); window.clearInterval(clockTimer) }
  }, [])
  const connected = readiness?.status === 'ready' && readiness.platform_connected && readiness.simulation_running
  const home = location.pathname === '/'
  const exactPatchRoute = ['/twins', '/scenarios', '/energy', '/evidence'].includes(location.pathname)
  if (exactPatchRoute) return <Outlet />
  return <div className="app-shell v3-app-shell">
    <header className="header">
      <NavLink to="/" className="brand" aria-label="Open MineGuard X Twin Inspector">
        <div className="brand-shield"><ShieldHalf size={30} /></div>
        <div className="brand-words"><div className="brand-name">MINEGUARD <span>X</span></div><div className="brand-sub">DIGITAL TWIN · REAL-TIME AIRFLOW &amp; HAZARD MONITOR</div></div>
        <span className="ultra">ULTRA<br />3D</span>
      </NavLink>
      <nav className="nav-tabs" aria-label="Dashboard views">{navigation.map(({ to, label, icon: Icon, end }) => <NavLink end={end} key={to} to={to} className={({ isActive }) => `nav-tab ${isActive ? 'active' : ''}`}><Icon className="tab-icon" size={19} /><span>{label}</span></NavLink>)}</nav>
      <div className="top-right"><span className="source-flag live">LIVE BACKEND</span><span className={`connection ${connected ? 'connected' : 'offline'}`}>● <span>{connected ? 'SYSTEM ONLINE' : 'SYSTEM DEGRADED'}</span></span><time>{clock.toLocaleTimeString()}</time></div>
    </header>
    {home ? <Outlet /> : <div className="workspace secondary-workspace"><main className="page-container"><Outlet /></main></div>}
    <footer className="bottom-status"><span className={connected ? 'green' : 'red'}>● {connected ? 'DITTO + SIMULATION CONNECTED' : 'PLATFORM STATUS DEGRADED'}</span><span>MODE: <b>SYNTHETIC PHYSICS</b></span><span>DITTO TICK: {readiness?.platform_last_verified_tick ?? '—'}</span><span>SIMULATION ONLY · NOT FOR OPERATIONAL SAFETY USE</span></footer>
  </div>
}
