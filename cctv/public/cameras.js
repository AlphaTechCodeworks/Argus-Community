// Cameras report page: the live per-camera inventory (GET /api/admin/cameras, camera-export.mjs),
// one compact row per camera (a card on a phone, css/cameras.css), with a text filter, a Refresh
// that forces a new read, and an Excel download that keeps every column. Admins only -- a viewer
// who reaches the page gets the API's 403 and a message. Built with DOM calls; names and addresses
// come from the NVRs.
const $ = (id) => document.getElementById(id)
const el = (tag, cls, text) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

const ENCT = { h264: 'H.264', h264p: 'H.264+', h264s: 'H.264 Smart', h265: 'H.265', h265p: 'H.265+', h265s: 'H.265 Smart' }
const enctLabel = (e) => (e ? ENCT[e] ?? String(e).toUpperCase() : '')
const yesNoBlank = (v) => (v == null ? '' : v ? 'Yes' : 'No')

export const HEAD = ['NVR', 'Site', 'Ch', 'Camera', 'Online', 'IP', 'Make', 'Model', 'Main', 'Main codec', 'Bitrate', 'H.265+?', 'Sub', 'Codec', 'Rec', 'PoE']

/** "NVR: North", "Bitrate: VBR"… one per line, leaving out what the recorder did not say. */
const tooltip = (cells) => HEAD.map((h, i) => (cells[i] === '' || cells[i] == null ? '' : `${h}: ${cells[i]}`)).filter(Boolean).join('\n')

/**
 * Flattens the report to one entry per camera, in the words its row shows: the name with where it
 * is (site, recorder, channel), a quieter second line with the make, model and main stream, whether
 * it is online and its address. The old table's sixteen columns stay in `cells`, and every one of
 * them is in the row's tooltip, so nothing the table showed is lost (the Excel download has them
 * all too). Each entry keeps a lower-cased search blob for the filter.
 */
export function flatten(report) {
  const rows = []
  for (const n of report.nvrs ?? []) {
    const cams = (n.cameras ?? []).slice().sort((a, b) => (a.ch ?? 0) - (b.ch ?? 0))
    const nvrName = n.nvrName || n.nvr
    if (cams.length === 0) {
      const why = n.nvrOnline ? n.error || 'no cameras returned' : 'offline — no cameras listed'
      const cells = [nvrName, n.site || '', '', `(${why})`, '', '', '', '', '', '', '', '', '', '', '', '']
      rows.push({ offline: true, online: false, name: `(${why})`, where: [n.site, nvrName].filter(Boolean).join(' · '), detail: '', ip: '', cells, title: tooltip(cells), blob: `${n.nvrName} ${n.site} ${why}`.toLowerCase() })
      continue
    }
    for (const c of cams) {
      const main = c.mainRes ? (c.mainFps ? `${c.mainRes} @${c.mainFps}` : c.mainRes) : ''
      const sub = c.subRes ? (c.subFps ? `${c.subRes} @${c.subFps}` : c.subRes) : ''
      const cells = [nvrName, n.site || '', c.ch, c.name || '', c.online ? 'Yes' : 'No', c.ip || '', c.maker || '', c.model || '', main, enctLabel(c.mainEnct), c.mainBitType || '', yesNoBlank(c.h265pCapable), sub, (c.subCodec || '').toUpperCase(), c.recStatus || '', c.poe ? 'Yes' : 'No']
      rows.push({
        offline: false,
        camOffline: !c.online,
        online: Boolean(c.online),
        name: c.name || `Camera ${c.ch}`,
        where: [n.site, nvrName, c.ch != null ? `ch ${c.ch}` : ''].filter(Boolean).join(' · '),
        // blanks are dropped, so a camera the recorder says little about shows no stray " · "
        detail: [[c.maker, c.model].filter(Boolean).join(' '), main, enctLabel(c.mainEnct)].filter(Boolean).join(' · '),
        ip: c.ip || '',
        cells,
        title: tooltip(cells),
        blob: `${n.nvrName} ${n.site} ${c.name} ${c.ip} ${c.maker} ${c.model} ${c.recStatus} ${c.mainEnct || ''} ${c.mainBitType || ''}`.toLowerCase()
      })
    }
  }
  return rows
}

const PAGE_SIZE = 50
let cameraPage = 0, filterTimer
function render(rows, filter) {
  const q = filter.trim().toLowerCase()
  const shown = q ? rows.filter((r) => r.blob.includes(q)) : rows
  const list = el('ul', 'cm-list')
  cameraPage = Math.min(cameraPage, Math.max(0, Math.ceil(shown.length / PAGE_SIZE) - 1))
  for (const r of shown.slice(cameraPage * PAGE_SIZE, (cameraPage + 1) * PAGE_SIZE)) {
    const li = el('li', `cm-row${r.offline ? ' cm-off' : r.camOffline ? ' cm-camoff' : ''}`)
    li.title = r.title
    // the dot is a colour, so the word is there too, for a screen reader
    const dot = el('span', `cm-dot ${r.online ? 'is-on' : 'is-off'}`)
    dot.append(el('span', 'visually-hidden', r.online ? 'Online' : 'Offline'))
    const name = el('div', 'cm-name')
    name.append(el('b', '', r.name), el('span', 'cm-where', r.where))
    li.append(dot, name, el('div', 'cm-detail', r.detail), el('span', 'cm-ip', r.ip))
    list.append(li)
  }
  if (!shown.length) list.append(el('li', 'cm-empty', q ? 'No camera matches the filter.' : 'No cameras to show.'))
  $('cmTable').replaceChildren(list)
  $('cmPage').textContent = `${cameraPage + 1} / ${Math.max(1, Math.ceil(shown.length / PAGE_SIZE))} · ${shown.length} cameras`
  $('cmPrevious').disabled = cameraPage === 0
  $('cmNext').disabled = (cameraPage + 1) * PAGE_SIZE >= shown.length
  return shown.length
}

/** "02:00" today, "18 Oct 02:00" another day: the snapshot's time, short enough for one line. */
function whenText(d, now = Date.now()) {
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date(now).toDateString() ? time : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`
}

/**
 * The page header's one line. "Cameras" are the channels a recorder has a camera set up on, online
 * or not -- the same as Live's "282 of 296 cameras online" counts, though Live counts only the site
 * or view shown, and now, where this is the recorders that answered the nightly read.
 */
export function headerSub(body, now = Date.now()) {
  const cams = (body.nvrs ?? []).reduce((t, n) => t + (n.cameras ?? []).length, 0)
  const online = (body.nvrs ?? []).filter((n) => n.nvrOnline).length
  const off = (body.nvrs ?? []).length - online
  const when = body.at ? whenText(new Date(body.at), now) : ''
  return [
    `${cams} camera${cams === 1 ? '' : 's'} on ${online} recorder${online === 1 ? '' : 's'}`,
    off ? `${off} recorder${off === 1 ? '' : 's'} not answering` : '',
    body.cached ? `snapshot ${when}` : `read just now, ${when}`
  ].filter(Boolean).join(' · ')
}

let rows = []
let lastTotal = 0
let lastBody = null // the last report, for the optimiser's NVR list

async function load({ fresh = false } = {}) {
  $('cmStatus').hidden = false
  $('cmStatus').textContent = fresh ? 'Reading every NVR…' : 'Loading the cameras…'
  $('cmRefresh').disabled = true
  const res = await fetch(`/api/admin/cameras${fresh ? '?fresh=1' : ''}`).catch(() => null)
  $('cmRefresh').disabled = false
  if (res && res.status === 403) {
    $('cmStatus').textContent = 'This report is for admins only.'
    return
  }
  const body = await res?.json().catch(() => null)
  if (!res?.ok || !body?.nvrs) {
    $('cmStatus').textContent = body?.error ?? 'The report could not be loaded.'
    return
  }
  lastBody = body
  rows = flatten(body)
  lastTotal = render(rows, $('cmFilter').value)
  $('cmStatus').hidden = true
  $('cmSub').textContent = headerSub(body)
  $('cmSub').title = body.cached ? 'The nightly snapshot. Press Refresh to read every recorder now.' : ''
}

// ---- optimise codecs: bulk H.265 + VBR (POST /api/admin/nvrs/:id/streams/optimise) ----
const btn = (text, onClick) => {
  const b = el('button', '', text)
  b.type = 'button'
  b.style.marginRight = '8px'
  b.style.marginTop = '10px'
  b.addEventListener('click', onClick)
  return b
}
const optClear = () => {
  $('cmOptPanel').hidden = true
  $('cmOptPanel').replaceChildren()
}
async function optPost(nvrId, confirm) {
  const res = await fetch(`/api/admin/nvrs/${encodeURIComponent(nvrId)}/streams/optimise`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(confirm ? { confirm: true } : {})
  }).catch(() => null)
  const body = await res?.json().catch(() => null)
  return { ok: Boolean(res?.ok), body }
}
function optTable(head, rows) {
  const t = el('table', 'al-table rp-table')
  const thead = el('thead')
  const htr = el('tr')
  for (const h of head) htr.append(el('th', '', h))
  thead.append(htr)
  const tb = el('tbody')
  for (const r of rows) {
    const tr = el('tr')
    for (const c of r) tr.append(el('td', '', c == null ? '' : String(c)))
    tb.append(tr)
  }
  t.append(thead, tb)
  return t
}
async function startOptimise() {
  const panel = $('cmOptPanel')
  const online = (lastBody?.nvrs ?? []).filter((n) => n.nvrOnline)
  panel.hidden = false
  if (!online.length) {
    panel.replaceChildren(el('p', 'hp-note', 'No NVRs are online to optimise.'))
    return
  }
  $('cmOptimise').disabled = true
  panel.replaceChildren(el('p', 'hp-note', `Planning H.265 + VBR changes across ${online.length} NVR${online.length === 1 ? '' : 's'}… (reading each camera's encoder settings)`))
  const plans = []
  for (const n of online) {
    const { ok, body } = await optPost(n.nvr, false)
    if (ok && Array.isArray(body?.cameras)) {
      const cams = body.cameras.filter((c) => Array.isArray(c.moves) && c.moves.length)
      if (cams.length) plans.push({ nvr: n.nvr, name: n.nvrName || n.nvr, cams })
    }
  }
  $('cmOptimise').disabled = false
  renderPlan(plans)
}
function renderPlan(plans) {
  const panel = $('cmOptPanel')
  const total = plans.reduce((t, p) => t + p.cams.length, 0)
  const box = el('section', 'se-section')
  box.append(el('h2', '', 'Optimise codecs to H.265 + VBR'))
  if (total === 0) {
    box.append(el('p', 'hp-note', "Nothing to change — every online camera is already on H.265/H.265+ (and VBR), or can't be upgraded."))
    box.append(btn('Close', optClear))
    panel.replaceChildren(box)
    return
  }
  const count = (pred) => plans.reduce((t, p) => t + p.cams.filter((c) => c.moves.some(pred)).length, 0)
  const h264 = count((m) => m.startsWith('enct h264'))
  const cbr = count((m) => m.startsWith('bitType CBR'))
  box.append(el('p', 'st-help', `${total} camera${total === 1 ? '' : 's'} across ${plans.length} NVR${plans.length === 1 ? '' : 's'} would change (H.264→H.265: ${h264}, CBR→VBR: ${cbr}). The bitrate cap and picture quality are kept — these only save space. Each camera's encoder restarts briefly (a few seconds without video/recording). Already-optimal and H.265+ cameras are left alone.`))
  box.append(optTable(['NVR', 'Ch', 'Camera', 'Change'], plans.flatMap((p) => p.cams.map((c) => [p.name, c.ch, c.name, c.moves.join(', ')]))))
  box.append(btn(`Apply to ${total} camera${total === 1 ? '' : 's'}`, () => applyPlan(plans)), btn('Cancel', optClear))
  panel.replaceChildren(box)
}
async function applyPlan(plans) {
  const panel = $('cmOptPanel')
  panel.replaceChildren(el('p', 'hp-note', 'Applying, one camera at a time… (this can take a while)'))
  const results = []
  for (const p of plans) {
    const { ok, body } = await optPost(p.nvr, true)
    if (ok && Array.isArray(body?.results)) for (const r of body.results) results.push({ nvr: p.name, ...r })
    else results.push({ nvr: p.name, status: 'failed', message: body?.error || 'request failed' })
  }
  const done = results.filter((r) => r.status === 'done').length
  const notDone = results.filter((r) => r.status !== 'done' && r.status !== 'skipped')
  const box = el('section', 'se-section')
  box.append(el('h2', '', 'Optimise results'))
  box.append(el('p', 'st-help', `${done} applied${notDone.length ? `, ${notDone.length} did not take` : ''}. Press Refresh to see the new settings. Any change can be undone from the camera's stream settings.`))
  if (notDone.length) box.append(optTable(['NVR', 'Ch', 'Camera', 'Result'], notDone.map((r) => [r.nvr, r.ch, r.name, r.message || r.status])))
  box.append(btn('Close & refresh', () => { optClear(); load({ fresh: false }) }))
  panel.replaceChildren(box)
}

// ---- cap resolution: lower oversized cameras (e.g. 8MP -> 4MP). REDUCES quality -> strong confirm ----
async function capPost(nvrId, confirm) {
  const res = await fetch(`/api/admin/nvrs/${encodeURIComponent(nvrId)}/streams/cap-resolution`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(confirm ? { confirm: true, maxMp: 4 } : { maxMp: 4 })
  }).catch(() => null)
  return { ok: Boolean(res?.ok), body: await res?.json().catch(() => null) }
}
async function startCap() {
  const panel = $('cmOptPanel')
  const online = (lastBody?.nvrs ?? []).filter((n) => n.nvrOnline)
  panel.hidden = false
  if (!online.length) {
    panel.replaceChildren(el('p', 'hp-note', 'No NVRs are online.'))
    return
  }
  $('cmCapRes').disabled = true
  panel.replaceChildren(el('p', 'hp-note', `Finding cameras over 4 MP across ${online.length} NVR${online.length === 1 ? '' : 's'}…`))
  const plans = []
  for (const n of online) {
    const { ok, body } = await capPost(n.nvr, false)
    if (ok && Array.isArray(body?.cameras)) {
      const cams = body.cameras.filter((c) => Array.isArray(c.moves) && c.moves.length)
      if (cams.length) plans.push({ nvr: n.nvr, name: n.nvrName || n.nvr, cams })
    }
  }
  $('cmCapRes').disabled = false
  renderCapPlan(plans)
}
function renderCapPlan(plans) {
  const panel = $('cmOptPanel')
  const total = plans.reduce((t, p) => t + p.cams.length, 0)
  const box = el('section', 'se-section')
  box.append(el('h2', '', 'Cap resolution at 4 MP'))
  if (total === 0) {
    box.append(el('p', 'hp-note', 'No cameras are above 4 MP (or none can be lowered).'))
    box.append(btn('Close', optClear))
    panel.replaceChildren(box)
    return
  }
  const warn = el('p', 'st-help')
  warn.style.color = '#c0392b'
  warn.textContent = `This LOWERS recorded detail on ${total} camera${total === 1 ? '' : 's'} across ${plans.length} NVR${plans.length === 1 ? '' : 's'} (plates/faces harder to read at distance). Each encoder restarts briefly. You can restore a camera's resolution later (per-camera Undo), but footage recorded while it is lowered stays low. Nothing is recording now, so there is no disk saving until storage is set up.`
  box.append(warn)
  box.append(optTable(['NVR', 'Ch', 'Camera', 'Resolution'], plans.flatMap((p) => p.cams.map((c) => [p.name, c.ch, c.name, c.mp || c.moves.join(', ')]))))
  const label = el('label', '')
  label.style.display = 'block'
  label.style.margin = '10px 0'
  const cb = el('input')
  cb.type = 'checkbox'
  cb.style.marginRight = '8px'
  label.append(cb, document.createTextNode('I understand this permanently lowers the recorded detail on these cameras.'))
  box.append(label)
  const apply = btn(`Apply to ${total} camera${total === 1 ? '' : 's'}`, () => applyCap(plans))
  apply.disabled = true
  cb.addEventListener('change', () => { apply.disabled = !cb.checked })
  box.append(apply, btn('Cancel', optClear))
  panel.replaceChildren(box)
}
async function applyCap(plans) {
  const panel = $('cmOptPanel')
  panel.replaceChildren(el('p', 'hp-note', 'Lowering resolution, one camera at a time…'))
  const results = []
  for (const p of plans) {
    const { ok, body } = await capPost(p.nvr, true)
    if (ok && Array.isArray(body?.results)) for (const r of body.results) results.push({ nvr: p.name, ...r })
    else results.push({ nvr: p.name, status: 'failed', message: body?.error || 'request failed' })
  }
  const done = results.filter((r) => r.status === 'done').length
  const notDone = results.filter((r) => r.status !== 'done' && r.status !== 'skipped')
  const box = el('section', 'se-section')
  box.append(el('h2', '', 'Cap resolution — results'))
  box.append(el('p', 'st-help', `${done} lowered${notDone.length ? `, ${notDone.length} did not take` : ''}. Press Refresh to see the new settings.`))
  if (notDone.length) box.append(optTable(['NVR', 'Ch', 'Camera', 'Result'], notDone.map((r) => [r.nvr, r.ch, r.name, r.message || r.status])))
  box.append(btn('Close & refresh', () => { optClear(); load({ fresh: false }) }))
  panel.replaceChildren(box)
}
// The page's wiring. Only in a browser on this page: the row and header helpers above are also
// loaded by the tests (cameras-page.test.mjs), where there is no page to wire.
if (typeof document !== 'undefined' && document.getElementById('cmTable')) {
  $('cmFilter').addEventListener('input', () => {
    clearTimeout(filterTimer)
    filterTimer = setTimeout(() => {
      cameraPage = 0
      const shown = render(rows, $('cmFilter').value)
      if (shown !== lastTotal || $('cmFilter').value) $('cmStatus').hidden = true
    }, 120)
  })
  for (const [id, direction] of [['cmPrevious', -1], ['cmNext', 1]]) $(id).addEventListener('click', () => {
    cameraPage += direction
    render(rows, $('cmFilter').value)
  })
  $('cmRefresh').addEventListener('click', () => load({ fresh: true }))
  $('cmXlsx').addEventListener('click', () => {
    window.location = '/api/admin/cameras.xlsx'
  })
  $('cmOptimise').addEventListener('click', startOptimise)
  $('cmCapRes').addEventListener('click', startCap)
  load()
}
