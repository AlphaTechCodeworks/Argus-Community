// Settings, one subject at a time: the page's sections are grouped by subject (each section says
// which with data-tab) and only the chosen subject's are shown. The subject is in the address
// (settings.html#storage), so a link or a reload lands on it. Nothing about the forms themselves
// changes: every section still lives in the page and settings.js still fills them all.
//
// Nine subjects were too many for a row of tabs: on a phone the later ones sat off the right-hand
// edge, so a link to #server opened a page whose own tab could not be seen. On a laptop (900 px and
// wider) they are a list down the left, all in view; narrower, a "Section" dropdown that always
// shows the one you are in. Both are built here and style.css shows the one that fits.
//
// The sections themselves (TABS, tabFor) are in settings-sections.js, data only, so other pages can
// read them without running this file, which lays out whatever page loads it.
import { TABS, tabFor } from './settings-sections.js'
export { TABS, tabFor }

if (typeof document !== 'undefined') {
  const main = document.querySelector('.st-main')
  const sections = [...document.querySelectorAll('.se-section[data-tab]')]

  // the list down the left (laptop)
  const menu = document.createElement('nav')
  menu.className = 'se-menu'
  menu.setAttribute('aria-label', 'Settings')
  menu.append(...TABS.map((t) => {
    const a = document.createElement('a')
    a.href = `#${t.id}`
    a.textContent = t.label
    a.dataset.tab = t.id
    return a
  }))

  // the dropdown (phone): picking a section changes the address, as a click in the list does, so
  // Back returns to the section before and everything listening for the address hears it
  const pick = document.createElement('select')
  pick.id = 'se-pick'
  pick.append(...TABS.map((t) => Object.assign(document.createElement('option'), { value: t.id, textContent: t.label })))
  pick.addEventListener('change', () => { location.hash = `#${pick.value}` })
  const pickRow = document.createElement('label')
  pickRow.className = 'se-pick'
  pickRow.append('Section', pick)

  const help = document.createElement('p')
  help.className = 'se-tab-help'

  // The sections are moved, not copied: their forms, what is typed in them and every handler on
  // them come along untouched.
  const body = document.createElement('div')
  body.className = 'se-body'
  body.append(pickRow, help, ...sections)
  const layout = document.createElement('div')
  layout.className = 'se-layout'
  layout.append(menu, body)
  main.querySelector('#notice')?.after(layout)

  function show(hash) {
    const tab = tabFor(hash)
    // "page", not an empty value: an empty aria-current tells a screen reader nothing
    for (const a of menu.children) { if (a.dataset.tab === tab.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current') }
    pick.value = tab.id
    for (const s of sections) s.classList.toggle('se-off', s.dataset.tab !== tab.id)
    help.textContent = tab.help
  }
  addEventListener('hashchange', () => show(location.hash))
  show(location.hash)
}
