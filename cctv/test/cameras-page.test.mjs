// The Cameras page (public/cameras.js, cameras.html, css/cameras.css): one compact row per camera
// instead of the old sixteen-column table, a card per camera on a phone, the same count line as the
// rest of the app, and the two bulk tools under plainer names. The row words come from pure helpers,
// so they are checked on plain data; the page wiring is checked on the source.
//   node cctv/test/cameras-page.test.mjs
import { readFileSync } from 'node:fs'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const { flatten, headerSub, HEAD } = await import('../public/cameras.js')

// ---- what a row says ----
const report = {
  at: Date.parse('2026-10-19T02:00:00'),
  cached: true,
  nvrs: [
    { nvr: 'a', nvrName: 'North', site: 'Harbour', nvrOnline: true, cameras: [
      { ch: 3, name: 'Gate', online: true, ip: '192.168.3.21', maker: 'TVT', model: 'TD-9541', mainRes: '2560x1440', mainFps: 25, mainEnct: 'h265', mainBitType: 'VBR', h265pCapable: true, subRes: '704x576', subFps: 15, subCodec: 'h264', recStatus: 'recording', poe: true },
      { ch: 1, name: 'Yard', online: false, ip: '192.168.3.22', maker: '', model: '', mainRes: '', subRes: '' }
    ] },
    { nvr: 'b', nvrName: 'Office', site: 'Town', nvrOnline: false, cameras: [] }
  ]
}
const rows = flatten(report)
const gate = rows.find((r) => r.name === 'Gate')
check('rows are sorted by channel within a recorder', rows[0].name === 'Yard' && rows[1].name === 'Gate')
check('first line: the camera name, then its site, recorder and channel', gate.name === 'Gate' && gate.where === 'Harbour · North · ch 3', gate.where)
check('second line: make and model, then the main stream', gate.detail === 'TVT TD-9541 · 2560x1440 @25 · H.265', gate.detail)
check('online and the IP address are on the row', gate.online === true && gate.ip === '192.168.3.21')
check('nothing disappears: every old column is in the row\'s tooltip', HEAD.every((h) => gate.title.includes(`${h}:`)) && /Bitrate: VBR/.test(gate.title) && /H\.265\+\?: Yes/.test(gate.title) && /Sub: 704x576 @15/.test(gate.title) && /Codec: H264/.test(gate.title) && /Rec: recording/.test(gate.title) && /PoE: Yes/.test(gate.title), gate.title)
const yard = rows.find((r) => r.name === 'Yard')
check('an offline camera is marked offline and its empty details leave no stray dots', yard.online === false && yard.camOffline === true && yard.detail === '', JSON.stringify(yard.detail))
const off = rows.find((r) => r.offline)
check('a recorder that is not answering keeps one row that says so', off && off.where === 'Town · Office' && /offline/.test(off.name), JSON.stringify(off))
check('the filter still searches the recorder, camera, IP and model', gate.blob.includes('north') && gate.blob.includes('192.168.3.21') && gate.blob.includes('td-9541'))

// ---- the header line ----
const sub = headerSub(report, Date.parse('2026-10-19T09:00:00'))
check('header: "N cameras on M recorders · … · snapshot HH:MM"', sub === '2 cameras on 1 recorder · 1 recorder not answering · snapshot 02:00', sub)
const fresh = headerSub({ ...report, cached: false, nvrs: [report.nvrs[0]] }, Date.parse('2026-10-19T09:00:00'))
check('after Refresh: "read just now"', fresh === '2 cameras on 1 recorder · read just now, 02:00', fresh)

// ---- the page ----
const html = read('public/cameras.html')
const js = read('public/cameras.js')
check('the two bulk tools have plain names', />Use H\.265 to save space…<\/button>/.test(html) && />Limit picture size…<\/button>/.test(html) && !/Optimise codecs…|Cap resolution…/.test(html))
check('…and do what they did', /\$\('cmOptimise'\)\.addEventListener\('click', startOptimise\)/.test(js) && /\$\('cmCapRes'\)\.addEventListener\('click', startCap\)/.test(js) && /\/streams\/optimise/.test(js) && /\/streams\/cap-resolution/.test(js))
check('Refresh, Download Excel, the filter and paging stay', /id="cmRefresh"/.test(html) && /id="cmXlsx"/.test(html) && /id="cmFilter"/.test(html) && /id="cmPrevious"/.test(html) && /id="cmNext"/.test(html) && /\/api\/admin\/cameras\.xlsx/.test(js) && /PAGE_SIZE = 50/.test(js))
check('the cameras are a list of rows, not a wide table', /el\('ul', 'cm-list'\)/.test(js) && !/el\('table', 'al-table rp-table'\)\s*\n\s*const thead = el\('thead'\)\s*\n\s*const htr = el\('tr'\)\s*\n\s*for \(const h of HEAD\)/.test(js))
check('the page loads its stylesheet', /<link rel="stylesheet" href="css\/cameras\.css" \/>/.test(html))
check('the page wiring only runs in a browser (the helpers load on their own)', /if \(typeof document !== 'undefined' && document\.getElementById\('cmTable'\)\)/.test(js))

// ---- the layout ----
const css = read('public/css/cameras.css').replace(/\/\*[\s\S]*?\*\//g, '')
const wide = css.match(/@media \(min-width: 700px\) \{([\s\S]*)\}\s*$/)?.[1] ?? ''
check('from 700px: one compact row, dot, two lines, IP on the right', /grid-template-areas: "dot name ip" "dot detail ip"/.test(wide))
check('under 700px: each camera is a card', /\.cm-row \{[^}]*border: 1px solid var\(--border\)[^}]*border-radius: var\(--r-md\)/.test(css.replace(wide, '')))
check('nothing is wider than a phone', !/(?<!max-|min-)width:\s*\d{3,}px/.test(css) && /minmax\(0, 1fr\)/.test(css) && /overflow-wrap: anywhere/.test(css))

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
