// A small "…" menu: one button that opens a short list of actions, for rows that have more actions
// than fit beside them (Users & access). The actions are ordinary <button>s made
// by the page with their own click handlers; this only gathers them behind one button, so moving
// an action into a menu never changes what it does.
//
// It behaves the way a menu does everywhere else, so a keyboard or screen-reader user meets nothing
// new: the button says it opens a menu and whether it is open (aria-haspopup, aria-expanded); Enter,
// Space or the down arrow opens it on the first action, the up arrow on the last; the arrows, Home
// and End move between actions (skipping one that cannot be used now); Escape or a click anywhere
// else closes it and puts the keyboard back on the button; Tab closes it and moves on as usual.

let made = 0

// Where the arrows go next, skipping actions that are switched off. Kept apart from the page so it
// can be tested on its own. Returns -1 when nothing can be chosen.
export function menuNext(index, key, enabled) {
  const n = enabled.length
  if (!enabled.some(Boolean)) return -1
  const step = (from, dir) => { let i = from; for (let k = 0; k < n; k++) { i = (i + dir + n) % n; if (enabled[i]) return i } return -1 }
  if (key === 'Home') return step(-1, 1)
  if (key === 'End') return step(n, -1)
  if (key === 'ArrowDown') return step(index, 1)
  if (key === 'ArrowUp') return step(index < 0 ? n : index, -1)
  return index
}

// items: the action buttons, in order. label: the button's words for a screen reader
// ("Actions for mike"). Returns the wrapper to put on the row.
export function menuButton(items, { label = 'More actions' } = {}) {
  const wrap = document.createElement('div')
  wrap.className = 'menu-wrap'
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'btn-ghost btn-icon menu-button'
  button.textContent = '…'
  button.setAttribute('aria-label', label)
  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute('aria-expanded', 'false')
  const list = document.createElement('div')
  list.className = 'menu-list'
  list.id = `menu-${++made}`
  list.setAttribute('role', 'menu')
  list.setAttribute('aria-label', label)
  list.hidden = true
  button.setAttribute('aria-controls', list.id)
  for (const item of items) {
    item.setAttribute('role', 'menuitem')
    // one tab stop for the whole menu: the arrows move inside it
    item.tabIndex = -1
    list.append(item)
  }
  wrap.append(button, list)

  const isOpen = () => button.getAttribute('aria-expanded') === 'true'
  const enabled = () => items.map((b) => !b.disabled)
  const focusAt = (i) => { if (i >= 0) items[i].focus() }
  const current = () => items.indexOf(document.activeElement)

  // a click or tap outside the menu closes it, without taking the keyboard anywhere
  const outside = (e) => { if (!wrap.contains(e.target)) close(false) }
  function open(at) {
    if (!isOpen()) {
      list.hidden = false
      button.setAttribute('aria-expanded', 'true')
      document.addEventListener('pointerdown', outside, true)
      // the last row's menu opens below the fold on a phone: bring all of it into sight
      list.scrollIntoView?.({ block: 'nearest' })
    }
    focusAt(menuNext(-1, at === 'last' ? 'End' : 'Home', enabled()))
  }
  function close(refocus = true) {
    if (!isOpen()) return
    list.hidden = true
    button.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', outside, true)
    if (refocus) button.focus()
  }

  button.addEventListener('click', () => { if (isOpen()) close(); else open('first') })
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); open('first') }
    else if (e.key === 'ArrowUp') { e.preventDefault(); open('last') }
    else if (e.key === 'Escape' && isOpen()) { e.preventDefault(); e.stopPropagation(); close() }
    // Tab off the "…" button while it is open: the keyboard moves on, so the menu shuts behind it
    else if (e.key === 'Tab') close(false)
  })
  list.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
    if (e.key === 'Tab') { close(false); return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); focusAt(menuNext(current(), e.key, enabled())) }
  })
  // Capture: the menu closes, and the keyboard is back on its button, before the action's own
  // handler runs. A dialog the action opens then hands the keyboard back to the "…" button when it
  // closes, not to an action hidden in a closed menu.
  list.addEventListener('click', (e) => { if (items.some((b) => b === e.target || b.contains?.(e.target))) close() }, true)
  return wrap
}
