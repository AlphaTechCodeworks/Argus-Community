// cctv/public/pb-picker.js
// The Playback page's camera picker: a find box that lists matching cameras as you type, and the
// choice of which camera the page opens on. The choosing is plain functions, so the tests can run it
// without a browser (test/pb-picker.test.mjs); mountCameraFinder is the part on the page.
import { searchCameras } from './grid-view.js'

// One per browser: the camera last watched here, so Playback opens where the owner left off.
export const LAST_CAMERA_KEY = 'argus.pb.lastCamera'

const keyOf = (c) => `${c.nvr}/${c.ch}`
/** A camera's key, "nvr/ch": the value the page's camera select holds. */
export const cameraKey = keyOf

/** How a camera reads in the list and in the find box: "3 · Gate", marked when it is offline. */
export const cameraLabel = (c) => `${Number(c.ch) + 1} · ${c.name}${c.online ? '' : ' (offline)'}`

/**
 * The cameras the list shows, grouped under "site · recorder" headings.
 * Nothing typed: the site chosen in Browse (or every site). Something typed: every camera that
 * matches wherever it is, the chosen site's first, because someone typing a name means that camera.
 * Online cameras only, so nothing is offered that cannot play; the camera being watched (keep) stays
 * even when it goes offline, rather than vanishing from under the viewer.
 */
export function cameraChoices(cameras, { site = '', query = '', keep = null } = {}) {
  const usable = (cameras ?? []).filter((c) => c && (c.online || keyOf(c) === keep))
  let found
  if (String(query ?? '').trim()) {
    const hits = searchCameras(usable, query)
    found = site ? [...hits.filter((c) => c.site === site), ...hits.filter((c) => c.site !== site)] : hits
  } else {
    found = usable.filter((c) => !site || c.site === site)
    const current = usable.find((c) => keyOf(c) === keep)
    if (current && !found.includes(current)) found = [current, ...found]
  }
  const groups = new Map()
  for (const c of found) {
    const label = [c.site, c.nvrName ?? c.nvr].filter(Boolean).join(' · ') || 'Cameras'
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push(c)
  }
  return [...groups].map(([label, list]) => ({ label, cameras: list }))
}

/**
 * The camera Playback opens on: the one a link names (?nvr=&ch=), else the one this browser watched
 * last (when it is still there and online), else the first online camera of the site worked in, else
 * the first online camera at all. Null when there are no cameras.
 */
export function startCamera(cameras, { nvr = null, ch = null, last = null, site = null } = {}) {
  const list = (cameras ?? []).filter(Boolean)
  return list.find((c) => nvr !== null && c.nvr === nvr && String(c.ch) === String(ch))
    ?? list.find((c) => c.online && keyOf(c) === last)
    ?? list.find((c) => c.online && site && c.site === site)
    ?? list.find((c) => c.online)
    ?? list[0]
    ?? null
}

/** The last camera watched in this browser, or null. Storage can be blocked (a private window): then null. */
export function readLastCamera(storage) {
  try {
    const v = storage?.getItem(LAST_CAMERA_KEY)
    return typeof v === 'string' && /^[^/{}"]+\/\d+$/.test(v) ? v : null
  } catch {
    return null
  }
}

/** Remembers the camera being watched; quietly does nothing where storage is blocked. */
export function saveLastCamera(storage, key) {
  try { storage?.setItem(LAST_CAMERA_KEY, key) } catch {}
}

/**
 * The find box on the page. Shows the camera being watched; clicking it lists the cameras, typing
 * narrows the list, and Up/Down, Enter and Escape work as in any list of choices. The list comes from
 * choices(query), which reads the camera list already loaded: nothing is asked of the server per key.
 * current() is the camera being watched (for the words in the box); onPick(cam) switches to a camera.
 */
export function mountCameraFinder({ input, list, choices, current, onPick }) {
  let options = [] // [{ cam, el }] in the order shown
  let active = -1
  let timer = 0

  const showCurrent = () => {
    const cam = current()
    input.value = cam ? cameraLabel(cam) : ''
    input.title = cam ? `${cameraLabel(cam)} · ${[cam.site, cam.nvrName].filter(Boolean).join(' · ')}` : ''
  }
  const isOpen = () => !list.hidden

  function setActive(i) {
    if (options[active]) options[active].el.setAttribute('aria-selected', 'false')
    active = options.length ? Math.max(0, Math.min(options.length - 1, i)) : -1
    const opt = options[active]
    if (opt) {
      opt.el.setAttribute('aria-selected', 'true')
      input.setAttribute('aria-activedescendant', opt.el.id)
      opt.el.scrollIntoView({ block: 'nearest' })
    } else {
      input.removeAttribute('aria-activedescendant')
    }
  }

  function render(query) {
    const groups = choices(query)
    const watching = current()
    options = []
    active = -1
    const items = []
    for (const g of groups) {
      const head = document.createElement('li')
      head.className = 'pb-find-group'
      head.setAttribute('role', 'presentation')
      head.textContent = g.label
      items.push(head)
      for (const cam of g.cameras) {
        const li = document.createElement('li')
        li.id = `pbCam${options.length}`
        li.className = 'pb-find-option'
        li.setAttribute('role', 'option')
        li.setAttribute('aria-selected', 'false')
        li.textContent = cameraLabel(cam)
        if (watching && keyOf(cam) === keyOf(watching)) li.classList.add('is-current')
        li.addEventListener('click', () => pick(cam))
        options.push({ cam, el: li })
        items.push(li)
      }
    }
    if (!options.length) {
      const none = document.createElement('li')
      none.className = 'pb-find-none'
      none.setAttribute('role', 'presentation')
      none.textContent = 'No camera matches that. Try another name, or Browse.'
      items.push(none)
    }
    list.replaceChildren(...items)
    // typing: the best match is ready for Enter; just opened: the camera being watched
    const here = options.findIndex((o) => o.el.classList.contains('is-current'))
    if (String(query ?? '').trim()) setActive(0)
    else if (here >= 0) setActive(here)
    else input.removeAttribute('aria-activedescendant')
  }

  function open(query = '') {
    render(query)
    list.hidden = false
    input.setAttribute('aria-expanded', 'true')
  }
  function close() {
    clearTimeout(timer)
    timer = 0
    list.hidden = true
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
  }
  function pick(cam) {
    close()
    onPick(cam)
    showCurrent()
  }

  // clicking the box selects its words, so typing replaces them; the whole list opens meanwhile
  input.addEventListener('focus', () => { input.select(); open('') })
  // (a mouse click ends by placing the caret, which undoes the select above: select again)
  input.addEventListener('click', () => {
    if (!isOpen()) open('')
    if (current() && input.value === cameraLabel(current())) input.select()
  })
  input.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(() => { timer = 0; list.hidden = false; input.setAttribute('aria-expanded', 'true'); render(input.value) }, 80)
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!isOpen()) return open(input.value === (current() ? cameraLabel(current()) : '') ? '' : input.value)
      setActive(active + (e.key === 'ArrowDown' ? 1 : -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // a search still waiting on its pause is run first, so Enter takes what was typed
      if (timer) { clearTimeout(timer); timer = 0; render(input.value) }
      const opt = options[active]
      if (isOpen() && opt) pick(opt.cam)
    } else if (e.key === 'Escape') {
      if (isOpen()) { e.preventDefault(); e.stopPropagation(); close(); showCurrent(); input.select() }
    } else if (e.key === 'Tab') {
      close()
    }
  })
  // a press on the list must not take the focus from the box first (that would close the list)
  list.addEventListener('pointerdown', (e) => e.preventDefault())
  input.addEventListener('blur', () => { close(); showCurrent() })

  showCurrent()
  return {
    /** The camera changed by other means (Browse, a bookmark, a link to another camera). */
    refresh() {
      if (document.activeElement === input && isOpen()) render(input.value === (current() ? cameraLabel(current()) : '') ? '' : input.value)
      else showCurrent()
    }
  }
}
