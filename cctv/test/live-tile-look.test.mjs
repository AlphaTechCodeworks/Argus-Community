// cctv/test/live-tile-look.test.mjs
// How a Live tile looks (GUI refresh stage 2, task 2). The picture fills its tile edge to edge: the
// grid's cells take the picture's shape, so no black strip is left above and below it, and nothing
// opaque sits under it. The name sits over the bottom of the picture on the overlay scrim: the state
// dot and the camera's name, which ellipsizes, and the site once, muted, only when the cameras on the
// grid come from more than one site. The technical marks (CONV, the stream kind, the codec) are hidden
// unless "View options -> Show technical details" is ticked, a choice kept in this browser.
//   node cctv/test/live-tile-look.test.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }

const pub = join(import.meta.dirname, '..', 'public')
const read = (f) => readFileSync(join(pub, f), 'utf8').replace(/\r\n/g, '\n')
const noCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length))
const liveCss = noCssComments(read('css/live.css'))
const styleCss = noCssComments(read('style.css'))
const html = read('index.html').replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length))
const viewer = read('viewer.js')
const tileJs = read('live-tile.js')

// every declaration block whose selector list matches `sel` (a regex), joined
const rules = (css, sel) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => sel.test(m[1])).map((m) => m[2]).join(';')

// ---- the picture fills its tile ----
const { pictureTracks, spansSites } = await import('../public/grid-view.js')
{
  check('grid-view.js exports pictureTracks', typeof pictureTracks === 'function')
  // 3 x 3 in a wide box: the height decides, columns are the picture's shape and centred (within
  // the 2 px that whole pixels cost: each side is whole, the shorter one floored)
  const wide = pictureTracks?.({ cols: 3, rows: 3, width: 1600, height: 600, gap: 8, aspect: 16 / 9 })
  const rowH = (600 - 16) / 3
  check('a wide box: rows fill the height', wide && Math.abs(wide.row - rowH) < 1, JSON.stringify(wide))
  check('  and each column is the picture\'s width for that height', wide && Math.abs(wide.col - rowH * 16 / 9) < 2, JSON.stringify(wide))
  // 3 x 3 in a tall box: the width decides
  const tall = pictureTracks?.({ cols: 3, rows: 3, width: 900, height: 1200, gap: 8, aspect: 16 / 9 })
  const colW = (900 - 16) / 3
  check('a tall box: columns fill the width, rows are the picture\'s height', tall && Math.abs(tall.col - colW) < 2 && Math.abs(tall.row - colW * 9 / 16) < 1, JSON.stringify(tall))
  // the 1 px tile border is outside the picture: the picture inside it keeps its shape
  const b = pictureTracks?.({ cols: 2, rows: 2, width: 1000, height: 2000, gap: 0, aspect: 16 / 9, border: 1 })
  check('the tile border is allowed for: the picture inside it is 16:9', b && Math.abs((b.col - 2) / (b.row - 2) - 16 / 9) < 0.02, JSON.stringify(b))
  check('never more than the box', [wide, tall, b].every((t) => t && t.col > 0 && t.row > 0))
  check('no size yet: null (the grid keeps 1fr tracks)', pictureTracks?.({ cols: 3, rows: 3, width: 0, height: 0, gap: 8, aspect: 16 / 9 }) === null)
}
check('render() and relayout() shape the cells from the picture (applyTracks)', (viewer.match(/applyTracks\(size, rows\)/g) ?? []).length >= 2)
const apply = (viewer.match(/function applyTracks\([^)]*\) \{([\s\S]*?)\n\}/) ?? ['', ''])[1]
check('  applyTracks uses pictureTracks with the grid\'s own room', /pictureTracks\(/.test(apply) && /clientWidth/.test(apply) && /clientHeight/.test(apply))
check('  only for a picture that is shown whole (Auto, Fit): Fill and Stretch keep 1fr', /pictureFit\.value === 'fill'|'fill', 'stretch'|\['fill', 'stretch'\]/.test(apply))
check('  the rows start at the top of the grid (no empty band above the first row)', /align-content:\s*start/.test(rules(liveCss, /\.live-page #grid\s*$/)) && !/align-content:\s*center/.test(rules(liveCss, /\.live-page #grid\s*$/)))
check('  and the grid is centred across', /justify-content:\s*center/.test(rules(liveCss, /\.live-page #grid\s*$/)))
check('a resized window reshapes them for every layout, not only Auto', /new ResizeObserver\(\(\) => \{[\s\S]{0,400}applyTracks/.test(viewer))
check('changing Picture reshapes them', /pictureFit\.addEventListener\('change', \(\) => \{[\s\S]{0,300}applyTracks/.test(viewer))

// ---- nothing opaque under the picture: the name is over it, on the scrim ----
const label = rules(liveCss, /\.live-page #grid \.tile \.label\s*$/)
check('the Live tile label has no solid bar behind it (no --video-bg, no min-height)', !/--video-bg/.test(label) && !/min-height/.test(label), label)
check('  it sits on the overlay scrim (a gradient to --ov-shade / --scrim)', /gradient\([^)]*var\(--(ov-shade|scrim)\)/.test(label), label)
check('  in the overlay text colour', /color:\s*var\(--ov-(label|text)\)/.test(label), label)
// readable over a white, floodlit picture: the fade reaches the full shade by the top of the text
// (the label's top padding), and the letters have a shadow
check('  the fade is full by the top of the text', /gradient\(transparent, var\(--ov-shade\) var\(--s4\)\)/.test(label) && /padding:\s*var\(--s4\)/.test(label), label)
check('  the text has a shadow', /text-shadow:[^;]*var\(--ov-shade\)/.test(label), label)
const dense = rules(liveCss, /\.live-page #grid:is\(\[data-size="5"\], \[data-size="6"\], \[data-size="8"\], \[data-size="10"\], \[data-size="12"\]\) \.tile \.label\s*$/)
// The placeholder ("Connecting to camera", "Camera offline": an offline tile keeps it for good) never
// runs under the name: its second line goes from 3 x 3 up, and it is centred in the room above the
// label, 40 px for the full-size label (3 x 3, 4 x 4), 24 px for the small one (5 x 5 and up)
check('from 3 x 3 up the placeholder has no second line', /\.live-page #grid:not\(\[data-size="1"\]\):not\(\[data-size="2"\]\) \.tile-placeholder > span\s*\{[^}]*display:\s*none/.test(liveCss))
check('  3 x 3 and 4 x 4: compact, 40 px kept clear for the label', /padding:\s*8px 6px 40px/.test(rules(liveCss, /\.live-page #grid:is\(\[data-size="3"\], \[data-size="4"\]\) \.tile-placeholder\s*$/)))
check('  5 x 5 and up: compact, 24 px for the small label', /padding:\s*8px 6px 24px/.test(rules(liveCss, /\.live-page #grid:is\(\[data-size="5"\], \[data-size="6"\], \[data-size="8"\], \[data-size="10"\], \[data-size="12"\]\) \.tile-placeholder\s*$/)))
check('full screen shares the spare height above and below the rows', /align-content:\s*center/.test(rules(liveCss, /\.live-page #grid:fullscreen\s*$/)))
check('a wall of small tiles (5x5 and up) has a smaller label, its fade full by its text too', /font-size:\s*var\(--fs-tiny\)/.test(dense) && /gradient\(transparent, var\(--ov-shade\) var\(--s2\)\)/.test(dense) && /padding:\s*var\(--s2\)/.test(dense), dense)
check('TILE_HTML: the label holds the dot, then the name', /<div class="label"><span class="dot [^"]*"[^>]*><\/span><span class="name"><\/span><\/div>/.test(tileJs))
const nameCss = rules(styleCss, /^\s*\.tile \.name\s*$/) + rules(styleCss, /\.tile \.label \.name\s*$/)
check('the name ellipsizes (one line, hidden overflow, ellipsis, can shrink)', /overflow:\s*hidden/.test(nameCss) && /text-overflow:\s*ellipsis/.test(nameCss) && /white-space:\s*nowrap/.test(nameCss) && /min-width:\s*0/.test(nameCss), nameCss)
// the green LIVE dot in the corner said what the label's dot says: on the grid it is folded into it
check('the corner LIVE dot is not drawn on grid tiles (the label\'s dot shows live)', /\.live-page #grid \.tile:not\(\.single-overlay\) > \.status\.live[^{]*\{[^}]*(display:\s*none|clip)/.test(liveCss))

// ---- the site, once ----
const tileLabel = (viewer.match(/function tileLabel\([^)]*\) \{([\s\S]*?)\n\}/) ?? ['', ''])[1]
check('the name no longer carries the site (tileLabel)', tileLabel.length > 0 && !/site/.test(tileLabel), tileLabel)
check('spansSites: one site, or none, is not many', spansSites?.([{ site: 'A' }, { site: 'A' }]) === false && spansSites?.([]) === false && spansSites?.([null, { site: 'A' }]) === false)
check('spansSites: two sites are', spansSites?.([{ site: 'A' }, null, { site: 'B' }]) === true)
check('spansSites: with no sites set, two recorders are (the tile shows the recorder\'s name then)', spansSites?.([{ site: '', nvrName: 'NVR 1' }, { site: '', nvrName: 'NVR 2' }]) === true && spansSites?.([{ site: '', nvrName: 'NVR 1' }, { site: '', nvrName: 'NVR 1' }]) === false)
check('render() and relayout() mark whether the grid spans sites (markSites)', (viewer.match(/markSites\(perPage\)/g) ?? []).length >= 2)
check('  as data-sites, from every camera of the grid (not just this page)', /function markSites\(perPage\) \{\s*grid\.dataset\.sites = spansSites\(shownCameras\(gridCameras\(\)/.test(viewer))
check('  the site is hidden unless it does', /#grid:not\(\[data-sites="many"\]\) \.tile-source\s*\{[^}]*display:\s*none/.test(liveCss))
const source = rules(liveCss, /^\s*\.tile-source\s*$/)
check('  and muted (a lighter overlay word, still legible), and it ellipsizes', /color:\s*var\(--ov-label-quiet\)/.test(source) && /text-overflow:\s*ellipsis/.test(source), source)

// ---- technical marks on request ----
const { TECH_DETAILS_KEY, techDetailsShown } = await import('../public/live-tile.js')
check('live-tile.js: techDetailsShown is off by default', techDetailsShown?.({ getItem: () => null }) === false)
check('  on when this browser said so', techDetailsShown?.({ getItem: (k) => (k === TECH_DETAILS_KEY ? '1' : null) }) === true)
check('  off where storage is blocked', techDetailsShown?.({ getItem: () => { throw new Error('blocked') } }) === false)
check('CONV is a technical mark', /b\.className = 'sd-badge conv-badge tech'/.test(tileJs))
check('the stream kind is a mark, not words added to the name', !/\.name'\)\??\.append\(' \(/.test(tileJs) && /techBadge\(/.test(tileJs))
check('the full-size view\'s SD mark is a technical mark', /b\.className = 'sd-badge tech'/.test(viewer))
check('technical marks are hidden on grid tiles unless the page shows them', /\.live-page:not\(\.show-tech\) \.tile:not\(\.single-overlay\) \.tech\s*\{[^}]*display:\s*none/.test(liveCss))
check('  the full-size view keeps its SD mark (the one sign of why it is not full quality)', !/\.live-page:not\(\.show-tech\) \.tile \.tech\s*\{/.test(liveCss))
check('  a mark has no aria-label on its plain span; its title says it', !/techBadge\(text, title\) \{[\s\S]{0,400}aria-label'/.test(tileJs))
const panel = (html.match(/<div class="live-options-panel">([\s\S]*?)<\/div><\/details>/) ?? ['', ''])[1]
check('View options holds "Show technical details", off by default', /<input id="showTech" type="checkbox" \/> Show technical details/.test(panel))
check('  beside Hide offline and Smooth', /id="smooth"[^\n]*\n[^\n]*id="showTech"/.test(panel))
check('viewer.js keeps the choice in this browser and puts the class on the page', /techDetailsShown\(\)/.test(viewer) && /localStorage\.setItem\(TECH_DETAILS_KEY/.test(viewer) && /classList\.toggle\('show-tech'/.test(viewer))
check('the phone sheet shows it as it shows Hide offline', /label:has\(#showTech\)/.test(liveCss))

if (failures) { console.log(`\n${failures} failed`); process.exitCode = 1 } else console.log('\nall passed')
