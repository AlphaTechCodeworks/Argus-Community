// cctv/test/css-tokens.test.mjs
// The redesign's one hard rule: every colour comes from tokens.css. The old style.css reached 69
// distinct hard-coded colours, which is why no two pages looked alike. This fails the build the
// moment a new stylesheet under css/ writes a colour of its own.
//   node cctv/test/css-tokens.test.mjs
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }

const dir = join(import.meta.dirname, '..', 'public', 'css')
check('the css folder exists', existsSync(dir))
const files = existsSync(dir) ? readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.css')) : []
check('tokens.css exists', files.includes('tokens.css'))

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g
for (const f of files) {
  if (f === 'tokens.css') continue
  const text = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const hits = text.match(COLOUR) ?? []
  check(`${f} takes every colour from the tokens`, hits.length === 0, hits.slice(0, 3).join(' '))
}

// The old stylesheets beside the pages (style.css, grid-order.css) follow the same rule now, and every
// stylesheet takes its type sizes and corners from the scale too. Left out: colour-check*.css,
// the colour-test demo, whose swatches are its content.
const pub = join(import.meta.dirname, '..', 'public')
const oldSheets = readdirSync(pub).filter((f) => f.endsWith('.css') && !/^colour-check/.test(f))
check('style.css is among the old sheets checked', oldSheets.includes('style.css'))
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
for (const f of oldSheets) {
  const hits = strip(readFileSync(join(pub, f), 'utf8')).match(COLOUR) ?? []
  check(`${f} takes every colour from the tokens`, hits.length === 0, `${hits.length} raw: ${hits.slice(0, 3).join(' ')}`)
}
// a raw pixel size: font-size: 13px, or the size inside a font shorthand (font: 600 12px ...)
const FONT_PX = /font-size\s*:\s*[0-9.]+px|\bfont\s*:[^;}]*?\b[0-9.]+px/g
// a raw corner: any border-radius with a pixel length other than 0 and 999px (a pill)
const RADIUS_PX = /border(?:-(?:top|bottom)-(?:left|right))?-radius\s*:[^;}]*/g
const rawRadius = (decl) => decl.replace(/\b(?:0|999)px\b/g, '').match(/[0-9.]+px/)
const sized = [...oldSheets.map((f) => [f, join(pub, f)]), ...files.filter((f) => f !== 'tokens.css').map((f) => [`css/${f}`, join(dir, f)])]
for (const [name, path] of sized) {
  const text = strip(readFileSync(path, 'utf8'))
  const fonts = text.match(FONT_PX) ?? []
  check(`${name} takes its font sizes from the type scale`, fonts.length === 0, `${fonts.length} raw: ${fonts.slice(0, 3).join(' | ')}`)
  const radii = (text.match(RADIUS_PX) ?? []).filter(rawRadius)
  check(`${name} takes its corners from the radius scale`, radii.length === 0, `${radii.length} raw: ${radii.slice(0, 3).join(' | ')}`)
}

const tokens = existsSync(join(dir, 'tokens.css')) ? readFileSync(join(dir, 'tokens.css'), 'utf8') : ''
for (const t of ['--bg', '--surface-1', '--surface-2', '--surface-3', '--border', '--text', '--text-muted', '--text-faint', '--accent', '--ok', '--warn', '--bad', '--video-bg']) {
  check(`dark defines ${t}`, new RegExp(`:root\\s*{[^}]*${t}\\s*:`).test(tokens))
}
check('a light theme exists', /:root\[data-theme="light"\]\s*{/.test(tokens))
for (const t of ['--bg', '--surface-1', '--text', '--border', '--accent']) {
  check(`light overrides ${t}`, new RegExp(`\\[data-theme="light"\\]\\s*{[^}]*${t}\\s*:`).test(tokens))
}

// the tokens that keep video, the timeline and the overlays exactly as they were, and the panel status
// words: each is said in both themes (the video ones with the same value, since video is black in both)
const bothThemes = [
  '--warn-text', '--bad-text', '--shadow-pop', '--paper',
  '--r-2xs', '--r-tl', '--r-xs', '--r-preview', '--r-ov', '--r-glass', '--fs-tiny', '--fs-ov-icon', '--fs-ov-step',
  '--tl-track', '--tl-rec', '--tl-nvr', '--tl-nvr-stripe', '--tl-evt', '--tl-evt-hover', '--tl-hit', '--tl-bm', '--tl-bm-hover',
  '--tl-mark-edge', '--tl-playhead', '--tl-pill-ink', '--tl-gap', '--tl-unknown',
  '--ov-shade', '--ov-live', '--ov-badge-bg', '--ov-bg-faint', '--ov-step-bg', '--ov-step-text', '--ov-note-bg', '--ov-note-glass',
  '--ov-stats-bg', '--ov-stats', '--ov-ring', '--ov-label', '--ov-label-quiet', '--ov-badge-text', '--ov-text-quiet', '--ov-dot-off', '--ov-edge-soft',
  '--ov-warn-text', '--ov-select', '--ov-tool-bg', '--ov-tool-edge', '--ov-chip-edge', '--ov-halo', '--ov-credit', '--ov-pill',
  '--ov-lift', '--ov-drag-lift', '--ov-glass-top', '--ov-glass-bottom', '--ov-glass-text', '--ov-text-muted', '--ov-glass',
  '--ov-glass-hover', '--ov-glass-strong', '--ov-glass-line',
]
const block = (re) => (tokens.match(re) ?? [''])[0]
const dark = block(/html:root\s*\{[^}]*\}/), light = block(/html:root\[data-theme="light"\]\s*\{[^}]*\}/)
const valueIn = (b, t) => strip(b).match(new RegExp(`${t}\\s*:\\s*([^;]+);`))?.[1].trim()
for (const t of bothThemes) {
  const decl = new RegExp(`${t}\\s*:`)
  check(`${t} is defined in both themes`, decl.test(dark) && decl.test(light))
  // video, the timeline and their corners and sizes look the same in either theme: a dark-only edit
  // to one of these would make the picture look different in light
  if (/^--(ov|tl|r|fs)-/.test(t)) check(`${t} has the same value in both themes`, valueIn(dark, t) !== undefined && valueIn(dark, t) === valueIn(light, t), `${valueIn(dark, t)} / ${valueIn(light, t)}`)
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
