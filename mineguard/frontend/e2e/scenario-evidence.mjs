/* global fetch, WebSocket, setTimeout, clearTimeout, AbortSignal */
// Runs guarded SIMULATION_ONLY commands against localhost and resets in finally.
// Start headless Chromium with --use-angle=swiftshader --enable-unsafe-swiftshader.
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { URL } from 'node:url'

const base = process.argv[2] ?? 'http://127.0.0.1:8091'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Evidence runner is localhost only')
const port = process.argv[3] ?? '9234'
const output = resolve(process.argv[4] ?? '../docs/final-scenario-evidence')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
// Dedicated evidence browser only: close previous test tabs to avoid concurrent WebGL renderers.
assert.equal(port, '9234', 'Use the dedicated software-rendering test browser on port 9234')
const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
for (const tab of tabs) if (tab.type === 'page' && tab.url.startsWith(base)) await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`)
const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(base)}`, { method: 'PUT' }).then((r) => r.json())
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }) })
const pending = new Map()
const errors = []
let sequence = 0
socket.addEventListener('message', ({ data }) => {
  const m = JSON.parse(String(data))
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
  const p = pending.get(m.id)
  if (p) { clearTimeout(p.timer); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result) }
})
const cdp = (method, params = {}) => new Promise((resolveRequest, reject) => {
  const id = ++sequence
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 20000)
  pending.set(id, { resolve: resolveRequest, reject, timer })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}
const api = async (path, method = 'GET') => {
  const r = await fetch(`${base}/api${path}`, { method, headers: { 'X-MineGuard-Simulation': 'SIMULATION_ONLY' }, signal: AbortSignal.timeout(30000) })
  if (!r.ok && !(path === '/health/ready' && r.status === 503)) throw new Error(`${path}: HTTP ${r.status}`)
  return r.json()
}
async function until(label, predicate, timeout = 120000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const v = await predicate(); if (v) return v; await sleep(400) }
  throw new Error(`Timed out: ${label}`)
}
async function capture(name, snapshot) {
  if (snapshot.paused) await until('rendered physics tick', () => evaluate(`document.body.innerText.includes('TICK ${snapshot.tick}')`), 30000)
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(resolve(output, name + '.png'), Buffer.from(data, 'base64'))
  await writeFile(resolve(output, name + '.json'), JSON.stringify(snapshot, null, 2) + '\n')
  process.stdout.write(`Captured ${name} at tick ${snapshot.tick}\n`)
}
const report = { captured_at: new Date().toISOString(), simulation_only: true, risk_stages: [], browser_errors: errors }
await mkdir(output, { recursive: true })
try {
  await cdp('Runtime.enable')
  await cdp('Page.enable')
  await cdp('Network.enable')
  await cdp('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp('Page.navigate', { url: base + '?evidence=' + Date.now() })
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1120, deviceScaleFactor: 1, mobile: false })
  await api('/v1/scenarios/reset', 'POST')
  await until('scene', () => evaluate("document.querySelectorAll('.floating-label').length === 6 && !!document.querySelector('.v3-main-view canvas')"))
  await capture('01-baseline', await api('/v1/state'))
  report.rendering = await evaluate(`new Promise(resolve => {
    const canvas = document.querySelector('.v3-main-view canvas');
    const gl = canvas.getContext('webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    let start; let frames = 0;
    const frame = t => { if (!start) start = t; frames++; if (t - start < 3000) requestAnimationFrame(frame); else resolve({ renderer, render_profile: canvas.dataset.renderProfile, canvas_pixels: [canvas.width, canvas.height], sample_ms: t-start, frames, approximate_raf_fps: (frames-1)*1000/(t-start), draw_calls: canvas.dataset.drawCalls, triangles: canvas.dataset.triangles, viewport: [innerWidth, innerHeight] }); };
    requestAnimationFrame(frame);
  })`)
  await api('/v1/scenarios/S1_METHANE_LEAK/start', 'POST')
  for (const [index, risk] of ['ADVISORY', 'WARNING', 'EMERGENCY'].entries()) {
    await until(risk, async () => { const s = await api('/v1/state'); return s.risks.find((z) => z.zone_id === 'Z04')?.state === risk && s })
    await api('/v1/scenarios/pause', 'POST')
    // State is Ditto readback: wait until the paused model state has been published and read back.
    const frozen = await until('paused readback', async () => { const s = await api('/v1/state'); return s.paused && s })
    assert.equal(frozen.publication_status, 'ECLIPSE_DITTO_READBACK')
    assert.equal(frozen.risks.find((z) => z.zone_id === 'Z04').state, risk)
    await capture(`0${index + 2}-${risk.toLowerCase()}`, frozen)
    report.risk_stages.push({ risk, tick: frozen.tick, seconds: frozen.simulated_seconds, methane_percent: frozen.risks.find((z) => z.zone_id === 'Z04').methane_fraction * 100 })
    if (risk === 'EMERGENCY') {
      const safety = frozen.safety.find((s) => s.zone_id === 'Z04')
      assert.ok(safety.production_stop && safety.evacuation_advisory && safety.ventilation_response && !safety.optimization_enabled)
      assert.ok(safety.fan_requests.length === 2 && safety.fan_requests.every((r) => r.status === 'ACHIEVED' && r.actual_speed_fraction === 1 && r.requested_speed_fraction === 1), 'Emergency fan model response did not achieve its requested setting')
      assert.ok(frozen.fans.every((f) => !f.faulted && f.actual_speed_fraction === 1 && f.actual_speed_rpm > 0))
      const ready = await until('Ditto emergency readback', async () => { const r = await api('/health/ready'); return r.platform_connected && r.platform_last_verified_tick >= frozen.tick && r })
      const twin = await api('/v1/twins/mineguard%3Azone-z04')
      const interlock = twin.features.safety_interlock.properties
      assert.ok(interlock.trip_power && interlock.evacuation_advisory && interlock.simulation_only && interlock.equipment_io === false)
      await writeFile(resolve(output, '05-ditto-emergency.json'), JSON.stringify({ ready, twin, safety }, null, 2) + '\n')
      report.ditto_emergency_verified = true
      const fans = await Promise.all(['fan-main', 'fan-aux'].map((id) => api('/v1/twins/mineguard%3A' + id)))
      for (const fan of fans) {
        assert.equal(fan.features.speed.properties.value, 100)
        assert.ok(fan.features.rpm.properties.value > 0)
        assert.ok(fan.features.simulation.properties.tick >= frozen.tick)
      }
      await writeFile(resolve(output, '05-fan-response-readback.json'), JSON.stringify({ model_feedback: safety.fan_requests, twins: fans }, null, 2) + '\n')
      report.simulated_fan_response_verified = true
      await evaluate("document.querySelector('.incident-buttons button')?.click()")
      await capture('06-emergency-acknowledged', frozen)
    } else await api('/v1/scenarios/resume', 'POST')
  }
  await api('/v1/scenarios/reset', 'POST')
  await api('/v1/scenarios/S2_MAIN_FAN_FAILURE/start', 'POST')
  const failed = await until('main fan failure', async () => { const s = await api('/v1/state'); return s.fans.find((f) => f.fan_id === 'FAN_MAIN')?.faulted && s })
  assert.equal(failed.fans.find((f) => f.fan_id === 'FAN_MAIN').actual_speed_rpm, 0)
  await api('/v1/scenarios/pause', 'POST')
  // The fan failure raises a new simulated incident dialog; acknowledge it so the scene is visible.
  await until('fan-failure incident dialog', () => evaluate("!!document.querySelector('.incident-buttons')"), 30000)
  await evaluate("document.querySelector('.incident-buttons button.secondary')?.click()")
  await capture('07-main-fan-failure', await until('paused readback', async () => { const s = await api('/v1/state'); return s.paused && s }))
  await until('Ditto fan failure', async () => { const r = await api('/health/ready'); return r.platform_connected && r.platform_last_verified_tick >= failed.tick })
  await writeFile(resolve(output, '08-ditto-fan-failure.json'), JSON.stringify(await api('/v1/twins/mineguard%3Afan-main'), null, 2) + '\n')
  report.fan_failure_verified = true
} finally {
  await api('/v1/scenarios/reset', 'POST')
  // Ditto is republished every second, so a reset shows as a verified tick restarting near zero.
  report.reset = await until('reset readback', async () => { const r = await api('/health/ready'); return r.platform_connected && r.platform_last_verified_tick !== null && r.platform_last_verified_tick <= 10 && r })
  const reset = await api('/v1/state')
  assert.ok(reset.tick <= 20, 'Ditto readback did not restart from the baseline')
  const resetScenario = await api('/v1/scenarios/state')
  assert.equal(resetScenario.status, 'IDLE')
  assert.equal(resetScenario.scenario_id, null)
  assert.ok(reset.fans.every((f) => !f.faulted))
  assert.ok(reset.safety.every((s) => !s.production_stop && !s.evacuation_advisory))
  await capture('09-reset-baseline', reset)
  await writeFile(resolve(output, '09-reset-ditto.json'), JSON.stringify(await api('/v1/twins/mineguard%3Azone-z04'), null, 2) + '\n')
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  try { await cdp('Page.close') } catch { /* Chrome may close a heavily loaded SwiftShader page before acknowledging CDP. */ }
  socket.close()
}
assert.deepEqual(errors, [])
process.stdout.write(JSON.stringify(report) + '\n')
