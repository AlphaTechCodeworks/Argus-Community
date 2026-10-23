// Tests picking the cameras to keep streaming ahead of Live (warm-streams.mjs).
//   node cctv/test/warm-streams.test.mjs
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'warm-')) // (the default warm-out.json lands here, never in data/)
delete process.env.CCTV_WARM_ALL_CAP // (the defaults are tested first; set further down)
delete process.env.CCTV_WARM_PER_NVR
const { ALL_CAP, FIRST_RUN_MS, OUT_FILE, OUT_SAVE_STEP_MS, PER_NVR, RELEASE_PER_RUN, pickWarm, startWarmStreams, warmCaps } = await import('../warm-streams.mjs')

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }

const cams = Array.from({ length: 30 }, (_, i) => ({ nvr: i < 20 ? 'a' : 'b', ch: i % 20, online: i !== 3 }))
const def = pickWarm({ cameras: cams, orders: {} })
check('no saved order: the first screen of the default order', def.length === 9 && def[0] === 'a/0')
check('offline cameras are skipped', !def.includes('a/3') && def.includes('a/9'), def.join(' '))
const one = pickWarm({ cameras: cams, orders: { mike: ['b/5', 'b/6'] } })
check('a user\'s own order comes first', one[0] === 'b/5' && one[1] === 'b/6' && one.length === 9, one.join(' '))
const many = pickWarm({ cameras: cams, orders: { u1: ['a/10', 'a/11', 'a/12', 'a/13', 'a/14', 'a/15', 'a/16', 'a/17', 'a/18'], u2: ['b/0', 'b/1', 'b/2', 'b/4', 'b/5', 'b/6', 'b/7', 'b/8', 'b/9'] } })
check('several users with nothing in common: stopped at 16', many.length === 16, String(many.length))
check('and shared cameras counted once', new Set(many).size === many.length)
check('a camera no longer there is not kept', !pickWarm({ cameras: cams, orders: { u: ['z/1'] } }).includes('z/1'))

// running: adds a quiet viewer, and lets it go when the camera drops off the list
{
  const streams = new Map()
  const streamOf = (n, ch) => {
    const k = `${n}/${ch}`
    if (!streams.has(k)) streams.set(k, { viewers: new Set(), add(v) { this.viewers.add(v) }, remove(v) { this.viewers.delete(v) } })
    return streams.get(k)
  }
  let list = cams
  const w = startWarmStreams({ cameras: () => list, orders: () => ({}), streamOf, log: () => {}, everyMs: 1e9, firstRunMs: 0, outFile: null })
  w.run()
  check('the first screen has a viewer each', [...streams.values()].filter((s) => s.viewers.size === 1).length === 9)
  list = cams.map((c) => (c.nvr === 'a' && c.ch === 0 ? { ...c, online: false } : c))
  w.run()
  check('a camera that went offline is let go', streams.get('a/0').viewers.size === 0)
}

{
  // every online camera of an NVR that is not refusing streams, on top of the first screens
  const cams = [
    ...Array.from({ length: 20 }, (_, i) => ({ nvr: 'calm', ch: i, online: true })),
    ...Array.from({ length: 20 }, (_, i) => ({ nvr: 'busy', ch: i, online: true })),
    { nvr: 'calm', ch: 99, online: false }
  ]
  const got = pickWarm({ cameras: cams, orders: {}, roomy: (id) => id === 'calm' })
  check('a calm NVR: up to 16 of its online cameras are kept ready', got.filter((k) => k.startsWith('calm/')).length === 16)
  check('an offline camera is not', !got.includes('calm/99'))
  check('a refusing NVR: only what the first-screen rule picked', got.filter((k) => k.startsWith('busy/')).length === 0)
  check('without roomy: the old first-screen rule', pickWarm({ cameras: cams, orders: {} }).length === 9)
}
{
  // an NVR that refuses once stays out of the extra warm-up for 6 h, even after it goes quiet
  let t = 0
  let refusing = false
  const cams = Array.from({ length: 30 }, (_, i) => ({ nvr: 'v', ch: i, online: true }))
  const fake = () => ({ clients: new Set(), add(w) { this.clients.add(w) }, remove(w) { this.clients.delete(w) } })
  const w = startWarmStreams({ cameras: () => cams, orders: () => ({}), streamOf: fake, roomy: () => !refusing, log: () => {}, everyMs: 1e9, now: () => t, firstRunMs: 0, outFile: null })
  w.run()
  check('calm: 16 kept ready', w.held.size === 16, String(w.held.size))
  refusing = true
  w.run()
  check('refusing: the extra ones are let go, 2 per pass', w.held.size === 14, String(w.held.size))
  for (let i = 0; i < 3; i++) w.run()
  check('... back to the first screen (9) after 4 passes', w.held.size === 9, String(w.held.size))
  refusing = false
  t += 60 * 60_000
  w.run()
  check('quiet again an hour later: still only the first screen', w.held.size === 9, String(w.held.size))
  t += 6 * 60 * 60_000
  w.run()
  check('six hours on: warmed again', w.held.size === 16, String(w.held.size))
}
const fake = () => ({ clients: new Set(), add(v) { this.clients.add(v) }, remove(v) { this.clients.delete(v) } })
{
  // nothing is warmed in the first 5 minutes after a start (which NVRs refuse is not known yet)
  let t = 1_000_000
  const cams = Array.from({ length: 20 }, (_, i) => ({ nvr: 'v', ch: i, online: true }))
  const w = startWarmStreams({ cameras: () => cams, orders: () => ({}), streamOf: fake, roomy: () => true, log: () => {}, everyMs: 1e9, now: () => t, outFile: null })
  check('first run: 5 minutes after start by default', FIRST_RUN_MS === 5 * 60_000)
  w.run()
  t += FIRST_RUN_MS - 1000
  w.run()
  check('nothing is added before 5 min', w.held.size === 0, String(w.held.size))
  t += 1000
  w.run()
  check('... and the first screen plus the extra ones at 5 min', w.held.size === 16, String(w.held.size))
}
{
  // an NVR kept out is still kept out after a restart (warm-out.json)
  const file = join(mkdtempSync(join(tmpdir(), 'warm-out-')), 'warm-out.json')
  let t = 5_000_000
  const cams = Array.from({ length: 30 }, (_, i) => ({ nvr: i < 20 ? 'v' : 'calm', ch: i, online: true }))
  let refusing = true
  const opts = { cameras: () => cams, orders: () => ({}), streamOf: fake, roomy: (id) => !(refusing && id === 'v'), log: () => {}, everyMs: 1e9, now: () => t, firstRunMs: 0, outFile: file }
  const a = startWarmStreams(opts)
  a.run()
  let saved = null
  try { saved = JSON.parse(readFileSync(file, 'utf8')) } catch {}
  check('an NVR put out is written to the file with its end', saved?.v === t + 6 * 60 * 60_000 && saved.calm === undefined, JSON.stringify(saved))
  refusing = false // quiet now: a new instance must still keep it out
  t += 30 * 60_000
  const b = startWarmStreams(opts)
  check('outUntil is read back by a new instance', b.outUntil.get('v') === saved?.v, JSON.stringify([...b.outUntil]))
  b.run()
  const vHeld = [...b.held.keys()].filter((k) => k.startsWith('v/')).length
  check('... and that NVR stays at the first-screen rule', vHeld === 9, String(vHeld))
  t += 6 * 60 * 60_000
  const c = startWarmStreams(opts)
  check('an entry that has run out is not read back', !c.outUntil.has('v'))
  check('the default file is warm-out.json in the data folder', OUT_FILE === join(process.env.DATA_DIR, 'warm-out.json'))
  check('(these tests wrote nothing into the default data folder)', !existsSync(OUT_FILE))
}
{
  // an NVR that goes on refusing: the saved end moves on with it, so a restart 7 h after the first
  // refusal (a deploy) still keeps it out
  const file = join(mkdtempSync(join(tmpdir(), 'warm-out-')), 'warm-out.json')
  let t = 9_000_000
  const cams = Array.from({ length: 30 }, (_, i) => ({ nvr: i < 20 ? 'v' : 'calm', ch: i, online: true }))
  let refusing = true
  const opts = { cameras: () => cams, orders: () => ({}), streamOf: fake, roomy: (id) => !(refusing && id === 'v'), log: () => {}, everyMs: 1e9, now: () => t, firstRunMs: 0, outFile: file }
  const read = () => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null } }
  const a = startWarmStreams(opts)
  a.run()
  const first = read()?.v
  t += 60_000
  a.run() // one pass later: moved on 1 min in memory, not written yet
  check('refusing on: the file is not rewritten at every pass', read()?.v === first && a.outUntil.get('v') === t + 6 * 60 * 60_000, `${(a.outUntil.get('v') - read()?.v) / 1000} s behind`)
  for (let i = 0; i < 7 * 60; i++) { t += 60_000; a.run() } // 7 h of passes, refusing all along
  const lag = a.outUntil.get('v') - read()?.v
  check(`refusing on for 7 h: the saved end follows (at most ${OUT_SAVE_STEP_MS / 60_000} min behind)`, lag >= 0 && lag < OUT_SAVE_STEP_MS, `${lag / 1000} s behind`)
  refusing = false
  t += 5 * 60_000 // a restart
  const b = startWarmStreams(opts)
  check('... a restart then keeps it out', b.outUntil.get('v') > t, `${(b.outUntil.get('v') - t) / 60_000} min left`)
  b.run()
  const vHeld = [...b.held.keys()].filter((k) => k.startsWith('v/')).length
  check('... at the first-screen rule', vHeld === 9, String(vHeld))
}
{
  // many warm streams no longer wanted at once are let go 2 per NVR per pass, not together
  let t = 0
  let cams = Array.from({ length: 16 }, (_, i) => ({ nvr: 'n', ch: i, online: true }))
  const w = startWarmStreams({ cameras: () => cams, orders: () => ({}), streamOf: fake, roomy: () => true, log: () => {}, everyMs: 1e9, now: () => t, firstRunMs: 0, outFile: null })
  w.run()
  check('16 held', w.held.size === 16, String(w.held.size))
  cams = cams.map((c) => ({ ...c, online: false })) // all 16 drop off the list
  const sizes = []
  for (let i = 0; i < 9; i++) {
    w.run()
    sizes.push(w.held.size)
  }
  check(`dropping 16 keys releases ${RELEASE_PER_RUN} per run`, RELEASE_PER_RUN === 2 && sizes.join() === '14,12,10,8,6,4,2,0,0', sizes.join())
}{
  // an NVR edited and made again under the same id: its old streams are closed, and held nothing
  // warm for ever after (the key stayed "held", so the camera's new stream was never asked for)
  let made = []
  const fake = () => { const s = { clients: new Set(), closed: false, add(w) { this.clients.add(w) }, remove(w) { this.clients.delete(w) } }; made.push(s); return s }
  const cams = Array.from({ length: 4 }, (_, i) => ({ nvr: 'e', ch: i, online: true }))
  const w = startWarmStreams({ cameras: () => cams, orders: () => ({}), streamOf: fake, roomy: () => true, log: () => {}, everyMs: 1e9, now: () => 0, firstRunMs: 0, outFile: null })
  w.run()
  const old = made
  made = []
  for (const s of old) { s.closed = true; s.clients.clear() } // stream-hub.mjs closeAll
  w.run()
  check('closed streams are forgotten and their cameras warmed again on the new ones', old.length === 4 && made.length === 4 && w.held.size === 4 && [...w.held.values()].every((h) => made.includes(h.stream) && h.stream.clients.has(h.viewer)), made.length + ' made, ' + w.held.size + ' held')
  w.run()
  check('... once: streams that run are left alone', made.length === 4, String(made.length))
}

// V1-streaming-server#0 / NET-network#0 (2026-10-20): the caps set on the service were never read
{
  check('nothing set: 200 in all, 16 per NVR', ALL_CAP === 200 && PER_NVR === 16, `${ALL_CAP}/${PER_NVR}`)
  const caps = (env) => { const c = warmCaps(env); return `${c.allCap}/${c.perNvr}` }
  check('caps read from the environment', caps({ CCTV_WARM_ALL_CAP: '48', CCTV_WARM_PER_NVR: '4' }) === '48/4', caps({ CCTV_WARM_ALL_CAP: '48', CCTV_WARM_PER_NVR: '4' }))
  check('missing: the defaults', caps({}) === '200/16', caps({}))
  check('empty or blank: the defaults (not 0)', caps({ CCTV_WARM_ALL_CAP: '', CCTV_WARM_PER_NVR: '  ' }) === '200/16', caps({ CCTV_WARM_ALL_CAP: '', CCTV_WARM_PER_NVR: '  ' }))
  const junk = ['abc', '48abc', '4.5', '-1', 'NaN', 'Infinity']
  check('junk: the defaults', junk.every((v) => caps({ CCTV_WARM_ALL_CAP: v, CCTV_WARM_PER_NVR: v }) === '200/16'), junk.map((v) => caps({ CCTV_WARM_ALL_CAP: v, CCTV_WARM_PER_NVR: v })).join(' '))
  check('0 is kept (none beyond the first screens)', caps({ CCTV_WARM_ALL_CAP: '0', CCTV_WARM_PER_NVR: '0' }) === '0/0', caps({ CCTV_WARM_ALL_CAP: '0', CCTV_WARM_PER_NVR: '0' }))
  check('the service environment is the one read by default', caps() === '200/16', caps())
}

// 22 recorders of 16 cameras each, all roomy, n00 .. n21 in the order allCameras() gives them
const fleet = Array.from({ length: 22 * 16 }, (_, i) => ({ nvr: `n${String(Math.floor(i / 16)).padStart(2, '0')}`, ch: i % 16, online: true }))
const nvrIds = [...new Set(fleet.map((c) => c.nvr))]
const perNvrOf = (keys) => new Map(nvrIds.map((id) => [id, keys.filter((k) => k.startsWith(`${id}/`)).length]))

// NET-network#1 (2026-10-20): a cap of 48 went to the alphabetically first recorders, NVR by NVR
{
  const spread = ['n03/0', 'n03/1', 'n03/2', 'n03/3', 'n07/5', 'n07/6', 'n10/0', 'n15/2', 'n21/9']
  const got = pickWarm({ cameras: fleet, orders: { u: spread }, roomy: () => true, allCap: 48, perNvr: 4 })
  const per = perNvrOf(got)
  check('caps 48/4 on 22 x 16: 48 picked', got.length === 48 && new Set(got).size === 48, String(got.length))
  check('... at most 4 on any NVR', Math.max(...per.values()) <= 4, JSON.stringify(Object.fromEntries(per)))
  check('... the first screen comes first, all of it', spread.every((k, i) => got[i] === k), got.slice(0, 9).join(' '))
  check('... every roomy NVR gets at least 2', Math.min(...per.values()) >= 2, JSON.stringify(Object.fromEntries(per)))
  check('... each NVR\'s cameras in the usual order', got.includes('n05/0') && got.includes('n05/1') && !got.includes('n05/2'), got.filter((k) => k.startsWith('n05/')).join(' '))

  // no saved order: the first screen is n00's first nine; the rest still reaches every recorder
  const def = pickWarm({ cameras: fleet, orders: {}, roomy: () => true, allCap: 48, perNvr: 4 })
  const dper = perNvrOf(def)
  check('no saved order: 48, the first screen unchanged', def.length === 48 && def.slice(0, 9).join() === Array.from({ length: 9 }, (_, i) => `n00/${i}`).join(), def.slice(0, 9).join(' '))
  check('... and every other NVR gets some', nvrIds.every((id) => dper.get(id) >= 1) && Math.max(...nvrIds.slice(1).map((id) => dper.get(id))) <= 4, JSON.stringify(Object.fromEntries(dper)))

  // a refusing NVR gets nothing extra; its share goes to the others
  const busy = pickWarm({ cameras: fleet, orders: { u: spread }, roomy: (id) => id !== 'n01', allCap: 48, perNvr: 4 })
  check('a refusing NVR is skipped in every round', busy.length === 48 && perNvrOf(busy).get('n01') === 0, String(perNvrOf(busy).get('n01')))

  // 0: none beyond the first screens
  const first = pickWarm({ cameras: fleet, orders: { u: spread }, roomy: () => true, allCap: 0, perNvr: 4 })
  check('all-cap 0: the first screen only', first.join() === spread.join(), first.join(' '))
  const first2 = pickWarm({ cameras: fleet, orders: { u: spread }, roomy: () => true, allCap: 48, perNvr: 0 })
  check('per-NVR 0: the first screen only', first2.join() === spread.join(), first2.join(' '))

  // roomy() (which puts a refusing NVR out for 6 h) is asked once per NVR, and only for an NVR that
  // would be given a camera
  const asked = []
  pickWarm({ cameras: fleet, orders: { u: spread }, roomy: (id) => { asked.push(id); return true }, allCap: 12, perNvr: 4 })
  check('roomy() asked once each, only while there is room', asked.length === new Set(asked).size && asked.length === 3, asked.join(' '))
}

// the caps set on the service reach the running warm-up (a fresh copy of the module reads them)
{
  process.env.CCTV_WARM_ALL_CAP = '48'
  process.env.CCTV_WARM_PER_NVR = '4'
  const m = await import('../warm-streams.mjs?caps-from-env')
  delete process.env.CCTV_WARM_ALL_CAP
  delete process.env.CCTV_WARM_PER_NVR
  check('CCTV_WARM_ALL_CAP / CCTV_WARM_PER_NVR read at start', m.ALL_CAP === 48 && m.PER_NVR === 4, `${m.ALL_CAP}/${m.PER_NVR}`)
  const lines = []
  const w = m.startWarmStreams({ cameras: () => fleet, orders: () => ({}), streamOf: fake, roomy: () => true, log: (s) => lines.push(s), everyMs: 1e9, now: () => 0, firstRunMs: 0, outFile: null })
  w.run()
  const per = perNvrOf([...w.held.keys()])
  check('... the warm-up keeps 48 streaming, not 200', w.held.size === 48, String(w.held.size))
  check('... spread over every recorder', nvrIds.every((id) => per.get(id) >= 1), JSON.stringify(Object.fromEntries(per)))
  check('... and says its caps once at start', lines.filter((s) => /at most 48 in all, 4 per NVR/.test(s)).length === 1, lines.join(' | '))
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
