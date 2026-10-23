// Ctrl+K: one box that finds any camera, site, page or settings section, on every page.
//
// With a hundred cameras over a dozen sites, getting to one meant knowing which page holds it, then
// which site, then scrolling. Here you type a few letters of anything you remember ("gate harbour")
// and press Enter. shell.js loads this module and draws the search buttons (data-open-search); the
// rest is here. The rules (what is listed for whom, how typing narrows it, where each result goes,
// when the shortcut may fire) are pure and tested with plain node in test/command-palette.test.mjs.
//
// Nothing here grants anything: it lists only what the person could already reach (navFor for the
// pages, the server's own /api/cameras answer for the cameras), and every page checks rights again.
import { currentId, navFor } from './nav-model.js'
import { liveHref } from './pb-bar.js'
import { TABS } from './settings-sections.js' // (data only: settings-tabs.js lays out any page it runs on)
import { icon } from './icons.js'

/** The result groups, always in this order. */
export const GROUPS = Object.freeze([
  { id: 'camera', label: 'Cameras' },
  { id: 'site', label: 'Sites' },
  { id: 'page', label: 'Pages' },
  { id: 'setting', label: 'Settings' }
])

// More than this many in one group and the rest are counted, not drawn: "Cam" over 300 cameras
// would otherwise bury the sites and pages under it. Typing more narrows it.
const PER_GROUP = 8

/** Where a result goes: a camera full-size on Live, a site's cameras on Live, or a page's address. */
export function itemHref(item) {
  if (item.kind === 'camera') return liveHref({ nvr: item.nvr, ch: item.ch })
  if (item.kind === 'site') return liveHref({ site: item.label })
  return item.href
}

/**
 * Everything this person can be taken to. `me` is /api/me's answer (admin, watchOnly); anyone not
 * positively an admin is treated as a viewer, as the sidebar does. `cameras` is /api/cameras.
 */
export function paletteItems({ me = {}, cameras = [] } = {}) {
  const items = []
  for (const c of cameras ?? []) {
    const label = c.name || `Camera ${Number(c.ch) + 1}`
    items.push({ kind: 'camera', label, sub: [c.site, c.nvrName].filter(Boolean).join(' · '), nvr: c.nvr, ch: c.ch, words: [label, c.site, c.nvrName] })
  }
  for (const site of [...new Set((cameras ?? []).map((c) => c.site).filter(Boolean))].sort((a, b) => a.localeCompare(b))) {
    const n = cameras.filter((c) => c.site === site).length
    items.push({ kind: 'site', label: site, sub: `${n} ${n === 1 ? 'camera' : 'cameras'}`, words: [site] })
  }
  const pages = navFor({ admin: me?.admin === true, watchOnly: me?.watchOnly === true }).flatMap((g) => g.items)
  for (const p of pages) items.push({ kind: 'page', label: p.label, sub: '', href: p.href, icon: p.icon, words: [p.label] })
  // the Settings page's sections (the same list its own side menu is built from), for admins only;
  // Storage is already a page of its own in the menu, so it is not listed twice
  if (me?.admin === true) {
    for (const t of TABS) {
      const href = `/settings.html#${t.id}`
      if (items.some((i) => i.href === href)) continue
      items.push({ kind: 'setting', label: t.label, sub: t.help, href, words: [t.label, 'settings', t.help] })
    }
  }
  for (const i of items) i.href = itemHref(i)
  return items
}

/** Every typed word is somewhere in the result, in any order and any case. Nothing typed: all. */
export function matches(item, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const text = (item.words ?? [item.label, item.sub]).filter(Boolean).join(' ').toLowerCase()
  return words.every((w) => text.includes(w))
}

/**
 * The results to draw: `[{ id, label, items, more }]` in GROUPS order, empty groups left out, each cut
 * to PER_GROUP with `more` counting the rest. With nothing typed the cameras are left out: a list of
 * every camera is not a useful start, the pages and sites are.
 */
export function groupResults(items, query, { perGroup = PER_GROUP } = {}) {
  const typed = String(query ?? '').trim() !== ''
  const out = []
  for (const g of GROUPS) {
    if (!typed && g.id === 'camera') continue
    const hits = items.filter((i) => i.kind === g.id && matches(i, query))
    if (hits.length) out.push({ id: g.id, label: g.label, items: hits.slice(0, perGroup), more: Math.max(0, hits.length - perGroup) })
  }
  return out
}

// someone typing: these keys are theirs, not ours
const FIELD = 'input, textarea, select, [contenteditable]'

/**
 * Whether a keydown should open the palette: Ctrl+K or Cmd+K anywhere, "/" off the Live page (on
 * Live "/" already opens Live's own find box, viewer.js). Never while someone is typing in a field,
 * never over another dialog (that one has the keyboard), and never when the page already used the key.
 */
export function shortcutOpens(e, { onLive = false } = {}) {
  if (e.defaultPrevented || e.altKey) return false
  const t = e.target
  if (typeof t?.closest === 'function' && (t.closest(FIELD) || t.closest('dialog'))) return false
  if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') return true
  return e.key === '/' && !e.ctrlKey && !e.metaKey && !onLive
}

// ---- the dialog (browser only) -------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const GROUP_ICON = { camera: 'camera', site: 'site', setting: 'cog' }

function mountPalette() {
  const dialog = document.createElement('dialog')
  dialog.className = 'cmdk'
  dialog.setAttribute('aria-label', 'Search')
  dialog.innerHTML = `
    <div class="cmdk-box">${icon('search')}<input type="search" class="cmdk-input" role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Find a camera, site, page or setting" aria-label="Find a camera, site, page or setting" /><button type="button" class="cmdk-close" aria-label="Close search">Esc</button></div>
    <div class="cmdk-list" id="cmdk-list" role="listbox" aria-label="Results"></div>
    <p class="cmdk-note" role="status"></p>`
  document.body.append(dialog)
  const input = dialog.querySelector('input')
  const list = dialog.querySelector('.cmdk-list')
  const note = dialog.querySelector('.cmdk-note')

  // Who this is and what they can see: asked once, on the first open, and kept for the page's life.
  // Never per keystroke: typing filters what is already here. A failed load is asked again next open.
  let me = (() => { try { return JSON.parse(sessionStorage.getItem('cctv.me') ?? '{}') ?? {} } catch { return {} } })()
  let cameras = []
  let loading = null
  let loaded = false
  let loadFailed = false
  const getJson = (url) => fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' } }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
  function load() {
    loading ??= Promise.allSettled([getJson('/api/me'), getJson('/api/cameras')]).then(([m, c]) => {
      if (m.status === 'fulfilled' && m.value) me = m.value
      if (c.status === 'fulfilled' && Array.isArray(c.value)) { cameras = c.value; loaded = true; loadFailed = false } else { loadFailed = true; loading = null }
      if (dialog.open) render()
    })
    return loading
  }

  let shown = [] // the results drawn, in order, for the arrow keys
  let active = 0
  let opener = null

  function render() {
    const groups = groupResults(paletteItems({ me, cameras }), input.value)
    shown = groups.flatMap((g) => g.items)
    active = Math.min(active, Math.max(0, shown.length - 1))
    let n = 0
    list.innerHTML = groups.map((g) => `<div class="cmdk-group" role="group" aria-labelledby="cmdk-g-${g.id}"><div class="cmdk-group-label" id="cmdk-g-${g.id}" role="presentation">${esc(g.label)}</div>${
      g.items.map((i) => { const k = n++; return `<div class="cmdk-item" role="option" id="cmdk-o-${k}" data-k="${k}" aria-selected="${k === active}">${icon(i.icon ?? GROUP_ICON[i.kind])}<span class="cmdk-label">${esc(i.label)}${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</span></div>` }).join('')
    }${g.more ? `<div class="cmdk-more" role="presentation">${g.more} more — keep typing to narrow it down</div>` : ''}</div>`).join('')
    if (shown.length) input.setAttribute('aria-activedescendant', `cmdk-o-${active}`)
    else input.removeAttribute('aria-activedescendant')
    const typed = input.value.trim() !== ''
    note.textContent = typed && shown.length === 0 ? 'Nothing matches. Try fewer letters, or another name.'
      : loadFailed ? 'The camera list could not be loaded, so only pages are listed. Close and open again to retry.'
      : !loaded && typed ? 'Loading cameras…' : ''
  }

  function move(to) {
    if (!shown.length) return
    active = (to + shown.length) % shown.length
    for (const o of list.querySelectorAll('[role="option"]')) o.setAttribute('aria-selected', String(Number(o.dataset.k) === active))
    input.setAttribute('aria-activedescendant', `cmdk-o-${active}`)
    list.querySelector(`#cmdk-o-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }

  function go(k) {
    const item = shown[k]
    if (!item) return
    dialog.close()
    location.assign(item.href) // (a settings section on the Settings page only changes the hash)
  }

  function open() {
    if (dialog.open) { input.select(); return }
    opener = document.activeElement
    input.value = ''
    active = 0
    load()
    render()
    dialog.showModal()
    input.focus()
  }

  input.addEventListener('input', () => { active = 0; render() })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(active + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(active - 1) }
    else if (e.key === 'Enter') { e.preventDefault(); go(active) }
    // Escape closes at once: a search box's own Escape would only empty the box first, so it took
    // two presses (the close handler below returns the focus)
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dialog.close() }
  })
  // Every key pressed in the search is the search's own. Let through, it reaches the page under it
  // once the dialog has closed: Escape then also closed Live's full-size camera or a filter sheet,
  // and Space on the Esc button paused Playback.
  dialog.addEventListener('keydown', (e) => e.stopPropagation())
  list.addEventListener('click', (e) => { const o = e.target.closest('[role="option"]'); if (o) go(Number(o.dataset.k)) })
  dialog.querySelector('.cmdk-close').addEventListener('click', () => dialog.close())
  // a click on the dim backdrop (outside the box) closes it, as on a phone you expect
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close() })
  dialog.addEventListener('close', () => {
    // back to where the person was; if the shell redrew that button meanwhile, to its new copy
    const back = opener?.isConnected ? opener : document.querySelector('[data-open-search]')
    back?.focus?.()
    opener = null
  })

  document.addEventListener('keydown', (e) => {
    if (dialog.open || !shortcutOpens(e, { onLive: currentId(location.pathname) === 'live' })) return
    e.preventDefault() // (Ctrl+K would otherwise move the focus to the browser's own search bar)
    open()
  })
  // the shell's search buttons (sidebar and the phone's top bar): one listener, so a redraw of the
  // shell needs no re-binding
  document.addEventListener('click', (e) => { if (e.target.closest?.('[data-open-search]')) open() })
}

if (typeof document !== 'undefined') mountPalette()
