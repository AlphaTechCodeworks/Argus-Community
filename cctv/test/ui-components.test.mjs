// cctv/test/ui-components.test.mjs
// One button, one field and one tab style everywhere. The pages hold hundreds of plain <button>s and
// fields with no class, so the one style is set on the bare elements in css/components.css. This
// fails the moment a page stylesheet brings back a bare-element style of its own (a third style), or
// a tab strip or main-action colour of its own.
//   node cctv/test/ui-components.test.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }

const pub = join(import.meta.dirname, '..', 'public')
const read = (f) => readFileSync(join(pub, f), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')

// The rules of a stylesheet as { media, selectors[], decls{} }. Enough of CSS for these sheets: rules,
// and @media or @container blocks holding rules (no nesting deeper than that). A @container block's
// media is its whole prelude ("container pb-bar (max-width: 1109px)"), an @media block's its query.
function rules(css) {
  const out = []
  const text = strip(css)
  let i = 0
  const block = (from) => { // index just past the matching }
    let depth = 0
    for (let j = from; j < text.length; j++) { if (text[j] === '{') depth++; else if (text[j] === '}' && --depth === 0) return j + 1 }
    return text.length
  }
  const parse = (body, media) => {
    for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = splitList(m[1].trim()).map(norm)
      const decls = {}
      for (const d of m[2].split(';')) { const k = d.indexOf(':'); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim() }
      out.push({ media, selectors, decls })
    }
  }
  while (i < text.length) {
    const found = /@(media|container)\b/.exec(text.slice(i))
    if (!found) { parse(text.slice(i), ''); break }
    const at = i + found.index
    parse(text.slice(i, at), '')
    const open = text.indexOf('{', at)
    const end = block(open)
    const prelude = text.slice(at + found[0].length, open).trim()
    parse(text.slice(open + 1, end - 1), found[1] === 'media' ? prelude : `container ${prelude}`)
    i = end
  }
  return out
}
// split a selector list on its top-level commas (not the ones inside :not(...) or :is(...))
function splitList(s) {
  const parts = []; let depth = 0, cur = ''
  for (const c of s) {
    if (c === '(') depth++; else if (c === ')') depth--
    if (c === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += c
  }
  return [...parts, cur]
}
const norm = (s) => s.trim().replace(/\s+/g, ' ').replace(/'/g, '"').replace(/,\s*/g, ', ')

const components = rules(read('css/components.css'))
const base = rules(read('css/base.css'))
const find = (list, media, ...sels) => list.find((r) => (media === null || r.media === media) && sels.every((s) => r.selectors.includes(norm(s))))
const PHONE = '(max-width: 599px)'

// ---- buttons ----
const btn = find(components, '', 'button', '.btn')
check('a bare <button> and .btn share one rule', Boolean(btn))
if (btn) {
  // a floor, not a fixed height: a label that wraps, or a second line, makes the button taller
  check('  at least 32px tall, never a fixed height', btn.decls['min-height'] === '32px' && !('height' in btn.decls), `min-height ${btn.decls['min-height']}, height ${btn.decls.height}`)
  check('  the small corner --r-sm', btn.decls['border-radius'] === 'var(--r-sm)', btn.decls['border-radius'])
  check('  a border', btn.decls.border === '1px solid var(--border)', btn.decls.border)
  check('  the surface (--surface-2), the secondary button', btn.decls.background === 'var(--surface-2)', btn.decls.background)
  check('  takes its words from the type scale', /var\(--fs-/.test(btn.decls.font ?? ''), btn.decls.font)
}
const btnPhone = find(components, PHONE, 'button', '.btn')
check('under 600px wide a button is at least 44px tall (a finger)', btnPhone?.decls['min-height'] === '44px' && !('height' in (btnPhone?.decls ?? {})), btnPhone?.decls['min-height'])
check('base.css does not style a bare button differently', !base.some((r) => r.selectors.some((s) => /(^|[\s>+~])button\b/.test(s))))

// ---- fields ----
// the exclusions in :where(), so the rule weighs as a bare element and a field's own class wins
const FIELD = 'input:where(:not([type="checkbox"], [type="radio"], [type="range"]))'
const field = find(components, '', FIELD, 'select', 'textarea')
check('text inputs, select and textarea share one rule', Boolean(field))
if (field) {
  check('  32px tall, level with a button', field.decls.height === '32px', field.decls.height)
  check('  --surface-2', field.decls.background === 'var(--surface-2)', field.decls.background)
  check('  a visible edge, --field-border', field.decls.border === '1px solid var(--field-border)', field.decls.border)
  check('  the small corner --r-sm', field.decls['border-radius'] === 'var(--r-sm)', field.decls['border-radius'])
  check('  body size words (--fs-body)', /var\(--fs-body\)/.test(field.decls.font ?? ''), field.decls.font)
}
const fieldPhone = find(components, PHONE, FIELD, 'select')
check('under 600px wide a field is 44px tall', fieldPhone?.decls.height === '44px', fieldPhone?.decls.height)
const tokens = read('css/tokens.css')
const themeBlock = (re) => strip((tokens.match(re) ?? [''])[0])
check('--field-border is said in both themes', /--field-border\s*:/.test(themeBlock(/html:root\s*\{[^}]*\}/)) && /--field-border\s*:/.test(themeBlock(/html:root\[data-theme="light"\]\s*\{[^}]*\}/)))
// the carve-out for the video zone keeps element weight too, so the bars' own class rules win
const zoneInput = components.find((r) => r.selectors.some((s) => s.startsWith(':where(.pb-bar') && s.includes(' input')))
check('the video-zone field carve-out keeps its exclusions in :where()', Boolean(zoneInput) && zoneInput.selectors.every((s) => !/input:not\(/.test(s)), zoneInput?.selectors.join(', '))

// no button with a second line is held to a fixed height: the playback bookmark row has a title and
// a date line under it
const style = rules(read('style.css'))
const bmGo = style.filter((r) => r.selectors.includes('.pb-bm-go'))
check('.pb-bm-go (two lines) is not given a fixed height', bmGo.length > 0 && bmGo.every((r) => !('height' in r.decls)))

// ---- tabs ----
const tabs = find(components, '', '.tabs-ui')
check('a .tabs-ui component exists', Boolean(tabs))
if (tabs) {
  check('  a row', tabs.decls.display === 'flex', tabs.decls.display)
  check('  scrolls sideways', tabs.decls['overflow-x'] === 'auto', tabs.decls['overflow-x'])
  check('  with no scrollbar drawn (Firefox)', tabs.decls['scrollbar-width'] === 'none', tabs.decls['scrollbar-width'])
}
check('  with no scrollbar drawn (Chrome, Safari)', find(components, '', '.tabs-ui::-webkit-scrollbar')?.decls.display === 'none')
const item = find(components, '', '.tabs-ui > a', '.tabs-ui > [role="tab"]')
check('  its tabs are text: no box, a 2px underline waiting', item?.decls.background === 'none' && /^2px solid transparent$/.test(item?.decls['border-bottom'] ?? ''), item?.decls['border-bottom'])
const on = find(components, '', '.tabs-ui > [role="tab"][aria-selected="true"]', '.tabs-ui > a[aria-current="page"]')
check('  a selected tab (role=tab aria-selected, or a link aria-current=page) is --text with an --accent underline', on?.decls.color === 'var(--text)' && on?.decls['border-bottom-color'] === 'var(--accent)', JSON.stringify(on?.decls))

// every tab strip is the one component, and its old look is gone
const pageTabs = read('page-tabs.js'), settingsTabs = read('settings-tabs.js'), editor = read('camera-editor.js')
check('page-tabs.js (Alarms, Users & access) builds a .tabs-ui row', /bar\.className = 'tabs-ui'/.test(pageTabs))
// Settings has nine sections, too many for a row: a side list and a "Section" dropdown instead
// (settings-layout.test.mjs), never a strip of its own look
check('settings-tabs.js (Settings) builds a side list, not a tab strip of its own', /className = 'se-menu'/.test(settingsTabs) && !/className = '(se-tabs|tabs)'/.test(settingsTabs))
check('both mark the shown tab aria-current="page"', [pageTabs, settingsTabs].every((js) => /setAttribute\('aria-current', 'page'\)/.test(js) && /removeAttribute\('aria-current'\)/.test(js)))
check('the camera editor\'s tabs are a .tabs-ui tablist of role=tab buttons', /el\('div', \{ className: 'tabs-ui' \}\)/.test(editor) && /tabBar\.setAttribute\('role', 'tablist'\)/.test(editor) && /t\.btn\.setAttribute\('role', 'tab'\)/.test(editor) && /aria-selected/.test(editor))
const sheets = [...readdirSync(pub).filter((f) => f.endsWith('.css')), ...readdirSync(join(pub, 'css')).filter((f) => f.endsWith('.css')).map((f) => `css/${f}`)]
const allCss = sheets.map((f) => [f, strip(read(f))])
check('no stylesheet keeps the old tab strips (.se-tabs, .ce-tabs, .ce-tab)', allCss.every(([, t]) => !/\.(se-tabs|ce-tabs?)\b/.test(t)), allCss.filter(([, t]) => /\.(se-tabs|ce-tabs?)\b/.test(t)).map(([f]) => f).join(' '))

// ---- no third style ----
// style.css used to give bare buttons, selects and date fields a look of its own: that is the one
// style's job now, so no page sheet may set one on the bare element at the top level
const BARE = new Set(['button', 'select', 'textarea', 'input', 'input[type="date"]', FIELD])
for (const f of sheets.filter((s) => s !== 'css/components.css' && s !== 'css/base.css' && !/^colour-check/.test(s))) {
  const bare = rules(read(f)).filter((r) => r.media === '' && r.selectors.some((s) => BARE.has(s)))
  check(`${f} sets no bare button or field style of its own`, bare.length === 0, bare.map((r) => r.selectors.join(', ')).join(' | '))
}

// ---- one main-action style ----
const markup = readdirSync(pub).filter((f) => /\.(html|js)$/.test(f)).map((f) => [f, read(f)])
const oldPrimary = /\b(st-primary|pb-primary)\b/
check('no stylesheet keeps a main-action colour of its own (.st-primary, .pb-primary)', allCss.every(([, t]) => !oldPrimary.test(t)))
check('no page or script uses them', markup.every(([, t]) => !oldPrimary.test(t)), markup.filter(([, t]) => oldPrimary.test(t)).map(([f]) => f).join(' '))
check('.btn-primary exists', Boolean(find(components, '', '.btn-primary')))

// ---- one page header ----
// Every page opens the same way: the page's name, one short line under it, and the page's own
// actions on the right. The name is the sidebar's name for the page, because on a phone the shell's
// top bar already says it and the page's own h1 is kept for screen readers only.
const PAGES = {
  'index.html': 'Live', 'playback.html': 'Playback', 'map.html': 'Map',
  'alarms.html': 'Alarms', 'health.html': 'Health', 'audit.html': 'Users & access', 'sites.html': 'Sites',
  'settings.html': 'Settings', 'reports.html': 'Reports', 'cameras.html': 'Cameras', 'register.html': 'NVR register'
}
// Pages that have no page header, on purpose, each with its reason.
const EXEMPT = {
  'wall.html': 'Many cameras: the video comes first, and the wall keeps its full height'
}
for (const [page, why] of Object.entries(EXEMPT)) check(`${page} has no page header (${why})`, !/class="page-head/.test(read(page)))
// On these three the <main> is the video grid or the map itself (scripts fill it, and its size is the
// picture's), so the header stands just before the page's toolbar instead of inside <main>.
const WORKSPACE = new Set(['index.html', 'playback.html', 'map.html'])
const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()
for (const [page, title] of Object.entries(PAGES)) {
  // (comments blanked, not removed, so positions hold: a comment may well mention <main>)
  const html = read(page).replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length))
  const heads = [...html.matchAll(/<header class="page-head[" ][^>]*>([\s\S]*?)<\/header>/g)]
  check(`${page}: exactly one <header class="page-head">`, heads.length === 1, String(heads.length))
  if (heads.length !== 1) continue
  const at = heads[0].index, inner = heads[0][1]
  const mainOpen = html.indexOf('<main'), mainClose = html.indexOf('</main>')
  if (WORKSPACE.has(page)) {
    // (the toolbar: a bare <header>, or Live's <header class="live-toolbar">)
    const toolbar = html.search(/<header(>| class="live-toolbar")/)
    check(`  ${page}: before the toolbar and the video/map <main>`, at < mainOpen && (toolbar < 0 || at < toolbar))
  } else {
    check(`  ${page}: inside <main>`, at > mainOpen && at < mainClose)
  }
  const h1s = [...inner.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)]
  check(`  ${page}: one h1, "${title}"`, h1s.length === 1 && decode(h1s[0][1]) === title, h1s.map((m) => decode(m[1])).join(' | '))
  const subs = [...inner.matchAll(/<p [^>]*class="page-sub"/g)]
  check(`  ${page}: at most one p.page-sub`, subs.length <= 1, String(subs.length))
  check(`  ${page}: at most one .page-actions`, (inner.match(/class="page-actions"/g) ?? []).length <= 1)
  // nothing but the title, the sub line and the actions at the header's top level
  const top = inner.replace(/<div class="page-head-text">([\s\S]*?)<\/div>/, '$1').replace(/<div class="page-actions"[\s\S]*<\/div>/, '')
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>/, '').replace(/<p [^>]*class="page-sub"[^>]*>[\s\S]*?<\/p>/, '').trim()
  check(`  ${page}: holds only the title, the sub line and the actions`, top === '', top.slice(0, 80))
}
// the old headings, one per page, are gone
const oldHeads = /\b(live-heading|workspace-heading|al-heading|health-heading)\b/
check('no page, script or stylesheet keeps an old page heading (.live-heading, .workspace-heading, .al-heading, .health-heading)',
  markup.every(([, t]) => !oldHeads.test(t)) && allCss.every(([, t]) => !oldHeads.test(t)),
  [...markup, ...allCss].filter(([, t]) => oldHeads.test(t)).map(([f]) => f).join(' '))

const head = find(components, '', '.page-head')
check('.page-head is a row that wraps', head?.decls.display === 'flex' && head?.decls['flex-wrap'] === 'wrap', JSON.stringify(head?.decls))
// style.css still styles the bare <header> (the old toolbar): the page header undoes its panel look
check('  with no panel background of its own (the old bare header rule gives one)', head?.decls.background === 'none', head?.decls.background)
const text = find(components, '', '.page-head-text')
check('  its title block can shrink, so a long title ends in … instead of pushing the actions off', text?.decls['min-width'] === '0', JSON.stringify(text?.decls))
const h1 = find(components, '', '.page-head h1')
check('  the title: --fs-title, weight 600', h1?.decls['font-size'] === 'var(--fs-title)' && h1?.decls['font-weight'] === '600', JSON.stringify(h1?.decls))
check('  the title stays on one line and ends in … when there is no room', h1?.decls['white-space'] === 'nowrap' && h1?.decls.overflow === 'hidden' && h1?.decls['text-overflow'] === 'ellipsis')
const sub = find(components, '', '.page-sub')
check('  the sub line: --text-muted at --fs-body', sub?.decls.color === 'var(--text-muted)' && sub?.decls['font-size'] === 'var(--fs-body)', JSON.stringify(sub?.decls))
const actions = find(components, '', '.page-actions')
check('  the actions pushed to the right, wrapping', actions?.decls['margin-left'] === 'auto' && actions?.decls['flex-wrap'] === 'wrap', JSON.stringify(actions?.decls))
// a phone: the shell's top bar (css/shell.css, the same query) already names the page
const SHELL_PHONE = '(max-width: 699px), (pointer: coarse) and (max-height: 500px)'
const phoneH1 = find(components, SHELL_PHONE, '.page-head h1')
check('on a phone the title is for screen readers only (the shell\'s top bar says it)', phoneH1?.decls.position === 'absolute' && /^1px$/.test(phoneH1?.decls.width ?? '') && /clip|clip-path/.test(Object.keys(phoneH1?.decls ?? {}).join(' ')), JSON.stringify(phoneH1?.decls))
const phoneActions = find(components, SHELL_PHONE, '.page-actions')
check('on a phone the actions wrap under the sub line, from the left', phoneActions?.decls['margin-left'] === '0' && phoneActions?.decls['flex-basis'] === '100%', JSON.stringify(phoneActions?.decls))
check('the shell\'s top bar is shown on that same query', /@media \(max-width: 699px\), \(pointer: coarse\) and \(max-height: 500px\) \{\s*\.shell-top \{/.test(read('style.css')))
// a rule like ".live-page header" would put the old toolbar's panel on the page header too
const leaky = allCss.flatMap(([f, t]) => rules(t).filter((r) => r.selectors.some((s) => /(^|\s)header$/.test(s) && !/^header$/.test(s) && !/> header$/.test(s))).map((r) => `${f}: ${r.selectors.join(', ')}`))
check('no page stylesheet styles every <header> under a page class (it would hit the page header)', leaky.length === 0, leaky.join(' | '))
// Live's slim toolbar (test/live-toolbar.test.mjs): its new buttons are the one button style, and the
// toolbar is not given the old boxed panel (a border round the whole row)
const liveHtml = read('index.html')
for (const id of ['mobileControls', 'filtersDone', 'noticeClose']) {
  check(`Live's #${id} is a .btn`, new RegExp(`<button id="${id}"[^>]*class="btn[ "]`).test(liveHtml), (liveHtml.match(new RegExp(`<button id="${id}"[^>]*>`)) ?? ['missing'])[0])
}
const liveBar = rules(read('css/live.css')).filter((r) => r.media === '' && r.selectors.some((s) => /^\.live-page.*(\.live-toolbar|> header)$/.test(s)))
const boxed = (d) => (d.border && !/^(0|none)$/.test(d.border)) || (d.background && !/^(none|transparent)$/.test(d.background)) || (d['border-radius'] && d['border-radius'] !== '0')
check('Live\'s .live-toolbar has no border or panel background of its own', liveBar.length > 0 && liveBar.every((r) => !boxed(r.decls)), liveBar.map((r) => JSON.stringify(r.decls)).join(' | '))
// the tabs (page-tabs.js) go under the header, not above it
check('page-tabs.js puts the tab strip after the page header', /querySelector\(':scope > \.page-head'\)/.test(read('page-tabs.js')))

// ---- phones: a slim top bar and finger-sized controls (stage 4) ----
// The shell's top bar on a phone (style.css .shell-top: the logo, ARGUS and the page's name) was 53 px
// below the status bar, and with the page header under it the cameras started about 100 px down. Its
// height is the padding above and below, the logo (the tallest thing in it) and its 1px bottom edge.
{
  const SHELL_Q = '(max-width: 699px), (pointer: coarse) and (max-height: 500px)'
  const top = find(style, SHELL_Q, '.shell-top')
  const logo = find(style, SHELL_Q, '.shell-top img', '.shell-top .shell-top-logo')
  const px = (v) => Number((/(\d+(?:\.\d+)?)px/.exec(v ?? '') ?? [])[1])
  // padding: calc(Npx + env(safe-area-inset-top)) Hpx Mpx: the status bar's own height is on top of N
  const pad = /^calc\((\d+)px \+ env\(safe-area-inset-top\)\) \S+ (\d+)px$/.exec(top?.decls.padding ?? '')
  const edge = px(top?.decls['border-bottom'])
  const height = pad ? Number(pad[1]) + px(logo?.decls.height) + Number(pad[2]) + edge : NaN
  check('a phone\'s top bar (ARGUS + the page\'s name) is at most 52px tall, under the status bar', height <= 52, `${height}px from ${top?.decls.padding}, logo ${logo?.decls.height}, edge ${edge}`)
  check('  and still clears the status bar and notch (env(safe-area-inset-top))', Boolean(pad))
  check('  the logo is still at least 24px', px(logo?.decls.height) >= 24 && logo?.decls.width === logo?.decls.height, `${logo?.decls.width} x ${logo?.decls.height}`)
}

// Under 600 px wide, every button, select, input, tab, chip and pager arrow on Live, Playback, Alarms,
// Settings, Users and Cameras is at least 44 px tall. Measured from the CSS: every rule that applies on
// a phone and holds such a control below 44 px (a height, or a min-height of 0 that lets padding
// decide) must be outweighed, at that width, by a phone rule setting 44 px or more: one for the same
// selector later in the cascade, or a named rule that covers it (COVERED). What is not a tap target
// on these pages is named in NOT_A_TARGET, each with its reason.
{
  // the sheets those six pages load, in the order they load them (the page sheets come last and are
  // never loaded together, except review.css before playback.css on Playback)
  const ORDER = ['css/tokens.css', 'css/base.css', 'css/components.css', 'css/shell.css', 'css/camera-browser.css', 'style.css',
    'colour-check.css', 'grid-order.css', 'css/live.css', 'css/start-order.css', 'css/review.css', 'css/playback.css',
    'css/alarms.css', 'css/users.css', 'css/cameras.css']
  const PAGES6 = ['index.html', 'playback.html', 'alarms.html', 'settings.html', 'audit.html', 'cameras.html']
  for (const page of PAGES6) {
    const used = [...read(page).matchAll(/href="([^"]+\.css)"/g)].map((m) => m[1])
    check(`${page} loads only sheets in ORDER, in that order`, used.every((f) => ORDER.includes(f)) && used.every((f, i) => i === 0 || ORDER.indexOf(f) > ORDER.indexOf(used[i - 1])), used.join(' '))
  }
  // Whether a rule's @media (or @container: the container is never wider than the screen) applies on
  // a phone this wide, held upright (taller than 500 px), touch only.
  const applies = (media, w) => media === '' || media.replace(/^container [\w-]+ /, '').split(/,(?![^(]*\))/).some((alt) =>
    [...alt.matchAll(/\(([^)]+)\)/g)].every(([, c]) => {
      const [k, v] = c.split(':').map((x) => x.trim())
      if (k === 'max-width') return w <= parseFloat(v)
      if (k === 'min-width') return w >= parseFloat(v)
      if (k === 'max-height') return 812 <= parseFloat(v)
      if (k === 'min-height') return 812 >= parseFloat(v)
      if (k === 'pointer' || k === 'any-pointer') return v === 'coarse'
      if (k === 'hover') return v === 'none'
      return false // prefers-reduced-motion, display-mode …: not taken for granted
    }) && !/\bnot\b|\bprint\b/.test(alt))
  // the classes the pages put on their controls, so a rule like ".ip-close" is known to be a button
  const ctlClass = new Set()
  for (const [, t] of markup) for (const m of t.matchAll(/<(?:button|select|input|summary|textarea)\b[^>]*?class="([^"$]+)"/g)) for (const c of m[1].split(/\s+/)) if (c) ctlClass.add(c)
  // (read without its :not(…) and :where(…) parts, whose spaces and commas are not the selector's own)
  const bare = (s) => s.replace(/:(not|where)\((?:[^()]|\([^()]*\))*\)/g, '')
  const isControl = (s) => /(^|[\s>+~(])(button|select|input|textarea|summary)\b[^\s>+~]*$/.test(bare(s)) || /\[role="tab"\]$/.test(bare(s)) ||
    /^\.tabs-ui > a$/.test(s) || [...(bare(s).split(/[\s>+~]+/).pop() ?? '').matchAll(/\.([\w-]+)/g)].some((m) => ctlClass.has(m[1]))
  // a tick box, radio button, colour or slider: its label (the words beside it) is what a finger taps
  const isTick = (s) => /\[type="(checkbox|radio|color|range|hidden)"\]$/.test(bare(s))
  const below = (d) => [d.height, d['min-height']].some((v) => v === '0' || (/^\d+(\.\d+)?px$/.test(v ?? '') && parseFloat(v) < 44))
  const atLeast44 = (d) => parseFloat(d['min-height']) >= 44 || (parseFloat(d.height) >= 44 && !('min-height' in d && parseFloat(d['min-height']) < 44) && !('max-height' in d))
  const all = ORDER.flatMap((f, fi) => rules(read(f)).map((r, ri) => ({ ...r, file: f, at: fi * 1e5 + ri })))
  // a later phone rule for the same selector, 44 px or more
  const outweighed = (sel, r, w) => all.some((o) => o.at > r.at && o.media !== '' && applies(o.media, w) && o.selectors.includes(sel) && atLeast44(o.decls))
  // a broader phone rule that covers these on their pages; it must exist as said, 44 px or more
  const COVERED = {
    // Playback: review.css gives every button and field on the page 44 px on a phone, and its
    // :is(.playback-page) weighs more than these (one class, or one class and an element, earlier)
    '.pb-icon': ':is(.map-page, .playback-page) button', '.pb-tbtn': ':is(.map-page, .playback-page) button',
    '.pb-mode button': ':is(.map-page, .playback-page) button',
    ':where(.pb-bar, .tile, .wall-tile) button': ':is(.map-page, .playback-page) button',
    ':where(.pb-bar, .tile, .wall-tile) select': ':is(.map-page, .playback-page) select'
  }
  for (const [sel, by] of Object.entries(COVERED)) check(`  (${by} is a 44 px phone rule)`, all.some((o) => o.media !== '' && applies(o.media, 375) && o.selectors.includes(norm(by)) && atLeast44(o.decls)))
  const NOT_A_TARGET = {
    // pages other than these six
    '.map-zoom button': 'Map', '.map-page .map-zoom button': 'Map', '.rp-periods button': 'Reports',
    // the picture: a grid tile on a phone is one tap target, .tile-open, which covers the tile and
    // opens it full size; the full-size camera's own buttons are 44 px (style.css .single-overlay)
    ':where(.pb-bar, .tile, .wall-tile) input:where(:not([type="checkbox"], [type="radio"], [type="range"]))': 'the picture (no field on a Live tile)',
    // the desktop sidebar only: the shell's sidebar is not drawn on a phone
    '.shell-settings-status': 'desktop sidebar',
    // textarea and lists grow with their rows, never shorter than one 44 px line
    // the colour check's radio buttons and tick boxes: each in a label, the label is what is tapped
    '.cc-mode input': 'radio in a label', '.cc-same input': 'tick box in a label', '.cc-suggest input': 'tick box in a label',
    'textarea': 'grows with its rows', 'select[multiple]': 'a list box, rows', 'select[size]:not([size="1"])': 'a list box, rows', 'input[type="file"]': 'the browser draws it'
  }
  const offenders = []
  for (const w of [375, 599]) {
    for (const r of all) {
      if (!applies(r.media, w) || !below(r.decls)) continue
      for (const sel of r.selectors) {
        if (!isControl(sel) || isTick(sel) || NOT_A_TARGET[sel] || COVERED[sel]) continue
        if (outweighed(sel, r, w)) continue
        offenders.push(`${w}px ${r.file}: ${sel} (${r.decls.height ? `height ${r.decls.height}` : `min-height ${r.decls['min-height']}`})`)
      }
    }
  }
  check('under 600px wide no button, field, tab, chip or pager arrow on Live, Playback, Alarms, Settings, Users or Cameras is held below 44px', offenders.length === 0, [...new Set(offenders)].join(' | '))
  // the one style's own parts, said outright
  const P = (sel) => find(components, PHONE, sel)
  check('  a small button (.btn-sm) is 44px on a phone too', parseFloat(P('.btn-sm')?.decls['min-height']) >= 44)
  check('  an icon button is 44px wide', P('.btn-icon')?.decls.width === '44px')
  check('  a segmented control\'s and a pill row\'s buttons are 44px', parseFloat(P('.seg button')?.decls['min-height']) >= 44 && parseFloat(P('.pills button')?.decls['min-height']) >= 44)
  const tab = P('.tabs-ui > a') ?? find(components, PHONE, '.tabs-ui > a', '.tabs-ui > [role="tab"]')
  check('  a tab (a link or role=tab) is 44px, its words centred', parseFloat(tab?.decls['min-height']) >= 44 && tab?.decls['align-items'] === 'center', JSON.stringify(tab?.decls))
  // sized by their padding alone, so the scan above cannot see them: found by measuring the pages at
  // 375px (2026-10-19), Settings' folds were 20-22px
  const styleLate = rules(read('style.css')).filter((r) => r.media === PHONE)
  check('  Settings\' folds ("How this works", "Add a USB drive", "Email") are 44px', ['.se-section details > summary', '.se-more > summary', '.se-fold > summary'].every((s) => styleLate.some((r) => r.selectors.includes(s) && parseFloat(r.decls['min-height']) >= 44)))
  // the phone bar and its More sheet
  const bar = find(rules(read('css/shell.css')), SHELL_PHONE, '.shell-bar a', '.shell-bar button')
  const sheetItem = find(rules(read('css/shell.css')), SHELL_PHONE, '.shell-sheet a', '.shell-sheet button')
  check('  the phone bar\'s and the More sheet\'s items are 44px', parseFloat(bar?.decls['min-height']) >= 44 && parseFloat(sheetItem?.decls['min-height']) >= 44)
}

// Live on a phone shows at most 6 tiles a page (it drew 48 waiting tiles, the list's whole page, in
// the audit), keeping a smaller choice (one camera, 2 x 2). grid-view.test.mjs tests the rule itself;
// here, that the page uses it for every layout it draws.
{
  const viewer = read('viewer.js')
  const body = viewer.slice(viewer.indexOf('function layoutCells(id)'), viewer.indexOf('\n}\n', viewer.indexOf('function layoutCells(id)')))
  check('viewer.js: every layout the page draws goes through phonePage (grid-view.js) on a phone', /import \{[^}]*\bphonePage\b[^}]*\} from '\.\/grid-view\.js'/.test(viewer) && /return phonePage\(anyLayoutCells\(id\), isPhone\(\)\)/.test(body), body.slice(0, 120))
  const anyBody = viewer.slice(viewer.indexOf('function anyLayoutCells(id)'), viewer.indexOf('\n}\n', viewer.indexOf('function anyLayoutCells(id)')))
  check('  the list says it is one, so its page is cut and it still scrolls', /list: true, cells: Array\.from\(\{ length: LIST_PAGE \}/.test(anyBody))
  check('  and nothing else calls the uncapped cells', (viewer.match(/anyLayoutCells\(/g) ?? []).length === 2)
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
