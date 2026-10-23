// Settings > Licence (admins): shows this server's licence, the machine fingerprint to send the
// owner for a Pro licence, and an upload box for the licence file they send back. Prod-safe: an
// unlicensed server reads "all features on". Talks to /api/licence (licence-api.mjs).

/** Status → a plain-English line and a tone. Pure, so it is tested without a browser. */
export function statusLine(info = {}) {
  const name = info.appName || 'Argus'
  const who = info.customer || 'this site'
  switch (info.status) {
    case 'none': return { tone: 'neutral', text: 'Running unlicensed — all features are on. To license this server, send the fingerprint below.' }
    case 'active': return { tone: 'ok', text: `${name} — licensed to ${who}.` }
    case 'over-cameras': return { tone: 'warn', text: `${name} — licensed to ${who}, but ${info.cameraCount} cameras are set up and this licence covers ${info.maxCameras}. Ask for more cameras, or reduce them.` }
    case 'wrong-machine': return { tone: 'warn', text: `This licence (for ${info.customer || 'a customer'}) is for a different machine. Send the fingerprint below to get one for this server.` }
    case 'wrong-site': return { tone: 'warn', text: 'This licence is for a different site — none of its recorders are connected here.' }
    case 'expired': return { tone: 'warn', text: `This licence expired${info.expiry ? ` on ${new Date(info.expiry).toLocaleDateString()}` : ''}. Ask the owner for a renewal.` }
    case 'bad-signature': case 'malformed': case 'unknown-key': return { tone: 'bad', text: 'The stored licence could not be read. Upload the licence file again.' }
    default: return { tone: 'neutral', text: 'Checking the licence…' }
  }
}

/** The camera-usage line, when the licence sets a limit. Pure. */
export function cameraLine(info = {}) {
  if (info.maxCameras == null) return info.cameraCount != null ? `${info.cameraCount} cameras set up (no camera limit).` : ''
  return `${info.cameraCount ?? 0} of ${info.maxCameras} licensed cameras in use.`
}

// ---- the panel (browser only) ------------------------------------------------------------------
if (typeof document !== 'undefined') {
  const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); Object.assign(n, props); n.append(...kids.filter((c) => c != null)); return n }
  const api = async (method, body) => {
    const res = await fetch('/api/licence', { method, headers: method === 'GET' ? {} : { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined })
    if (res.status === 401) { location.href = '/login.html'; return null }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
    return data
  }

  const mount = document.getElementById('licencePanel')
  if (mount) {
    const render = (info) => {
      mount.textContent = ''
      const s = statusLine(info)
      mount.append(el('p', { className: `lic-status lic-${s.tone}`, textContent: s.text, role: 'status' }))
      if (info.status !== 'none' && info.maxCameras != null) mount.append(el('p', { className: 'st-meta', textContent: cameraLine(info) }))

      // the fingerprint to send the owner
      const fp = info.fingerprint ?? {}
      const code = el('code', { className: 'lic-fingerprint', textContent: fp.id ?? '—' })
      const copyBtn = el('button', { type: 'button', className: 'btn', textContent: 'Copy code' })
      copyBtn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(fp.id ?? ''); copyBtn.textContent = 'Copied' } catch { const r = document.createRange(); r.selectNode(code); getSelection().removeAllRanges(); getSelection().addRange(r) }
        setTimeout(() => { copyBtn.textContent = 'Copy code' }, 1500)
      })
      const dlBtn = el('button', { type: 'button', className: 'btn', textContent: 'Download details' })
      dlBtn.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(fp, null, 2)], { type: 'application/json' })
        const a = el('a', { href: URL.createObjectURL(blob), download: `argus-fingerprint-${fp.id ?? 'server'}.json` })
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      })
      mount.append(
        el('h3', { className: 'lic-sub', textContent: 'This server’s fingerprint' }),
        el('p', { className: 'st-help', textContent: 'Send this to the owner to get a licence for this exact server and its recorders.' }),
        el('div', { className: 'lic-fp-row' }, code, copyBtn, dlBtn)
      )

      // upload a licence file (or paste it)
      const msg = el('span', { className: 'st-meta', role: 'status' })
      const file = el('input', { type: 'file', accept: '.json,application/json', id: 'licFile' })
      const install = async (text) => {
        let obj
        try { obj = JSON.parse(text) } catch { msg.textContent = 'That file is not a licence (could not read it).'; msg.className = 'st-error'; return }
        try { render(await api('POST', obj)); } catch (e) { msg.textContent = e.message; msg.className = 'st-error' }
      }
      file.addEventListener('change', () => { const f = file.files?.[0]; if (f) f.text().then(install) })
      const removeBtn = info.status !== 'none'
        ? (() => { const b = el('button', { type: 'button', className: 'btn', textContent: 'Remove licence' }); b.addEventListener('click', async () => { if (confirm('Remove this licence? The server keeps running; it just goes back to unlicensed.')) { try { render(await api('DELETE')) } catch (e) { msg.textContent = e.message } } }); return b })()
        : null
      mount.append(
        el('h3', { className: 'lic-sub', textContent: 'Install a licence' }),
        el('p', { className: 'st-help', textContent: 'Choose the licence file (licence.json) the owner sent back.' }),
        el('div', { className: 'lic-fp-row' }, file, removeBtn),
        msg
      )
    }

    api('GET').then((info) => { if (info) render(info) }).catch((e) => { mount.textContent = ''; mount.append(el('p', { className: 'st-error', textContent: e.message })) })
  }
}
