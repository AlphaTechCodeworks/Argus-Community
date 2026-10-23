// The Alarms page's wording and shaping, with no DOM in it.
//
// The same split health.js and pb-sources.js use: everything that decides what a line of the page
// says lives here and is tested on plain data (cctv/test/alarms.test.mjs), and alarms.js only
// paints.
//
// It imports nothing at all, because the browser fetches it from /alarms-view.js and cannot reach
// anything above that folder. That is also why the priorities and the words for each kind of event
// live HERE and are imported by event-rules.mjs on the server, the same way bookmarks.mjs takes its
// rules from public/bookmarks-view.js: the page and the server cannot then disagree about what an
// alarm is called or how urgent "high" is.

/** Urgencies, most urgent first. A rule picks one; without a rule an alarm is the quietest. */
export const PRIORITIES = Object.freeze(['critical', 'high', 'medium', 'low'])
export const DEFAULT_PRIORITY = 'low'
const RANK = new Map(PRIORITIES.map((p, i) => [p, i]))
/** Lower is more urgent. An unknown word ranks last rather than throwing: a list must still draw. */
export const priorityRank = (p) => RANK.get(p) ?? PRIORITIES.length

/**
 * Every kind of event, what it is called on screen, and — the important column — whether anything
 * in this app can actually produce it today. An unconfirmed kind is still listed, so a rule can be
 * written for the day it works, but the page labels it and never shows an empty list as though it
 * meant nothing happened. event-rules.mjs adds where each one comes from; see events.mjs for why
 * "person" and "vehicle" are not confirmed on these NVRs.
 */
export const EVENT_KINDS = Object.freeze([
  { type: 'motion', label: 'Motion', confirmed: true },
  { type: 'camera-offline', label: 'Camera offline', confirmed: true },
  { type: 'video-loss', label: 'Video loss', confirmed: true },
  { type: 'tamper', label: 'Camera tampered with', confirmed: true },
  { type: 'sensor', label: 'Alarm input', confirmed: true },
  { type: 'ai', label: 'Smart detection', confirmed: true },
  // The camera's own line-crossing detection. A kind of its own rather than one more 'ai' subtype,
  // so the "Line crossing" alarm rule can ask for exactly this and nothing else the camera's AI does.
  { type: 'line-crossing', label: 'Line crossing', confirmed: true },
  { type: 'face', label: 'Face', confirmed: true },
  { type: 'pos', label: 'Till (POS)', confirmed: true },
  { type: 'ai-person', label: 'Person', confirmed: true },
  { type: 'ai-vehicle', label: 'Vehicle', confirmed: true },
  { type: 'ai-bicycle', label: 'Bicycle', confirmed: true },
  { type: 'ai-boat', label: 'Boat', confirmed: true },
  { type: 'ai-animal', label: 'Animal', confirmed: true },
  { type: 'ai-bag', label: 'Bag', confirmed: true },
  // the smart rules (Argus Pro): something entered a zone, or crossed a line, drawn on the camera
  { type: 'zone-enter', label: 'Zone entered', confirmed: true },
  { type: 'line-cross', label: 'Line crossed', confirmed: true },
  // the stay rules on those zones (Argus Pro): someone or something there too long, or a crowd
  { type: 'loitering', label: 'Loitering', confirmed: true },
  { type: 'parked-too-long', label: 'Parked too long', confirmed: true },
  { type: 'left-object', label: 'Left object', confirmed: true },
  { type: 'crowding', label: 'Crowding', confirmed: true },
  { type: 'plate', label: 'Number plate', confirmed: false },
  { type: 'nvr-event', label: 'Event (kind not named)', confirmed: true }
])

/** What each kind of event is called on screen. */
export const LABELS = Object.freeze(Object.fromEntries(EVENT_KINDS.map((k) => [k.type, k.label])))
/** The words for a kind, or the raw name when it is one we have never seen. */
export const labelOf = (type) => LABELS[type] ?? String(type)

const S = 1000
const MIN = 60 * S
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** "just now", "5 min ago", "3 h ago", "2 days ago". Short: these sit in a narrow column. */
export function timeAgo(ms, now = Date.now()) {
  const d = Math.max(0, now - ms)
  if (d < MIN) return 'just now'
  if (d < HOUR) return `${Math.round(d / MIN)} min ago`
  if (d < DAY) return `${Math.round(d / HOUR)} h ago`
  return `${Math.round(d / DAY)} ${Math.round(d / DAY) === 1 ? 'day' : 'days'} ago`
}

/** How long an event lasted, or null when it has no end — never a made-up zero. */
export function lasted(startMs, endMs) {
  if (!Number.isFinite(endMs) || endMs === null || endMs <= startMs) return null
  const d = endMs - startMs
  if (d < MIN) return `${Math.round(d / S)} s`
  if (d < HOUR) return `${Math.round(d / MIN)} min`
  return `${(d / HOUR).toFixed(1)} h`
}

const clock = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const day = (ms) => new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/**
 * The kinds of event that come with a picture of the moment: the camera's own line crossings
 * (event-snapshot.mjs, from Argus's own recording) and every detection and smart-rule event
 * (Argus Pro, the moment's picture). No other kind has one, so no other row asks the server for one.
 */
export const SNAPSHOT_KINDS = Object.freeze(['line-crossing', 'ai-person', 'ai-vehicle', 'ai-bicycle', 'ai-boat', 'ai-animal', 'ai-bag', 'zone-enter', 'line-cross', 'loitering', 'parked-too-long', 'left-object', 'crowding'])
/**
 * How long after an event starts its picture may still be on its way. The snapshot waits up to
 * three minutes for the recording to cover the moment (event-snapshot.mjs SNAP_WAIT_MS), and the
 * two minutes on top cover the recording's last file being written and ffmpeg. A picture still
 * missing after that is not coming, so the page stops asking for it on every refresh.
 */
export const SNAPSHOT_SETTLE_MS = 5 * 60_000

/** The kinds the "People & vehicles" chip lists: this server's own detections (Argus Pro). */
export const PEOPLE_VEHICLES_TYPES = Object.freeze(['ai-person', 'ai-vehicle'])

/**
 * The /api/alarms query with the "People & vehicles" chip on. A detection with no alert rule is
 * stored already acknowledged, so the "needs review" filter would hide exactly these rows: the chip
 * drops the acknowledged filter and asks for both types.
 */
export function peopleVehiclesParams(params) {
  return detectionChipParams(params, { people: true })
}

/** The kinds the "Other objects" chip lists: bicycles, boats, animals and bags (Argus Pro). */
export const OTHER_OBJECTS_TYPES = Object.freeze(['ai-bicycle', 'ai-boat', 'ai-animal', 'ai-bag'])

/** The /api/alarms query with the "Other objects" chip on: as the People & vehicles chip, for the other four kinds. */
export function otherObjectsParams(params) {
  return detectionChipParams(params, { objects: true })
}

/** The kinds the "Smart rules" chip lists: a zone entered, a line crossed, and the four stay rules (Argus Pro). */
export const SMART_RULES_TYPES = Object.freeze(['zone-enter', 'line-cross', 'loitering', 'parked-too-long', 'left-object', 'crowding'])

/** The /api/alarms query with the "Smart rules" chip on: as the People & vehicles chip, for those six kinds. */
export function smartRulesParams(params) {
  return detectionChipParams(params, { rules: true })
}

/** Any of the chips, or several (their kinds add up). Detections are stored acknowledged, so the acked filter goes. */
export function detectionChipParams(params, { people = false, objects = false, rules = false } = {}) {
  const p = new URLSearchParams(params)
  p.set('types', [...(people ? PEOPLE_VEHICLES_TYPES : []), ...(objects ? OTHER_OBJECTS_TYPES : []), ...(rules ? SMART_RULES_TYPES : [])].join(','))
  p.delete('acked')
  return p
}

/**
 * Every kind but motion. A busy week is mostly motion (about 500 rows burying 42 people and 33
 * vehicles when this was written), so the list leaves it out unless the Motion chip is ticked. The
 * server has no "leave this kind out" filter, so the page asks for every other kind by name instead:
 * the database still does the filtering, the 500-row limit counts what is shown, and the counts the
 * server sends back describe the list on screen. Built from EVENT_KINDS, so a kind added later is
 * shown without anyone remembering to add it here.
 */
export const NOT_MOTION_TYPES = Object.freeze(EVENT_KINDS.map((k) => k.type).filter((t) => t !== 'motion'))

/**
 * The /api/alarms query with the chips applied.
 * - People & vehicles, Other objects, Smart rules: as before (detectionChipParams); a ticked
 *   Motion adds motion to their kinds, as the chips add up among themselves.
 * - None of those, and no kind picked under More filters: motion is left out unless Motion is ticked.
 * - A kind picked under More filters is a plain request for that kind and is kept, motion included.
 */
export function kindParams(params, { people = false, objects = false, rules = false, motion = false } = {}) {
  if (people || objects || rules) {
    const p = detectionChipParams(params, { people, objects, rules })
    if (motion) p.set('types', `${p.get('types')},motion`)
    return p
  }
  const p = new URLSearchParams(params)
  if (!motion && !p.get('types')) p.set('types', NOT_MOTION_TYPES.join(','))
  return p
}

/** Where an event's picture is served, or null for a kind that never has one. */
export function snapshotUrl(event) {
  const id = event?.id
  // the id goes into a URL: only the whole number the database gave is let through
  if (!SNAPSHOT_KINDS.includes(event?.type) || !Number.isSafeInteger(id) || id <= 0) return null
  return `/api/events/${id}/snapshot`
}

/** Whether a picture that failed to load may still arrive, so the next refresh should ask again. */
export const snapshotMayArrive = (startMs, now = Date.now()) => Number.isFinite(startMs) && now - startMs < SNAPSHOT_SETTLE_MS

/**
 * One row per alarm, ready to paint.
 * `needsAck` is the one the eye should go to: the page exists to show what still needs a person.
 */
export function alarmRows(alarms, { now = Date.now() } = {}) {
  return (alarms ?? []).map((a) => ({
    id: a.id,
    priority: a.priority,
    camera: a.camera ?? `${a.nvr}/${a.ch}`,
    what: a.subtype ? `${labelOf(a.type)} (${a.subtype})` : labelOf(a.type),
    when: `${day(a.startMs)} ${clock(a.startMs)}`,
    ago: timeAgo(a.startMs, now),
    lasted: lasted(a.startMs, a.endMs),
    needsAck: !a.ackMs,
    // The whole acknowledgement in one line: who looked, and what they made of it. A note nobody
    // wrote is not invented into "no issue found".
    ack: a.ackMs ? `${a.ackUser ?? 'someone'} ${timeAgo(a.ackMs, now)}${a.ackNote ? ` — ${a.ackNote}` : ''}` : '',
    rule: a.ruleName ?? '',
    detail: a.detail ?? '',
    startMs: a.startMs,
    endMs: a.endMs ?? null,
    nvr: a.nvr,
    ch: a.ch,
    // a line crossing's picture (event-snapshot.mjs), or null for kinds that never have one
    snapshot: snapshotUrl(a)
  }))
}

/**
 * The line above the list: what is being shown out of what there is.
 * filters, as the page applied them: { acked (true, false or left out), motionHidden, text, kinds
 * (a chip or a kind chosen), priority (an urgency chosen) }.
 */
export function filterSummary(summary, filters = {}) {
  const total = summary?.total ?? 0
  // Said whenever motion is hidden: a quiet list must not be read as "nothing moved anywhere".
  const motionNote = filters.motionHidden ? 'motion is not shown (tick Motion to see it)' : ''
  if (!total) {
    // Only with nothing chosen but times and cameras does an empty list mean nothing was recorded.
    // Any other filter may be what hides the alarms, so the line names it (audit 2026-10-20
    // SE-search#0).
    const hiding = [
      filters.acked === false ? 'Show: Needs review hides the alarms already done, and the detections no rule asked for are filed as done' : '',
      filters.acked === true ? 'Show: Done hides the alarms still needing review' : '',
      filters.kinds ? 'only the kinds chosen are listed' : '',
      filters.priority ? 'only the urgency chosen is listed' : '',
      filters.text ? `searching for “${filters.text}”` : ''
    ].filter(Boolean)
    if (hiding.length) return ['Nothing matches these filters', ...hiding, motionNote].filter(Boolean).join(' · ')
    return ['Nothing in this window — no alarms have been recorded for the times and cameras selected.', motionNote].filter(Boolean).join(' · ')
  }
  const parts = []
  if (filters.acked === false) parts.push(`${summary.unacked} of ${total} still need a look`)
  else parts.push(`${total} alarm${total === 1 ? '' : 's'}, ${summary.unacked} still needing a look`)
  if (summary.worst) parts.push(`worst outstanding: ${summary.worst}`)
  if (motionNote) parts.push(motionNote)
  return parts.join(' · ')
}

/**
 * "2 high · 14 medium · 300 low": the one short line that replaced the four big urgency cards.
 * Most urgent first, and an urgency with nothing in it is left out rather than shown as a zero.
 * `byPriority` is the server's count of the list shown (event-rules.mjs summarise).
 */
export function urgencyLine(byPriority) {
  return urgencyCounts(byPriority).map((u) => u.text).join(' · ')
}

/** The same line in parts, one per urgency with something in it: the page makes each a button that filters to it. */
export function urgencyCounts(byPriority) {
  return PRIORITIES.filter((p) => (byPriority?.[p] ?? 0) > 0).map((p) => ({ priority: p, count: byPriority[p], text: `${byPriority[p]} ${p}` }))
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A rule as one readable sentence, so the rules list can be read without opening each one. */
export function ruleSummary(rule) {
  const cams = rule.cameras?.length ? rule.cameras.join(', ') : 'any camera'
  // (an empty list leaves out people and vehicles: they are caught only by name, event-rules.mjs ruleMatches)
  const kinds = rule.types?.length ? rule.types.map(labelOf).join(', ') : 'anything but people and vehicles'
  const when = !rule.schedule?.length
    ? 'at any time'
    : rule.schedule.map((s) => `${s.days?.length ? s.days.map((d) => DAY_NAMES[d]).join('/') : 'every day'} ${s.from}–${s.to}`).join('; ')
  const tail = rule.notify ? `, and notifies${rule.minGapS ? ` (at most one message every ${rule.minGapS} s)` : ''}` : ', without notifying'
  return `${kinds} on ${cams}, ${when} → ${rule.priority}${tail}${rule.bell ? ', and turns the bell red' : ''}`
}

/** The colour class for a priority, so the list is scannable without reading it. */
export const priorityClass = (p) => `pri-${PRIORITIES.includes(p) ? p : 'low'}`

/**
 * The alarm a link points at, or null. A phone alert links to /alarms.html#event=<id>
 * (line-actions.mjs eventLink); anything else after the # (a tab name such as #rules) is not one.
 */
export function eventFromHash(hash) {
  const raw = new URLSearchParams(String(hash ?? '').replace(/^#/, '')).get('event')
  if (!raw || !/^\d{1,15}$/.test(raw)) return null
  const id = Number(raw)
  return id > 0 ? id : null
}

/**
 * What the page says when the alarm a link points at is not in the list it shows, or '' when there
 * is no link or the alarm is there. Never "it does not exist": the list covers a window of dates
 * (the last week unless changed), and the server leaves out the alarms of cameras this viewer may
 * not see (alarms.mjs), so its absence here proves neither.
 */
export function linkedEventNote(id, rows) {
  if (id === null || id === undefined) return ''
  if ((rows ?? []).some((r) => r.id === id)) return ''
  return `The alarm the link points to (number ${id}) is not in the list below: it may be older than the dates shown, or on a camera you cannot see. Widen the dates under More filters to look further back.`
}
