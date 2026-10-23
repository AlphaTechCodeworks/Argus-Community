// Users & access as one card per person (audit.js userCard/placeText, audit.html, css/users.css)
// and the "…" menu that holds each person's actions (menu-button.js). The menu is driven through a
// tiny stand-in for the page's elements, enough to press keys and click: no browser needed.
//   node cctv/test/users-cards.test.mjs
import { readFileSync } from 'node:fs'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// ---- what each card says ----
const { userCard, placeText } = await import('../public/audit.js')
const ad = userCard({ name: 'jsmith', displayName: 'Michael P', role: 'admin', source: 'ad', sessions: [] })
check('a Windows account: name, full name, role badge Admin, "from Windows group" note', ad.name === 'jsmith' && ad.fullName === 'Michael P' && ad.role === 'Admin' && ad.roleNote === 'from Windows group', JSON.stringify(ad))
check('not connected reads "Not connected"', ad.places.join() === 'Not connected' && ad.connected === false)
check('its menu: Edit access, Set up a phone, Sign out user, Forget (no password to reset)', ad.actions.join('|') === 'Edit access|Set up a phone|Sign out user|Forget', ad.actions.join('|'))
const local = userCard({ name: 'jo', role: 'viewer', sessions: [{ connection: 'LAN', address: '192.168.2.101' }, { connection: 'Web', address: '81.2.3.4' }] })
check('a local account: Viewer, no Windows note, no full name', local.role === 'Viewer' && local.roleNote === '' && local.fullName === '' && local.fromAd === false)
check('where they are: on the network, over the internet', local.places.join('|') === 'On the network · 192.168.2.101|Over the internet · 81.2.3.4' && local.connected, local.places.join('|'))
check('its menu keeps Reset password and Remove', local.actions.join('|') === 'Edit access|Set up a phone|Reset password|Sign out user|Remove')
check('Watch only reads as words', userCard({ name: 'w', role: 'watch' }).role === 'Watch only')
check('a local account\'s display name is not shown as a full name (only AD sends one)', userCard({ name: 'x', displayName: 'X', role: 'viewer' }).fullName === '')
check('placeText: exactly "On the network · 192.168.2.101"', placeText({ connection: 'LAN', address: '192.168.2.101' }) === 'On the network · 192.168.2.101')
check('placeText: "Over the internet" when there is no address', placeText({ connection: 'Web' }) === 'Over the internet')

// ---- the page ----
const html = read('public/audit.html')
const js = read('public/audit.js')
check('the accounts are a list of cards, not the old four-column table', /<ul id="userRows" class="user-list"/.test(html) && !/<th>Actions<\/th>/.test(html))
check('the page loads the cards\' stylesheet', /<link rel="stylesheet" href="css\/users\.css" \/>/.test(html))
check('each card is an li.user-card with who, role, where and the menu', /el\('li', \{ className: 'user-card' \}\)/.test(js) && /li\.append\(who, role, where, menu\)/.test(js))
check('the role is a badge', /className: 'badge badge-neutral', textContent: card\.role/.test(js))
check('every action goes into the "…" menu, Reset password only for local accounts', /menuButton\(\[edit, setup, \.\.\.\(fromAd \? \[\] : \[reset\]\), kick, rm\], \{ label: `Actions for \$\{u\.name\}` \}\)/.test(js))
check('the action handlers are the ones they were', /edit\.addEventListener\('click', \(\) => openAccess\(u\.name\)\)/.test(js) && /setup\.addEventListener\('click', \(\) => openSetupCode\(u\.name\)\)/.test(js) && /reset\.addEventListener\('click', \(\) => openPasswordReset\(u\.name\)\)/.test(js) && /usersApi\('POST', `\/\$\{encodeURIComponent\(u\.name\)\}\/sign-out`/.test(js) && /usersApi\('DELETE', `\/\$\{encodeURIComponent\(u\.name\)\}`\)/.test(js))
check('the 30-second refresh waits while a menu or any dialog is open', /const usersBusy = \(\) => document\.querySelector\('#userRows \[aria-expanded="true"\], dialog\[open\]'\)/.test(js) && /if \(usersBusy\(\)\) \{ usersStale = true; return \}/.test(js))
check('... and repaints once the last dialog closes', /d\.addEventListener\('close', \(\) => \{ if \(usersStale && !usersBusy\(\)\) \{ usersStale = false; void loadUsers\(\) \} \}\)/.test(js))
check('after a repaint the keyboard goes back to the same person\'s "…" (from anywhere on their card)', /closest\?\.\('#userRows \.user-card'\)\?\.dataset\.user/.test(js) && /li\.dataset\.user = u\.name/.test(js) && /\.menu-button\[data-user="\$\{CSS\.escape\(refocus\)\}"\]`\)\?\.focus\(\)/.test(js))
check('the old table\'s dead rules are gone from style.css', !/\.ac-user-actions|\.ac-badge/.test(read('public/style.css')))
check('the Audit log tab is unchanged: its filters and table', /data-tab="log" data-tab-label="Audit log"/.test(html) && /<tr><th>When<\/th><th>User<\/th><th>Action<\/th><th>Camera \/ target<\/th><th>Detail<\/th><th>From<\/th><\/tr>/.test(html) && /<tbody id="auditRows"><\/tbody>/.test(html) && /id="filters"/.test(html))

// ---- the layout: compact on a wide screen, stacked on a phone, never wider than the screen ----
const css = read('public/css/users.css').replace(/\/\*[\s\S]*?\*\//g, '')
const wide = css.match(/@media \(min-width: 900px\) \{([\s\S]*)\}\s*$/)?.[1] ?? ''
check('from 900px each card is one line: who, role, where, menu side by side', /grid-template-areas: "who role where menu"/.test(wide))
check('narrower, the lines stack with the menu at the side', /grid-template-areas: "who menu" "role menu" "where menu"/.test(css.replace(wide, '')))
check('no fixed widths that could push a phone sideways', !/(?<!max-|min-)width:\s*\d{3,}px/.test(css) && /minmax\(0, 1fr\)/.test(css) && /overflow-wrap: anywhere/.test(css))
const comp = read('public/css/components.css')
check('the menu opens right-aligned under its button, and a closed one stays hidden', /\.menu-list \{[^}]*right: 0/.test(comp) && /\.menu-list\[hidden\] \{ display: none; \}/.test(comp))
// (the one phone rule, max-width 599px, makes every button 44px tall and a .btn-icon, as the "…" is, 44px wide)
check('on a phone the "…" button and the menu\'s actions are 44px', /@media \(max-width: 599px\) \{\s*button, \.btn \{ min-height: 44px; \}[^}]*\}[^@]*?\.btn-icon \{ width: 44px; \}/.test(comp) && /className = 'btn-ghost btn-icon menu-button'/.test(read('public/menu-button.js')))

// ---- the "…" menu, driven by keys and clicks ----
const { menuButton, menuNext } = await import('../public/menu-button.js')
check('arrows wrap and skip a switched-off action', menuNext(0, 'ArrowDown', [true, false, true]) === 2 && menuNext(2, 'ArrowDown', [true, false, true]) === 0 && menuNext(0, 'ArrowUp', [true, false, true]) === 2)
check('Home and End go to the first and last usable action', menuNext(1, 'Home', [false, true, true]) === 1 && menuNext(0, 'End', [true, true, false]) === 1)
check('nothing usable: nowhere to go', menuNext(0, 'ArrowDown', [false, false]) === -1)

// a stand-in for the page: elements with attributes, children, listeners (capture first), focus
class Node {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.parent = null; this.listeners = []; this.hidden = false; this.disabled = false; this.textContent = '' }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null }
  removeAttribute(k) { delete this.attrs[k] }
  append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k) } }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false }
  addEventListener(type, fn, capture = false) { this.listeners.push({ type, fn, capture: capture === true || capture?.capture === true }) }
  removeEventListener(type, fn, capture = false) { const c = capture === true || capture?.capture === true; this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn && l.capture === c)) }
  focus() { if (!this.disabled) doc.activeElement = this }
}
const doc = new Node('#document')
doc.createElement = (t) => new Node(t)
doc.activeElement = null
globalThis.document = doc
// capture from the top down, then the target, then bubble up: as the browser does
function fire(target, type, extra = {}) {
  const e = { type, target, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true }, stopPropagation() { this.stopped = true }, ...extra }
  const path = []
  for (let x = target; x; x = x.parent) path.unshift(x)
  if (!path.includes(doc)) path.unshift(doc)
  for (const n of path.slice(0, -1)) for (const l of n.listeners.filter((l) => l.type === type && l.capture)) l.fn(e)
  for (const n of [...path].reverse()) { for (const l of n.listeners.filter((l) => l.type === type && (n === target || !l.capture))) l.fn(e); if (e.stopped) break }
  return e
}
const press = (target, key) => fire(target, 'keydown', { key })
const click = (target) => { if (!target.disabled) fire(target, 'click') }

const page = new Node('body')
doc.append(page)
const log = []
const mk = (text, disabled = false) => { const b = new Node('button'); b.textContent = text; b.disabled = disabled; b.addEventListener('click', () => log.push([text, doc.activeElement === btn, list.hidden])); return b }
const items = [mk('Edit access'), mk('Set up a phone'), mk('Sign out user', true), mk('Forget')]
const wrap = menuButton(items, { label: 'Actions for jo' })
page.append(wrap)
const [btn, list] = wrap.children
check('the button says it opens a menu, and that it is shut', btn.getAttribute('aria-haspopup') === 'menu' && btn.getAttribute('aria-expanded') === 'false' && btn.getAttribute('aria-label') === 'Actions for jo' && btn.textContent === '…')
check('the list is a menu of menu items, one tab stop', list.getAttribute('role') === 'menu' && list.hidden && items.every((b) => b.getAttribute('role') === 'menuitem' && b.tabIndex === -1) && btn.getAttribute('aria-controls') === list.id)

click(btn)
check('a click opens it on the first action', !list.hidden && btn.getAttribute('aria-expanded') === 'true' && doc.activeElement === items[0])
press(items[0], 'ArrowDown'); press(items[1], 'ArrowDown')
check('down, down skips the switched-off Sign out user (your own account)', doc.activeElement === items[3])
press(items[3], 'ArrowDown')
check('and wraps round to the top', doc.activeElement === items[0])
press(items[0], 'End')
check('End: the last action', doc.activeElement === items[3])
const esc = press(items[3], 'Escape')
check('Escape shuts it and puts the keyboard back on "…", and goes no further (a dialog behind stays open)', list.hidden && btn.getAttribute('aria-expanded') === 'false' && doc.activeElement === btn && esc.stopped)

press(btn, 'ArrowUp')
check('up arrow on the button opens it on the last action', !list.hidden && doc.activeElement === items[3])
press(items[3], 'Tab')
check('Tab shuts it and lets the keyboard move on', list.hidden && doc.activeElement === items[3])

click(btn); btn.focus(); press(btn, 'Tab')
check('Tab off the "…" button while it is open shuts it too', list.hidden && btn.getAttribute('aria-expanded') === 'false')

press(btn, 'ArrowDown')
check('down arrow on the button opens it on the first action', !list.hidden && doc.activeElement === items[0])
click(items[1])
check('choosing an action shuts the menu and returns to "…" before the action runs (so its dialog returns there too)', log.length === 1 && log[0][0] === 'Set up a phone' && log[0][1] === true && log[0][2] === true)

click(btn)
const elsewhere = new Node('div'); page.append(elsewhere)
fire(elsewhere, 'pointerdown')
check('a click anywhere else shuts it', list.hidden && btn.getAttribute('aria-expanded') === 'false')
click(btn); fire(items[0], 'pointerdown')
check('a click inside it does not', !list.hidden)
click(btn)
check('the button again shuts it', list.hidden && doc.activeElement === btn)
check('a switched-off action does nothing when clicked', (click(items[2]), !log.some((l) => l[0] === 'Sign out user')))
check('once shut, the outside-click listener is gone', !doc.listeners.some((l) => l.type === 'pointerdown'))

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exitCode = failures ? 1 : 0
