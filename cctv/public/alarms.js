// The Alarms page: what still needs a person, in the order it needs them.
//
// The split is the one health.js uses: everything that decides what a line says is in
// alarms-view.js and is tested without a browser; this file fetches, paints and wires up the
// buttons. The motion tuning panel is its own class in motion-tune.js.
// Everything imported here is served from this folder: the browser cannot reach above it, which is
// why the kinds, the words and the priorities live in alarms-view.js and the server imports them
// from there rather than the other way round.
import { EVENT_KINDS, NOT_MOTION_TYPES, PRIORITIES, alarmRows, eventFromHash, filterSummary, kindParams, labelOf, linkedEventNote, priorityClass, ruleSummary, snapshotMayArrive, urgencyCounts } from './alarms-view.js'
import { bellFilters } from './alarm-bell.js'
import { fillCameraSelect } from './camera-choice.js'
import { MotionTuner } from './motion-tune.js'
import { mountCameraBrowser, workspaceSite } from './camera-browser.js'
import { preferenceStorage, preferencesReady } from './user-settings.js'

const $ = (id) => document.getElementById(id)
const REFRESH_MS = 30_000

let cameras = []
let admin = false
let tuner = null
let alarmRowsNow = [], alarmPage = 0, alarmRequest, alarmRequestId = 0, appliedFilters = null
let alarmBrowser
const ALARM_PAGE_SIZE = 50
// The alarm a link pointed at (a phone alert opens /alarms.html#event=<id>): marked in the list on
// every repaint, scrolled to once per link.
let linked = eventFromHash(location.hash)
let scrolledTo = null
// Line-crossing pictures, kept across the 30 s refresh so the list does not fetch and redraw every
// thumbnail each time; and the alarms whose picture is known not to be coming.
const thumbs = new Map()
const noPicture = new Set()

const jsonOf = (r) => r.json().catch(() => ({}))
const say = (el, text) => { el.textContent = text }

let dlgSeq = 0
/**
 * A themed input dialog in place of prompt(): resolves the entered text, or null if cancelled. Esc or
 * Cancel gives null; the action button (or Enter, single line) submits; showModal traps focus. Uses the
 * app's .ip-dialog look, so it matches every other dialog instead of the browser's own chrome.
 * @param {{ title: string, label?: string, value?: string, placeholder?: string, multiline?: boolean, action?: string }} o
 */
function inputDialog({ title, label = '', value = '', placeholder = '', multiline = false, action = 'Save' }) {
  const d = document.createElement('dialog')
  d.className = 'ip-dialog al-input'
  const tid = `al-d-${++dlgSeq}`
  d.setAttribute('aria-labelledby', tid)
  const h = document.createElement('h3')
  h.id = tid
  h.textContent = title
  const field = document.createElement(multiline ? 'textarea' : 'input')
  if (multiline) field.rows = 3
  else field.type = 'text'
  field.value = value
  field.placeholder = placeholder
  field.id = `${tid}-f`
  const lab = document.createElement('label')
  lab.htmlFor = field.id
  lab.textContent = label
  const buttons = document.createElement('div')
  buttons.className = 'ip-dialog-buttons'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = 'Cancel'
  const ok = document.createElement('button')
  ok.type = 'button'
  ok.className = 'ip-go btn btn-primary'
  ok.textContent = action
  buttons.append(cancel, ok)
  d.append(h, ...(label ? [lab] : []), field, buttons)
  document.body.append(d)
  return new Promise((resolve) => {
    const done = (v) => { try { d.close() } catch {} d.remove(); resolve(v) }
    ok.addEventListener('click', () => done(field.value))
    cancel.addEventListener('click', () => done(null))
    d.addEventListener('cancel', (e) => { e.preventDefault(); done(null) }, { once: true }) // Esc
    if (!multiline) field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(field.value) } })
    d.showModal()
    field.focus()
    field.select?.()
  })
}

/** A date input's value as milliseconds, or null when it is empty. */
const dayMs = (v, endOfDay = false) => {
  if (!v) return null
  const t = Date.parse(`${v}T00:00:00`)
  return Number.isFinite(t) ? t + (endOfDay ? 86_399_999 : 0) : null
}

function filterParams() {
  const f = $('filters').elements
  const p = new URLSearchParams()
  const from = dayMs(f.from.value)
  const to = dayMs(f.to.value, true)
  if (from !== null) p.set('from', String(from))
  if (to !== null) p.set('to', String(to))
  if (f.camera.value) p.set('cameras', f.camera.value)
  if (f.site.value) p.set('site', f.site.value)
  if (f.type.value) p.set('types', f.type.value)
  if (f.priority.value) p.set('priorities', f.priority.value)
  if (f.acked.value) p.set('acked', f.acked.value)
  if (f.text.value.trim()) p.set('text', f.text.value.trim())
  // The chips: the detection ones list this server's own detections (mostly stored acknowledged),
  // and motion is left out unless Motion is ticked (alarms-view.js kindParams says how).
  return kindParams(p, { people: f.people.checked, objects: f.objects.checked, rules: f.rules.checked, motion: f.motion.checked })
}

/**
 * Whether the list leaves motion out because Motion is not ticked, for the line above it. Not when
 * a kind is picked under More filters: then ticking Motion would not bring motion back, and the line
 * must not say it would.
 */
const motionHidden = () => { const f = $('filters').elements; return !f.motion.checked && !f.type.value }

/**
 * The filters behind the list, for the line above it: an empty list names the ones that may hide
 * alarms instead of saying none were recorded (alarms-view.js filterSummary; audit 2026-10-20
 * SE-search#0). A chip drops the Show filter from the query, so Show is read from what was asked.
 */
function summaryFilters() {
  const applied = appliedFilters ?? filterParams()
  const acked = applied.get('acked')
  return {
    acked: acked === 'false' ? false : acked === 'true' ? true : undefined,
    motionHidden: motionHidden(),
    text: applied.get('text') ?? '',
    // (from the query sent, like the rest, not the boxes: a chip ticked but not yet applied must not
    // be named for a list it did not shape; review of SE-search#0, 2026-10-20. Only Motion ticked
    // sends no kinds; nothing ticked sends every kind but motion, which is no choice of kind.)
    kinds: Boolean(applied.get('types')) && applied.get('types') !== NOT_MOTION_TYPES.join(','),
    priority: Boolean(applied.get('priorities'))
  }
}

// The filters a person chose are kept with their account and come back next time. The search is
// not: a search typed last week ("person") coming back on its own made the list look empty.
const SAVED_FILTERS = ['acked', 'type', 'priority', 'from', 'to']

// ---- the list ----------------------------------------------------------------------------------

async function loadAlarms() {
  const requestId = ++alarmRequestId
  $('list').setAttribute('aria-busy', 'true')
  alarmRequest?.abort()
  alarmRequest = new AbortController()
  try {
  const res = await fetch(`/api/alarms?${appliedFilters ?? filterParams()}`, { headers: { accept: 'application/json' }, signal: alarmRequest.signal })
  if (res.status === 401) return void (location.href = '/login.html')
  const body = await jsonOf(res)
  if (requestId !== alarmRequestId) return
  if (!res.ok) return say($('summary'), body.error ?? 'The alarms could not be read.')
  admin = body.admin === true
  const rows = alarmRows(body.alarms)
  alarmRowsNow = rows
  if (linked !== null && scrolledTo !== linked) {
    const index = rows.findIndex((r) => r.id === linked)
    if (index >= 0) alarmPage = Math.floor(index / ALARM_PAGE_SIZE)
  }
  // A linked alarm that is not in this list is explained on the summary line, which is read out as
  // a status: whoever followed the link learns why they are not looking at it.
  say($('summary'), [filterSummary(body.summary, summaryFilters()), body.scanLimited ? 'the search stopped before the start of this window: narrow the dates or the filters to see older matches' : '', linkedEventNote(linked, rows)].filter(Boolean).join(' · '))
  paintUrgency(body.summary?.byPriority)
  paintAlarmPage()
  $('alarmUpdated').textContent = `Updated ${new Date().toLocaleTimeString()} · Auto-refresh every 30 seconds · Counts cover loaded results${rows.length >= 500 ? ' (500-result limit; narrow filters for more detail)' : ''}`
  paintSources(body.sources)
  showLinked()
  } catch (e) {
    if (e.name !== 'AbortError') say($('summary'), 'Alarms could not be refreshed. Previous results remain visible. Use Refresh alarms to try again.')
  } finally { if (requestId === alarmRequestId) $('list').setAttribute('aria-busy', 'false') }
}

/**
 * One short line in place of the four urgency cards ("2 high · 14 medium · 300 low"). The server
 * counted the list it sent, so these are the counts of what is listed, motion left out included.
 * Each count is still the one-click way to see just that urgency (as the cards were): it sets the
 * Urgency filter under More filters, and a second click clears it.
 */
function paintUrgency(byPriority) {
  const f = $('filters').elements
  const parts = []
  for (const u of urgencyCounts(byPriority)) {
    if (parts.length) parts.push(' · ')
    const b = button(u.text, () => { f.priority.value = f.priority.value === u.priority ? '' : u.priority; applyAlarmFilters() }, 'btn btn-ghost btn-sm')
    b.setAttribute('aria-pressed', String(f.priority.value === u.priority))
    b.title = f.priority.value === u.priority ? 'Show every urgency again' : `Show only ${u.priority}`
    parts.push(b)
  }
  $('alarmOverview').replaceChildren(...parts)
}
function paintAlarmPage() {
  alarmPage = Math.min(alarmPage, Math.max(0, Math.ceil(alarmRowsNow.length / ALARM_PAGE_SIZE) - 1))
  paintAlarms(alarmRowsNow.slice(alarmPage * ALARM_PAGE_SIZE, (alarmPage + 1) * ALARM_PAGE_SIZE))
  $('alarmPage').textContent = alarmRowsNow.length ? `${alarmPage * ALARM_PAGE_SIZE + 1}–${Math.min(alarmRowsNow.length, (alarmPage + 1) * ALARM_PAGE_SIZE)} of ${alarmRowsNow.length} loaded alarms` : 'No matching alarms'
  $('alarmPrev').disabled = alarmPage === 0
  $('alarmNext').disabled = (alarmPage + 1) * ALARM_PAGE_SIZE >= alarmRowsNow.length
}
/**
 * The filters as they stand, applied. There is no Apply button any more: a select or a chip applies
 * when it changes, the search when Enter is pressed or it loses focus. The browser can report one
 * search twice (its change and its search events), so the same filters are not asked for again;
 * `force` is for Reset, which must reload even when nothing was set.
 */
function applyAlarmFilters({ force = false } = {}) {
  const f = $('filters').elements
  f.to.setCustomValidity(f.from.value && f.to.value && f.from.value > f.to.value ? 'End date must be on or after the start date.' : '')
  if (!$('filters').reportValidity()) return
  preferenceStorage.setItem('cctv.alarmFilters', JSON.stringify(Object.fromEntries(SAVED_FILTERS.map((k) => [k, f[k].value]))))
  const next = filterParams()
  if (!force && appliedFilters && String(next) === String(appliedFilters)) return
  alarmPage = 0; appliedFilters = next; loadAlarms()
}

// ---- the phone's Filters sheet -------------------------------------------------------------------
//
// On a phone the row folds to Browse and "Filters" (css/alarms.css); Filters opens the rest as a
// sheet under them, the same way Live's Filters does. The keyboard goes into the sheet's first field
// and comes back to Filters when it closes; Escape, a tap outside or Filters again closes it.
const filtersOpen = () => $('alarmFiltersToggle').getAttribute('aria-expanded') === 'true'
// Filters is on screen only on a narrow page (the stylesheet decides, not this script)
const filtersShown = () => $('alarmFiltersToggle').checkVisibility?.() ?? $('alarmFiltersToggle').offsetParent !== null
function setFilterSheet(open) {
  $('alarmFiltersToggle').setAttribute('aria-expanded', String(open))
  $('filters').classList.toggle('is-open', open)
  if (open) $('filters').elements.acked.focus()
}
function closeFilterSheet() {
  if (!filtersOpen()) return
  setFilterSheet(false)
  if (filtersShown()) $('alarmFiltersToggle').focus()
}
function wireFilterSheet() {
  $('alarmFiltersToggle').addEventListener('click', () => (filtersOpen() ? closeFilterSheet() : setFilterSheet(true)))
  // A dialog open over the page (Browse, Done's note) takes its own Escape.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && filtersOpen() && !document.querySelector('dialog[open]')) closeFilterSheet() })
  // A tap outside the filters closes the sheet; not one in a dialog opened from it (Browse).
  document.addEventListener('pointerdown', (e) => {
    if (filtersOpen() && !e.target.closest?.('#filters') && !e.target.closest?.('dialog')) setFilterSheet(false)
  })
  // Widened past the fold: the row shows everything again and Filters is gone, so the sheet is
  // closed rather than left "open" behind a hidden button.
  window.addEventListener('resize', () => { if (filtersOpen() && !filtersShown()) setFilterSheet(false) })
}

function paintAlarms(rows) {
  const list = $('list')
  list.replaceChildren()
  if (!rows.length) {
    const tr = document.createElement('tr')
    const td = document.createElement('td')
    td.colSpan = 7
    // Never "all clear": an empty list means nothing matched these filters, which is a different
    // claim from "nothing happened", and a very different one from "we can see everything".
    td.textContent = 'Nothing matches these filters. See “Where these come from” below for what this page can and cannot report.'
    tr.append(td)
    list.append(tr)
    thumbs.clear()
    return
  }
  for (const r of rows) {
    const tr = document.createElement('tr')
    tr.className = `${priorityClass(r.priority)}${r.needsAck ? ' needs-ack' : ''}${r.id === linked ? ' al-target' : ''}`
    tr.dataset.event = String(r.id)
    const cell = (text) => {
      const td = document.createElement('td')
      td.textContent = text ?? '—'
      return td
    }
    // urgency as a tag, the time with how long ago under it: read at a glance, not parsed
    const pri = document.createElement('td')
    const tag = document.createElement('span')
    tag.className = `al-pri ${priorityClass(r.priority)}`
    tag.textContent = r.priority
    pri.append(tag)
    const when = document.createElement('td')
    when.className = 'al-when'
    const ago = document.createElement('small')
    ago.textContent = r.ago
    when.append(r.when, ago)
    const what = cell(r.what)
    // a line crossing's picture sits under its name (event-snapshot.mjs takes it from the recording)
    if (r.snapshot && !noPicture.has(r.id)) what.append(thumbFor(r))
    tr.append(pri, when, cell(r.camera), what, cell(r.lasted), cell(r.ack || (r.needsAck ? 'Needs review' : '')))

    const actions = document.createElement('td')
    actions.className = 'al-actions'
    // "Done" on screen: short enough not to be cut off in the column, and the plain word. It is the
    // same acknowledge as ever (the note dialog, then POST .../ack). The tooltip says Acknowledge for
    // anyone who knows it by that word; the name read out says which alarm, as a screen reader's list
    // of buttons would otherwise be forty identical "Done"s.
    if (r.needsAck) {
      const done = button('Done', () => acknowledge(r), 'btn btn-primary')
      done.title = 'Acknowledge'
      done.setAttribute('aria-label', `Done: ${r.what} on ${r.camera}`)
      actions.append(done)
    }
    // Opening in playback a little before the alarm: the useful part starts before the trigger.
    actions.append(link('Playback', `/playback.html?nvr=${encodeURIComponent(r.nvr)}&ch=${r.ch}&t=${r.startMs - 30_000}`))
    const evidence = document.createElement('details'); evidence.className = 'al-evidence'
    const evidenceTitle = document.createElement('summary'); evidenceTitle.textContent = 'Evidence'
    evidenceTitle.setAttribute('aria-label', `Evidence actions for ${r.camera}`)
    const evidenceActions = document.createElement('div'); evidenceActions.className = 'al-evidence-actions'
    evidenceActions.append(button('Bookmark', () => bookmark(r), 'btn btn-ghost'), button('Export clip', () => exportClip(r), 'btn btn-ghost'))
    evidence.append(evidenceTitle, evidenceActions); actions.append(evidence)
    const group = document.createElement('div'); group.className = 'al-action-group'
    group.append(...actions.childNodes); actions.append(group)
    tr.append(actions)
    ;['Urgency', 'When', 'Camera', 'Event', 'Duration', 'Review', 'Actions'].forEach((label, i) => { tr.children[i].dataset.label = label })
    list.append(tr)
  }
  // pictures of rows that have left the list (acknowledged, filtered out, too old) are let go
  const shown = new Set(rows.map((r) => r.id))
  for (const id of thumbs.keys()) if (!shown.has(id)) thumbs.delete(id)
}

const button = (text, fn, cls = '') => {
  const b = document.createElement('button')
  b.type = 'button'
  if (cls) b.className = cls
  b.textContent = text
  b.addEventListener('click', fn)
  return b
}
// a quiet text action (.btn-ghost), as the row's other actions beside Acknowledge
const link = (text, href) => {
  const a = document.createElement('a')
  a.className = 'btn btn-ghost'
  a.textContent = text
  a.href = href
  return a
}

/**
 * A line crossing's picture: a thumbnail that opens the full picture in a new tab. Loaded lazily
 * (the browser fetches it only when the row comes near the screen): the list can hold hundreds of
 * rows, and each picture is a file the server reads from disk. The same element is reused on every
 * refresh, so a picture is fetched once rather than every 30 s.
 */
function thumbFor(row) {
  const kept = thumbs.get(row.id)
  if (kept) return kept
  const a = document.createElement('a')
  a.className = 'al-snap'
  a.href = row.snapshot
  a.target = '_blank'
  a.rel = 'noopener'
  a.title = 'Open the picture'
  const img = document.createElement('img')
  // the alarm a link pointed at is looked at straight away: its picture should not wait for a scroll
  img.loading = row.id === linked ? 'eager' : 'lazy'
  img.decoding = 'async'
  img.alt = `${row.what}, ${row.camera}, ${row.when}`
  // No picture: it is taken from the recording up to three minutes after the crossing, or there was
  // no recording to take it from, or this user may not play that camera back. The empty frame goes;
  // the next refresh asks again only while the picture may still be on its way.
  img.addEventListener('error', () => {
    a.remove()
    thumbs.delete(row.id)
    if (!snapshotMayArrive(row.startMs)) noPicture.add(row.id)
  }, { once: true })
  img.src = row.snapshot
  a.append(img)
  thumbs.set(row.id, a)
  return a
}

/**
 * The alarm a link pointed at: brought into view once per link, and given the focus so a keyboard
 * or a screen reader starts there. Later refreshes keep it marked but leave the scrolling to the user.
 */
function showLinked() {
  if (linked === null || scrolledTo === linked) return
  const tr = $('list').querySelector(`tr[data-event="${linked}"]`)
  if (!tr) return
  scrolledTo = linked
  tr.tabIndex = -1
  tr.scrollIntoView({ block: 'center' })
  tr.focus({ preventScroll: true })
}

async function acknowledge(row) {
  const note = await inputDialog({ title: 'Acknowledge alarm', label: `What did you find? (${row.what} on ${row.camera})`, placeholder: 'e.g. checked the area — all clear', multiline: true, action: 'Done' })
  if (note === null) return
  const res = await fetch(`/api/alarms/${row.id}/ack`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note }) })
  const body = await jsonOf(res)
  if (res.ok) loadAlarms()
  else say($('summary'), body.error ?? 'It could not be acknowledged.')
}

async function bookmark(row) {
  const title = await inputDialog({ title: 'Bookmark alarm', label: 'Save this alarm as:', value: `${row.what} — ${row.camera}`, action: 'Bookmark' })
  if (title === null) return
  const res = await fetch(`/api/alarms/${row.id}/bookmark`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) })
  const body = await jsonOf(res)
  say($('summary'), res.ok ? 'Bookmarked. Housekeeping will now leave this footage alone.' : body.error ?? 'It could not be bookmarked.')
}

/** Exporting stays entirely in the exports page; this only hands it the times to open on. */
async function exportClip(row) {
  const res = await fetch(`/api/alarms/${row.id}/clip`)
  const body = await jsonOf(res)
  if (!res.ok) return void say($('summary'), body.error ?? 'The clip times could not be read.')
  const c = body.clip
  location.href = `/playback.html?nvr=${encodeURIComponent(row.nvr)}&ch=${row.ch}&t=${c.startMs}&markIn=${c.startMs}&markOut=${c.endMs}&export=1`
}

/** The honest footnote: what this page can see, and what it cannot. */
function paintSources(sources) {
  const box = $('sources')
  box.replaceChildren()
  if (!sources) return
  const section = (title, items, render) => {
    const h = document.createElement('h3')
    h.textContent = title
    const ul = document.createElement('ul')
    for (const i of items) {
      const li = document.createElement('li')
      li.textContent = render(i)
      ul.append(li)
    }
    box.append(h, ul)
  }
  section('Reported', sources.confirmed, (c) => `${c.what} — from ${c.how}`)
  section('Not available', sources.notAvailable, (n) => `${n.what} — ${n.why}. To find out whether it can be: ${n.toConfirm}`)
}

// ---- the rules ------------------------------------------------------------------------------------

async function loadRules() {
  const res = await fetch('/api/alarms/rules', { headers: { accept: 'application/json' } })
  const body = await jsonOf(res)
  if (!res.ok) return
  admin = body.admin === true
  $('ruleForm').hidden = !admin
  const ul = $('rules')
  ul.replaceChildren()
  if (!body.rules.length) {
    const li = document.createElement('li')
    li.textContent = 'No rules yet. Without one, events are still recorded and listed here; they are just never urgent and nobody is messaged.'
    ul.append(li)
  }
  for (const rule of body.rules) {
    const li = document.createElement('li')
    const text = document.createElement('span')
    text.textContent = `${rule.name}: ${ruleSummary(rule)}${rule.enabled ? '' : ' (off)'}${rule.damaged ? ' — this rule could not be read and is doing nothing until it is saved again' : ''}`
    li.append(text)
    if (admin) {
      li.append(button(rule.enabled ? 'Turn off' : 'Turn on', () => patchRule(rule.id, { enabled: !rule.enabled })))
      // rules made before the bell (all of them off) get it here: there is no editing a rule whole
      li.append(button(rule.bell ? 'Stop turning the bell red' : 'Turn the bell red', () => patchRule(rule.id, { bell: !rule.bell })))
      li.append(button('Delete', () => deleteRule(rule.id, rule.name)))
    }
    ul.append(li)
  }
}

async function patchRule(id, fields) {
  await fetch(`/api/alarms/rules/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields) })
  loadRules()
}
async function deleteRule(id, name) {
  if (!confirm(`Delete the rule “${name}”? Alarms already filed under it keep the urgency it gave them.`)) return
  await fetch(`/api/alarms/rules/${id}`, { method: 'DELETE' })
  loadRules()
}

async function addRule(e) {
  e.preventDefault()
  const f = e.target.elements
  const days = f.days.value.split(',').map((d) => d.trim()).filter(Boolean).map(Number).filter((d) => Number.isInteger(d))
  const schedule = f.from.value || f.to.value || days.length ? [{ days, from: f.from.value || '00:00', to: f.to.value || '00:00' }] : []
  const body = {
    name: f.name.value.trim(),
    cameras: [...f.cameras.selectedOptions].map((o) => o.value),
    types: [...f.types.selectedOptions].map((o) => o.value),
    schedule,
    priority: f.priority.value,
    notify: f.notify.checked,
    bell: f.bell.checked,
    minGapS: Number(f.minGapS.value) || 0
  }
  const res = await fetch('/api/alarms/rules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const answer = await jsonOf(res)
  say($('ruleError'), res.ok ? '' : answer.error ?? 'The rule could not be saved.')
  if (res.ok) {
    e.target.reset()
    loadRules()
  }
}

// ---- setting the page up ----------------------------------------------------------------------------

function fillChoices() {
  // grouped by site, "3 · Main Gate" (camera-choice.js); tuning lists only cameras it can measure
  fillCameraSelect($('filters').elements.camera, cameras.slice(0, 50))
  fillCameraSelect($('ruleForm').elements.cameras, cameras)
  fillCameraSelect($('tuneCamera'), cameras, { onlineOnly: true })
  for (const t of EVENT_KINDS) {
    // An unconfirmed kind is listed, because a rule may be written for the day it works, but it is
    // labelled so nobody sits waiting for alarms that cannot arrive yet.
    const label = t.confirmed ? labelOf(t.type) : `${labelOf(t.type)} (not available yet)`
    $('filters').elements.type.append(new Option(label, t.type))
    $('ruleForm').elements.types.append(new Option(label, t.type))
  }
  for (const p of PRIORITIES) {
    $('filters').elements.priority.append(new Option(p, p))
    $('ruleForm').elements.priority.append(new Option(p, p))
  }
  $('ruleForm').elements.priority.value = 'medium'
}

async function start() {
  const [roster] = await Promise.all([fetch('/api/cameras', { headers: { accept: 'application/json' } }).then(jsonOf).catch(() => []), preferencesReady])
  cameras = roster
  if (!Array.isArray(cameras)) cameras = cameras.cameras ?? []
  fillChoices()
  const f = $('filters').elements
  // the filters and the site last chosen come with the account: not read before they are known
  // (user-settings.js; asked for while the cameras above were, so this seldom waits at all)
  await preferencesReady
  try {
    const saved = JSON.parse(preferenceStorage.getItem('cctv.alarmFilters') || '{}')
    // (a search saved by an older version of this page is ignored: the search starts empty)
    for (const key of SAVED_FILTERS) {
      if (typeof saved[key] !== 'string') continue
      if (f[key].tagName !== 'SELECT' || [...f[key].options].some((o) => o.value === saved[key])) f[key].value = saved[key]
    }
  } catch {}
  const savedSite = workspaceSite()
  f.site.value = cameras.some((c) => c.site === savedSite) ? savedSite : ''
  // The red bell's link (alert-banner.js) is /alarms.html?acked=false&from=<oldest>: what still needs
  // review, from the day of the oldest alarm ringing it. Asked for in the address, it wins over the
  // filters saved last time, and the narrowing ones are let go, so every alarm that turned the bell red
  // is in the list to be acknowledged.
  const asked = bellFilters(location.search)
  if (asked) {
    for (const key of ['type', 'priority', 'text', 'from', 'to']) f[key].value = ''
    f.acked.value = asked.acked
    f.from.value = asked.from
    f.site.value = ''
    // a rule may turn the bell red for motion: those alarms must be in the list too
    f.motion.checked = true
  }
  f.camera.replaceChildren(new Option('Any camera', ''))
  fillCameraSelect(f.camera, cameras.filter((c) => !f.site.value || c.site === f.site.value).slice(0, 50))
  alarmBrowser = mountCameraBrowser({ host: $('filters'), cameras: () => cameras, selectedSite: () => f.site.value,
    onSite: (site) => { f.site.value = site; f.camera.replaceChildren(new Option('Any camera', '')); fillCameraSelect(f.camera, cameras.filter((c) => !site || c.site === site).slice(0, 50)); applyAlarmFilters() },
    onCamera: (cam) => { f.site.value = cam.site; const key = `${cam.nvr}/${cam.ch}`; if (![...f.camera.options].some((o) => o.value === key)) f.camera.append(new Option(`${cam.ch + 1} · ${cam.name}`, key)); f.camera.value = key; applyAlarmFilters() }
  })
  $('refreshAlarms').addEventListener('click', () => loadAlarms())
  f.people.addEventListener('change', () => applyAlarmFilters())
  f.objects.addEventListener('change', () => applyAlarmFilters())
  f.rules.addEventListener('change', () => applyAlarmFilters())
  f.motion.addEventListener('change', () => applyAlarmFilters())
  // the rest of the row, and More filters, apply as they change (a search on Enter or leaving the box)
  for (const key of ['acked', 'camera', 'type', 'priority']) f[key].addEventListener('change', () => applyAlarmFilters())
  // The dates: typed digit by digit, a date field reports a "change" at every step that makes a
  // valid date (a year typed out fired four reloads, and a warning could pop up halfway). So a date
  // applies when the field is left or Enter is pressed; a date picked from the calendar while the
  // field does not have the keyboard still applies at once.
  for (const key of ['from', 'to']) {
    f[key].addEventListener('change', () => { if (document.activeElement !== f[key]) applyAlarmFilters() })
    // (not while the dates are back to front: the warning would pull the keyboard back on every leave)
    f[key].addEventListener('blur', () => { if (!(f.from.value && f.to.value && f.from.value > f.to.value)) applyAlarmFilters() })
    f[key].addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyAlarmFilters() } })
  }
  f.text.addEventListener('change', () => applyAlarmFilters())
  // the search box's own clear (×) and Enter, which some browsers report only as "search"
  f.text.addEventListener('search', () => applyAlarmFilters())
  $('resetAlarmFilters').addEventListener('click', () => { $('filters').reset(); f.site.value = ''; f.camera.replaceChildren(new Option('Any camera', '')); fillCameraSelect(f.camera, cameras.slice(0, 50)); alarmBrowser.refresh(); applyAlarmFilters({ force: true }) })
  for (const [id, step] of [['alarmPrev', -1], ['alarmNext', 1]]) $(id).addEventListener('click', () => { alarmPage += step; paintAlarmPage() })
  // (Enter in a field can still submit the form: it applies, rather than reloading the page)
  $('filters').addEventListener('submit', (e) => {
    e.preventDefault()
    applyAlarmFilters()
  })
  wireFilterSheet()
  $('ruleForm').addEventListener('submit', addRule)

  tuner = new MotionTuner({
    tile: $('tuneTile'),
    overlay: $('tuneOverlay'),
    meter: $('tuneMeter'),
    note: $('tuneNote'),
    form: $('tuneForm'),
    error: $('tuneError'),
    result: $('tuneResult')
  })
  $('tuneCamera').addEventListener('change', (e) => {
    const [nvr, ch] = e.target.value.split('/')
    // nothing but the picker until a camera is chosen (it was a black box under it)
    $('tuneEmpty').hidden = Boolean(nvr)
    $('tuneBody').hidden = !nvr
    tuner.show(nvr ? { nvr, ch: Number(ch), name: e.target.selectedOptions[0].textContent } : null)
  })
  // Nothing is streamed until somebody picks a camera: this page is opened far more often than the
  // tuning panel is used, and an NVR at its limit should not pay for a panel nobody is looking at.
  $('tuneCamera').prepend(new Option('choose a camera…', ''))
  $('tuneCamera').value = ''

  // A link to one alarm must find it even if someone has acknowledged it already: the list opens on
  // "still needing a look", which would hide exactly the alarm the link was sent about.
  // The same for motion: the alarm the link is about may be a motion one.
  if (linked !== null) { f.acked.value = ''; f.site.value = ''; f.motion.checked = true; alarmBrowser.refresh() }
  appliedFilters = filterParams()
  await Promise.all([loadAlarms(), loadRules()])
  setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]') && !$('list').querySelector('details[open]') && !$('list').contains(document.activeElement)) loadAlarms() }, REFRESH_MS)
}

$('logout')?.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {})
  location.href = '/login.html'
})

// A second alert tapped while this page is open changes only what follows the #: follow it here,
// without a reload. A tab link (#rules) is not an alarm and just clears the mark.
addEventListener('hashchange', () => {
  const id = eventFromHash(location.hash)
  if (id === linked) return
  linked = id
  scrolledTo = null
  for (const tr of $('list').querySelectorAll('tr.al-target')) tr.classList.remove('al-target')
  if (id === null) return
  $('filters').elements.acked.value = ''
  $('filters').elements.site.value = ''
  $('filters').elements.motion.checked = true
  alarmBrowser?.refresh()
  appliedFilters = filterParams()
  loadAlarms()
})

start()
