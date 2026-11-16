// Service worker for gldump.html: reports the GPU identity WebGL gives it.
function identity(canvas) {
  function fnv(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  const out = [];
  for (const kind of ['webgl', 'webgl2']) {
    const gl = (canvas(kind));
    if (!gl) { out.push(kind + ':none'); continue; }
    // Asking before the extension is enabled must fail, as in an unmodified browser.
    const early = gl.getParameter(0x9246), earlyError = gl.getError();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const all = [];
    for (const name in gl) {
      if (typeof gl[name] !== 'number' || name !== name.toUpperCase()) continue;
      let value;
      try { value = gl.getParameter(gl[name]); } catch (e) { value = 'throws'; }
      gl.getError();
      if (value && typeof value === 'object' && 'length' in value) value = Array.from(value).join(',');
      else if (value && typeof value === 'object') value = Object.prototype.toString.call(value);
      all.push(name + '=' + value);
    }
    out.push(kind + ':' + [
      info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'no-info',
      info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : 'no-info',
      'early=' + early + '/' + earlyError,
      'params=' + fnv(all.join('|')),
      'ext=' + fnv((gl.getSupportedExtensions() || []).join(',')),
    ].join('~'));
  }
  return out.join(' ## ');
}
onmessage = event => event.ports[0].postMessage(identity(kind => new OffscreenCanvas(8, 8).getContext(kind)));
