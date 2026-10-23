import { searchCameras } from './grid-view.js'
import { preferenceStorage } from './user-settings.js'

const CONTEXT_KEY = 'cctv.workspaceSite'
const FAVORITES_KEY = 'cctv.favoriteSites'
const RECENTS_KEY = 'cctv.recentSites'
const read = (key, fallback) => { try { return JSON.parse(preferenceStorage.getItem(key)) ?? fallback } catch { return fallback } }
const write = (key, value) => { try { preferenceStorage.setItem(key, JSON.stringify(value)) } catch {} }
export const workspaceSite = () => read(CONTEXT_KEY, null)
export function rememberSite(site) {
  write(CONTEXT_KEY, site || '')
  if (site) write(RECENTS_KEY, [site, ...read(RECENTS_KEY, []).filter((s) => s !== site)].slice(0, 8))
}

export function browserResults(cameras, { mode = 'sites', site = '', query = '', favorites = [], recents = [] } = {}) {
  if (mode === 'cameras') return searchCameras(cameras.filter((c) => !site || c.site === site), query)
  const counts = new Map()
  for (const c of cameras) if (c.site) counts.set(c.site, (counts.get(c.site) || 0) + 1)
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return [...counts].map(([name, count]) => ({ name, count })).filter((s) => words.every((w) => s.name.toLowerCase().includes(w)))
    .sort((a, b) => Number(favorites.includes(b.name)) - Number(favorites.includes(a.name)) ||
      (recents.includes(a.name) ? recents.indexOf(a.name) : 99) - (recents.includes(b.name) ? recents.indexOf(b.name) : 99) || a.name.localeCompare(b.name))
}

/** What Live's grid can be narrowed to, from /api/sites: every site, each site, and each recorder of a
 *  site that has more than one (value "@nvr:<id>"), so a big site can be watched one recorder at a
 *  time. Browse is Live's one site picker, so it offers what the old Site list's indented rows did. */
export function siteScopes(sites) {
  const bySite = new Map()
  for (const s of sites) { const k = s.site || ''; (bySite.get(k) ?? bySite.set(k, []).get(k)).push(s) }
  const out = [{ value: '', label: 'All sites', site: '' }]
  for (const name of [...bySite.keys()].sort((a, b) => a.localeCompare(b))) {
    out.push({ value: name, label: name, site: name })
    const list = bySite.get(name)
    if (list.length <= 1) continue
    for (const n of list.slice().sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))) {
      out.push({ value: `@nvr:${n.id}`, label: `${name} · ${n.name}`, site: name, nvr: n.id, name: n.name })
    }
  }
  return out
}

// Shared native dialog: bounded rows, native keyboard controls and automatic modal focus trapping.
// Optional, for Live: recorders(site) lists the recorders of a site with several ({ value, name }),
// onRecorder(value) shows just one of them, and selectedLabel() names what is shown on the button
// (a site, or a site and one of its recorders).
export function mountCameraBrowser({ host, cameras, selectedSite, onSite, onCamera, recorders, onRecorder, selectedLabel }) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'camera-browser-launch'
  button.setAttribute('aria-haspopup', 'dialog')
  host.prepend(button)
  const dialog = document.createElement('dialog')
  dialog.className = 'camera-browser'
  dialog.setAttribute('aria-label', 'Sites and cameras')
  dialog.innerHTML = `<form method="dialog" class="camera-browser-head"><h2>Sites and cameras</h2><button aria-label="Close sites and cameras">Close</button></form>
    <div class="camera-browser-tabs" role="group" aria-label="Browse"><button type="button" data-mode="sites" aria-pressed="true">Sites</button><button type="button" data-mode="cameras" aria-pressed="false">Cameras</button></div>
    <label class="camera-browser-search">Search<input type="search" placeholder="Find a site" autocomplete="off" /></label>
    <div class="camera-browser-scope"></div><p class="camera-browser-count" role="status"></p><ul class="camera-browser-results"></ul>
    <div class="camera-browser-pages"><button type="button" data-page="-1">Previous</button><button type="button" data-page="1">Next</button></div>`
  document.body.append(dialog)
  const search = dialog.querySelector('input')
  const list = dialog.querySelector('ul')
  const count = dialog.querySelector('.camera-browser-count')
  const scope = dialog.querySelector('.camera-browser-scope')
  let mode = 'sites', page = 0, timer
  const makeButton = (label, action) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label
    b.addEventListener('click', action); return b
  }
  const chooseSite = (name) => { dialog.close(); rememberSite(name); onSite(name); refresh() }
  function render() {
    const favorites = read(FAVORITES_KEY, [])
    const recents = read(RECENTS_KEY, [])
    const site = selectedSite() || ''
    const results = browserResults(cameras(), { mode, site, query: search.value, favorites, recents })
    page = Math.min(page, Math.max(0, Math.ceil(results.length / 50) - 1))
    scope.replaceChildren()
    if (mode === 'sites') scope.append(makeButton('All sites', () => chooseSite('')))
    else {
      scope.textContent = site ? `Cameras in ${site}` : 'Cameras across all sites'
      if (site) scope.append(makeButton('Browse all sites', () => { mode = 'sites'; page = 0; search.value = ''; updateMode(); render() }))
    }
    count.textContent = results.length ? `${page * 50 + 1}–${Math.min(results.length, (page + 1) * 50)} of ${results.length} ${mode}` : 'No matches. Try another name or choose another site.'
    list.replaceChildren()
    for (const item of results.slice(page * 50, (page + 1) * 50)) {
      const li = document.createElement('li')
      if (mode === 'sites') {
        const favorite = favorites.includes(item.name)
        const select = makeButton(item.name, () => chooseSite(item.name))
        select.className = 'camera-browser-choice'
        const meta = document.createElement('small')
        meta.textContent = `${item.count} cameras${favorite ? ' · Favorite' : recents.includes(item.name) ? ' · Recent' : ''}`
        select.append(meta)
        const star = makeButton(favorite ? '★' : '☆', () => {
          write(FAVORITES_KEY, favorite ? favorites.filter((s) => s !== item.name) : [...favorites, item.name]); render()
          const stars = [...list.querySelectorAll('.camera-browser-favorite')]
          stars.find((s) => s.dataset.site === item.name)?.focus()
        })
        star.className = 'camera-browser-favorite'; star.dataset.site = item.name
        star.setAttribute('aria-label', `Favorite ${item.name}`); star.setAttribute('aria-pressed', String(favorite))
        li.append(select, star)
        // a site with several recorders: one row per recorder under it, to watch just that one
        if (recorders && onRecorder) {
          list.append(li)
          for (const r of recorders(item.name)) {
            const sub = document.createElement('li')
            sub.className = 'camera-browser-sub'
            const pick = makeButton(r.name, () => { dialog.close(); onRecorder(r.value); refresh() }) // (onRecorder remembers the site)
            pick.className = 'camera-browser-choice'
            const note = document.createElement('small')
            note.textContent = `Only this recorder of ${item.name}`
            pick.append(note)
            sub.append(pick)
            list.append(sub)
          }
          continue
        }
      } else {
        const select = makeButton(item.name || `Camera ${item.ch + 1}`, () => { dialog.close(); rememberSite(item.site); onCamera(item); refresh() })
        select.className = 'camera-browser-choice'
        const meta = document.createElement('small')
        meta.textContent = `${item.site} · ${item.nvrName} · Channel ${item.ch + 1} · ${item.online ? 'Online' : 'Offline'}`
        select.append(meta); li.append(select)
      }
      list.append(li)
    }
    for (const b of dialog.querySelectorAll('[data-page]')) b.disabled = Number(b.dataset.page) < 0 ? page === 0 : (page + 1) * 50 >= results.length
  }
  function updateMode() {
    for (const b of dialog.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode))
    search.placeholder = mode === 'sites' ? 'Find a site' : 'Camera, recorder or channel'
  }
  function refresh() { button.textContent = `Browse · ${selectedLabel?.() || selectedSite() || 'All sites'}`; if (dialog.open) render() }
  button.addEventListener('click', () => { page = 0; search.value = ''; render(); dialog.showModal(); search.focus() })
  dialog.addEventListener('close', () => button.focus())
  for (const b of dialog.querySelectorAll('[data-mode]')) b.addEventListener('click', () => { mode = b.dataset.mode; page = 0; search.value = ''; updateMode(); render(); search.focus() })
  for (const b of dialog.querySelectorAll('[data-page]')) b.addEventListener('click', () => { page += Number(b.dataset.page); render(); list.scrollTop = 0 })
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { page = 0; render() }, 150) })
  refresh()
  return { refresh }
}
