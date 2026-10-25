/* global fetch, WebSocket, clearTimeout, setTimeout */
// Optional real Chromium gate. Start an isolated browser with a loopback CDP
// port, then run: node e2e/browser-smoke.mjs [base-url] [cdp-port] [output-dir]
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

const base = process.argv[2] ?? 'http://127.0.0.1:8091'
const cdpPort = Number(process.argv[3] ?? 9223)
const output = resolve(process.argv[4] ?? '../docs')
const target = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(base)}`, { method: 'PUT' }).then((response) => response.json())
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }) })
let sequence = 0
const pending = new Map()
const browserErrors = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    browserErrors.push({
      text: details.text,
      description: details.exception?.description ?? null,
      url: details.url,
      line: details.lineNumber,
      column: details.columnNumber,
    })
  }
  const request = pending.get(message.id)
  if (request) {
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  }
})
function command(method, params = {}) {
  return new Promise((resolveCommand, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve: resolveCommand, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const response = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result.value
}
async function waitFor(expression, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return
    await new Promise((done) => setTimeout(done, 250))
  }
  throw new Error(`Browser condition timed out: ${expression}`)
}
async function capture(name) {
  const { data } = await command('Page.captureScreenshot', { format: 'png' })
  await writeFile(resolve(output, name), Buffer.from(data, 'base64'))
}

try {
  await mkdir(output, { recursive: true })
  await command('Runtime.enable')
  await command('Page.enable')
  await command('Network.enable')
  await command('Network.setCacheDisabled', { cacheDisabled: true })
  await command('Page.navigate', { url: base + '?validation=' + Date.now() })
  await command('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1080, deviceScaleFactor: 1, mobile: false })
  await waitFor("document.querySelector('.brand-name')?.textContent?.includes('MINEGUARD') && document.querySelector('.v3-main-view') !== null")
  await waitFor("document.querySelector('.v3-main-view canvas') !== null")
  await waitFor("document.querySelectorAll('.zone-row').length === 6 && document.querySelectorAll('.floating-label').length === 6")
  const rendering = await evaluate(`new Promise(resolve => {
    const canvas = document.querySelector('.v3-main-view canvas');
    const gl = canvas.getContext('webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    let start; let frames = 0;
    const frame = t => { if (!start) start = t; frames++; if (t-start < 3000) requestAnimationFrame(frame); else resolve({
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      render_profile: canvas.dataset.renderProfile, sample_ms: t-start, approximate_raf_fps: (frames-1)*1000/(t-start),
      draw_calls: canvas.dataset.drawCalls, triangles: canvas.dataset.triangles, engine_render_fps: canvas.dataset.renderFps,
      canvas_pixels: [canvas.width,canvas.height], canvas_css: [canvas.clientWidth,canvas.clientHeight]
    }); }; requestAnimationFrame(frame);
  })`)
  if (rendering.render_profile === 'v3-software-lite') assert.ok(Math.abs(rendering.canvas_pixels[0] / rendering.canvas_css[0] - 0.5) < 0.02, 'V3 software canvas ratio did not apply')
  assert.equal(await evaluate("document.querySelectorAll('.scene-tools button').length"), 4)
  const cameraBefore = await evaluate("document.querySelector('.v3-main-view canvas').dataset.camera")
  await new Promise((done) => setTimeout(done, 2000))
  const cameraAfter = await evaluate("document.querySelector('.v3-main-view canvas').dataset.camera")
  assert.ok(cameraBefore.split(',').every((v, i) => Math.abs(Number(v) - Number(cameraAfter.split(',')[i])) < 0.1), 'Live telemetry moved the settled overview camera')
  await evaluate("Array.from(document.querySelectorAll('.scene-tools button')).find(button => button.textContent.includes('Sensors')).click()")
  await waitFor("document.querySelectorAll('.floating-label').length === 0")
  await evaluate("Array.from(document.querySelectorAll('.scene-tools button')).find(button => button.textContent.includes('Sensors')).click()")
  await waitFor("document.querySelectorAll('.floating-label').length === 6")
  await evaluate("document.querySelectorAll('.zone-row')[0].click()")
  await waitFor("document.querySelectorAll('.zone-row')[0].classList.contains('selected')")
  await capture('command-center-3d.png')
  const routes = [['/twins', 'Twin Inspector', 'twin-inspector.png'], ['/scenarios', 'Scenario Laboratory', 'scenario-laboratory.png'], ['/energy', 'Energy Intelligence', 'energy-intelligence.png'], ['/evidence', 'Engineering Evidence', 'engineering-evidence.png']]
  for (const [path, title, screenshot] of routes) {
    await command('Page.navigate', { url: `${base}${path}` })
    await waitFor(`document.querySelector('h1')?.textContent === ${JSON.stringify(title)}`)
    await waitFor("document.querySelector('.mxf-header, .evx-header') !== null")
    if (path === '/energy') await waitFor("document.querySelectorAll('.mxf-candidate-table tbody tr').length > 0")
    if (path === '/twins') {
      await waitFor("document.querySelectorAll('.mxf-entity').length === 16 && document.querySelector('.mxf-live-badge')?.textContent.includes('LIVE · DITTO') && document.querySelector('.mxf-detail-heading')?.textContent.includes('ECLIPSE DITTO RESPONSE')")
      await evaluate("document.querySelectorAll('.mxf-entity')[1].click()")
      await waitFor("document.querySelector('.mxf-detail-heading')?.textContent.includes('mineguard:zone-z01') && document.querySelector('.mxf-detail-heading')?.textContent.includes('ECLIPSE DITTO RESPONSE')")
      await evaluate("document.querySelectorAll('.mxf-entity')[0].click()")
      await waitFor("document.querySelector('.mxf-detail-heading')?.textContent.includes('mineguard:mine-01')")
    }
    assert.equal(await evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), true, `${path} has horizontal page overflow`)
    await capture(screenshot)
  }
  await command('Page.navigate', { url: base })
  await waitFor("document.querySelectorAll('.zone-row').length === 6 && document.querySelectorAll('.floating-label').length === 6")
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  const responsiveRoutes = []
  for (const path of ['/', ...routes.map(([path]) => path)]) {
    await command('Page.navigate', { url: base + path })
    if (path === '/') await waitFor("document.querySelector('.v3-main-view canvas') !== null")
    else await waitFor("document.querySelector('h1') !== null")
    if (path === '/energy') await waitFor("document.querySelector('.mxf-candidate-table') !== null")
    if (path === '/twins') await waitFor("document.querySelector('.mxf-feature-grid') !== null")
    assert.equal(await evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), true, `${path} has mobile horizontal page overflow`)
    responsiveRoutes.push(path)
    await capture(`mobile-${path.slice(1) || 'command'}.png`)
  }
  const result = { checked_at: new Date().toISOString(), base, webgl: true, zones: 6, zone_selection: true, stable_camera: true, sensor_toggle: true, rendering, direct_routes: routes.map(([path]) => path), responsive_routes: responsiveRoutes, browser_errors: browserErrors }
  assert.deepEqual(browserErrors, [], 'Browser reported an uncaught exception')
  await writeFile(resolve(output, 'browser-validation.json'), `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(result)}\n`)
} catch (error) {
  await capture('browser-failure.png')
  const diagnostic = await evaluate("({title:document.title, heading:document.querySelector('h1')?.textContent, body:document.body.innerText.slice(0,2000), canvases:document.querySelectorAll('canvas').length, labels:document.querySelectorAll('.floating-label').length})")
  await writeFile(resolve(output, 'browser-failure.json'), `${JSON.stringify({ diagnostic, browserErrors }, null, 2)}\n`)
  throw error
} finally {
  await command('Page.close')
  socket.close()
}
