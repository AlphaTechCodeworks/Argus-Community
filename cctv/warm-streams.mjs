// Each user's first screen of cameras, streaming before anyone opens Live, so the picture is there
// the moment the page is.
//
// A camera nobody is watching is not streaming, and the first viewer waits for the NVR to start it
// (seconds, on a busy NVR). The server knows each user's camera order (user-prefs.mjs), so it keeps
// the sub-streams of each user's first FIRST_SCREEN cameras running, at most CAP in all -- the
// sub-streams are small, but nvr-2 refuses streams once its bandwidth budget is spent, so this is
// kept to what makes a difference: the screen people open first. Re-read every minute; a camera
// that drops off the list is let go (and lingers the usual 3 minutes, stream-hub.mjs).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DATA_DIR } from './auth.mjs'

export const FIRST_SCREEN = 9
export const CAP = 16
// ...and, beyond that, up to PER_NVR online cameras of each NVR that is not refusing streams
// (roomy(nvrId)): an NVR takes 3.5 s on average to start a stream (up to 30 s), so a camera
// already streaming opens at once. Every extra sub-stream is also pulled by the NVR from its
// camera: with all 29 of depot's warmed at once it refused streams and four cameras dropped off
// it. So at most PER_NVR each, and an NVR that refuses is left at the first-screen rule for
// STAY_OUT_MS (startWarmStreams), not warmed again ten quiet minutes later.
//
// Both can be set on the service: CCTV_WARM_ALL_CAP (ALL_CAP, counted with the first screens) and
// CCTV_WARM_PER_NVR (PER_NVR, likewise). 2026-10-20, V1-streaming-server#0 / NET-network#0: the
// service set them to 48 and 4, but nothing read them, so 156-215 sub-streams stayed warm around
// the clock, most of them over remote sites' links, with nobody watching.

/**
 * The warm-up caps from the environment: whole numbers of 0 or more (0: nothing beyond the first
 * screens). A missing, empty or other value keeps the default, 200 in all and 16 per NVR.
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ allCap: number, perNvr: number }}
 */
export function warmCaps(env = process.env) {
  const read = (name, fallback) => {
    const raw = env[name]
    // (blank is not 0: Number('') is 0, and an emptied setting must not switch the warm-up off)
    const n = raw == null || String(raw).trim() === '' ? NaN : Number(raw)
    return Number.isInteger(n) && n >= 0 ? n : fallback
  }
  return { allCap: read('CCTV_WARM_ALL_CAP', 200), perNvr: read('CCTV_WARM_PER_NVR', 16) }
}
export const { allCap: ALL_CAP, perNvr: PER_NVR } = warmCaps()
export const STAY_OUT_MS = 6 * 60 * 60_000
const EVERY_MS = 60_000
// Nothing is warmed until this long after start. Warming every NVR at each restart put up to 16
// extra sub-streams on each of them in the very minute recording was starting again (03:39:52,
// 04:04:13, 04:18:34), before it was known which NVRs refuse streams (nvr-2 said so at 03:41:36).
export const FIRST_RUN_MS = 5 * 60_000
// At most this many held streams of one NVR are let go per pass: nvr-2's 16 let go together (16
// stops at 03:44:36-38) were followed by 6 of its cameras stalling.
export const RELEASE_PER_RUN = 2
// which NVRs are kept out and until when, so that nvr-2 and depot stay out across restarts
export const OUT_FILE = join(DATA_DIR, 'warm-out.json')
// An NVR that goes on refusing has its "kept out until" moved on at every pass; the file follows
// once it has moved this far (not at every pass). Only the first one saved, a restart 6 h after the
// first refusal let an NVR back in that had refused all along.
export const OUT_SAVE_STEP_MS = 10 * 60_000

/**
 * Which cameras to keep ready: each user's first screen in their own order (the default order for
 * a user who has none), online ones only, the first users' first, at most `cap`. With `roomy`, then
 * the other online cameras of the NVRs it says are not refusing, up to `perNvr` on each NVR and
 * `allCap` in all (both counted with the first screens). Pure, but for what roomy() does.
 * @param {{ cameras: {nvr:string,ch:number,online:boolean,configured?:boolean}[], orders: Record<string,string[]>,
 *   roomy?: ((nvrId: string) => boolean)|null, allCap?: number, perNvr?: number }} o
 * @returns {string[]} "nvr/ch" keys
 */
export function pickWarm({ cameras, orders, perUser = FIRST_SCREEN, cap = CAP, roomy = null, allCap = ALL_CAP, perNvr = PER_NVR }) {
  const first = pickFirst({ cameras, orders, perUser, cap })
  if (!roomy) return first
  const out = [...first]
  const nvrOf = (k) => k.slice(0, k.lastIndexOf('/'))
  const per = new Map()
  for (const k of out) per.set(nvrOf(k), (per.get(nvrOf(k)) ?? 0) + 1)
  // each NVR's other online cameras, the NVRs and their cameras in the order `cameras` has them
  const seen = new Set(out)
  const queues = new Map()
  for (const c of cameras) {
    const k = `${c.nvr}/${c.ch}`
    if (!c.online || c.configured === false || seen.has(k)) continue
    seen.add(k)
    if (!queues.has(c.nvr)) queues.set(c.nvr, [])
    queues.get(c.nvr).push(k)
  }
  // 2026-10-20, NET-network#1: the extra ones are dealt out in rounds, round r giving one camera to
  // each roomy NVR that has fewer than r, not NVR by NVR. Filled in the cameras' order (by site
  // name), a cap of 48 went whole to the first few remote sites and the office recorders got none.
  // roomy() is asked once per NVR, and only for one that would be given a camera: for an NVR that
  // refuses it puts it out for STAY_OUT_MS (startWarmStreams).
  const ok = new Map()
  // (no more rounds than the biggest NVR has cameras, whatever perNvr is set to)
  let rounds = 0
  for (const [nvrId, queue] of queues) rounds = Math.max(rounds, (per.get(nvrId) ?? 0) + queue.length)
  rounds = Math.min(rounds, perNvr)
  for (let round = 1; round <= rounds && out.length < allCap; round++) {
    for (const [nvrId, queue] of queues) {
      if (out.length >= allCap) break
      if (!queue.length || (per.get(nvrId) ?? 0) >= round) continue
      if (!ok.has(nvrId)) ok.set(nvrId, Boolean(roomy(nvrId)))
      if (!ok.get(nvrId)) continue
      out.push(queue.shift())
      per.set(nvrId, (per.get(nvrId) ?? 0) + 1)
    }
  }
  return out
}

function pickFirst({ cameras, orders, perUser, cap }) {
  const live = cameras.filter((c) => c.online && c.configured !== false)
  const known = new Set(live.map((c) => `${c.nvr}/${c.ch}`))
  const defaultOrder = live.map((c) => `${c.nvr}/${c.ch}`)
  const users = Object.values(orders)
  const lists = users.length ? users : [[]]
  const out = []
  for (const saved of lists) {
    // a saved order lists the cameras the user moved; the rest follow in the default order
    const order = [...saved.filter((k) => known.has(k)), ...defaultOrder.filter((k) => !saved.includes(k))]
    for (const k of order.slice(0, perUser)) {
      if (out.length >= cap) return out
      if (!out.includes(k)) out.push(k)
    }
  }
  return out
}

/** The stream's quiet viewer: takes the frames, sends them nowhere. */
const quietViewer = () => ({ OPEN: 1, readyState: 1, bufferedAmount: 0, send() {}, on() {} })

/** The saved "kept out until" times (NVR id -> ms), only those still running at t. */
function readOut(file, t) {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    return new Map(Object.entries(saved ?? {}).filter(([, until]) => Number.isFinite(until) && until > t))
  } catch {
    return new Map()
  }
}

/**
 * Keeps the picked sub-streams running.
 * @param {{ cameras: () => object[], orders: () => object, streamOf: (nvrId: string, ch: number) => {add: Function, remove: Function}|null,
 *   log?: Function, everyMs?: number, now?: () => number, firstRunMs?: number, outFile?: string|null, allCap?: number, perNvr?: number }} o
 *   outFile: where the kept-out NVRs are saved (null: memory only); allCap, perNvr: pickWarm's caps
 */
export function startWarmStreams({ cameras, orders, streamOf, roomy = null, log = console.log, everyMs = EVERY_MS, now = Date.now, firstRunMs = FIRST_RUN_MS, outFile = OUT_FILE, allCap = ALL_CAP, perNvr = PER_NVR }) {
  const startedAt = now()
  // said once, so a setting on the service that has no effect shows (V1-streaming-server#0, 2026-10-20)
  log(`[warm] at most ${allCap} in all, ${perNvr} per NVR (CCTV_WARM_ALL_CAP, CCTV_WARM_PER_NVR)`)
  const held = new Map() // key -> { stream, viewer }
  // an NVR that refused is kept out of the extra warm-up for STAY_OUT_MS, not just while it refuses,
  // and a restart does not let it back in (outFile)
  const outUntil = outFile ? readOut(outFile, startedAt) : new Map()
  const saved = new Map(outUntil) // what the file holds
  const saveOut = () => {
    if (!outFile) return
    // (counted as saved even when the write fails: tried again a step later, not at every camera)
    saved.clear()
    for (const [k, v] of outUntil) saved.set(k, v)
    try {
      mkdirSync(dirname(outFile), { recursive: true })
      const tmp = `${outFile}.tmp`
      writeFileSync(tmp, `${JSON.stringify(Object.fromEntries(outUntil))}\n`)
      renameSync(tmp, outFile)
    } catch (e) {
      log(`[warm] ${outFile} not written: ${e.message}`)
    }
  }
  const calm = roomy && ((id) => {
    const t = now()
    if (!roomy(id)) {
      const fresh = !outUntil.has(id) || outUntil.get(id) <= t
      if (fresh) log(`[warm] ${id} is refusing streams: only its first-screen cameras are kept ready for the next ${STAY_OUT_MS / 3_600_000} h`)
      outUntil.set(id, t + STAY_OUT_MS)
      // when it is put out, and again each time its end has moved on OUT_SAVE_STEP_MS (not at every
      // pass it goes on refusing)
      if (fresh || t + STAY_OUT_MS - (saved.get(id) ?? 0) >= OUT_SAVE_STEP_MS) saveOut()
      return false
    }
    return (outUntil.get(id) ?? 0) <= t
  })
  const run = () => {
    if (now() - startedAt < firstRunMs) return
    let want
    try {
      want = new Set(pickWarm({ cameras: cameras(), orders: orders(), roomy: calm, allCap, perNvr }))
    } catch (e) {
      return log(`[warm] ${e.message}`)
    }
    // a stream that has ended (its NVR was removed, or edited and made again under the same id) keeps
    // nothing warm: forgotten, so the camera is warmed again on the stream it has now
    for (const [k, h] of held) if (h.stream.closed === true || h.stream.stopped === true) held.delete(k)
    const released = new Map() // NVR id -> streams let go in this pass
    for (const [k, h] of held) {
      if (want.has(k)) continue
      const nvrId = k.slice(0, k.lastIndexOf('/'))
      const n = released.get(nvrId) ?? 0
      if (n >= RELEASE_PER_RUN) continue // the rest in the next passes
      released.set(nvrId, n + 1)
      h.stream.remove(h.viewer)
      held.delete(k)
    }
    let added = 0
    for (const k of want) {
      if (held.has(k)) continue
      const i = k.lastIndexOf('/')
      const stream = streamOf(k.slice(0, i), Number(k.slice(i + 1)))
      if (!stream) continue
      const viewer = quietViewer()
      viewer.background = true // (a real viewer's start goes ahead of this one)
      stream.add(viewer)
      held.set(k, { stream, viewer })
      added++
    }
    if (added) log(`[warm] keeping ${held.size} camera${held.size === 1 ? '' : 's'} streaming, ready for Live`)
  }
  const t = setInterval(run, everyMs)
  t.unref?.()
  setTimeout(run, firstRunMs).unref?.() // viewers still go first
  return { run, held, outUntil }
}
