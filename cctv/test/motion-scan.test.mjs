// Motion search (motion.mjs motionScan) when its ffmpeg cannot be started.
//
// S7b-osd-motion-tripwire-notes#5 (2026-10-20): the picture analyser's ffmpeg had no 'error'
// listener, so a spawn that failed (ffmpeg missing, or the box out of processes or file handles) was
// an uncaught exception, and the server has no handler for those on purpose (process-guard.mjs): one
// motion search took every live view, playback and recording down with it. With no pipes set up
// (EMFILE) it threw inside the SDK's frame callback instead, and other failures (ENOMEM) are thrown
// by spawn itself. Now each ends that search with a plain error.
//
// The SDK, the playback calls and the lanes are stood in for (a module resolve hook, below), so this
// runs on any machine and nothing reaches an NVR. ffmpeg is never found: PATH is an empty folder.
//   node cctv/test/motion-scan.test.mjs
import childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { registerHooks, syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}

// what motion.mjs takes from sdk.mjs, playback.mjs and lanes.mjs; a playback's frame callback is
// kept in globalThis.__motionTest.claimed (handle -> callback), where the test plays frames into it
const shared = { claimed: new Map() }
globalThis.__motionTest = shared
const STUBS = {
  './sdk.mjs': `
    const t = globalThis.__motionTest
    export const CODEC_H265 = 1
    export const FRAME_TYPE_VIDEO = 1
    export const FRAME_TYPE_VIDEO_FORMAT = 5
    export const HEADER_SIZE = 16
    export const codecOf = () => 1
    export const encodeFrame = (info, buf) => Buffer.concat([Buffer.alloc(16), buf])
    export const playFrames = { callback: null, claim: (h, fn) => t.claimed.set(h, fn), release: (h) => t.claimed.delete(h) }
    export const sdkCallT = async (opts, fn, ...args) => fn(...args)
  `,
  './playback.mjs': `
    let next = 100
    export const PB = { PlayBackByTimeEx: () => next++, SetPlayDataCallBack: () => true, PlayBackControl: () => true, StopPlayBack: () => true, PLAYCTRL: { FF: 3 } }
    export const SPEED_CODE = { 32: 11 }
    export const toDD = (ms) => ms
  `,
  './lanes.mjs': 'export const PRIORITY = { HIGH: 0, NORMAL: 1 }'
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBS[specifier] && /\/motion\.mjs$/.test(context.parentURL ?? '')) {
      return { url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}`, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  }
})

// spawn as the test asks: the real one (with no ffmpeg on PATH), one that throws, or a child whose
// pipes could not be made (EMFILE: Node sets up no stdio and sends 'error', then 'close')
const realSpawn = childProcess.spawn
let spawnAs = 'real'
childProcess.spawn = (...args) => {
  if (spawnAs === 'throw') throw Object.assign(new Error('spawn ENOMEM'), { code: 'ENOMEM' })
  if (spawnAs === 'no-pipes') {
    const c = new EventEmitter()
    Object.assign(c, { pid: undefined, stdin: null, stdout: null, stderr: null, kill: () => false })
    process.nextTick(() => {
      c.emit('error', Object.assign(new Error('spawn ffmpeg EMFILE'), { code: 'EMFILE' }))
      c.emit('close', -24, null)
    })
    return c
  }
  return realSpawn(...args)
}
syncBuiltinESMExports()
const empty = mkdtempSync(join(tmpdir(), 'cctv-no-ffmpeg-'))
const oldPath = process.env.PATH
process.env.PATH = empty

const { motionScan } = await import('../motion.mjs')

const FROM = Date.UTC(2026, 9, 20, 10, 0, 0)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (ok, ms = 2000) => {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await sleep(10)
  return ok()
}

/** One search of two minutes on NVR `id`; a keyframe is played into one of its playbacks. */
async function search(id) {
  shared.claimed.clear()
  const ws = { OPEN: 1, readyState: 1, sent: [], on() {}, send: (s) => ws.sent.push(JSON.parse(s)), close: () => (ws.readyState = 3) }
  const nvr = {
    id,
    scans: new Set(),
    playback: { clock: async () => ({ tzOffsetMs: 0 }), recordings: async () => ({ events: [] }), isHdOnly: () => false },
    sessions: { acquire: async () => ({ userId: 1, release() {} }) },
    lane: { run: (task) => task() }
  }
  const url = new URL(`http://test/motion?nvr=${id}&ch=0&from=${FROM}&to=${FROM + 120_000}&box=0.1,0.1,0.5,0.5&sens=2`)
  const uncaught = []
  const onUncaught = (e) => uncaught.push(e)
  process.on('uncaughtException', onUncaught)
  const scan = motionScan(nvr, ws, url)
  let threw = null
  if (await until(() => shared.claimed.size === 2)) {
    const onFrame = [...shared.claimed.values()][0]
    try {
      onFrame({ frameType: 5, length: 10 }, Buffer.alloc(10))
      onFrame({ frameType: 1, length: 10, keyFrame: true, time: BigInt(FROM + 1000) * 1000n }, Buffer.alloc(10))
    } catch (e) {
      threw = e
    }
  }
  const ended = await Promise.race([scan.then(() => true), sleep(3000).then(() => false)])
  await sleep(50) // (an error emitted late still has time to land)
  process.off('uncaughtException', onUncaught)
  return { ws, threw, uncaught, ended, last: ws.sent.at(-1) }
}

const plain = (r) => r.last?.type === 'error' && /^The picture analyser could not be started\. Search incomplete/.test(r.last.message ?? '')

{
  const r = await search('n1')
  check('ffmpeg not found (an \'error\' event): no uncaught exception (the server would have ended)', r.uncaught.length === 0, r.uncaught[0]?.message)
  check('...the search ends at once, with a plain error', r.ended && plain(r), JSON.stringify(r.last))
}
{
  spawnAs = 'throw'
  const r = await search('n2')
  check('spawn throws (ENOMEM): nothing escapes the SDK\'s frame callback', r.threw === null && r.uncaught.length === 0, (r.threw ?? r.uncaught[0])?.message)
  check('...the search ends at once, with a plain error', r.ended && plain(r), JSON.stringify(r.last))
}
{
  spawnAs = 'no-pipes'
  const r = await search('n3')
  check('no pipes (EMFILE): nothing escapes the frame callback, no uncaught exception', r.threw === null && r.uncaught.length === 0, (r.threw ?? r.uncaught[0])?.message)
  check('...the search ends at once, with a plain error', r.ended && plain(r), JSON.stringify(r.last))
}

process.env.PATH = oldPath
childProcess.spawn = realSpawn
syncBuiltinESMExports()
rmSync(empty, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
