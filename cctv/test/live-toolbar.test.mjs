// cctv/test/live-toolbar.test.mjs
// Live opens on the cameras, not on a panel of controls. One slim row above the grid holds what is
// used every day (Browse to pick a site or camera, the find box, Layout, the pager, full screen);
// everything else is one click away under "View options", and nothing was dropped on the way. Where
// the row does not fit it folds to Browse, the pager, full screen and "Filters", which opens the rest
// as a sheet; it never wraps. The offline message
// sits at the top of the grid and can be put away, instead of covering the bottom row of tiles.
//   node cctv/test/live-toolbar.test.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }

const pub = join(import.meta.dirname, '..', 'public')
const read = (f) => readFileSync(join(pub, f), 'utf8')
// (comments blanked, not removed, so positions hold)
const html = read('index.html').replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length))
const viewer = read('viewer.js')
const css = read('css/live.css').replace(/\/\*[\s\S]*?\*\//g, '')
const browser = read('camera-browser.js')

// the inner HTML of the first element opened by `open` (a regex for its start tag), up to its own close
function inner(open, tag) {
  const m = html.match(open)
  if (!m) return ''
  let depth = 1, i = m.index + m[0].length
  const re = new RegExp(`<(/?)${tag}\\b`, 'g')
  re.lastIndex = i
  for (let t; (t = re.exec(html));) {
    depth += t[1] ? -1 : 1
    if (depth === 0) return html.slice(i, t.index)
  }
  return html.slice(i)
}
const has = (block, id) => new RegExp(`id="${id}"`).test(block)

// ---- one toolbar row ----
const toolbars = html.match(/<header class="live-toolbar"/g) ?? []
check('index.html has one toolbar, <header class="live-toolbar">', toolbars.length === 1, String(toolbars.length))
const bar = inner(/<header class="live-toolbar"[^>]*>/, 'header')
check('  after the page header and before the grid', html.indexOf('class="page-head"') < html.indexOf('class="live-toolbar"') && html.indexOf('class="live-toolbar"') < html.indexOf('<main id="grid"'))
check('  it holds the site and camera picker\'s place (.live-scope, where Browse is put)', /class="live-scope"/.test(bar))
for (const [id, what] of [['cameraSearch', 'the find box'], ['layout', 'Layout'], ['livePager', 'the pager'], ['fullscreen', 'the full-screen button'], ['mobileControls', 'the phone\'s Filters button']]) {
  check(`  it holds ${what} (#${id})`, has(bar, id))
}
check('  the phone button says "Filters"', /id="mobileControls"[^>]*>Filters</.test(bar), (bar.match(/id="mobileControls"[^>]*>[^<]*/) ?? [''])[0])

// ---- Browse is the one site picker ----
check('no separate Site <select> (#site) on Live', !/id="site"/.test(html) && !/id="siteLabel"/.test(html))
check('viewer.js no longer looks for a #site select', !/getElementById\('site'\)/.test(viewer) && !/siteSelect\b/.test(viewer))
check('viewer.js mounts Browse on .live-scope', /mountCameraBrowser\(\{[\s\S]{0,80}host: document\.querySelector\('\.live-scope'\)/.test(viewer))
// what choosing a site did through the select still happens, now in one function Browse calls
const choose = (viewer.match(/function chooseSite\([^)]*\) \{([\s\S]*?)\n\}/) ?? ['', ''])[1]
check('choosing a site goes through one function (chooseSite)', choose.length > 0)
for (const [re, what] of [
  [/rememberSite\(/, 'remembers the site for every page (rememberSite)'],
  [/page = 0/, 'goes back to the first page'],
  [/activeView = null/, 'leaves the saved view'],
  [/stopCycle\(\)/, 'stops going round views'],
  [/setItem\('cctv\.activeView', ''\)/, 'forgets the saved view'],
  [/renderViewSel\(\)/, 'puts the View menu back on "(not saved)"'],
  [/setItem\('cctv\.site', /, 'keeps the choice with the account (cctv.site)'],
  [/freshenForPageChange\(\)/, 'drops the old site\'s video still on its way'],
  [/closeSingle\(\)/, 'closes a camera open full size'],
  [/render\(\)/, 'draws the new grid']
]) check(`  it ${what}`, re.test(choose))
check('Browse\'s site and camera choices call it', /onSite: \(name\) => chooseSite\(name\)/.test(viewer) && /onCamera: \(cam\) => \{ chooseSite\(cam\.site\)/.test(viewer))
// the select could narrow a site with several recorders to one of them: Browse can too
check('Browse offers one recorder of a site with several (recorders / onRecorder)', /recorders: /.test(viewer) && /onRecorder: /.test(viewer) && /recorders\b/.test(browser) && /onRecorder\b/.test(browser))

// ---- View options holds the rest ----
const options = inner(/<details class="live-options"[^>]*>/, 'details')
check('"View options" holds the saved views (#viewSel)', has(options, 'viewSel'))
for (const id of ['saveView', 'cycleViews', 'startOrderBtn', 'hideOffline', 'smooth', 'pictureFit', 'resetOrder', 'remoteMark']) {
  check(`  and #${id}`, has(options, id))
}
check('the View select is not on the toolbar row itself', !has(bar.replace(options, ''), 'viewSel'))

// ---- no "% of frames shown" pill ----
// (the figure is measured still, and each screen's share is in Health > Technical details >
// Viewing experience: experience-view.js wallView, "Frames shown")
check('Live draws no "% of frames shown" pill (#wallHealth)', !/wallHealth/.test(viewer) && !/frames shown`/.test(viewer))
check('Health\'s technical details list each screen\'s frames shown', /'Frames shown'/.test(read('experience-view.js')) && /id="technical"/.test(read('health.html')) && /id="experienceWallRows"/.test(read('health.html')))
check('live.css keeps no .wall-health rules', !/\.wall-health/.test(css))

// ---- the offline notice: a bar at the top of the grid, put away for the session ----
const notice = html.match(/<div id="notice"[^>]*>/)?.[0] ?? ''
check('the notice is a bar (div#notice.live-notice)', /class="live-notice"/.test(notice), notice)
check('  before the grid, not after it', html.indexOf('id="notice"') > 0 && html.indexOf('id="notice"') < html.indexOf('<main id="grid"'))
check('  with a button that puts it away (#noticeClose, a .btn)', /<button id="noticeClose"[^>]*class="btn[^"]*"/.test(html))
check('  the putting away is remembered for the session (sessionStorage)', /sessionStorage\.setItem\(NOTICE_KEY/.test(viewer) && /sessionStorage\.getItem\(NOTICE_KEY/.test(viewer))
const noticeRule = css.match(/\.live-notice\s*\{([^}]*)\}/)?.[1] ?? ''
check('  it is not fixed over the tiles', noticeRule.length > 0 && !/position:\s*(fixed|absolute)/.test(noticeRule), noticeRule.trim())

// ---- where the row does not fit: it folds, never wraps ----
// Folded, the row keeps Browse, the pager, full screen and "Filters" (turning the page is frequent);
// Filters opens the find box, Layout and View options as a sheet. Both states are one row.
const display = inner(/<div class="live-display" id="liveDisplay"[^>]*>/, 'div')
for (const id of ['cameraSearch', 'layout', 'viewSel', 'filtersDone']) check(`the sheet (#liveDisplay) holds #${id}`, has(display, id))
for (const id of ['livePager', 'fullscreen', 'cycleStop', 'mobileControls']) check(`#${id} stays on the row, outside the sheet`, has(bar, id) && !has(display, id))
const order = ['class="live-scope"', 'id="liveDisplay"', 'id="livePager"', 'id="fullscreen"', 'id="mobileControls"'].map((s) => bar.indexOf(s))
check('  in the order Browse, (the sheet), pager, full screen, Filters', order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])), order.join(' '))
const row = css.match(/\.live-page\.has-shell \.app-main > header \.controls \{([^}]*)\}/)?.[1] ?? ''
check('the row never wraps (flex-wrap: nowrap)', /flex-wrap: nowrap/.test(row), row.trim())
check('  nor does the part that folds', /\.live-display \{[^}]*flex-wrap: nowrap/.test(css))
check('the toolbar is a size container, so the fold follows its real width (sidebar pinned or not)', /\.live-toolbar \{[^}]*container: live-toolbar \/ inline-size/.test(css))
const foldAt = css.search(/@container live-toolbar \(max-width: (\d+)px\) \{/)
const N = Number(css.match(/@container live-toolbar \(max-width: (\d+)px\) \{/)?.[1])
// the measured need (index.html widths at their tightest, 2026-10-19): Browse 120 + find 120 + Layout
// 167 + View options 121 + Stop cycling 103 + pager and full screen 204 + 5 gaps of 12 = 895
check('it folds below the width the whole row needs (at least 895 px of toolbar)', foldAt >= 0 && N + 1 >= 895, String(N))
const fold = foldAt >= 0 ? css.slice(foldAt, css.indexOf('\n}', foldAt)) : ''
check('  folded, the sheet\'s contents are hidden until Filters is pressed', /\n  \.live-display \{ display: none; \}/.test(fold))
check('  Filters is shown', /\.mobile-controls \{[^}]*display: inline-flex/.test(fold))
check('  pressed, they open as a sheet under the row', /\.live-page\.mobile-controls-open \.live-display \{[^}]*position: absolute; top: calc\(100% \+ var\(--s2\)\)/.test(fold))
// Browse stays in the fold (a rehearsal at ~730 px, 2026-10-19, found it gone: width 0): it is never
// hidden, with one site too, and the fold does not squeeze it to nothing
check('  Browse keeps a width of its own when folded (min-width above 0)', /\n  \.live-scope \{[^}]*min-width: (\d+)px/.test(fold) && Number(fold.match(/\n  \.live-scope \{[^}]*min-width: (\d+)px/)[1]) >= 80, (fold.match(/\n  \.live-scope \{[^}]*\}/) ?? [''])[0])
check('  nor is it hidden in the fold', !/\.live-scope[^{]*\{[^}]*display: none/.test(fold))
check('Browse is never hidden by the page, with one site too', !/querySelector\('\.live-scope'\)\.hidden = (?!false)/.test(viewer) && !/names\.length < 2/.test(viewer))
check('  the pager is not hidden when folded',!/live-navigation \{[^}]*display: none|livePager[^{]*\{[^}]*display: none/.test(fold))
check('the old under-600 px phone block is gone', !/@media \(max-width: 599px\)/.test(css))
check('the sheet has a Done button and Escape closes it', has(bar, 'filtersDone') && /'Escape'/.test(viewer) && /closeFilters\(\)/.test(viewer))

// ---- the sheet and the keyboard (review of task 1: I1, M1-M6) ----
const setFilters = (viewer.match(/function setFilters\([^)]*\) \{([\s\S]*?)\n\}/) ?? ['', ''])[1]
// focus goes into the sheet; into the find box only from the keyboard, since on a phone focusing a
// text box from a tap brings up the on-screen keyboard over the sheet (final review I2)
check('opening the sheet from the keyboard puts focus in the find box', /if \(open\)[^\n]*keyboard \? document\.getElementById\('cameraSearch'\)/.test(setFilters), setFilters.trim().slice(0, 160))
check('  from a tap, the sheet itself (no on-screen keyboard)', /: document\.getElementById\('liveDisplay'\)\)\.focus\(\)/.test(setFilters) && /id="liveDisplay" tabindex="-1"/.test(html))
check('  Filters says which: a click with no pointer behind it (Enter, Space) is the keyboard', /mobileControls\.addEventListener\('click', \(e\) => [^\n]*setFilters\(true, \{ keyboard: e\.detail === 0 \}\)/.test(viewer))
check('"/" opens the folded sheet on the find box (it is hidden in the fold)', /filtersShown\(\) && !filtersOpen\(\)\) setFilters\(true, \{ keyboard: true \}\)/.test(viewer))
const closeFn = (viewer.match(/function closeFilters\([^)]*\) \{([\s\S]*?)\n\}/) ?? ['', ''])[1]
check('closing it gives focus back to Filters, only when Filters is on screen', /filtersShown\(\)/.test(closeFn) && /mobileControls\.focus\(\)/.test(closeFn))
check('widening the window past the fold closes the sheet', /addEventListener\('resize', [\s\S]{0,160}filtersShown\(\)[\s\S]{0,80}setFilters\(false\)/.test(viewer))
const esc = viewer.match(/document\.addEventListener\('keydown', \(e\) => \{[^\n]*mobile-controls-open[^\n]*/)?.[0] ?? ''
check('one Escape closes one layer: View options first, then the sheet', /\.live-options\[open\]/.test(esc), esc.slice(0, 160))
check('a click outside the toolbar closes the sheet (not one inside a dialog)', /addEventListener\('pointerdown', [\s\S]{0,240}live-toolbar[\s\S]{0,120}closest(\?\.)?\('dialog'\)[\s\S]{0,80}setFilters\(false\)/.test(viewer))
check('Stop cycling keeps its one accessible name where it reads "Stop"', /<button id="cycleStop"[^>]*aria-label="Stop cycling"/.test(html))
const closeNotice = viewer.match(/getElementById\('noticeClose'\)\.addEventListener\('click', \(\) => \{([\s\S]*?)\n\}\)/)?.[1] ?? ''
check('putting the notice away leaves the keyboard on the toolbar, not lost', /\.focus\(\)/.test(closeNotice))
check('the notice\'s live region is always rendered, around the bar that hides', /<div[^>]*role="status"[^>]*>\s*<div id="notice"/.test(html) && !/id="noticeText"[^>]*role=/.test(html))

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
