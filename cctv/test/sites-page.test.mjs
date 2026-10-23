// The Sites page (public/sites.js, sites.html, css/sites.css): recorder cards two to a row on a wide
// screen, and the sub-stream warning as one short line with a Fix button that opens the recorder's
// existing Sub-streams dialog. sites.js runs against the page as it loads, so it is checked on its
// source, as hik-sites.test.mjs and camera-editor.test.mjs do.
//   node cctv/test/sites-page.test.mjs
import { readFileSync } from 'node:fs'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const js = read('public/sites.js')
const html = read('public/sites.html')

// ---- the sub-stream warning ----
check('one short line: "N cameras send H.265 that some browsers can\'t play"', js.includes("`${seen.h265} camera${seen.h265 === 1 ? ' sends' : 's send'} H.265 that some browsers can't play`"))
check('the old long sentence is gone', !/Most browsers can’t play H\.265 in live grids — set these cameras’ sub-streams to H\.264 on the NVR\./.test(js))
check('a Fix button beside it opens that recorder\'s Sub-streams dialog', /textContent: 'Fix'/.test(js) && /fix\.addEventListener\('click', \(\) => openSubstreams\(nvr\)\)/.test(js))
check('Fix only where Sub-streams is offered (an online TVT recorder)', /const canSwitch = n\.status === 'online' && n\.brand !== 'hikvision'/.test(js) && /subStreamNote\(n\.subStreamsSeen, canSwitch \? n : null\)/.test(js))
check('Sub-streams is still not offered for a Hikvision device', /n\.status === 'online' && n\.brand !== 'hikvision'/.test(js))
check('the dialog itself is unchanged', /<dialog id="subs" class="st-dialog st-discover" aria-labelledby="s-title">/.test(html) && /async function openSubstreams\(nvr\)/.test(js))

// ---- the recorder cards ----
check('each recorder and its cameras dropdown are one card', /el\('div', \{ className: 'st-nvr-card' \}, row, camerasPanel\(n\)\)/.test(js))
check('Find device can still find the row', /row\.dataset\.nvr = n\.id/.test(js))
check('the page loads its stylesheet', /<link rel="stylesheet" href="css\/sites\.css" \/>/.test(html))
const css = read('public/css/sites.css').replace(/\/\*[\s\S]*?\*\//g, '')
const wide = css.match(/@media \(min-width: 1100px\) \{([\s\S]*)\}\s*$/)?.[1] ?? ''
check('from 1100px: two columns of recorder cards', /\.st-nvrs \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(wide))
check('…and the page is allowed to use the width', /\.sites-page \.st-main \{[^}]*max-width: /.test(wide))
check('a card with its camera editor open takes the whole row', /\.st-nvr-card:has\(\.st-cameras\[open\]\) \{[^}]*grid-column: 1 \/ -1/.test(wide))
check('the warning line keeps its words and button on one line where it fits, wrapping on a phone', /\.st-subs-warn \{[^}]*display: flex;[^}]*flex-wrap: wrap/.test(css))
check('no fixed widths that could push a phone sideways', !/(?<!max-|min-)width:\s*\d{3,}px/.test(css))

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
