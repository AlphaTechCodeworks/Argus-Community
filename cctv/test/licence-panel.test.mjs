// The Licence panel's plain-English formatters (the DOM part is guarded and does not run in node).
//   node cctv/test/licence-panel.test.mjs
import { statusLine, cameraLine } from '../public/licence-panel.js'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }

check('unlicensed reads plainly and neutrally', (() => { const s = statusLine({ status: 'none' }); return s.tone === 'neutral' && /all features are on/.test(s.text) })())
check('active names the edition and customer, green', (() => { const s = statusLine({ status: 'active', appName: 'Argus Pro', customer: 'Acme Port Ltd' }); return s.tone === 'ok' && s.text === 'Argus Pro — licensed to Acme Port Ltd.' })())
check('wrong-machine warns and points to the fingerprint', (() => { const s = statusLine({ status: 'wrong-machine', customer: 'Acme' }); return s.tone === 'warn' && /different machine/.test(s.text) })())
check('wrong-site warns about recorders', statusLine({ status: 'wrong-site' }).tone === 'warn')
check('over-cameras warns with the numbers', (() => { const s = statusLine({ status: 'over-cameras', appName: 'Argus Pro', customer: 'Acme', cameraCount: 80, maxCameras: 64 }); return s.tone === 'warn' && /80/.test(s.text) && /64/.test(s.text) })())
check('a broken stored licence reads as bad', ['bad-signature', 'malformed', 'unknown-key'].every((st) => statusLine({ status: st }).tone === 'bad'))
check('unknown status does not throw and stays neutral', statusLine({ status: 'weird' }).tone === 'neutral')
check('camera line: with a limit', cameraLine({ status: 'active', cameraCount: 40, maxCameras: 64 }) === '40 of 64 licensed cameras in use.')
check('camera line: no limit', /no camera limit/.test(cameraLine({ status: 'active', cameraCount: 40, maxCameras: null })))

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exitCode = failures ? 1 : 0
