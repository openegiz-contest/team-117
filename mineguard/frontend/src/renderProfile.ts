/** CPU-only WebGL (SwiftShader, llvmpipe) needs a lighter scene and no backdrop blurs. */
export function detectSoftwareRenderer(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return false
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return /swiftshader|llvmpipe|software|softpipe/i.test(name)
  } catch {
    return false
  }
}

let cached: boolean | null = null

export function isSoftwareRenderer(): boolean {
  cached ??= detectSoftwareRenderer()
  return cached
}

/** Expose the profile to CSS as html[data-render-profile]. */
export function applyRenderProfile(): void {
  document.documentElement.dataset.renderProfile = isSoftwareRenderer() ? 'software' : 'hardware'
}
