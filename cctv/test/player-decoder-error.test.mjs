// A decoder error is not a device video limit (audit F1b-player-media#0, 2026-10-20).
//
// The 2026-10-14 phone pass made every VideoDecoder error call onResourceLimit, budget or none. Every
// caller reads that as "this device cannot take more video": on a PC one tile's hiccup (an H.265 stream
// that passed the capability check but will not decode, a GPU reset, a background tab's decoder taken
// back) turned the Live wall from Auto or 2x2 to one camera, and Playback closed its stream with
// "Device video limit". Now a decoder error only waits for the next keyframe (and asks for H.264 after
// an H.265 failure), as before; onResourceLimit comes from the phone budget alone. Live's downgrade
// (viewer.js downgradeLive) is for phones only.
//   node cctv/test/player-decoder-error.test.mjs
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createVideoBudget } from '../public/video-budget.js'

let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}

globalThis.window = { devicePixelRatio: 1 }
globalThis.requestAnimationFrame = () => 1
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.EncodedVideoChunk = class { constructor(o) { Object.assign(this, o) } }
class Frame {
  constructor(timestamp) { this.timestamp = timestamp; this.displayWidth = this.codedWidth = 640
    this.displayHeight = this.codedHeight = 360 }
  clone() { return new Frame(this.timestamp) }
  close() {}
}
const decoders = [] // every decoder made, newest last
globalThis.VideoDecoder = class {
  static async isConfigSupported() { return { supported: true } }
  constructor({ output, error }) { this.output = output; this.error = error; this.state = 'unconfigured'; this.decodeQueueSize = 0; decoders.push(this) }
  configure() { this.state = 'configured' }
  decode(chunk) { this.output(new Frame(chunk.timestamp)) }
  close() { this.state = 'closed' }
}
const { VideoPlayer, CODEC_H264, CODEC_H265 } = await import('../public/player.js')
const turn = () => new Promise(resolve => setImmediate(resolve))
const chunk = (timestamp, codecId = CODEC_H264, isKey = true) => ({ timestampUs: timestamp, isKey, codecId, data: new Uint8Array([1, 2, 3]) })
const canvas = () => ({ width: 640, height: 360, getContext: () => ({ drawImage() {} }),
  getBoundingClientRect: () => ({ width: 640, height: 360 }) })
const watched = (options = {}) => {
  const seen = { limits: [], unsupported: [] }
  const player = new VideoPlayer(canvas(), { ...options,
    onResourceLimit: reason => seen.limits.push(reason), onUnsupported: codecId => seen.unsupported.push(codecId) })
  return { player, seen }
}

{
  // a PC: no budget (deviceVideoBudget is null off a phone)
  const { player, seen } = watched()
  player.push(chunk(0))
  await turn()
  const failed = decoders.at(-1)
  failed.error(new Error('decode failed'))
  check('a PC has no video budget', player.resources === null, String(player.resources))
  check('an H.264 decoder error on a PC is not a device video limit', seen.limits.length === 0, JSON.stringify(seen.limits))
  check('... nor an unplayable codec', seen.unsupported.length === 0, JSON.stringify(seen.unsupported))
  check('... the decoder is closed and the player waits for a keyframe', player.decoder === null && failed.state === 'closed' && player.needKey === true)
  check('... and the error is counted for telemetry', player.stats.decoderErrors === 1, String(player.stats.decoderErrors))
  const queued = player.queue.length
  player.push(chunk(66_667, CODEC_H264, false)) // (a delta frame: needs the keyframe it leant on)
  player.push(chunk(2_000_000))
  await turn()
  check('the next keyframe sets a decoder up again and the picture carries on', decoders.at(-1) !== failed && player.decoder?.state === 'configured' && player.queue.length === queued + 1 && player.queue.at(-1).ts === 2000, `queue ${queued} -> ${player.queue.length}`)
  player.close()
}

{
  const { player, seen } = watched()
  player.push(chunk(0, CODEC_H265))
  await turn()
  decoders.at(-1).error(new Error('decode failed'))
  check('an H.265 decoder error still asks for the H.264 fallback', seen.unsupported.length === 1 && seen.unsupported[0] === CODEC_H265, JSON.stringify(seen.unsupported))
  check('... and is not a device video limit', seen.limits.length === 0, JSON.stringify(seen.limits))
  player.close()
}

{
  // a phone's budget: the limits come from it, and from nowhere else
  const budget = createVideoBudget({ decoders: 1, imageBytes: 640 * 360 * 4 * 4 })
  const first = watched({ resources: budget })
  const second = watched({ resources: budget })
  first.player.push(chunk(0))
  await turn()
  second.player.push(chunk(0))
  await turn()
  check('the budget path: no decoder left is a device video limit ("decoder capacity")', second.seen.limits.length === 1 && second.seen.limits[0] === 'decoder capacity', JSON.stringify(second.seen.limits))
  decoders.at(-1).error(new Error('decode failed'))
  check('a decoder error under a budget gives its decoder back', budget.active === 0, String(budget.active))
  check('... and is not reported as a device video limit', first.seen.limits.length === 0, JSON.stringify(first.seen.limits))
  first.player.close()
  second.player.close()
}

{
  // less image memory in the budget than one picture: the only frame queued is let go
  const budget = createVideoBudget({ decoders: 2, imageBytes: 640 * 360 })
  const { player, seen } = watched({ resources: budget })
  player.push(chunk(0))
  await turn()
  check('the budget path: no image memory left is a device video limit ("image capacity")', seen.limits.length === 1 && seen.limits[0] === 'image capacity', JSON.stringify(seen.limits))
  player.close()
}

{
  // viewer.js downgradeLive, run on its own: a smaller layout is for phones only
  const source = readFileSync(new URL('../public/viewer.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const start = source.indexOf('function downgradeLive(')
  const end = source.indexOf('\nsetInterval(', start)
  const live = async (phone, layout) => {
    const notices = []
    const context = vm.createContext({
      isPhone: () => phone, layoutSelect: { value: layout }, document: { hidden: false }, single: null, page: 2,
      queueMicrotask, markPhoneLayout() {}, render() {}, showNotice: text => notices.push(text)
    })
    vm.runInContext(source.slice(start, end), context)
    context.downgradeLive('This device reached its video limit.')
    await turn()
    return { layout: context.layoutSelect.value, notices }
  }
  check('downgradeLive found in viewer.js', start > 0 && end > start)
  for (const layout of ['auto', 'g2', 'g3']) {
    const pc = await live(false, layout)
    check(`a PC on ${layout} keeps its layout and gets no "video limit" notice`, pc.layout === layout && pc.notices.length === 0, JSON.stringify(pc))
  }
  const phone = await live(true, 'g2')
  check('a phone on 2x2 still steps down to one camera, and says why', phone.layout === 'g1' && phone.notices.length === 1, JSON.stringify(phone))
  const phone3 = await live(true, 'g3')
  check('a phone on 3x3 still steps down to 2x2', phone3.layout === 'g2', JSON.stringify(phone3))
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exitCode = failures ? 1 : 0
