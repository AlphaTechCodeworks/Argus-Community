// Switching camera in Playback stops the camera that was playing (audit F2a-playback-page#0, 2026-10-20).
//
// The camera list, a follow link, Back and a bookmark on another camera all switched by loading the
// new camera's day and seeking in it, and left it to that seek to replace the old socket. When the
// new camera had nothing to play at that moment (its last recording ended earlier, or its NVR search
// failed), the seek gave up with "No recording after this point." and the old camera's footage played
// on under the new camera's name: its frames moved the playhead and cleared the message, and a
// snapshot saved it named as the new camera. Now a switch closes the old socket and takes its picture
// off before the new day loads; a failed search keeps "Could not load recordings: ..." on screen
// instead of seeking; and an NVR socket that is no longer the page's is not listened to.
// The page's own functions (goToCamera, the camera list's change handler, reloadKeepingPosition,
// loadDay, seek, open, closeSocket) run here against stand-ins for the DOM, the player and the server.
//   node cctv/test/pb-camera-switch.test.mjs
import { readFileSync } from 'node:fs'
import { ALL_RIGHTS, convertTime, pickMode, qualityForCam } from '../public/pb-sources.js'

let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}

// Its line endings are whatever the checkout left (CRLF on a Windows working copy), so they are evened out.
const page = readFileSync(new URL('../public/playback.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
/** One top-level function of the page as written, `async` included ('' when the page has none of that name). */
const fn = (name) => {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(page)
  return m ? page.slice(m.index, page.indexOf('\n}\n', m.index) + 2) : ''
}
// the camera list's own change handler, which has no name
const listAt = page.indexOf("cameraSel.addEventListener('change', async () => {")
const listHandler = listAt < 0 ? '' : page.slice(listAt, page.indexOf('\n})\n', listAt) + 3)
// leaveCamera is the switch's own stop (absent before the fix, so not required to exist here)
const PAGE_FNS = ['closeSocket', 'leaveCamera', 'recordedFrom', 'seek', 'open', 'loadDay', 'reloadKeepingPosition', 'goToCamera']
const missing = PAGE_FNS.filter((n) => n !== 'leaveCamera' && !fn(n))
check('the page has the functions this test runs, and the camera list\'s change handler', missing.length === 0 && listHandler !== '', missing.join(' '))

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0)

/**
 * The page in NVR mode on camera n1/1. `days` gives each camera's recordings for the day: its ranges,
 * or an Error for an NVR search that fails. The server has no recordings (NVR mode, as in production
 * while server recording is off).
 */
function rig(days) {
  const r = { log: [], messages: [], frames: [], sockets: [], wiped: [] }
  const state = { mode: 'nvr', nvr: 'n1', ch: 1, clockOf: 'n1', date: '2026-10-20', tz: 0, skew: 0, nvrNow: NOW, position: null, requested: null, paused: false, speed: 1, stream: 1, h265: true, quality: 'server', nvrMain: false, ranges: [], events: [], gaps: [], nvrRaw: null, stretches: [] }
  r.state = state
  class FakeSocket {
    constructor(url) {
      this.url = url
      this.camera = `${/[?&]nvr=([^&]*)/.exec(url)[1]}/${/[?&]ch=(\d+)/.exec(url)[1]}`
      this.readyState = 0
      this.closed = false
      r.sockets.push(this)
      r.log.push(`open ${this.camera}`)
    }
    send() {}
    close() {
      this.closed = true
      r.log.push(`close ${this.camera}`)
    }
  }
  r.FakeSocket = FakeSocket
  const canvas = {
    width: 640,
    height: 360,
    getContext: () => ({
      clearRect: (...a) => {
        r.wiped.push(a)
        r.log.push('wipe picture')
      },
      fillRect: (...a) => {
        r.wiped.push(a)
        r.log.push('wipe picture')
      }
    })
  }
  r.canvas = canvas
  r.spinnerEl = { hidden: true }
  r.placeholderEl = { hidden: true } // (hidden once the first picture came)
  r.cameraSel = { value: 'n1/1', addEventListener: (type, f) => type === 'change' && (r.listChange = f) }
  const deps = {
    state,
    player: { canvas, reset: () => r.log.push('player reset'), resume() {}, setRate() {}, seekReset() {}, setStills() {} },
    cameraSel: r.cameraSel,
    qualitySel: { dataset: { kind: 'nvr' }, value: '1', options: [] },
    spinnerEl: r.spinnerEl,
    placeholderEl: r.placeholderEl,
    WebSocket: FakeSocket,
    location: { protocol: 'https:', host: 'argus.test' },
    history: { replaceState() {} },
    camKey: () => `${state.nvr}/${state.ch}`,
    nvrQ: () => `nvr=${encodeURIComponent(state.nvr)}`,
    keyOf: (nvr, ch) => `${nvr}/${ch}`,
    rightsNow: () => ALL_RIGHTS,
    pickMode,
    qualityForCam,
    convertTime,
    nvrFallback: { used: new Set() },
    fetchTimeline: async () => ({ available: false }),
    api: async (path) => {
      const cam = `${state.nvr}/${/[?&]ch=(\d+)/.exec(path)[1]}`
      r.log.push(`recordings ${cam}`)
      const day = days[cam]
      if (day instanceof Error) throw day
      return { ranges: day ?? [], events: [] }
    },
    loadNvrInfo: async () => null,
    retryWhenFree: () => false, // (not busy: a plain failure)
    leaveServerMode: () => {},
    enterServerDay: () => {
      throw new Error('server mode is not part of this test')
    },
    serverSeek: () => {
      throw new Error('server mode is not part of this test')
    },
    showMessage: (text) => {
      r.messages.push(text)
      r.log.push(`message ${text}`)
    },
    showNotice: () => {},
    showSpinner: () => (r.spinnerEl.hidden = false),
    drawTimeline: () => {},
    scheduleDraw: () => {},
    updatePlayButton: () => {},
    updateModeUi: () => {},
    stopStallWatch: () => {},
    settleStart: () => {},
    soundNewSocket: () => {},
    syncSound: () => {},
    onStatus: (msg) => r.log.push(`status ${msg.type}`),
    pushFrame: (data) => r.frames.push(data.frame),
    refusedMessage: () => null,
    fillCameraList: () => {},
    playbackCams: [],
    saveLastCamera: () => {},
    pageStorage: null,
    clearSearch: () => {},
    resetZoom: () => {},
    drawFollow: () => {}
  }
  const body = `let ws = null, stepHold = false, seekAt = null, startMs = null, dayToken = 0, lastPick = null, busyTimer = null, nvrSideTimer = null
${PAGE_FNS.map(fn).join('\n')}
${listHandler}
return { goToCamera, loadDay, open, socket: () => ws, setSocket: (s) => (ws = s) }`
  Object.assign(r, new Function(...Object.keys(deps), body)(...Object.values(deps)))
  return r
}

/** A rig with camera n1/1 playing from 5 minutes back: its socket open and one of its frames shown. */
function playingA(days) {
  const t = rig(days)
  t.state.ranges = days['n1/1']
  t.state.position = NOW - 5 * MIN
  t.open(t.state.position)
  const a = t.socket()
  a.onmessage({ data: frame('A1') })
  t.spinnerEl.hidden = true // (its first picture came)
  t.log.length = 0
  return { t, a }
}
/** A binary message of the socket (a picture), as the page's onmessage sees it: anything but a string. */
const frame = (name) => ({ frame: name })
const before = (log, x, y) => log.indexOf(x) >= 0 && log.indexOf(y) >= 0 && log.indexOf(x) < log.indexOf(y)
const wipedWhole = (t) => t.wiped.some(([x, y, w, h]) => x === 0 && y === 0 && w >= t.canvas.width && h >= t.canvas.height)

// ---- a follow link, Back or a bookmark (goToCamera): the new camera's last recording ended earlier ----
{
  const { t, a } = playingA({ 'n1/1': [[NOW - 60 * MIN, NOW]], 'n1/2': [[NOW - 60 * MIN, NOW - 30 * MIN]] })
  check('setup: camera n1/1 plays, its frames reach the player', t.frames.length === 1 && t.socket() === a && !a.closed)
  await t.goToCamera('n1', 2, t.state.position)
  check('goToCamera to a camera with nothing at that moment: the old camera\'s socket is closed', a.closed, t.log.join(' | '))
  check('  nothing plays: the page has no socket, and none was opened for the new camera', t.socket() === null && t.sockets.length === 1)
  check('  closed, player reset and picture wiped before the new camera\'s day is asked for', before(t.log, 'close n1/1', 'recordings n1/2') && before(t.log, 'player reset', 'recordings n1/2') && before(t.log, 'wipe picture', 'recordings n1/2'), t.log.join(' | '))
  check('  the whole picture is wiped (a snapshot cannot save the old camera under the new name)', wipedWhole(t), JSON.stringify(t.wiped))
  check('  the quiet mark is back and no spinner turns (nothing is coming)', t.placeholderEl.hidden === false && t.spinnerEl.hidden === true)
  check('  the viewer is told', t.messages.at(-1) === 'No recording after this point.', t.messages.at(-1))
  a.onmessage({ data: frame('A2') })
  a.onmessage({ data: JSON.stringify({ type: 'end' }) })
  check('  a frame or a status of the old camera arriving late is dropped', t.frames.length === 1 && !t.log.includes('status end'), `${t.frames} ${t.log.join(' | ')}`)
}

// ---- the camera list (its change handler): the same --------------------------------------------------
{
  const { t, a } = playingA({ 'n1/1': [[NOW - 60 * MIN, NOW]], 'n1/2': [[NOW - 60 * MIN, NOW - 30 * MIN]] })
  check('setup: the page registered its camera list change handler', typeof t.listChange === 'function')
  t.cameraSel.value = 'n1/2' // the viewer picks n1/2 in the list
  await t.listChange()
  check('the camera list, to a camera with nothing at that moment: the old camera\'s socket is closed, nothing plays', a.closed && t.socket() === null && t.sockets.length === 1, t.log.join(' | '))
  check('  closed, player reset and picture wiped before the new camera\'s day is asked for', before(t.log, 'close n1/1', 'recordings n1/2') && before(t.log, 'player reset', 'recordings n1/2') && before(t.log, 'wipe picture', 'recordings n1/2'), t.log.join(' | '))
  check('  the viewer is told, and the old camera\'s late frames are dropped', t.messages.at(-1) === 'No recording after this point.' && (a.onmessage({ data: frame('A2') }), t.frames.length === 1))
}

// ---- a camera whose recordings exist at that moment: the switch plays it, as before ----------------------
{
  const { t, a } = playingA({ 'n1/1': [[NOW - 60 * MIN, NOW]], 'n1/2': [[NOW - 60 * MIN, NOW]] })
  await t.goToCamera('n1', 2, t.state.position)
  const b = t.socket()
  check('goToCamera to a camera with footage then: the old socket closed, a new one for the new camera at the same moment', a.closed && b && b.camera === 'n1/2' && !b.closed && new RegExp(`[?&]start=${NOW - 5 * MIN}(&|$)`).test(b.url), b?.url)
  b.onmessage({ data: frame('B1') })
  a.onmessage({ data: frame('A2') })
  check('  the new camera\'s frames are shown, the old one\'s are not', t.frames.join() === 'A1,B1', t.frames.join())
  check('  the spinner turns until its first picture', t.spinnerEl.hidden === false)
}

// ---- a camera whose NVR search fails ---------------------------------------------------------------
{
  const { t, a } = playingA({ 'n1/1': [[NOW - 60 * MIN, NOW]], 'n1/2': new Error('NVR offline') })
  await t.goToCamera('n1', 2, t.state.position)
  check('goToCamera to a camera whose search fails: the old camera\'s socket is closed, nothing plays', a.closed && t.socket() === null, t.log.join(' | '))
  check('  the real reason stays on screen (not overwritten by "No recording after this point.")', t.messages.at(-1) === 'Could not load recordings: NVR offline', t.messages.join(' | '))
}

// ---- loadDay itself: a failed search does not run what comes after -------------------------------------
{
  const t = rig({ 'n1/1': new Error('timed out') })
  let after = 0
  await t.loadDay(() => after++)
  check('loadDay with a failed search: after() is not run, the message stays', after === 0 && t.messages.at(-1) === 'Could not load recordings: timed out', `${after} ${t.messages.join(' | ')}`)
  const ok = rig({ 'n1/1': [[NOW - 60 * MIN, NOW]] })
  let ran = 0
  await ok.loadDay(() => ran++)
  check('  a search that succeeds still runs it', ran === 1 && ok.state.ranges.length === 1)
  const empty = rig({ 'n1/1': [] })
  let ranEmpty = 0
  await empty.loadDay(() => ranEmpty++)
  check('  as does a day with no recordings (unchanged)', ranEmpty === 1 && empty.messages.includes('No recordings for this camera on this day.'))
}

// ---- whatever kind of socket was playing -----------------------------------------------------------
{
  const t = rig({ 'n1/1': [[NOW - 60 * MIN, NOW]], 'n1/2': [[NOW - 60 * MIN, NOW - 30 * MIN]] })
  const old = new t.FakeSocket('wss://argus.test/playback?nvr=n1&ch=1&stream=0&src=auto')
  old.kind = 'server'
  t.setSocket(old)
  t.state.position = NOW - 5 * MIN
  await t.goToCamera('n1', 2, t.state.position)
  check('goToCamera closes a server playback socket too', old.closed && t.socket() === null)
}

// ---- every switch from code goes through goToCamera ---------------------------------------------------
check('a bookmark on another camera, a follow link and Back all switch through goToCamera', /await goToCamera\(nvr, Number\(ch\), b\.startMs\)/.test(fn('openBookmark')) && /await goToCamera\(/.test(fn('followTo')) && /if \(back\) await goToCamera\(/.test(page))

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exitCode = failures ? 1 : 0
