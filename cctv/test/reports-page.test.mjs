// The Reports page (public/reports.js, reports.html): while Argus is not recording, no recording
// figures ("–", "0 cameras", "0 B") but one plain line; event kinds in the Alarms page's words; and a
// section with nothing in it says so once, not once per table.
//   node cctv/test/reports-page.test.mjs
import { readFileSync } from 'node:fs'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const { recordingOff, eventRows, NOT_RECORDING, EMPTY } = await import('../public/reports.js')
const { LABELS } = await import('../public/alarms-view.js')

// ---- is Argus recording? ----
// /api/admin/reports gives each camera `recording: false` when its recording mode is "off" (the
// server's cameraRecording(...).mode), which is what the global "recording off" sets for all of them
const cam = (recording) => ({ recording, recordedShare: recording ? 0.5 : null })
check('every camera off: not recording', recordingOff({ cameras: [cam(false), cam(false)] }) === true)
check('one camera recorded: recording', recordingOff({ cameras: [cam(false), cam(true)] }) === false)
check('no cameras at all: nothing is being recorded', recordingOff({ cameras: [] }) === true)
check('the line, word for word', NOT_RECORDING === "Argus isn't recording — each recorder keeps its own copy", NOT_RECORDING)

// ---- event kinds in words ----
const ev = eventRows({ motion: 1200, 'camera-offline': 3, 'ai-person': 40, 'something-new': 2 })
check('kinds read as the Alarms page names them, busiest first', ev.map((r) => r[0]).join('|') === 'Motion|Person|Camera offline|something-new', ev.map((r) => r[0]).join('|'))
check('the counts are formatted', ev[0][1] === '1,200')
check('the words are the alarms\' own map, not a copy', LABELS.motion === 'Motion' && /import \{ labelOf \} from '\.\/alarms-view\.js'/.test(read('public/reports.js')) && !/'camera-offline':\s*'Camera offline'/.test(read('public/reports.js')))

// ---- the page ----
const js = read('public/reports.js')
check('one empty line for a section with nothing', EMPTY === 'Nothing in this period.' && /function pair\(/.test(js))
check('a pair of empty tables becomes that one line', /if \(!a\.length && !b\.length\) return el\('p', 'hp-note', EMPTY\)/.test(js))
check('while not recording: the cards become the one line and the two recording sections are hidden', /const off = recordingOff\(rep\)/.test(js) && /el\('p', 'rp-off', NOT_RECORDING\)/.test(js) && /\$\('rpWorst'\)\.closest\('section'\)\.hidden = off/.test(js) && /\$\('rpGaps'\)\.closest\('section'\)\.hidden = off/.test(js))
check('while not recording: Every camera shows the camera and its events, no "0 B"', /off\s*\?\s*table\(\['Camera', 'Events'\]/.test(js))
check('the page wiring only runs in a browser (the helpers load on their own)', /if \(typeof document !== 'undefined' && document\.getElementById\('rpCards'\)\)/.test(js))
const html = read('public/reports.html')
const css = read('public/style.css')
check('the one line spans the summary row', /\.rp-off \{[^}]*grid-column: 1 \/ -1/.test(css))

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
