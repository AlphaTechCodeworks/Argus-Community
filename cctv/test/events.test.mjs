// Offline tests for event intake (events.mjs, event-rules.mjs, rec-modes.mjs, motion-tune.mjs):
// the NVR recording-type bits, schedules, pre/post windows, the recording gate, the poller's
// manners, the read-only command probe, and the motion write's refusals.
//
// Temp data folder only; no NVR, no SDK, no network. Nothing here sends anything anywhere, and the
// one module that would (motion-tune) is driven with a fake query so the write path is exercised
// without a real box.
//   node cctv/test/events.test.mjs
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'cctv-events-test-'))
writeFileSync(join(process.env.DATA_DIR, 'users.json'), JSON.stringify({ alice: { hash: 'x', role: 'admin' } }))

const {
  CONTINUOUS_BITS, EVENT_TYPES, MODE_TYPES, RECORD_TYPE_BITS, TYPE_NAMES,
  eventWindow, eventsForMode, inSchedule, inWindows, isEventMode,
  recordWindows, shouldRecord, typesFromRecordBits
} = await import('../event-rules.mjs')
const {
  BACKOFF_MS, EVENT_PROBES, EVENT_PROBE_NAMES, FIRST_LOOK_MS, MIN_POLL_MS, SOURCE_RECORDINGS,
  backoffFor, daysToAsk, eventsFromRecordings, itemsOf, makeEventIntake, offlineEvents,
  pollable, probeEvents, probeShapes, sourceReport, summariseProbe
} = await import('../events.mjs')
const events = await import('../events.mjs')
const { FEED_FRESH_MS, buildWindowMessage, shouldWrite, windowsFor } = await import('../rec-modes.mjs')
const { buildMotionEdit, motionRequest, readArea, readMotionAnswer, writeMotionThreshold } = await import('../motion-tune.mjs')

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }

const T0 = Date.UTC(2026, 8, 25, 9, 0, 0)
const MIN = 60_000
const S = 1000

// --- the NVR's recording-type bits ---------------------------------------------------------------
//
// These are the one event source in this phase that is not a guess: DD_RECORD_TYPE, from the
// vendor's own header, read by a search this app already makes to draw the timeline.
{
  check('plain scheduled recording is not an event', typesFromRecordBits(CONTINUOUS_BITS).length === 0)
  check('manual recording alone is not an event', typesFromRecordBits(0x1).length === 0)
  const motion = typesFromRecordBits(0x4)
  check('0x4 is motion', motion.length === 1 && motion[0].type === 'motion', JSON.stringify(motion))
  const both = typesFromRecordBits(0x2 | 0x4)
  check('scheduled + motion is one motion event', both.length === 1 && both[0].type === 'motion')
  const two = typesFromRecordBits(0x4 | 0x400)
  check('one file can carry two reasons', two.length === 2 && two.some((t) => t.type === 'motion') && two.some((t) => t.type === 'line-crossing' && t.subtype === 'tripwire'), JSON.stringify(two))
  // The camera's own line-crossing detection is a kind of its own, so a rule can ask for exactly
  // that; the NVR's other intelligent bits stay 'ai'.
  const tripwire = typesFromRecordBits(0x400)
  check('0x400 is a line crossing (tripwire)', tripwire.length === 1 && tripwire[0].type === 'line-crossing' && tripwire[0].subtype === 'tripwire', JSON.stringify(tripwire))
  const crossed = typesFromRecordBits(0x80)
  check('0x80 is a line crossing (line crossed)', crossed.length === 1 && crossed[0].type === 'line-crossing' && crossed[0].subtype === 'line crossed', JSON.stringify(crossed))
  const bothLines = typesFromRecordBits(0x2 | 0x80 | 0x400)
  check('both line bits in one file give two line-crossing rows', bothLines.length === 2 && bothLines.every((t) => t.type === 'line-crossing'), JSON.stringify(bothLines))
  check('area entered (0x800) is still smart detection', typesFromRecordBits(0x800)[0].type === 'ai' && typesFromRecordBits(0x800)[0].subtype === 'area entered')
  check('no smart-detection bit is left with a line subtype', RECORD_TYPE_BITS.every((r) => r.type !== 'ai' || !/line|tripwire/.test(r.subtype)))
  check('0x1000 is a face', typesFromRecordBits(0x1000)[0].type === 'face')
  check('0x20 is tamper', typesFromRecordBits(0x20)[0].type === 'tamper')
  // The honest half: a bit we have no name for is reported as a bit, not as motion.
  const odd = typesFromRecordBits(0x8000)
  check('an unknown bit is named, not guessed at', odd.length === 1 && odd[0].type === 'nvr-event' && /0x8000/.test(odd[0].subtype), JSON.stringify(odd))
  check('a known bit plus an unknown one gives both', typesFromRecordBits(0x4 | 0x8000).length === 2)
  check('nothing at all gives nothing', typesFromRecordBits(0).length === 0 && typesFromRecordBits(null).length === 0)
}

// --- what this app admits it cannot do -------------------------------------------------------------
{
  const person = EVENT_TYPES.find((t) => t.type === 'ai-person')
  check('ai-person is confirmed: this server own detection makes it', person && person.confirmed === true && person.label === 'Person' && person.from.includes('argus'))
  check('ai-vehicle likewise', EVENT_TYPES.find((t) => t.type === 'ai-vehicle')?.confirmed === true && EVENT_TYPES.find((t) => t.type === 'ai-vehicle').label === 'Vehicle')
  for (const [t, l] of [['ai-bicycle', 'Bicycle'], ['ai-boat', 'Boat'], ['ai-animal', 'Animal'], ['ai-bag', 'Bag']]) {
    const k = EVENT_TYPES.find((x) => x.type === t)
    check(t + ' is a confirmed kind called ' + l + ', from argus', k?.confirmed === true && k.label === l && k.from.includes('argus'), JSON.stringify(k))
  }
  check('motion is confirmed', EVENT_TYPES.find((t) => t.type === 'motion')?.confirmed === true)
  const line = EVENT_TYPES.find((t) => t.type === 'line-crossing')
  check('line-crossing is a confirmed kind with words for people', line?.confirmed === true && line.label === 'Line crossing', JSON.stringify(line))
  check('... and says where it comes from', /line-crossing/.test(line?.from ?? '') && /0x80/.test(line?.from ?? '') && /0x400/.test(line?.from ?? ''), line?.from)
  // Nothing in the mapping may ever produce an unconfirmed kind.
  const produced = new Set()
  for (let bit = 1; bit <= 0x8000; bit <<= 1) for (const t of typesFromRecordBits(bit)) produced.add(t.type)
  check('the recording-type mapping never produces an unconfirmed kind',
    ![...produced].some((t) => EVENT_TYPES.find((x) => x.type === t)?.confirmed === false), [...produced].join())
  const report = sourceReport()
  check('the source report no longer lists person and vehicle as not available', !report.notAvailable.some((n) => /Person and vehicle/.test(n.what)), JSON.stringify(report.notAvailable))
  check('... it lists them as reported, from this server\'s own detection', report.confirmed.some((c) => c.what === 'Person and vehicle detection' && c.how === "this server's own detection on the cameras switched on for it (Picture tab)"), JSON.stringify(report.confirmed))
  check('and says what would confirm them', report.notAvailable.every((n) => Boolean(n.toConfirm)))
}

// --- schedules -------------------------------------------------------------------------------------
//
// T0 is Friday 2026-09-25 09:00 UTC. Friday is day 5.
{
  check('no schedule means always', inSchedule(null, T0) && inSchedule([], T0))
  check('inside an ordinary span', inSchedule([{ from: '08:00', to: '17:00' }], T0))
  check('outside it', !inSchedule([{ from: '10:00', to: '17:00' }], T0))
  check('the end is exclusive', !inSchedule([{ from: '07:00', to: '09:00' }], T0))
  check('the start is inclusive', inSchedule([{ from: '09:00', to: '10:00' }], T0))
  check('the right day passes', inSchedule([{ days: [5], from: '08:00', to: '17:00' }], T0))
  check('the wrong day does not', !inSchedule([{ days: [1, 2], from: '08:00', to: '17:00' }], T0))
  check('several spans: any one is enough', inSchedule([{ from: '00:00', to: '01:00' }, { from: '08:00', to: '17:00' }], T0))
  // through midnight
  const night = [{ from: '22:00', to: '06:00' }]
  check('22:00 is inside a night span', inSchedule(night, Date.UTC(2026, 8, 25, 22, 30)))
  check('02:00 is inside a night span', inSchedule(night, Date.UTC(2026, 8, 26, 2, 0)))
  check('noon is not', !inSchedule(night, Date.UTC(2026, 8, 25, 12, 0)))
  // A night span's days are the days it starts on, which is what "Friday night" means.
  const friNight = [{ days: [5], from: '22:00', to: '06:00' }]
  check('Friday night covers Friday 23:00', inSchedule(friNight, Date.UTC(2026, 8, 25, 23, 0)))
  check('Friday night covers Saturday 02:00', inSchedule(friNight, Date.UTC(2026, 8, 26, 2, 0)))
  check('Friday night does not cover Sunday 02:00', !inSchedule(friNight, Date.UTC(2026, 8, 27, 2, 0)))
  check('00:00 to 00:00 is the whole day', inSchedule([{ from: '00:00', to: '00:00' }], T0))
  // site wall clock: -4 h turns 09:00 UTC into 05:00 locally
  check('the site offset is applied', !inSchedule([{ from: '08:00', to: '17:00' }], T0, -240))
  check('and the local hour is what matches', inSchedule([{ from: '04:00', to: '06:00' }], T0, -240))
}

// --- pre/post windows --------------------------------------------------------------------------------
{
  const ev = { startMs: T0, endMs: T0 + 10 * S }
  check('a window grows either side', JSON.stringify(eventWindow(ev, { preS: 10, postS: 20 })) === JSON.stringify([T0 - 10 * S, T0 + 30 * S]))
  check('an event with no end is a moment', JSON.stringify(eventWindow({ startMs: T0 }, { preS: 5, postS: 5 })) === JSON.stringify([T0 - 5 * S, T0 + 5 * S]))
  check('no seconds means the event itself', JSON.stringify(eventWindow(ev)) === JSON.stringify([T0, T0 + 10 * S]))
  check('an event with no start is no window', eventWindow({}) === null)

  const events = [{ startMs: T0, endMs: T0 + 5 * S }, { startMs: T0 + 8 * S, endMs: T0 + 9 * S }, { startMs: T0 + 10 * MIN, endMs: T0 + 10 * MIN }]
  const w = recordWindows(events, { preS: 2, postS: 2 })
  check('overlapping windows merge', w.length === 2, JSON.stringify(w))
  check('the merged one spans both', w[0][0] === T0 - 2 * S && w[0][1] === T0 + 11 * S, JSON.stringify(w[0]))
  check('a distant event stays its own window', w[1][0] === T0 + 10 * MIN - 2 * S)
  check('joinMs pulls nearby windows together', recordWindows(events, { preS: 2, postS: 2, joinMs: 15 * MIN }).length === 1)
  check('no events, no windows', recordWindows([]).length === 0 && recordWindows(null).length === 0)

  check('inside a window', inWindows(w, T0 + 3 * S))
  check('between windows', !inWindows(w, T0 + 60 * S))
  check('the edges count', inWindows(w, w[0][0]) && inWindows(w, w[0][1]))
  check('shouldRecord agrees', shouldRecord(events, T0 + 3 * S, { preS: 2, postS: 2 }))
  check('and says no in the quiet', !shouldRecord(events, T0 + 60 * S, { preS: 2, postS: 2 }))
}

// --- which events a mode cares about -----------------------------------------------------------------
{
  const mixed = [{ type: 'motion' }, { type: 'ai' }, { type: 'line-crossing' }, { type: 'face' }, { type: 'camera-offline' }, { type: 'pos' }]
  check('motion mode takes motion only', eventsForMode(mixed, 'motion').length === 1)
  // A crossing was an 'ai' event until it got a kind of its own; the ai modes still record for it.
  check('ai mode takes the smart ones, line crossings included', eventsForMode(mixed, 'ai').length === 3 && eventsForMode(mixed, 'ai').some((e) => e.type === 'line-crossing'), JSON.stringify(eventsForMode(mixed, 'ai')))
  check('ai-or-motion takes all four', eventsForMode(mixed, 'ai-or-motion').length === 4)
  check('continuous is not an event mode', !isEventMode('continuous') && eventsForMode(mixed, 'continuous').length === 0)
  check('off is not either', !isEventMode('off'))
  check('every mode in MODE_TYPES lists only known kinds', Object.values(MODE_TYPES).flat().every((t) => TYPE_NAMES.includes(t)))
}

// --- the recording gate ------------------------------------------------------------------------------
//
// The important rule: an event mode with no trustworthy event feed records EVERYTHING, and says so.
// Silently recording nothing because the poller is stuck is how a month of footage goes missing.
{
  const win = [[T0, T0 + 10 * S]]
  check('continuous ignores the windows entirely', shouldWrite({ mode: 'continuous', windows: [], feedAt: null, ts: T0, nowMs: T0 }).write)
  const never = shouldWrite({ mode: 'motion', windows: [], feedAt: null, ts: T0, nowMs: T0 })
  check('no feed yet: record anyway', never.write)
  check('and say why', /no events have reached/.test(never.why), never.why)
  const stale = shouldWrite({ mode: 'motion', windows: win, feedAt: T0 - 2 * FEED_FRESH_MS, ts: T0 + 60 * S, nowMs: T0 + 60 * S })
  check('a stale feed: record anyway', stale.write)
  check('and say how stale', /cannot be trusted/.test(stale.why), stale.why)
  check('fresh feed, inside a window: write', shouldWrite({ mode: 'motion', windows: win, feedAt: T0, ts: T0 + 5 * S, nowMs: T0 + 5 * S }).write)
  const idle = shouldWrite({ mode: 'motion', windows: win, feedAt: T0, ts: T0 + 60 * S, nowMs: T0 + 60 * S })
  check('fresh feed, outside every window: do not write', !idle.write)
  check('and it is called waiting, not a fault', idle.why === 'waiting for an event', idle.why)

  const evs = [{ type: 'motion', startMs: T0, endMs: T0 + S }, { type: 'pos', startMs: T0 + 5 * MIN, endMs: T0 + 5 * MIN }]
  const made = windowsFor(evs, 'motion', { preS: 10, postS: 20 })
  check('windowsFor uses only the mode’s kinds', made.length === 1 && made[0][0] === T0 - 10 * S && made[0][1] === T0 + 21 * S, JSON.stringify(made))

  const msg = buildWindowMessage({
    nvrId: 'nvr1',
    cameras: [{ ch: 0 }, { ch: 1 }, { ch: 2 }],
    recording: { defaults: { mode: 'continuous', preS: 10, postS: 20 }, cameras: { 'nvr1/1': { mode: 'motion' }, 'nvr1/2': { mode: 'ai', preS: 1, postS: 1 } } },
    eventsOf: (ch) => (ch === 1 ? [{ type: 'motion', startMs: T0, endMs: T0 }] : [{ type: 'ai', startMs: T0, endMs: T0 }]),
    nowMs: T0 + MIN
  })
  check('only event-mode cameras get windows', Object.keys(msg.windows).sort().join() === '1,2', Object.keys(msg.windows).join())
  check('per-camera pre/post beats the defaults', msg.windows[2][0][0] === T0 - 1 * S, JSON.stringify(msg.windows[2]))
  check('and the defaults are used when the camera has none', msg.windows[1][0][0] === T0 - 10 * S, JSON.stringify(msg.windows[1]))
  check('the message is stamped so the worker can tell it is fresh', msg.at === T0 + MIN)
}

// --- intake from the recorded-file index --------------------------------------------------------------
{
  const recs = { ranges: [], events: [[T0, T0 + 20 * S, 0x4], [T0 + MIN, T0 + MIN + S, 0x4 | 0x400], [T0 + 2 * MIN, T0 + 2 * MIN, 0x2]] }
  const rows = eventsFromRecordings('nvr1', 3, recs)
  check('each reason in a file becomes its own row', rows.length === 3, JSON.stringify(rows.map((r) => `${r.type}/${r.subtype}`)))
  check('a plain scheduled file makes none', rows.every((r) => r.startMs !== T0 + 2 * MIN))
  check('the camera is carried', rows[0].nvr === 'nvr1' && rows[0].ch === 3)
  check('the source is named', rows.every((r) => r.source === SOURCE_RECORDINGS))
  check('the detail states the raw type', /0x4/.test(rows[0].detail), rows[0].detail)
  check('an answer with no events makes none', eventsFromRecordings('n', 0, { events: [] }).length === 0)
  check('a missing answer makes none, it does not throw', eventsFromRecordings('n', 0, null).length === 0)
}

// --- camera offline ------------------------------------------------------------------------------------
{
  const cams = [{ nvr: 'nvr1', ch: 0, name: 'Gate', online: true }, { nvr: 'nvr1', ch: 1, name: 'Yard', online: true }]
  const first = offlineEvents(new Map(), cams, T0)
  check('the first sighting of healthy cameras files nothing', first.events.length === 0)
  const gone = offlineEvents(first.state, [cams[0], { ...cams[1], online: false }], T0 + MIN)
  check('a camera going offline is one event', gone.events.length === 1 && gone.events[0].type === 'camera-offline')
  check('it names the camera', /Yard/.test(gone.events[0].detail), gone.events[0].detail)
  const still = offlineEvents(gone.state, [cams[0], { ...cams[1], online: false }], T0 + 2 * MIN)
  check('a camera still offline is not news every pass', still.events.length === 0)
  const back = offlineEvents(still.state, cams, T0 + 3 * MIN)
  check('and coming back files nothing either (that is the Health page’s job)', back.events.length === 0)
  // A camera that was offline before the server started must not produce an event on first sight.
  check('never-seen-before and offline files nothing', offlineEvents(new Map(), [{ nvr: 'n', ch: 0, online: false }], T0).events.length === 0)
}

// --- the poller's manners --------------------------------------------------------------------------------
//
// nvr-2 is at its bandwidth ceiling and yard takes 37 s over routine calls. Every "no" here is
// load this phase does not add to a box that is already struggling.
{
  const ok = { id: 'n', name: 'N', online: true }
  check('a healthy NVR may be asked', pollable(ok, T0).ok)
  check('an offline one may not', !pollable({ ...ok, online: false }, T0).ok)
  check('a degraded one may not', !pollable({ ...ok, degraded: true }, T0).ok)
  check('a stopped one may not', !pollable({ ...ok, stopped: true }, T0).ok)
  const refusing = pollable({ ...ok, refusalsLast10Min: 3 }, T0)
  check('one refusing streams is left alone', !refusing.ok)
  check('and the reason says so in words', /refusing/.test(refusing.why), refusing.why)
  check('two refusals is not enough to stop', pollable({ ...ok, refusalsLast10Min: 2 }, T0).ok)
  check('asked recently: wait', !pollable(ok, T0, { nextAt: T0 + MIN }).ok)
  check('every refusal comes with a sentence', ['online', 'degraded'].every(() => true) && pollable(null, T0).why.length > 0)

  check('the first failure waits a minute', backoffFor(1) === BACKOFF_MS[0])
  check('the backoff grows', backoffFor(3) > backoffFor(1))
  check('and stops at an hour', backoffFor(99) === BACKOFF_MS.at(-1) && BACKOFF_MS.at(-1) === 60 * 60_000)

  check('a first-ever poll looks back hours, not a month', FIRST_LOOK_MS === 6 * 3_600_000)
  // (Task 5 review, 2026-10-20: the rest an NVR takes after each round of its cameras, and each camera's floor)
  check('an NVR rests at least a minute after each round of its cameras, and no camera is asked twice inside a minute', MIN_POLL_MS >= 60_000)
  const days = daysToAsk(T0 - 3 * 86_400_000, T0, 0)
  check('a long catch-up is capped at two days a pass', days.length === 2, days.join())
  check('and it catches up from the oldest end (the next pass goes on from there)', days.join() === '2026-09-22,2026-09-23', days.join())
  check('the last two days are both asked', daysToAsk(T0 - 86_400_000, T0, 0).join() === '2026-09-24,2026-09-25')
  check('one day in the window is one day asked', daysToAsk(T0 - MIN, T0, 0).length === 1)
}

// --- the poller itself -----------------------------------------------------------------------------------
{
  const stored = []
  const store = {
    addEvent: (e) => {
      const already = stored.find((s) => s.nvr === e.nvr && s.ch === e.ch && s.type === e.type && s.startMs === e.startMs)
      if (already) return { event: already, isNew: false }
      const row = { id: stored.length + 1, ...e }
      stored.push(row)
      return { event: row, isNew: true }
    },
    intakeCursorMs: () => null
  }
  const asked = []
  let now = T0
  const nvrs = [{ id: 'nvr1', name: 'One', online: true }, { id: 'nvr2', name: 'Two', online: false }]
  const seen = []
  const intake = makeEventIntake({
    listNvrs: () => nvrs,
    camerasOf: () => [{ ch: 0 }, { ch: 1 }],
    recordings: async (nvr, ch, date) => {
      asked.push(`${nvr.id}/${ch}/${date}`)
      return { events: [[now - MIN, now - MIN + S, 0x4]] }
    },
    onEvent: (e) => seen.push(e),
    now: () => now,
    log: () => {},
    store
  })

  const r1 = await intake.tick()
  check('a pass does one camera on one NVR', asked.length === 1 && r1.nvr === 'nvr1' && r1.ch === 0, JSON.stringify(r1))
  check('it stored what it found', r1.stored === 1 && seen.length === 1 && seen[0].type === 'motion')
  check('the offline NVR was never asked', !asked.some((a) => a.startsWith('nvr2')))
  now += 100
  check('and it is not asked again straight away', (await intake.tick()) === null, JSON.stringify(asked))
  now += 5000
  const r2 = await intake.tick()
  check('after the rest, the next camera', r2.ch === 1, JSON.stringify(r2))
  check('re-reading the same stretch stores nothing twice', r2.stored === 0 || stored.length === 2, `${stored.length}`)

  const status = intake.status()
  check('status covers every NVR', status.length === 2)
  check('the offline one says why it is quiet', /offline/.test(status.find((s) => s.nvr === 'nvr2').why))
  check('and names the only confirmed source', status[0].source === SOURCE_RECORDINGS)
}
{
  // A failing NVR backs off and does not take the whole pass down with it.
  let now = T0
  const intake = makeEventIntake({
    listNvrs: () => [{ id: 'slow', name: 'Slow', online: true }],
    camerasOf: () => [{ ch: 0 }],
    recordings: async () => { throw new Error('the NVR is not answering') },
    now: () => now,
    log: () => {},
    store: { addEvent: () => ({ event: null, isNew: false }), intakeCursorMs: () => null }
  })
  const r = await intake.tick()
  check('a failure is reported, not thrown', r?.error && /not answering/.test(r.error), JSON.stringify(r))
  now += 30_000
  check('and it is left alone while it backs off', (await intake.tick()) === null)
  check('status explains the silence', /not answering/.test(intake.status()[0].why))
}
{
  // One pass at a time. On 09-27 a FindRecDate stuck in the SDK had each 5 s tick ask yet another
  // NVR's clock, and every one of those queued behind it: six overdue calls and a restart.
  const quiet = { addEvent: () => ({ event: null, isNew: false }), intakeCursorMs: () => null }
  const nvrs = [{ id: 'a', name: 'A', online: true }, { id: 'b', name: 'B', online: true }]
  const asked = []
  const never = new Promise(() => {})
  const intake = makeEventIntake({
    listNvrs: () => nvrs,
    camerasOf: () => [{ ch: 0 }, { ch: 1 }],
    clock: (nvr) => { asked.push(`clock ${nvr.id}`); return never },
    recordings: (nvr) => { asked.push(`recordings ${nvr.id}`); return never },
    now: () => T0,
    log: () => {},
    store: quiet
  })
  void intake.tick() // its clock read never comes back
  await new Promise((r) => setImmediate(r))
  // (raced against a timer: a tick that joins the stuck pass would never answer at all)
  const within = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r('still waiting'), 300))])
  const second = await within(intake.tick())
  check('a tick while the previous pass is still waiting on its clock read returns null', second === null)
  check('... and asks nothing, of that NVR or any other', asked.join() === 'clock a', asked.join())

  // the same when the clock answers and the search is the call that hangs
  const asked2 = []
  const intake2 = makeEventIntake({
    listNvrs: () => nvrs,
    camerasOf: () => [{ ch: 0 }],
    clock: async (nvr) => { asked2.push(`clock ${nvr.id}`); return { tzOffsetMs: 0 } },
    recordings: (nvr) => { asked2.push(`recordings ${nvr.id}`); return never },
    now: () => T0,
    log: () => {},
    store: quiet
  })
  void intake2.tick()
  await new Promise((r) => setImmediate(r))
  const again = await Promise.all([within(intake2.tick()), within(intake2.tick())])
  check('a tick while the previous pass waits on its search returns null and asks nothing', again.every((r) => r === null) && asked2.join() === 'clock a,recordings a', asked2.join())
}
{
  // Any overdue SDK call in this process (sdk.mjs lateCalls() > 0): nobody is asked, because the
  // SDK runs one call at a time for every NVR and a question now would only queue behind it.
  let busy = true
  const asked = []
  const intake = makeEventIntake({
    listNvrs: () => [{ id: 'a', name: 'A', online: true }, { id: 'b', name: 'B', online: true }, { id: 'c', name: 'C', online: false }],
    camerasOf: () => [{ ch: 0 }],
    clock: async (nvr) => { asked.push(`clock ${nvr.id}`); return { tzOffsetMs: 0 } },
    recordings: async (nvr, ch) => { asked.push(`recordings ${nvr.id}/${ch}`); return { events: [] } },
    sdkBusy: () => busy,
    now: () => T0,
    log: () => {},
    store: { addEvent: () => ({ event: null, isNew: false }), intakeCursorMs: () => null }
  })
  check('with an SDK call overdue, a tick asks no NVR at all', (await intake.tick()) === null && asked.length === 0, asked.join())
  const st = intake.status()
  check('... and status says why for each NVR that is online', st.filter((s) => s.nvr !== 'c').every((s) => /overdue/.test(s.why)), JSON.stringify(st.map((s) => s.why)))
  check('... while an offline NVR still says it is offline', /offline/.test(st.find((s) => s.nvr === 'c').why))
  busy = false
  const r = await intake.tick()
  check('once nothing is overdue, intake carries on', r?.nvr === 'a' && asked.join() === 'clock a,recordings a/0', asked.join())
  check('pollable: sdkBusy is a no, with a sentence', !pollable({ id: 'n', online: true }, T0, { sdkBusy: true }).ok && /overdue/.test(pollable({ id: 'n', online: true }, T0, { sdkBusy: true }).why))
}
{
  // One camera whose search fails (FindFile refused, or its file list broke off) must not keep the
  // NVR's other cameras from being asked. Its failure is no longer "no footage" (playback.mjs), so
  // restarting the list from the first camera after every failure would never reach the ones after it.
  const CAMERA_REST = events.CAMERA_REST_MS
  let now = T0
  const asked = []
  const logged = []
  const intake = makeEventIntake({
    listNvrs: () => [{ id: 'a', name: 'A', online: true }],
    camerasOf: () => [{ ch: 0 }, { ch: 1 }, { ch: 2 }],
    recordings: async (_nvr, ch) => {
      asked.push(ch)
      if (ch === 1) throw new Error('the NVR could not search its recordings')
      return { events: [] }
    },
    now: () => now,
    log: (l) => logged.push(l),
    store: { addEvent: () => ({ event: null, isNew: false }), intakeCursorMs: () => null }
  })
  await intake.tick()
  now += CAMERA_REST
  const failed = await intake.tick()
  check('a camera whose search fails is a failure (reported, logged, backed off)', failed?.ch === 1 && /could not search/.test(failed.error ?? '') && logged.length === 1, JSON.stringify(failed))
  now += backoffFor(1) + 1
  const next = await intake.tick()
  check('after the back-off the NVR\'s next camera is asked, not the list again from the first', next?.ch === 2 && !next.error && asked.join() === '0,1,2', asked.join())
  now += MIN_POLL_MS + 1
  await intake.tick()
  now += CAMERA_REST
  const again = await intake.tick()
  check('... and the failing camera is asked again on the next round', again?.ch === 1 && asked.join() === '0,1,2,0,1', asked.join())
}
{
  // An offline camera is not asked (the NVR refuses its search, which is no failure of the NVR), and a
  // camera whose search always fails backs off on its own: before, the NVR's count started again at
  // the next camera that answered, and the same camera failed and was logged every round for ever
  // (audit 2026-10-07 M1).
  const CAMERA_REST = events.CAMERA_REST_MS
  let now = T0
  const asked = []
  const logged = []
  const cams = [{ ch: 0, online: true }, { ch: 1, online: true }, { ch: 2, online: false }, { ch: 3, online: true }]
  const intake = makeEventIntake({
    listNvrs: () => [{ id: 'a', name: 'A', online: true }],
    camerasOf: () => cams,
    recordings: async (_nvr, ch) => {
      asked.push({ ch, at: now })
      if (ch === 1) throw new Error('the NVR refused the search (FindFile failed)')
      return { events: [] }
    },
    now: () => now,
    log: (l) => logged.push(l),
    store: { addEvent: () => ({ event: null, isNew: false }), intakeCursorMs: () => null }
  })
  const until = T0 + 6 * 3_600_000
  let errors = 0
  while (now < until) {
    const r = await intake.tick()
    if (r?.error) errors++
    now += 5000
  }
  const of = (ch) => asked.filter((a) => a.ch === ch)
  check('an offline camera is never asked', of(2).length === 0, `${of(2).length}`)
  check('... and leaving it out is not a failure', errors === of(1).length && intake.status()[0].fails <= 1, `${errors} errors, ${of(1).length} tries`)
  // 1, 2, 5, 15, 30 min, then every hour: 5 tries in the first hour, and one an hour after
  check('a camera whose search always fails backs off: about ten tries in six hours, not one a round', of(1).length >= 8 && of(1).length <= 12 && logged.length === of(1).length, `${of(1).length} tries, ${logged.length} lines`)
  const gaps = of(1).slice(1).map((a, i) => a.at - of(1)[i].at)
  check('... each wait at least as long as the one before, up to the hour', gaps.every((g, i) => i === 0 || g >= gaps[i - 1] - MIN_POLL_MS - 4 * CAMERA_REST) && gaps.at(-1) >= 55 * MIN, gaps.map((g) => Math.round(g / MIN)).join())
  check('... and its line says its own wait', /next try in 60 min$/.test(logged.at(-1) ?? ''), logged.at(-1))
  check('the healthy cameras are still asked every round', of(0).length > 100 && of(3).length > 100, `${of(0).length}, ${of(3).length}`)
  cams[2].online = true
  cams[1].online = false
  asked.length = 0
  for (let i = 0; i < 40; i++) {
    await intake.tick()
    now += 5000
  }
  check('a camera that comes back online is asked again', of(2).length > 0 && of(1).length === 0, asked.map((a) => a.ch).join())
}
{
  // Least recently read first (EV-event-pipeline#0, 2026-10-20). Each 5 s tick went to the first NVR
  // in list order that could be asked (playback report 6), and then to one camera of the next NVR in
  // turn: every NVR got one camera a round whatever its size, so with 22 NVRs a camera on a 36-camera
  // NVR was read again only every 22 x 36 x 5 s = 66 min. Now each tick asks the camera read longest
  // ago on any NVR that may be asked. Four NVRs of different sizes, ticked as nvrs.mjs ticks them.
  const TICK = 5000 // nvrs.mjs EVENT_TICK_MS
  const sizes = { big1: 32, big2: 32, mid: 8, small: 4 }
  const nvrs = Object.keys(sizes).map((id) => ({ id, name: id, online: true }))
  let now = T0
  let tickNo = 0
  const asked = []
  const intake = makeEventIntake({
    listNvrs: () => nvrs,
    camerasOf: (nvr) => Array.from({ length: sizes[nvr.id] }, (_, ch) => ({ ch })),
    recordings: async (nvr, ch) => {
      asked.push({ tick: tickNo, nvr: nvr.id, ch, at: now })
      return { events: [] }
    },
    now: () => now,
    log: () => {},
    store: { addEvent: () => ({ event: null, isNew: false }), intakeCursorMs: () => null }
  })
  let most = 0
  for (tickNo = 0; tickNo < 200; tickNo++) {
    const before = asked.length
    await intake.tick()
    most = Math.max(most, asked.length - before)
    now += TICK
  }
  check('least recently read: still one camera per tick', most === 1, `${most}`)
  const first4 = asked.filter((a) => a.tick < 4).map((a) => a.nvr)
  check('least recently read: the first four ticks ask the four NVRs, one each', new Set(first4).size === 4, first4.join())
  const cams = new Set(asked.filter((a) => a.tick < 76).map((a) => `${a.nvr}/${a.ch}`))
  check('least recently read: within 76 ticks every one of the 76 cameras has been asked', cams.size === 76, `${cams.size} of 76`)
  // between two reads of one camera: one tick per camera of the fleet, on a big NVR as on a small one,
  // and at most the minute an NVR rests after each round of its own cameras (MIN_POLL_MS: Task 5
  // review, 2026-10-20)
  const late = []
  const reads = new Map()
  const allowed = 76 + Math.ceil(MIN_POLL_MS / TICK)
  for (const a of asked) reads.set(`${a.nvr}/${a.ch}`, [...(reads.get(`${a.nvr}/${a.ch}`) ?? []), a.tick])
  for (const [key, ticks] of reads) {
    for (let i = 1; i < ticks.length; i++) if (ticks[i] - ticks[i - 1] > allowed) late.push(`${key} waited ${ticks[i] - ticks[i - 1]} ticks`)
  }
  check('least recently read: no camera waits more than one tick per camera of the fleet and one NVR rest', late.length === 0, late.slice(0, 3).join('; '))
  const counts = [...reads.values()].map((t) => t.length)
  check('least recently read: a camera on a big NVR is read as often as one on a small NVR', Math.max(...counts) - Math.min(...counts) <= 1, `${Math.min(...counts)}..${Math.max(...counts)}`)
}
{
  // EV-event-pipeline#0 (2026-10-20), on a fleet the shape of the one the finding measured: 22 NVRs,
  // 306 cameras, the biggest with 36, searches answering at once, a tick every 5 s for four rounds.
  const TICK = 5000
  const sizes = [36, 32, 32, 24, 20, 16, 16, 16, 16, 16, 12, 12, 8, 8, 8, 8, 4, 4, 4, 4, 4, 6]
  const total = sizes.reduce((a, b) => a + b, 0)
  const fleet = sizes.map((n, i) => ({ id: `site${i + 1}`, name: `Site ${i + 1}`, online: true, n }))
  const keys = fleet.flatMap((nvr) => Array.from({ length: nvr.n }, (_, ch) => `${nvr.id}/${ch}`))
  const quiet = { addEvent: () => ({ event: null, isNew: false }), intakeCursorMs: () => null }
  const simulate = async ({ urgent, ticks = 4 * total, onTick = () => {} }) => {
    let now = T0
    const reads = new Map()
    let asks = 0 // how often the rules hook was asked
    const intake = makeEventIntake({
      listNvrs: () => fleet,
      camerasOf: (nvr) => Array.from({ length: nvr.n }, (_, ch) => ({ ch })),
      recordings: async (nvr, ch) => {
        const key = `${nvr.id}/${ch}`
        if (!reads.has(key)) reads.set(key, [])
        reads.get(key).push(now)
        return { events: [] }
      },
      ...(urgent ? { urgent: () => (asks++, urgent()) } : {}),
      now: () => now,
      log: () => {},
      store: quiet
    })
    for (let i = 0; i < ticks; i++) {
      onTick(i, now, reads)
      await intake.tick()
      now += TICK
    }
    const gaps = (key) => (reads.get(key) ?? []).slice(1).map((t, i) => t - reads.get(key)[i])
    const worst = (ks) => Math.max(0, ...ks.flatMap(gaps))
    const median = (ks) => {
      const all = ks.flatMap(gaps).sort((a, b) => a - b)
      return all[Math.floor(all.length / 2)]
    }
    return { reads, worst, median, asks: () => asks }
  }
  const mins = (ms) => `${Math.round(ms / MIN)} min`
  const restTicks = Math.ceil(MIN_POLL_MS / TICK)
  // one round of the fleet, and one NVR rest (MIN_POLL_MS, Task 5 review, 2026-10-20)
  const round = (total + restTicks + 2) * TICK
  // ... and a round while rule cameras take their share of the passes (RULE_SHARE)
  const sharedRound = (round * events.RULE_SHARE) / (events.RULE_SHARE - 1)
  const plain = await simulate({})
  check('fleet: every camera is read', keys.every((k) => plain.reads.has(k)), `${plain.reads.size} of ${keys.length}`)
  check('fleet: no camera waits more than one tick per camera of the fleet and one NVR rest (about 26 min, was 66 on a 36-camera NVR)', plain.worst(keys) <= round, mins(plain.worst(keys)))

  // a camera an enabled alarm rule names is read again about every RULE_POLL_MS
  check('events.mjs exports RULE_POLL_MS, between one and two minutes', events.RULE_POLL_MS >= 60_000 && events.RULE_POLL_MS <= 120_000, String(events.RULE_POLL_MS))
  const covered = new Set(['site1/5', 'site1/30', 'site17/2'])
  const ruled = await simulate({ urgent: () => (nvr, ch) => covered.has(`${nvr}/${ch}`) })
  check('rule cameras: each is read again within RULE_POLL_MS and two ticks', ruled.worst([...covered]) <= events.RULE_POLL_MS + 2 * TICK, mins(ruled.worst([...covered])))
  const rest = keys.filter((k) => !covered.has(k))
  check('rule cameras: ... and the other cameras still come round, at most a third later than with no rule', ruled.worst(rest) <= sharedRound, mins(ruled.worst(rest)))

  // Task 5 review (2026-10-20): a rule on any camera beside a rule naming one. The broad rule made every
  // camera count, so none was ever read ahead and the named camera waited a whole round (about 25 min).
  const { alertingCameras } = await import('../event-rules.mjs')
  const rules = [
    { id: 1, enabled: true, bell: true, cameras: [], types: ['tamper', 'sensor'] },
    { id: 2, enabled: true, notify: true, cameras: ['site3/9'], types: ['motion'] }
  ]
  const mixed = await simulate({ urgent: () => alertingCameras(rules) })
  check('a rule on any camera beside one naming a camera: the named camera is still read within RULE_POLL_MS and two ticks', mixed.worst(['site3/9']) <= events.RULE_POLL_MS + 2 * TICK, mins(mixed.worst(['site3/9'])))
  check('... and the other cameras come round once a round, not every RULE_POLL_MS', mixed.median(keys.filter((k) => k !== 'site3/9')) > 10 * MIN, mins(mixed.median(keys.filter((k) => k !== 'site3/9'))))

  // Task 5 review (2026-10-20): rule cameras go ahead on one pass in RULE_SHARE at most. On every other
  // pass, nine or more of them took half the passes and the other cameras waited about 50 min.
  check('events.mjs exports RULE_SHARE, one pass in three or four', events.RULE_SHARE >= 3 && events.RULE_SHARE <= 4, String(events.RULE_SHARE))
  const twenty = new Set(keys.filter((_, i) => i % 15 === 7).slice(0, 20))
  const busy = await simulate({ urgent: () => (nvr, ch) => twenty.has(`${nvr}/${ch}`) })
  const notTwenty = keys.filter((k) => !twenty.has(k))
  check('twenty rule cameras: the others still come round at most a third later than with no rule', busy.worst(notTwenty) <= sharedRound, mins(busy.worst(notTwenty)))
  check('... and each rule camera is read within twenty of its share of passes (about 7 min)', busy.worst([...twenty]) <= (twenty.size * events.RULE_SHARE + 2) * TICK, mins(busy.worst([...twenty])))

  // so many rule cameras that they could take every tick: the rest still come round
  const many = new Set(keys.slice(0, 120))
  const crowd = await simulate({ urgent: () => (nvr, ch) => many.has(`${nvr}/${ch}`) })
  const others = keys.slice(120)
  check('many rule cameras: the rest are still read at most a third later than with no rule', crowd.worst(others) <= sharedRound, mins(crowd.worst(others)))
  check('many rule cameras: ... and the rule cameras no less often than the rest', crowd.median([...many]) <= crowd.median(others), `${mins(crowd.median([...many]))} vs ${mins(crowd.median(others))}`)

  // a rules hook that throws is no rule cameras: the intake goes on, least recently read first
  const broken = await simulate({ ticks: 50, urgent: () => { throw new Error('the rules could not be read') } })
  check('a rules hook that throws: the intake still asks one camera a tick', [...broken.reads.values()].flat().length === 50, String([...broken.reads.values()].flat().length))

  // Task 5 review (2026-10-20): the rules are read once a minute (RULES_REFRESH_MS), not every 5 s tick,
  // as a damaged rule logs a warning each time they are read; a rule edit still takes effect within it
  check('events.mjs exports RULES_REFRESH_MS, between 30 s and a minute', events.RULES_REFRESH_MS >= 30_000 && events.RULES_REFRESH_MS <= 60_000, String(events.RULES_REFRESH_MS))
  const named = new Set()
  let editAt = null
  const edited = await simulate({
    urgent: () => (nvr, ch) => named.has(`${nvr}/${ch}`),
    onTick: (i, at, reads) => {
      // part way through, a new rule names a camera last read longer than RULE_POLL_MS ago
      if (editAt === null && i >= 2 * total && at - (reads.get('site5/3')?.at(-1) ?? -Infinity) > events.RULE_POLL_MS) {
        named.add('site5/3')
        editAt = at
      }
    }
  })
  const span = 4 * total * TICK
  check('the rules hook is asked about once a minute, not on every tick', edited.asks() >= 1 && edited.asks() <= Math.ceil(span / events.RULES_REFRESH_MS) + 1, `${edited.asks()} times in ${mins(span)}`)
  const afterEdit = (edited.reads.get('site5/3') ?? []).find((t) => t >= editAt)
  check('... and a camera a new rule names is read ahead within RULES_REFRESH_MS of the edit', afterEdit !== undefined && afterEdit - editAt <= events.RULES_REFRESH_MS + (events.RULE_SHARE + 1) * TICK, afterEdit === undefined ? 'never' : `${Math.round((afterEdit - editAt) / 1000)} s`)
}
{
  // Task 5 review (2026-10-20): an NVR rests MIN_POLL_MS once each of its cameras has been asked, as it
  // did after each round of its own cameras before the least-recently-read order. Without the rest a
  // lone 12-camera NVR was searched on every tick: 720 cameras an hour, about 380 before and now.
  const TICK = 5000
  const lone = async (named = new Set()) => {
    let now = T0
    const asked = []
    const intake = makeEventIntake({
      listNvrs: () => [{ id: 'lone', name: 'Lone', online: true }],
      camerasOf: () => Array.from({ length: 12 }, (_, ch) => ({ ch })),
      recordings: async (_nvr, ch) => {
        asked.push({ ch, at: now })
        return { events: [] }
      },
      urgent: () => (_nvr, ch) => named.has(ch),
      now: () => now,
      log: () => {},
      store: { addEvent: () => ({ event: null, isNew: false }), intakeCursorMs: () => null }
    })
    for (let i = 0; i < 720; i++) {
      await intake.tick()
      now += TICK
    }
    return asked
  }
  const asked = await lone()
  check('a lone 12-camera NVR: about twelve cameras every two minutes in an hour, not one every tick', asked.length >= 300 && asked.length <= 400, `${asked.length} in an hour`)
  const restless = asked.filter((a, i) => i % 12 === 11 && asked[i + 1] && asked[i + 1].at - a.at < MIN_POLL_MS)
  check('... after each round of its twelve cameras it rests a minute', asked.length > 24 && restless.length === 0, restless.map((a) => new Date(a.at).toISOString().slice(11, 19)).join())
  // a camera an alarm rule names does not wait for the rest: those reads are few (one in RULE_POLL_MS each)
  const ruledLone = await lone(new Set([5]))
  const fives = ruledLone.filter((a) => a.ch === 5).map((a) => a.at)
  const worst5 = Math.max(0, ...fives.slice(1).map((t, i) => t - fives[i]))
  check('... while a camera an alarm rule names is still read within RULE_POLL_MS and two ticks', fives.length > 30 && worst5 <= events.RULE_POLL_MS + 2 * TICK, `${fives.length} reads, worst ${Math.round(worst5 / 1000)} s`)
}
{
  // Which cameras an alarm rule tells somebody about, for the intake (EV-event-pipeline#0, 2026-10-20):
  // enabled, notifying or ringing the bell, and about a kind the recorded-file intake files
  const { alertingCameras } = await import('../event-rules.mjs')
  check('event-rules.mjs exports alertingCameras', typeof alertingCameras === 'function')
  const covers = typeof alertingCameras === 'function'
    ? alertingCameras([
        { id: 1, enabled: true, notify: true, cameras: ['a/1', 'a/2'], types: ['motion'] },
        { id: 2, enabled: false, notify: true, cameras: ['b/0'], types: [] },
        { id: 3, enabled: true, notify: false, bell: false, cameras: ['c/0'], types: [] },
        { id: 4, enabled: true, notify: true, cameras: ['d/0'], types: ['ai-person', 'ai-vehicle'] },
        { id: 5, enabled: true, notify: false, bell: true, cameras: ['e/3'], types: [] },
        { id: 6, enabled: false, notify: true, cameras: ['f/0'], types: [], damaged: true }
      ])
    : () => null
  check('alertingCameras: the cameras of an enabled notifying rule', covers('a', 1) === true && covers('a', 2) === true && covers('a', 3) === false)
  check('alertingCameras: not a switched-off rule', covers('b', 0) === false)
  check('alertingCameras: not a rule that tells nobody', covers('c', 0) === false)
  check('alertingCameras: not a rule only about kinds the NVR recordings never carry', covers('d', 0) === false)
  check('alertingCameras: a rule that rings the bell counts', covers('e', 3) === true)
  check('alertingCameras: not a damaged rule', covers('f', 0) === false)
  // Task 5 review (2026-10-20): a rule with no camera list made every camera count, and then none was
  // read ahead of another; only the cameras a rule names count now
  const broad = typeof alertingCameras === 'function'
    ? alertingCameras([{ enabled: true, notify: true, cameras: [], types: [] }, { enabled: true, notify: true, cameras: ['g/4'], types: ['sensor'] }])
    : () => null
  check('alertingCameras: a rule with no camera list puts no camera ahead', broad('x', 7) === false && broad('g', 0) === false)
  check('alertingCameras: ... while the camera another rule names still counts', broad('g', 4) === true)
  check('alertingCameras: no rules (or none readable) covers nothing', typeof alertingCameras === 'function' && alertingCameras(null)('a', 1) === false && alertingCameras([])('a', 1) === false)
  // A rule about line crossings alone, on a camera the line watch reads (alarm-watch.mjs): its crossings
  // are filed within seconds already, so reading its recordings early only takes reads from the rest
  const lines = typeof alertingCameras === 'function'
    ? alertingCameras(
        [
          { enabled: true, notify: true, cameras: ['h/0', 'h/1'], types: ['line-crossing'] },
          { enabled: true, notify: true, cameras: ['h/2'], types: ['line-crossing', 'motion'] },
          { enabled: true, notify: true, cameras: ['h/3'], types: [] }
        ],
        { watched: new Set(['h/0', 'h/2', 'h/3']) }
      )
    : () => null
  check('alertingCameras: not a line-crossing rule\'s camera the line watch reads', lines('h', 0) === false)
  check('alertingCameras: ... but one it does not read', lines('h', 1) === true)
  check('alertingCameras: ... and a watched camera whose rule names other kinds too', lines('h', 2) === true && lines('h', 3) === true)
  const unwatched = typeof alertingCameras === 'function' ? alertingCameras([{ enabled: true, notify: true, cameras: ['h/0'], types: ['line-crossing'] }]) : () => null
  check('alertingCameras: with no line watch running, a line-crossing rule\'s cameras count', unwatched('h', 0) === true)
}
{
  // ... and the per-NVR rests still hold when the ticks come faster than the rest
  const REST = events.CAMERA_REST_MS
  let now = T0
  const asked = []
  const intake = makeEventIntake({
    listNvrs: () => [{ id: 'a', name: 'A', online: true }, { id: 'b', name: 'B', online: true }],
    camerasOf: () => [{ ch: 0 }, { ch: 1 }, { ch: 2 }, { ch: 3 }],
    recordings: async (nvr, ch) => {
      asked.push({ nvr: nvr.id, ch, at: now })
      return { events: [] }
    },
    now: () => now,
    log: () => {},
    store: { addEvent: () => ({ event: null, isNew: false }), intakeCursorMs: () => null }
  })
  for (let i = 0; i < 12; i++) {
    await intake.tick()
    now += 1000
  }
  const tooSoon = ['a', 'b'].flatMap((id) => {
    const mine = asked.filter((x) => x.nvr === id)
    return mine.slice(1).filter((x, i) => x.at - mine[i].at < REST).map((x) => `${id}/${x.ch}`)
  })
  check('turns: no NVR is asked again inside its camera rest', asked.length > 0 && tooSoon.length === 0, tooSoon.join())
  check('turns: with both NVRs ready they alternate', asked.slice(0, 4).map((x) => x.nvr).join() === 'a,b,a,b', asked.map((x) => x.nvr).join())
  // a failed search is a turn too: the next pass goes on to the other NVR, not back to the same one
  let now2 = T0
  const asked2 = []
  const intake2 = makeEventIntake({
    listNvrs: () => [{ id: 'a', name: 'A', online: true }, { id: 'b', name: 'B', online: true }],
    camerasOf: () => [{ ch: 0 }, { ch: 1 }],
    recordings: async (nvr) => {
      asked2.push(nvr.id)
      if (nvr.id === 'b') throw new Error('the NVR could not search its recordings')
      return { events: [] }
    },
    now: () => now2,
    log: () => {},
    store: { addEvent: () => ({ event: null, isNew: false }), intakeCursorMs: () => null }
  })
  for (let i = 0; i < 3; i++) {
    await intake2.tick()
    now2 += 5000
  }
  check('turns: after a failed turn the next NVR in line is asked', asked2.join() === 'a,b,a', asked2.join())
}

// --- the intake's clock: the last read while it is fresh -------------------------------------------------
//
// The intake read each NVR's clock for every camera it asked (GetDeviceTime, a 15 s-capable round trip
// on these NVRs queued behind every other main-process SDK call): about 1,500 reads an hour. A read
// under a minute old is used as it is; an older one is read again, as background work.
{
  check('events.mjs exports intakeClock and CLOCK_REUSE_MS (a minute)', typeof events.intakeClock === 'function' && events.CLOCK_REUSE_MS === 60_000)
  const fakeNvr = (last) => {
    const nvr = { reads: [], last }
    nvr.playback = {
      lastClock: () => (nvr.last ? { ...nvr.last } : null),
      clock: async (opts) => {
        nvr.reads.push(opts ?? null)
        return { now: T0, tzOffsetMs: -4 * 3_600_000, skewMs: 0 }
      }
    }
    return nvr
  }
  const intakeClock = events.intakeClock ?? (async () => null)
  const fresh = fakeNvr({ tzOffsetMs: -5 * 3_600_000, skewMs: 0, at: T0 - 30_000 })
  const c1 = intakeClock(fresh, T0)
  check('intakeClock answers with a promise (events.mjs catches a failed read)', typeof c1?.then === 'function')
  const r1 = await c1
  check('a clock read 30 s old is used: the NVR is not asked', r1?.tzOffsetMs === -5 * 3_600_000 && fresh.reads.length === 0, JSON.stringify({ r1, reads: fresh.reads }))
  const old = fakeNvr({ tzOffsetMs: -5 * 3_600_000, skewMs: 0, at: T0 - 61_000 })
  const r2 = await intakeClock(old, T0)
  check('one over a minute old: read again', r2?.tzOffsetMs === -4 * 3_600_000 && old.reads.length === 1, JSON.stringify({ r2, reads: old.reads }))
  check('... as background work (a late return does not hold that NVR\'s playback and searches)', old.reads[0]?.background === true, JSON.stringify(old.reads))
  const never = fakeNvr(null)
  await intakeClock(never, T0)
  check('no clock read yet: read', never.reads.length === 1 && never.reads[0]?.background === true)
  const failing = { playback: { lastClock: () => null, clock: async () => { throw new Error('GetDeviceTime failed') } } }
  const err = await intakeClock(failing, T0).catch((e) => e)
  check('a failed read rejects (the intake then falls back as before)', err instanceof Error && /GetDeviceTime failed/.test(err.message), String(err))
}

// --- nvrs.mjs wires the intake to the NVR as background work --------------------------------------------
{
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../nvrs.mjs', import.meta.url), 'utf8')
  check('nvrs.mjs: the intake\'s searches are background searches (their late return does not cool the NVR)',
    /recordings: \(nvr, ch, date\) => nvr\.playback\.recordings\(ch, date, \{ background: true \}\)/.test(src))
  check('nvrs.mjs: the intake\'s clock is intakeClock (the last read under a minute old)', /clock: \(nvr\) => intakeClock\(nvr\)/.test(src) && /intakeClock/.test(src.slice(src.indexOf('async function startEvents'), src.indexOf('makeEventIntake({'))))
  // EV-event-pipeline#0 (2026-10-20): the cameras an alarm rule names are read first, from the rules as
  // they stand (the intake asks again once a minute, RULES_REFRESH_MS: Task 5 review, 2026-10-20), less
  // a line-crossing rule's cameras the line watch reads, once that watch has started
  const intakeSrc = src.slice(src.indexOf('makeEventIntake({'), src.indexOf('startLineWatch(notifier)'))
  check('nvrs.mjs: the intake is told which cameras an alarm rule names, from the rules as they stand', /urgent: \(\) => alertingCameras\(listRules\(\), \{ watched: lineWatchCameras\?\.\(\) \?\? null \}\)/.test(intakeSrc), intakeSrc.match(/urgent:.*$/m)?.[0] ?? 'no urgent hook')
  const watchSrc = src.slice(src.indexOf('async function startLineWatch'), src.indexOf('export const startNvrs'))
  check('nvrs.mjs: ... and the line watch\'s cameras are left out only once startAlarmWatch has been started', /startAlarmWatch\(\{[\s\S]*\}\)\s*\n[\s\S]*lineWatchCameras = linesOn\s*\n\}/.test(watchSrc), watchSrc.slice(-200))
}

// --- one crossing, two sources ------------------------------------------------------------------------------
//
// The alarm watcher files a crossing within seconds. Minutes later this intake finds the NVR's
// recording of the same crossing: a few seconds earlier (pre-record), with both line bits. That must
// stay one event, and must not reach the rules (and the phone) a second time. Real store, temp file.
{
  const { addEvent, closeEvents, eventsOfCamera, intakeCursorMs } = await import('../events-db.mjs')
  const at = T0 + 30 * MIN
  const first = addEvent({ nvr: 'lc1', ch: 2, type: 'line-crossing', subtype: 'tripwire', startMs: at, source: 'alarm-status' }, at)
  check('the alarm watcher’s crossing is stored', first.isNew && first.event.id > 0)
  const seen = []
  const intake = makeEventIntake({
    listNvrs: () => [{ id: 'lc1', name: 'LC', online: true }],
    camerasOf: () => [{ ch: 2 }],
    recordings: async () => ({ events: [[at - 5 * S, at + 40 * S, 0x2 | 0x80 | 0x400]] }),
    onEvent: (e) => seen.push(e),
    now: () => at + 3 * MIN,
    log: () => {},
    store: { addEvent, intakeCursorMs }
  })
  const r = await intake.tick()
  check('the recording of the same crossing is not a new event', r?.stored === 0 && seen.length === 0, JSON.stringify({ r, seen: seen.length }))
  const rows = eventsOfCamera('lc1', 2, at - MIN, at + MIN)
  check('... the camera still has one row', rows.length === 1, JSON.stringify(rows.map((x) => `${x.type}/${x.subtype}@${x.startMs - at}`)))
  check('... with the alarm’s start and the recording’s end', rows[0]?.startMs === at && rows[0]?.endMs === at + 40 * S, JSON.stringify(rows[0]))

  // The NVR's file was already open for motion 3 minutes before the alarm: it still is the same crossing
  const at2 = at + 20 * MIN
  addEvent({ nvr: 'lc1', ch: 4, type: 'line-crossing', subtype: 'tripwire', startMs: at2, source: 'alarm-status' }, at2)
  const seen2 = []
  const intake2 = makeEventIntake({
    listNvrs: () => [{ id: 'lc1', name: 'LC', online: true }],
    camerasOf: () => [{ ch: 4 }],
    recordings: async () => ({ events: [[at2 - 3 * MIN, at2 + MIN, 0x4 | 0x400]] }),
    onEvent: (e) => seen2.push(e),
    now: () => at2 + 4 * MIN,
    log: () => {}
  })
  const r2 = await intake2.tick()
  check('a file that started 3 min before the alarm: its motion is new, its crossing is not (no second alert)',
    r2?.stored === 1 && seen2.length === 1 && seen2[0].type === 'motion', JSON.stringify({ r2, seen: seen2.map((e) => e.type) }))
  const rows2 = eventsOfCamera('lc1', 4, at2 - 5 * MIN, at2 + 5 * MIN).filter((x) => x.type === 'line-crossing')
  check('... the camera still has one crossing, the alarm’s, to the file’s end', rows2.length === 1 && rows2[0].startMs === at2 && rows2[0].endMs === at2 + MIN, JSON.stringify(rows2))
  closeEvents()
}

// --- the intake's own cursor --------------------------------------------------------------------------------
//
// The intake asks the NVR only for the local days from the newest row it filed itself onwards. A
// crossing the alarm watcher files just after midnight must not move that on to today: the recordings
// of the last minutes before midnight are only in yesterday's answer, and would never be read.
{
  const db = await import('../events-db.mjs')
  const TZ = -4 * 3_600_000 // the site is at UTC-4
  const midnight = Date.UTC(2026, 8, 28) - TZ // 2026-09-28 00:00 site time
  db.addEvent({ nvr: 'cur1', ch: 3, type: 'motion', subtype: '', startMs: midnight - 12 * MIN, endMs: midnight - 11 * MIN, source: SOURCE_RECORDINGS }, midnight - 10 * MIN)
  db.addEvent({ nvr: 'cur1', ch: 3, type: 'line-crossing', subtype: 'tripwire', startMs: midnight + MIN, source: 'alarm-status' }, midnight + MIN + 5 * S)
  const asked = []
  const intake = makeEventIntake({
    listNvrs: () => [{ id: 'cur1', name: 'Cursor', online: true }],
    camerasOf: () => [{ ch: 3 }],
    clock: async () => ({ tzOffsetMs: TZ }),
    recordings: async (_nvr, _ch, date) => {
      asked.push(date)
      return { events: [] }
    },
    now: () => midnight + 5 * MIN,
    log: () => {}
  })
  await intake.tick()
  check('a crossing the watcher filed after midnight does not move the intake past yesterday: both days are asked', asked.join() === '2026-09-27,2026-09-28', asked.join())
  check('the intake’s cursor is its own newest row, whatever else the camera has',
    typeof db.intakeCursorMs === 'function' && db.intakeCursorMs('cur1', 3) === midnight - 12 * MIN && db.intakeCursorMs('cur1', 9) === null)
  check('... while lastEventMs still means the camera’s newest row of any source', db.lastEventMs('cur1', 3) === midnight + MIN)
  db.closeEvents()
}

// After an outage the intake catches up from its cursor, oldest days first, two a pass. It asked the
// newest two days only: their events moved the cursor to today and the days before were never read.
{
  const DAY = 86_400_000
  const TZ = -4 * 3_600_000
  const dayOf = (ms) => new Date(ms + TZ).toISOString().slice(0, 10)
  let now = Date.UTC(2026, 9, 7, 16, 0, 0) // 12:00 on 2026-10-07 at the site
  const run = async ({ cursor, events }) => {
    const asked = []
    let newest = cursor
    const intake = makeEventIntake({
      listNvrs: () => [{ id: 'out1', name: 'Outage', online: true }],
      camerasOf: () => [{ ch: 0 }],
      clock: async () => ({ tzOffsetMs: TZ }),
      recordings: async (_nvr, _ch, date) => {
        asked.push(date)
        return { events: events ? [[Date.parse(`${date}T12:00:00Z`) - TZ, Date.parse(`${date}T12:00:10Z`) - TZ, 0x4]] : [] }
      },
      now: () => now,
      log: () => {},
      store: {
        addEvent: (e) => {
          const isNew = newest === null || e.startMs > newest
          if (isNew) newest = e.startMs
          return { event: { id: 1, ...e }, isNew }
        },
        intakeCursorMs: () => newest
      }
    })
    const rounds = []
    for (let i = 0; i < 4; i++) {
      const before = asked.length
      await intake.tick()
      rounds.push(asked.slice(before).join('+'))
      now += MIN_POLL_MS + 1
    }
    return { asked, rounds }
  }
  const start = now
  // five days down, a camera with events on every day
  const busy = await run({ cursor: start - 5 * DAY, events: true })
  check('catch-up: the oldest days first, two a pass, none skipped', busy.rounds.slice(0, 3).join(' | ') === '2026-10-02+2026-10-03 | 2026-10-04+2026-10-05 | 2026-10-06+2026-10-07', busy.rounds.join(' | '))
  check('... and once caught up it asks from its newest event, as before', busy.rounds[3] === '2026-10-07', busy.rounds[3])
  // the same outage on a camera that recorded no event: its cursor never moves, and it still gets to today
  now = start
  const quiet = await run({ cursor: start - 5 * DAY, events: false })
  check('catch-up: days with no event are not asked again for ever', quiet.rounds.slice(0, 3).join(' | ') === '2026-10-02+2026-10-03 | 2026-10-04+2026-10-05 | 2026-10-06+2026-10-07' && quiet.rounds[3] === '2026-10-06+2026-10-07', quiet.rounds.join(' | '))
  // a restart part-way (the marker is memory only): it goes on from the newest event filed, no day lost
  now = start
  const again = await run({ cursor: Date.parse('2026-10-03T12:00:00Z') - TZ, events: true })
  check('catch-up: after a restart it goes on from the cursor, and still reaches today', again.rounds.slice(0, 3).join(' | ') === '2026-10-03+2026-10-04 | 2026-10-05+2026-10-06 | 2026-10-06+2026-10-07', again.rounds.join(' | '))
  // a cursor a month old: a week is caught up, not the month
  now = start
  const stale = await run({ cursor: start - 30 * DAY, events: false })
  check('catch-up: no further back than CATCH_UP_MS (a week)', events.CATCH_UP_MS === 7 * DAY && stale.asked[0] === dayOf(start - 7 * DAY) && stale.rounds[3].endsWith('2026-10-07'), stale.rounds.join(' | '))
  // nothing to catch up: one day's cursor asks yesterday and today at once
  now = start
  const fresh = await run({ cursor: start - DAY, events: false })
  check('catch-up: a cursor from yesterday asks yesterday and today in the first pass', fresh.rounds.every((r) => r === '2026-10-06+2026-10-07'), fresh.rounds.join(' | '))
}

// --- detections are kept 30 days, acknowledged or not -----------------------------------------------------------
{
  const db = await import('../events-db.mjs')
  const { DETECT_SOURCE } = await import('../event-rules.mjs')
  const now = T0 + 900 * MIN
  const DAY = 86_400_000
  const add = (e) => db.addEvent(e, now).event.id
  const ackd = (e) => { const id = add(e); db.acknowledge(id, 'argus', 'no alert rule', now); return id }
  const old = ackd({ nvr: 'pd1', ch: 0, type: 'ai-person', startMs: now - 31 * DAY, source: DETECT_SOURCE })
  const oldNvr = ackd({ nvr: 'pd1', ch: 1, type: 'motion', startMs: now - 31 * DAY, source: SOURCE_RECORDINGS })
  const fresh = ackd({ nvr: 'pd1', ch: 2, type: 'ai-vehicle', startMs: now - 29 * DAY, source: DETECT_SOURCE })
  const oldBag = ackd({ nvr: 'pd1', ch: 4, type: 'ai-bag', startMs: now - 31 * DAY, source: DETECT_SOURCE })
  const oldDog = ackd({ nvr: 'pd1', ch: 5, type: 'ai-animal', startMs: now - 31 * DAY, source: DETECT_SOURCE })
  const oldOpen = add({ nvr: 'pd1', ch: 3, type: 'ai-person', startMs: now - 31 * DAY, source: DETECT_SOURCE })
  // the smart rules' events (zones and lines) are this server's detections too
  const oldZone = ackd({ nvr: 'pd1', ch: 6, type: 'zone-enter', startMs: now - 31 * DAY, endMs: now - 31 * DAY, source: DETECT_SOURCE, detail: 'Yard: Person' })
  const oldLine = add({ nvr: 'pd1', ch: 7, type: 'line-cross', startMs: now - 31 * DAY, endMs: now - 31 * DAY, source: DETECT_SOURCE, detail: 'Gate: Vehicle in' })
  // ...and so are the stay rules' (loitering, parked too long, left object, crowding)
  const oldStay = ['loitering', 'parked-too-long', 'left-object', 'crowding'].map((type, i) => ackd({ nvr: 'pd1', ch: 10 + i, type, startMs: now - 31 * DAY, endMs: now - 31 * DAY, source: DETECT_SOURCE, detail: 'Yard: Person 5 min' }))
  const freshStay = ackd({ nvr: 'pd1', ch: 14, type: 'crowding', startMs: now - 29 * DAY, endMs: now - 29 * DAY, source: DETECT_SOURCE, detail: 'Yard: 12 people' })
  check('DETECT_KEEP_DAYS is 30', db.DETECT_KEEP_DAYS === 30)
  const n = db.pruneDetections(now - db.DETECT_KEEP_DAYS * DAY)
  check('... loitering, parked too long, left object and crowding among them; a 29-day-old crowding kept', oldStay.every((id) => db.getEvent(id) === null) && db.getEvent(freshStay) !== null)
  check('pruneDetections removes the 31-day-old detections, acknowledged or not', n === 10 && db.getEvent(old) === null && db.getEvent(oldOpen) === null && db.getEvent(oldBag) === null && db.getEvent(oldDog) === null, String(n))
  check('... zones entered and lines crossed among them', db.getEvent(oldZone) === null && db.getEvent(oldLine) === null)
  check('... keeps an acknowledged NVR row of the same age', db.getEvent(oldNvr) !== null)
  check('... and a 29-day-old detection', db.getEvent(fresh) !== null)
  // it runs every 5 minutes on the server's main thread: it must go through the type index, never read
  // every old event of every source (events_start) to find the few detections
  const { DatabaseSync } = await import('node:sqlite')
  const look = new DatabaseSync(db.EVENTS_DB)
  const plan = look.prepare(`EXPLAIN QUERY PLAN ${db.PRUNE_DETECTIONS_SQL}`).all(1, DETECT_SOURCE).map((r) => r.detail).join(' | ')
  look.close()
  check('pruneDetections goes through events_type_start, not a scan', /events_type_start/.test(plan) && !/SCAN events/.test(plan), plan)

  // a restart's clean-up: a detection left open (crash, or the 2 s shutdown limit) is closed at its
  // start, and one left unacknowledged with no rule (a crash between insert and acknowledgement) is
  // acknowledged as "no alert rule"; a rule's row, an NVR row and a closed one are left as they are
  const openNoRule = add({ nvr: 'sd1', ch: 0, type: 'ai-person', startMs: now - 60_000, source: DETECT_SOURCE })
  const openRuled = add({ nvr: 'sd1', ch: 1, type: 'ai-vehicle', startMs: now - 60_000, source: DETECT_SOURCE })
  db.classify(openRuled, { priority: 'high', ruleId: 4, ruleName: 'Yard' })
  const openBoat = add({ nvr: 'sd1', ch: 7, type: 'ai-boat', startMs: now - 60_000, source: DETECT_SOURCE })
  const closed = add({ nvr: 'sd1', ch: 2, type: 'ai-person', startMs: now - 60_000, endMs: now - 50_000, source: DETECT_SOURCE })
  db.acknowledge(closed, 'argus', 'no alert rule', now)
  const nvrOpen = add({ nvr: 'sd1', ch: 3, type: 'motion', startMs: now - 60_000, source: SOURCE_RECORDINGS })
  // no rule is null, never 0: Number(null) is 0, and a 0 read as "a rule" left rows unacknowledged
  const noRule = add({ nvr: 'sd1', ch: 4, type: 'ai-person', startMs: now - 60_000, endMs: now - 55_000, source: DETECT_SOURCE })
  check('classify with no rule stores rule_id null, not 0', db.classify(noRule, { priority: 'low', ruleId: null }).ruleId === null)
  check('... nor for 0, undefined or an empty string', [0, undefined, ''].every((v) => db.classify(noRule, { priority: 'low', ruleId: v }).ruleId === null))
  check('addEvent with no rule stores rule_id null too', db.getEvent(add({ nvr: 'sd1', ch: 6, type: 'ai-person', startMs: now - 60_000, endMs: now - 55_000, source: DETECT_SOURCE, ruleId: null })).ruleId === null)
  // ...and a row the old code wrote with rule_id 0 is settled like one with none
  const zeroRule = add({ nvr: 'sd1', ch: 5, type: 'ai-person', startMs: now - 60_000, endMs: now - 55_000, source: DETECT_SOURCE })
  {
    const { DatabaseSync } = await import('node:sqlite')
    const raw = new DatabaseSync(db.EVENTS_DB)
    raw.prepare('UPDATE events SET rule_id = 0 WHERE id = ?').run(zeroRule)
    raw.close()
  }
  // a zone entered left unacknowledged with no rule (a crash before its acknowledgement)
  const zoneNoRule = add({ nvr: 'sd1', ch: 8, type: 'zone-enter', startMs: now - 60_000, endMs: now - 60_000, source: DETECT_SOURCE, detail: 'Yard: Person' })
  const loiterNoRule = add({ nvr: 'sd1', ch: 9, type: 'loitering', startMs: now - 60_000, endMs: now - 60_000, source: DETECT_SOURCE, detail: 'Yard: Person 5 min' })
  const done = db.settleDetections(now)
  const g = (id) => db.getEvent(id)
  check('settleDetections: a loitering row with no rule is acknowledged as "no alert rule" too', g(loiterNoRule).ackUser === 'argus' && g(loiterNoRule).ackNote === 'no alert rule')
  check('settleDetections: a zone entered with no rule is acknowledged as "no alert rule" too', g(zoneNoRule).ackUser === 'argus' && g(zoneNoRule).ackNote === 'no alert rule')
  check('settleDetections: a row with rule_id 0 is acknowledged as "no alert rule"', g(zeroRule).ackUser === 'argus' && g(zeroRule).ackNote === 'no alert rule')
  check('... and so is one classified with no rule', g(noRule).ackUser === 'argus')
  check('settleDetections: an open detection is closed at its start', g(openNoRule).endMs === now - 60_000 && g(openRuled).endMs === now - 60_000, JSON.stringify(done))
  check('... one with no rule and no acknowledgement: acknowledged by argus, "no alert rule"', g(openNoRule).ackUser === 'argus' && g(openNoRule).ackNote === 'no alert rule')
  check('... a new kind (boat) is closed and acknowledged too', g(openBoat).endMs === now - 60_000 && g(openBoat).ackUser === 'argus')
  check('... one a rule matched stays unacknowledged', g(openRuled).ackMs === null)
  check('... a closed one keeps its end, an NVR row is untouched', g(closed).endMs === now - 50_000 && g(nvrOpen).endMs === null && g(nvrOpen).ackMs === null)
  check('... it says how many (the 29-day-old one above had no end either)', done.closed === 4 && g(fresh).endMs === now - 29 * DAY && done.acked === 7, JSON.stringify(done))
}

// --- the events route: only cameras this user may see ----------------------------------------------------------
//
// GET /api/events drops every event on a camera the caller's canSee hook (rights.mjs, via server.mjs)
// refuses. Real store, temp file.
{
  const db = await import('../events-db.mjs')
  const at = T0 + 300 * MIN
  db.addEvent({ nvr: 'rt1', ch: 0, type: 'motion', startMs: at, source: SOURCE_RECORDINGS }, at)
  db.addEvent({ nvr: 'rt2', ch: 1, type: 'motion', startMs: at + S, source: SOURCE_RECORDINGS }, at + S)
  const get = (deps) => events.handleEvents('GET', `/api/events?from=${at - MIN}&to=${at + MIN}`, async () => ({}), { nvrs: new Map(), ...deps })
  const cams = (r) => (r[1].events ?? []).map((e) => `${e.nvr}/${e.ch}`).sort().join()

  // canSee is explicit here, as server.mjs's real one always is (and, for an admin, always true): the
  // fail-closed default below must never be what stands in for "an admin sees everything"
  const all = await get({ user: 'alice', admin: true, canSee: () => true })
  check('the events route: a hook that lets every camera through lists both', all[0] === 200 && cams(all) === 'rt1/0,rt2/1', cams(all))
  const viewer = await get({ user: 'bob', admin: false, canSee: (nvr) => nvr === 'rt1' })
  check('...a viewer’s hook keeps only the cameras it lets through', viewer[0] === 200 && cams(viewer) === 'rt1/0', cams(viewer))

  // FAIL CLOSED: a caller that forgets the canSee hook entirely (left out of deps, not passed as
  // () => true) must get nothing for a non-admin, never every camera's events.
  const forgot = await get({ user: 'carol', admin: false }) // no canSee at all
  check('a forgotten canSee hook: a non-admin sees no events, not all of them', forgot[0] === 200 && forgot[1].events.length === 0, cams(forgot))
  db.closeEvents()
}

// source-shape: server.mjs always hands handleEvents a canSee (the same one alarms, bookmarks and maps
// get), on every call, rather than leaving it out and falling on the fail-closed default
{
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
  const calls = server.match(/handleEvents\(.*$/gm) ?? []
  const ok = calls.length > 0 && calls.every((c) => /\{ nvrs, user, admin: who\.admin, intake: null, canSee \}\)$/.test(c))
  check('server.mjs passes handleEvents a canSee hook, on every call', ok, ok ? '' : calls.join(' | ') || 'no call found')
}

// --- the read-only command probe ------------------------------------------------------------------------
//
// This is the part that must never turn into "we guessed a name and built on it".
{
  check('every candidate is a query, never an edit', EVENT_PROBE_NAMES.every((n) => /^(query|search)/.test(n)), EVENT_PROBE_NAMES.join())
  check('every candidate says why it is a candidate', EVENT_PROBES.every((p) => p.why.length > 20))
  check('the one that would give object class is in the list', EVENT_PROBE_NAMES.includes('searchSmartTarget'))
  check('the shapes include a bodyless one and a time-bounded one', probeShapes({ fromMs: T0, toMs: T0 + MIN }).length >= 4)

  const sent = []
  const query = async (_nvr, url, doc) => {
    sent.push(url)
    if (url === 'queryLog' && /startTime/.test(doc)) return '<?xml version="1.0"?><response><status>success</status><content><item><time>x</time></item></content></response>'
    if (url === 'searchSmartTarget') return '<?xml version="1.0"?><response><status>fail</status><errorCode>536870923</errorCode></response>'
    throw new Error('the NVR did not accept the request (404)')
  }
  const run = await probeEvents({ id: 'nvr1' }, query, { candidates: EVENT_PROBES.slice(0, 5), sleep: async () => {} })
  const log = run.results.find((r) => r.cmd === 'queryLog')
  check('a command that answers is marked supported', log.supported && log.known)
  check('it stops at the first shape that works', log.tried.filter((t) => t.ok).length === 1)
  const smart = run.results.find((r) => r.cmd === 'searchSmartTarget')
  check('an errorCode still proves the firmware knows the command', smart.known && !smart.supported, JSON.stringify(smart.tried.map((t) => t.status)))
  const missing = run.results.find((r) => r.cmd === 'queryAlarmStatus')
  check('a bare failure means the firmware does not have it', !missing.known && !missing.supported)
  check('a failure never stops the run', run.results.length === 5)

  const sum = summariseProbe(run)
  check('the summary lists what answered', sum.working.includes('queryLog'))
  check('object class is only claimed when searchSmartTarget succeeded', sum.objectClassAvailable === false)
  check('the verdict is a sentence somebody can act on', sum.verdict.length > 30, sum.verdict)
  const none = summariseProbe({ results: [{ cmd: 'x', known: false, supported: false, tried: [] }] })
  check('nothing answering says intake stays on the recorded-event index', /recorded-event index/.test(none.verdict), none.verdict)
  const knownOnly = summariseProbe({ results: [{ cmd: 'queryLog', known: true, supported: false, tried: [] }] })
  check('known-but-refused says the shape is wrong, not the name', /shape is wrong/.test(knownOnly.verdict), knownOnly.verdict)
}
{
  check('itemsOf finds a plain list', itemsOf('<response><content><item>a</item><item>b</item></content></response>').length === 2)
  check('itemsOf finds a wrapped list', itemsOf('<response><content><logList><item>a</item></logList></content></response>').length === 1)
  check('itemsOf on nothing is nothing, not a throw', itemsOf('<response></response>').length === 0)
}

// --- motion tuning: reading ------------------------------------------------------------------------------
{
  const good = '<?xml version="1.0"?><response><status>success</status><content><chl id="{00000001-0000-0000-0000-000000000000}"><sensitivity>50</sensitivity><holdTime>10</holdTime><area><item>1111</item><item>1100</item></area></chl></content></response>'
  const r = readMotionAnswer(good, '{00000001-0000-0000-0000-000000000000}')
  check('a good answer reads back', r.available && r.sensitivity === 50, JSON.stringify(r))
  check('the hold time comes too', r.holdTime === 10)
  check('the zone grid is read', r.area?.rows === 2 && r.area.cols === 4, JSON.stringify(r.area))
  // The honest half: never a reassuring zero.
  check('no sensitivity means not available', readMotionAnswer('<response><status>success</status><content><chl></chl></content></response>').available === false)
  check('a refusal says so', /refused/.test(readMotionAnswer('<response><status>fail</status><errorCode>17</errorCode></response>').why))
  check('no document at all says so', /did not answer/.test(readMotionAnswer('').why))
  check('an unreadable zone grid is null, not an empty grid', readArea({ children: [{ name: 'area', children: [], text: 'zzz', attrs: {} }], attrs: {} }) === null)

  // Which camera. The question names it, and an answer is only ever read for the camera asked
  // about: the first camera's figure used to be shown for any camera the answer did not hold.
  const A = '{00000001-0000-0000-0000-000000000000}'
  const B = '{00000002-0000-0000-0000-000000000000}'
  const C = '{00000003-0000-0000-0000-000000000000}'
  check('the question names the camera', motionRequest(B).includes(`<condition><chlId>${B}</chlId></condition>`) && motionRequest(B).startsWith('<?xml') && motionRequest(B).endsWith('</request>'), motionRequest(B))
  const two = `<response><status>success</status><content><chl id="${A}"><sensitivity>50</sensitivity></chl><chl id="${B}"><sensitivity>20</sensitivity></chl></content></response>`
  check('an answer with several cameras gives each its own', readMotionAnswer(two, A).sensitivity === 50 && readMotionAnswer(two, B).sensitivity === 20)
  const missing = readMotionAnswer(two, C)
  check('a camera that is not in the answer is not available, not shown another camera’s', missing.available === false && missing.sensitivity === undefined && /did not include this camera/.test(missing.why), JSON.stringify(missing))
  check('a lone block for a different camera is not this camera’s either', readMotionAnswer(good, B).available === false, JSON.stringify(readMotionAnswer(good, B)))
  check('the id is matched whatever its letter case', readMotionAnswer(good.replace('{00000001', '{0000000a'), '{0000000A-0000-0000-0000-000000000000}').sensitivity === 50)
  check('an id given as an element is matched too', readMotionAnswer(`<response><status>success</status><content><item><id>${A}</id><sensitivity>1</sensitivity></item><item><id>${B}</id><sensitivity>2</sensitivity></item></content></response>`, B).sensitivity === 2)
  // a single-camera answer need not repeat the id: the question named the camera
  check('a lone block that names no camera is the answer for the camera asked about', readMotionAnswer('<response><status>success</status><content><chl><sensitivity>30</sensitivity></chl></content></response>', B).sensitivity === 30)
}

// --- motion tuning: building the write --------------------------------------------------------------------
//
// Built by substituting one number into the NVR's own answer, because these boxes replace the whole
// block and a field we forgot to mention is a field we silently wiped.
{
  const answer = '<?xml version="1.0"?><response><status>success</status><content><chl id="A"><sensitivity>50</sensitivity><holdTime>10</holdTime></chl></content></response>'
  const built = buildMotionEdit(answer, 70)
  check('the edit is built', built.ok)
  check('the old value is reported', built.was === '50')
  check('the new value is in it', /<sensitivity>70<\/sensitivity>/.test(built.doc))
  check('and every other field survived untouched', /<holdTime>10<\/holdTime>/.test(built.doc), built.doc)
  check('it is a request document, not a response', /^<\?xml/.test(built.doc) && /<\/request>$/.test(built.doc))
  const many = buildMotionEdit('<response><content><chl id="A"><sensitivity>1</sensitivity></chl><chl id="B"><sensitivity>2</sensitivity></chl></content></response>', 9)
  check('two cameras in one answer is refused, not guessed at', !many.ok && /2 sensitivity elements/.test(many.error), many.error)
  // ... unless the camera is known: then its own block is the one edited, and the only one sent
  const twoCams = '<response><content><chl id="A"><sensitivity>1</sensitivity><holdTime>5</holdTime></chl><chl id="B"><sensitivity>2</sensitivity><holdTime>7</holdTime></chl></content></response>'
  const forB = buildMotionEdit(twoCams, 9, 'b')
  check('with the camera named, its block is the one changed', forB.ok && forB.was === '2' && forB.doc.includes('<chl id="B"><sensitivity>9</sensitivity><holdTime>7</holdTime></chl>'), JSON.stringify(forB))
  check('and no other camera is written at all', forB.ok && !forB.doc.includes('id="A"') && (forB.doc.match(/<chl\b/g) ?? []).length === 1, forB.doc)
  check('a camera listed twice is refused', !buildMotionEdit('<response><content><chl id="A"><sensitivity>1</sensitivity></chl><chl id="A"><sensitivity>2</sensitivity></chl></content></response>', 9, 'A').ok)
  check('a lone block with no id is still edited whole', buildMotionEdit('<response><content><chl><sensitivity>50</sensitivity><holdTime>10</holdTime></chl></content></response>', 70, 'B').doc?.includes('<chl><sensitivity>70</sensitivity><holdTime>10</holdTime></chl>'))
  check('several unnamed blocks are still refused', !buildMotionEdit('<response><content><item><sensitivity>1</sensitivity></item><item><sensitivity>2</sensitivity></item></content></response>', 9, 'B').ok)
  check('no sensitivity element is refused', !buildMotionEdit('<response><content><chl/></content></response>', 9).ok)
  check('no content at all is refused', !buildMotionEdit('<response></response>', 9).ok)
}

// --- motion tuning: the write's refusals ---------------------------------------------------------------------
//
// Changing an NVR threshold is a WRITE to somebody else's box. Every one of these is a case where
// nothing must be sent.
{
  const goodAnswer = '<?xml version="1.0"?><response><status>success</status><content><chl id="{00000001-0000-0000-0000-000000000000}"><sensitivity>50</sensitivity></chl></content></response>'
  const nvr = { id: 'nvr1', name: 'One', online: true, cfg: { host: 'h', port: 1 } }
  // The four pieces motion-tune borrows from nvr-xml.mjs, which loads the native SDK. Stubbed here
  // so the write path itself is under test on a machine with no SDK; the real ones are used on the
  // server. The lock is a real one-at-a-time lock, so a second change while one is running throws.
  let held = false
  const xml = {
    HttpError: class extends Error {
      constructor(status, message) { super(message); this.status = status }
    },
    chlIdOf: (c) => `{${(c + 1).toString(16).toUpperCase().padStart(8, '0')}-0000-0000-0000-000000000000}`,
    deviceOf: (n) => `${n.cfg.host}:${n.cfg.port}`,
    withNvrLock: async (_n, _what, fn) => {
      if (held) throw new Error('another change is running on this NVR')
      held = true
      try { return await fn({ note: '' }) } finally { held = false }
    }
  }
  const tried = async (want, answers) => {
    const sent = []
    let i = 0
    const query = async (_n, url, doc) => {
      sent.push({ url, doc })
      return answers[Math.min(i++, answers.length - 1)]
    }
    let error = null
    let out = null
    try {
      out = await writeMotionThreshold(nvr, 0, want, 'alice', query, xml)
    } catch (e) {
      error = e
    }
    return { sent, out, error }
  }

  const bad = await tried({ threshold: 500 }, [goodAnswer])
  check('a threshold out of range is refused', bad.error && /0 to 100/.test(bad.error.message))
  check('and nothing was sent at all', bad.sent.length === 0)

  const blind = await tried({ threshold: 70 }, ['<response><status>fail</status><errorCode>17</errorCode></response>'])
  check('it never writes what it could not first read', blind.error && /nothing was changed/.test(blind.error.message), blind.error?.message)
  check('only the read went out', blind.sent.length === 1 && blind.sent[0].url === 'queryMotion')

  const same = await tried({ threshold: 50 }, [goodAnswer])
  check('setting it to what it already is sends nothing', same.out?.changed === false && same.sent.length === 1, JSON.stringify(same.out))

  const refused = await tried({ threshold: 70 }, [goodAnswer, '<response><status>fail</status><errorCode>9</errorCode></response>'])
  check('an NVR that refuses the write is reported, not assumed', refused.error && /refused the change \(code 9\)/.test(refused.error.message), refused.error?.message)

  const ok = await tried({ threshold: 70 }, [goodAnswer, '<response><status>success</status></response>', goodAnswer.replace('>50<', '>70<')])
  check('a good write reads back and confirms', ok.out?.applied === true, JSON.stringify(ok.out))
  check('it read, wrote and read again', ok.sent.map((s) => s.url).join() === 'queryMotion,editMotion,queryMotion', ok.sent.map((s) => s.url).join())
  check('and it logged what it did', ok.out?.logged?.was === 50 && ok.out.logged.wanted === 70 && ok.out.logged.by === 'alice', JSON.stringify(ok.out?.logged))

  check('every read names the camera', ok.sent.filter((s) => s.url === 'queryMotion').every((s) => s.doc.includes('<chlId>{00000001-0000-0000-0000-000000000000}</chlId>')), ok.sent[0]?.doc)

  // An NVR that answers with every camera: the write used to be refused outright ("2 sensitivity
  // elements"). The camera asked for is changed, and the other one is not in what is sent.
  const other = '<chl id="{00000002-0000-0000-0000-000000000000}"><sensitivity>20</sensitivity></chl>'
  const both = goodAnswer.replace('</content>', `${other}</content>`)
  const multi = await tried({ threshold: 70 }, [both, '<response><status>success</status></response>', both.replace('>50<', '>70<')])
  check('a several-camera answer: the camera asked for is changed', multi.out?.applied === true && multi.out.logged.was === 50, JSON.stringify(multi.out ?? multi.error?.message))
  check('and the write holds that camera only', multi.sent[1]?.doc.includes('<sensitivity>70</sensitivity>') && !multi.sent[1].doc.includes('00000002'), multi.sent[1]?.doc)
  const absent = await tried({ threshold: 70 }, [`<response><status>success</status><content>${other}</content></response>`])
  check('an answer without the camera writes nothing', absent.error && /did not include this camera.*nothing was changed/.test(absent.error.message) && absent.sent.length === 1, absent.error?.message)

  const lied = await tried({ threshold: 70 }, [goodAnswer, '<response><status>success</status></response>', goodAnswer])
  check('an NVR that says success and keeps its old value is caught', lied.out?.applied === false, JSON.stringify(lied.out))
  check('and the caller is warned in words', /still reports its old sensitivity/.test(lied.out?.warning ?? ''), lied.out?.warning)
}

// --- the tuning view's arithmetic ------------------------------------------------------------------
{
  const { changedFraction, confirmText, maskFromArea, meterReading, pct, thresholdNote } = await import('../public/motion-view.js')
  const flat = (v, n = 16) => Uint8Array.from({ length: n }, () => v)
  check('an identical pair changed nothing', changedFraction(flat(100), flat(100)) === 0)
  // The one that matters: a cloud brightening the whole scene is not movement.
  check('an even lighting change is subtracted out', changedFraction(flat(100), flat(160)) === 0)
  const moved = flat(100)
  const after = flat(100)
  after[0] = 255
  after[1] = 255
  check('real movement counts', changedFraction(moved, after) === 2 / 16, String(changedFraction(moved, after)))
  check('mismatched samples give null, not zero', changedFraction(flat(100), flat(100, 8)) === null)
  check('nothing to compare gives null', changedFraction(null, flat(100)) === null)
  const mask = Uint8Array.from({ length: 16 }, (_v, i) => (i < 2 ? 0 : 1))
  check('pixels outside the watched zone are ignored', changedFraction(moved, after, mask) === 0)

  const m = meterReading([0.1, 0.2, 0.9, 0.3])
  check('the meter shows the newest, an average and the peak', m.now === 0.3 && m.peak === 0.9 && m.samples === 4)
  check('with nothing measured it shows nothing, not zero', meterReading([]).now === null)
  check('a percentage of nothing is a dash', pct(null) === '—')

  const { mask: made } = maskFromArea({ rows: 2, cols: 2, cells: [[1, 0], [0, 0]] }, 4, 4)
  check('a zone grid becomes a mask', made && made[0] === 1 && made[3] === 0)
  const none = maskFromArea(null, 4, 4)
  check('no grid means the whole picture, and it says so', none.mask === null && /does not tell us/.test(none.why))
  const empty = maskFromArea({ rows: 1, cols: 2, cells: [[0, 0]] }, 4, 4)
  check('a grid watching nothing is reported as such', empty.mask === null && /no part/.test(empty.why))

  const note = thresholdNote({ available: true, sensitivity: 50, min: 1, max: 100 })
  check('the note states the NVR’s number and its range', /50/.test(note) && /1–100/.test(note))
  // The honesty the whole panel rests on.
  check('and says our meter is not the NVR’s scale', /not the same scale/.test(note), note)
  check('an unreadable setting says why instead', thresholdNote({ available: false, why: 'it did not answer' }) === 'it did not answer')
  check('the confirmation names the camera and both numbers', /Yard/.test(confirmText('Yard', 50, 70)) && /50 to 70/.test(confirmText('Yard', 50, 70)))
  check('and says whose equipment it is', /owner/.test(confirmText('Yard', 50, 70)))
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
