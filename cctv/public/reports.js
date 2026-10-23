// Reports page: a day, a week or a month of recording (GET /api/admin/reports, reports.mjs).
// Everything is built with DOM calls and textContent: camera names come from the NVRs.
// the words for each kind of event: the Alarms page's own map, so the two pages name them alike
import { labelOf } from './alarms-view.js'

const $ = (id) => document.getElementById(id)
const el = (tag, cls, text) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}
const pct = (x) => (x === null || x === undefined ? '–' : `${(x * 100).toFixed(x >= 0.995 && x < 1 ? 1 : 0)}%`)
const hours = (ms) => (!ms ? '0' : ms >= 3_600_000 ? `${(ms / 3_600_000).toFixed(ms >= 36_000_000 ? 0 : 1)} h` : `${Math.max(1, Math.round(ms / 60_000))} min`)
const bytes = (b) => {
  if (!Number.isFinite(b)) return '–'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = b
  while (v >= 1000 && i < u.length - 1) {
    v /= 1000
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`
}
const camName = (r) => `${r.site} · ${r.ch + 1} · ${r.name}`

function card(value, label, tone = '') {
  const c = el('div', `rp-card ${tone}`)
  c.append(el('b', '', value), el('span', '', label))
  return c
}

/** What a section with nothing in it says: once, however many tables it would have had. */
export const EMPTY = 'Nothing in this period.'

/**
 * Whether Argus is recording at all. The report gives each camera `recording: false` when its
 * recording mode is "off" (server.mjs allCameras: cameraRecording(...).mode !== 'off'), which is what
 * switching recording off in Settings does for every camera. This is the report's own signal: the
 * storage list cannot be used, as it comes from the storage history, which still holds a location
 * after it is removed, and a camera first recorded after the period also has no share, so neither
 * "no storage" nor "no recorded share" says recording is off. No cameras at all: nothing records.
 */
export const recordingOff = (rep) => (rep.cameras ?? []).every((r) => r.recording === false)
export const NOT_RECORDING = "Argus isn't recording — each recorder keeps its own copy"

/** The Events table's rows: each kind in the Alarms page's words, busiest first. */
export const eventRows = (eventsByType) => Object.entries(eventsByType ?? {}).sort((a, b) => b[1] - a[1]).map(([t, n]) => [labelOf(t), n.toLocaleString('en-GB')])

function table(head, rows) {
  if (!rows.length) return el('p', 'hp-note', EMPTY)
  const t = el('table', 'al-table rp-table')
  const tr = el('tr')
  for (const h of head) tr.append(el('th', '', h))
  t.append(el('thead'))
  t.tHead.append(tr)
  const tb = el('tbody')
  for (const r of rows) {
    const row = el('tr')
    for (const cell of r) {
      const td = el('td')
      if (cell instanceof Node) td.append(cell)
      else td.textContent = cell
      row.append(td)
    }
    tb.append(row)
  }
  t.append(tb)
  return t
}

/** Two tables side by side, or the one empty line when neither has anything. */
function pair([headA, a], [headB, b]) {
  if (!a.length && !b.length) return el('p', 'hp-note', EMPTY)
  const box = el('div', 'rp-two')
  box.append(table(headA, a), table(headB, b))
  return box
}

/** A bar for a share (0..1), with the figure beside it. */
function bar(share) {
  const w = el('span', 'rp-bar')
  const f = el('i')
  f.style.width = `${Math.round(Math.max(0, Math.min(1, share ?? 0)) * 100)}%`
  if (share !== null && share < 0.9) w.classList.add('poor')
  else if (share !== null && share < 0.99) w.classList.add('mostly')
  w.append(f)
  const box = el('span', 'rp-share')
  box.append(w, el('span', '', pct(share)))
  return box
}

const reasons = (gaps) => Object.entries(gaps).filter(([, ms]) => ms >= 60_000).sort((a, b) => b[1] - a[1]).map(([k, ms]) => `${hours(ms)} ${k}`).join(', ') || '–'

function render(rep) {
  const s = rep.summary
  $('rpSub').textContent = rep.label // the page header's line under "Reports": which period this is
  const events = card(Object.values(s.eventsByType).reduce((a, b) => a + b, 0).toLocaleString('en-GB'), 'events')
  // While Argus is not recording, every recording figure would read "–", "0 cameras" or "0 B", which
  // looks like a fault. One plain line says why instead (as Health does), and the two sections about
  // recorded footage are hidden; the events and storage below are still true, so they stay.
  const off = recordingOff(rep)
  $('rpWorst').closest('section').hidden = off
  $('rpGaps').closest('section').hidden = off
  if (off) {
    $('rpCards').replaceChildren(el('p', 'rp-off', NOT_RECORDING), events)
  } else {
    $('rpCards').replaceChildren(
      card(pct(s.recordedShare), `of the time recorded (${s.recordedCameras} cameras)`, s.recordedShare !== null && s.recordedShare < 0.95 ? 'warn' : ''),
      card(String(s.complete), 'cameras complete (99% or more)'),
      card(String(s.poor), 'cameras under 90%', s.poor ? 'warn' : ''),
      card(hours(Object.values(s.gapByKind).reduce((a, b) => a + b, 0)), 'not recorded, all cameras together'),
      events,
      card(bytes(s.bytes), 'recorded')
    )

    const poor = rep.worst.filter((r) => r.recordedShare < 0.9)
    $('rpWorst').replaceChildren(poor.length
      ? table(['Camera', 'Recorded', 'Why not'], poor.map((r) => [camName(r), bar(r.recordedShare), reasons(r.gaps)]))
      : el('p', 'hp-note', 'Every recorded camera was recorded at least 90% of the time.'))

    const gapRows = Object.entries(s.gapByKind).filter(([, ms]) => ms >= 60_000).sort((a, b) => b[1] - a[1]).map(([k, ms]) => [k, hours(ms)])
    const offline = rep.mostOffline.map((r) => [camName(r), hours(r.offlineMs)])
    $('rpGaps').replaceChildren(pair([['Reason', 'Time'], gapRows], [['Offline the longest', 'Time'], offline]))
  }

  const busiest = [...rep.cameras].filter((r) => r.eventCount).sort((a, b) => b.eventCount - a.eventCount).slice(0, 10).map((r) => [camName(r), r.eventCount.toLocaleString('en-GB')])
  $('rpEvents').replaceChildren(pair([['Kind', 'How many'], eventRows(s.eventsByType)], [['Busiest cameras', 'Events'], busiest]))

  $('rpStorage').replaceChildren(table(['Where', 'Used', 'Growing by', 'Lasts'], rep.storage.map((st) => [
    st.location,
    st.usedShare === null ? bytes(st.usedBytes) : `${bytes(st.usedBytes)} of ${bytes(st.totalBytes)} (${pct(st.usedShare)})`,
    st.perDayBytes === null ? '–' : `${bytes(st.perDayBytes)} a day`,
    st.daysLeft === null ? '–' : `about ${Math.round(st.daysLeft)} days`
  ])))

  // not recording: only what is true for every camera, its events (no "not recorded", no "0 B")
  const all = [...rep.cameras].sort((a, b) => (a.recordedShare ?? 2) - (b.recordedShare ?? 2))
  $('rpAll').replaceChildren(off
    ? table(['Camera', 'Events'], [...rep.cameras].sort((a, b) => b.eventCount - a.eventCount).map((r) => [camName(r), r.eventCount ? r.eventCount.toLocaleString('en-GB') : 'none']))
    : table(['Camera', 'Recorded', 'Not recorded', 'Events', 'Size'], all.map((r) => [
      camName(r),
      r.recordedShare === null ? 'not recorded by the server' : bar(r.recordedShare),
      reasons(r.gaps),
      r.eventCount ? r.eventCount.toLocaleString('en-GB') : '–',
      bytes(r.bytes)
    ])))
}

let current = null
async function load(period) {
  current = period
  for (const b of document.querySelectorAll('.rp-periods button')) b.setAttribute('aria-pressed', String(b.dataset.period === period))
  try { localStorage.setItem('argus.report.period', period) } catch {}
  $('rpStatus').hidden = false
  $('rpStatus').textContent = 'Working it out… (a month can take a little while)'
  const res = await fetch(`/api/admin/reports?period=${encodeURIComponent(period)}`).catch(() => null)
  if (current !== period) return // another period was chosen meanwhile
  const body = await res?.json().catch(() => null)
  if (!res?.ok || !body?.summary) {
    $('rpStatus').textContent = body?.error ?? 'The report could not be made.'
    return
  }
  $('rpStatus').hidden = true
  render(body)
}

// The page's wiring. Only in a browser on this page: the helpers above are also loaded by the
// tests (reports-page.test.mjs), where there is no page to wire.
if (typeof document !== 'undefined' && document.getElementById('rpCards')) {
  for (const b of document.querySelectorAll('.rp-periods button')) b.addEventListener('click', () => load(b.dataset.period))
  let first = 'yesterday'
  try { first = localStorage.getItem('argus.report.period') || first } catch {}
  load(first)
}
