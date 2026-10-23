// What the sidebar's bell says and does, worked out without a browser (alert-banner.js paints it;
// test/alarm-bell.test.mjs). It goes red for two lists: the open problems the Health page has (the
// server's own alerts, cameras offline) and the alarms an alarm rule asked to ring it for
// (GET /api/alarms/bell: unacknowledged, on cameras this person may watch Live). The alarms come first:
// somebody may be at the gate. They stay until somebody acknowledges them on the Alarms page, which
// is where clicking the bell goes while there are any.

import { labelOf } from './alarms-view.js'

/**
 * Where a click on a bell with alarms goes: the Alarms page on what still needs review, with
 * &from=<ms> of the oldest alarm ringing it added (bellState). The page opens on the last week when
 * not told otherwise, and an alarm older than that could never be found there and acknowledged.
 */
export const BELL_HREF = '/alarms.html?acked=false'
/** How many alarms the tooltip names; the rest are counted. */
export const BELL_SHOWN = 5

const two = (n) => String(n).padStart(2, '0')
/** A time as a date input's value, "2026-10-18", in this browser's local time. */
const dayOf = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

/** One alarm as the tooltip reads it: "Person at Main Gate, 02:14" (this browser's local time). */
export function bellLine(alarm) {
  const at = new Date(alarm.startMs)
  const camera = alarm.camera ?? `${alarm.nvr}/${alarm.ch}`
  return `${labelOf(alarm.type)} at ${camera}, ${two(at.getHours())}:${two(at.getMinutes())}`
}

/**
 * The bell for what is open now.
 * @param {{ problems?: string, alarms?: object[], oldestMs?: number|null }} open problems: the Health
 *   wording, '' for none; oldestMs: the start of the oldest alarm ringing it (the feed names only the
 *   newest), else the oldest of those named
 * @returns {{ red: boolean, title: string, href: string|null }} href null: the link stays as drawn
 */
export function bellState({ problems = '', alarms = [], oldestMs = null } = {}) {
  const list = Array.isArray(alarms) ? alarms : []
  const starts = [oldestMs, ...list.map((a) => a?.startMs)].filter((v) => typeof v === 'number' && Number.isFinite(v))
  const from = starts.length ? `&from=${Math.floor(Math.min(...starts))}` : ''
  const parts = []
  if (list.length) {
    const named = list.slice(0, BELL_SHOWN).map(bellLine).join(' · ')
    const more = list.length > BELL_SHOWN ? ` · and ${list.length - BELL_SHOWN} more` : ''
    parts.push(`${named}${more}. Open Alarms to acknowledge.`)
  }
  if (problems) parts.push(`${problems}. Open Health for the details.`)
  return { red: parts.length > 0, title: parts.length ? parts.join(' ') : 'Alarms', href: list.length ? `${BELL_HREF}${from}` : null }
}

/**
 * What the Alarms page is asked for by a bell's link (alarms.js), from its address's ?query:
 * { acked: 'false' | 'true', from: 'YYYY-MM-DD' | '' }, or null when the address asks for nothing
 * (the page then opens on the filters saved last time).
 */
export function bellFilters(search) {
  const p = new URLSearchParams(search ?? '')
  const acked = p.get('acked')
  if (acked !== 'false' && acked !== 'true') return null
  const ms = p.get('from') === null || p.get('from').trim() === '' ? NaN : Number(p.get('from'))
  return { acked, from: Number.isFinite(ms) && ms >= 0 ? dayOf(ms) : '' }
}
