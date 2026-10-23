// cctv/test/css-drawing-layers.test.mjs
// The OSD and Lines panels draw on a canvas (.ln-overlay) laid over the camera picture, with a shield
// (.ln-shield) under it and, for Lines, a magnifier (.ln-loupe). The script sets only left/top/width/
// height; the stylesheet must make them absolute layers above the picture. Those rules were scoped
// to the Live full-size tile (.single-overlay), but since the panels moved into the Sites camera
// editor (a plain 'tile ce-tile') nothing placed them there: the canvas fell into normal flow below
// the picture and was clipped, so OSD drag-to-place and line drawing could not work
// (F4a-camera-image-osd#0, 2026-10-20).
// This works out, from the sheets each page really loads, what these elements end up with in the
// editor's tile and in the Live full-size tile (a small cascade: selector match, specificity, order;
// rules inside @media/@container and selectors it does not understand are left out).
//   node cctv/test/css-drawing-layers.test.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }

const pub = join(import.meta.dirname, '..', 'public')
const read = (f) => readFileSync(join(pub, f), 'utf8')

// ---- the stylesheets: top-level rules only, in page order ----
function rulesOf(text) {
  const s = text.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  const at = []
  let buf = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '{') {
      const prelude = buf.trim()
      buf = ''
      if (prelude.startsWith('@')) { at.push(prelude); continue }
      const end = s.indexOf('}', i)
      out.push({ sel: prelude, body: s.slice(i + 1, end), inAt: at.length > 0 })
      i = end
    } else if (ch === '}') { at.pop(); buf = '' } else if (ch === ';' && !at.length) buf = ''
    else buf += ch
  }
  return out
}
const sheetsOf = (page) => [...read(page).matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1])

// ---- selectors: compound selectors joined by ' ' or '>'; anything else is not understood (null) ----
const SIMPLE = /^(?:(\*|[a-z][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|:not\(([^()]*)\))/i
const plus = (a, b) => a.map((x, k) => x + b[k])
const more = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
function compound(text) {
  const tests = []
  let spec = [0, 0, 0]
  let rest = text
  while (rest) {
    const m = SIMPLE.exec(rest)
    if (!m) return null
    rest = rest.slice(m[0].length)
    if (m[1]) { if (m[1] !== '*') { tests.push((e) => e.tag === m[1].toLowerCase()); spec = plus(spec, [0, 0, 1]) } }
    else if (m[2]) { tests.push((e) => e.classes.includes(m[2])); spec = plus(spec, [0, 1, 0]) }
    else if (m[3]) { tests.push((e) => e.id === m[3]); spec = plus(spec, [1, 0, 0]) }
    else if (m[4]) { tests.push((e) => (m[5] === undefined ? m[4] in e.attrs : e.attrs[m[4]] === m[5])); spec = plus(spec, [0, 1, 0]) }
    else {
      const inner = m[6].split(',').map((x) => compound(x.trim()))
      if (inner.some((x) => !x)) return null
      tests.push((e) => !inner.some((x) => x.test(e)))
      spec = plus(spec, inner.map((x) => x.spec).sort(more).at(-1))
    }
  }
  return { test: (e) => tests.every((t) => t(e)), spec }
}
function complex(sel) {
  const tokens = sel.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/)
  const chain = []
  let comb = null
  for (const t of tokens) {
    if (t === '>') { comb = '>'; continue }
    if (t === '+' || t === '~') return null
    const c = compound(t)
    if (!c) return null
    chain.push({ ...c, comb: chain.length ? comb ?? ' ' : null })
    comb = null
  }
  const go = (k, e) => {
    if (!chain[k].test(e)) return false
    if (k === 0) return true
    if (chain[k].comb === '>') return Boolean(e.parent) && go(k - 1, e.parent)
    for (let p = e.parent; p; p = p.parent) if (go(k - 1, p)) return true
    return false
  }
  return { matches: (e) => go(chain.length - 1, e), spec: chain.reduce((s, c) => plus(s, c.spec), [0, 0, 0]) }
}
// split on top-level commas only (a :not() can hold its own)
const selectorsOf = (list) => {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++
    if (ch === ')' || ch === ']') depth--
    if (ch === ',' && !depth) { out.push(cur); cur = '' } else cur += ch
  }
  return [...out, cur].map((s) => s.trim()).filter(Boolean)
}

// ---- the cascade for one element on one page ----
function styleOf(page, el) {
  const won = {}
  let order = 0
  for (const sheet of sheetsOf(page)) {
    for (const rule of rulesOf(read(sheet))) {
      order++
      if (rule.inAt) continue
      const specs = selectorsOf(rule.sel).map(complex).filter((c) => c && c.matches(el)).map((c) => c.spec)
      if (!specs.length) continue
      const spec = specs.sort(more).at(-1)
      for (const decl of rule.body.split(';')) {
        const i = decl.indexOf(':')
        if (i < 0) continue
        const prop = decl.slice(0, i).trim()
        const important = /!important\s*$/i.test(decl)
        const value = decl.slice(i + 1).replace(/!important\s*$/i, '').trim()
        const prev = won[prop]
        if (!prev || important > prev.important || (important === prev.important && more(spec, prev.spec) >= 0)) won[prop] = { value, important, spec, where: `${sheet}: ${rule.sel}` }
      }
    }
  }
  const out = Object.fromEntries(Object.entries(won).map(([p, d]) => [p, d.value]))
  out.where = Object.fromEntries(Object.entries(won).map(([p, d]) => [p, d.where]))
  if (!('display' in won) && 'hidden' in el.attrs) out.display = 'none' // the browser's own [hidden] rule
  out.position ??= 'static'
  return out
}
const node = (tag, { classes = [], id = '', attrs = {} } = {}, parent = null) => ({ tag, classes, id, attrs, parent })

// the two tiles the panels are drawn in
const html = (bodyClass) => node('body', { classes: [bodyClass] }, node('html'))
const editorTile = node('div', { classes: ['tile', 'ce-tile'] }, node('div', { classes: ['ce-preview'] }, html('sites-page')))
const fullTile = node('div', { classes: ['tile', 'single', 'single-overlay'] }, node('div', { id: 'grid' }, html('live-page')))
const places = [['the camera editor', 'sites.html', editorTile], ['the Live full-size view', 'index.html', fullTile]]

for (const [where, page, tile] of places) {
  const shield = styleOf(page, node('div', { classes: ['ln-shield'] }, tile))
  check(`${where}: the shield is a layer over the whole tile`, shield.position === 'absolute' && shield.inset === '0' && shield['z-index'] === '3', JSON.stringify([shield.position, shield.inset, shield['z-index']]))
  const hiddenShield = styleOf(page, node('div', { classes: ['ln-shield'], attrs: { hidden: '' } }, tile))
  check(`${where}: a hidden shield is not shown`, hiddenShield.display === 'none', hiddenShield.display)

  const canvas = styleOf(page, node('canvas', { classes: ['ln-overlay'] }, tile))
  const want = { position: 'absolute', 'z-index': '3', display: 'block', transform: 'none', 'object-fit': 'fill', 'touch-action': 'none', cursor: 'crosshair' }
  const off = Object.entries(want).filter(([p, v]) => canvas[p] !== v).map(([p]) => `${p}: ${canvas[p]} from ${canvas.where[p] ?? 'nothing'}`)
  check(`${where}: the drawing canvas is a layer of its own above the picture, placed by the script and not moved by the zoom`, off.length === 0, off.join('; '))
  const locked = styleOf(page, node('canvas', { classes: ['ln-overlay', 'ln-locked'] }, tile))
  check(`${where}: a locked drawing shows no crosshair`, locked.cursor === 'default', locked.cursor)
  const hiddenCanvas = styleOf(page, node('canvas', { classes: ['ln-overlay'], attrs: { hidden: '' } }, tile))
  check(`${where}: a hidden drawing canvas is not shown (the tile's own canvas rule says display: block)`, hiddenCanvas.display === 'none', `${hiddenCanvas.display} from ${hiddenCanvas.where.display}`)

  const loupe = styleOf(page, node('canvas', { classes: ['ln-loupe'] }, tile))
  check(`${where}: the magnifier sits above the drawing and takes no pointer`, loupe.position === 'absolute' && loupe['z-index'] === '5' && loupe.transform === 'none' && loupe['pointer-events'] === 'none', JSON.stringify([loupe.position, loupe['z-index'], loupe.transform, loupe['pointer-events']]))
  const hiddenLoupe = styleOf(page, node('canvas', { classes: ['ln-loupe'], attrs: { hidden: '' } }, tile))
  check(`${where}: a hidden magnifier is not shown`, hiddenLoupe.display === 'none', hiddenLoupe.display)
}

// the Zones and detection tabs' layers carry both class sets (ln- and cc-); they behave as before
{
  const shown = styleOf('sites.html', node('canvas', { classes: ['ln-overlay', 'cc-overlay', 'zn-overlay'] }, editorTile))
  check('the Zones canvas is still a layer over the picture', shown.position === 'absolute' && shown['z-index'] === '3' && shown.display === 'block', JSON.stringify([shown.position, shown['z-index'], shown.display]))
  const shield = styleOf('sites.html', node('div', { classes: ['ln-shield', 'cc-shield'], attrs: { hidden: '' } }, editorTile))
  check('  and its hidden shield stays hidden', shield.display === 'none', shield.display)
}

// the rules themselves are no longer tied to the full-size view
{
  const css = rulesOf(read('style.css')).filter((r) => !r.inAt)
  const scoped = css.flatMap((r) => selectorsOf(r.sel)).filter((s) => /\.ln-(shield|overlay|loupe)/.test(s.replace(/:not\([^)]*\)/g, '')) && /single-overlay/.test(s))
  check('no drawing-layer rule is scoped to .single-overlay', scoped.length === 0, scoped.join(' | '))
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exitCode = failures ? 1 : 0
