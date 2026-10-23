// Offline test of the events prune (events-db.mjs forgetEventsBefore), which server.mjs runs on the
// main thread every 5 minutes: it must find the old rows through events_start (start_ms), not read
// every unacknowledged row through events_ack, and it must still drop only the unacknowledged rows
// older than the cut (audit 2026-10-20 S4a-events-alarms-alerts#0).
//
// Temp data folder only; no NVR, no SDK, no network.
//   node cctv/test/events-prune-plan.test.mjs
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'cctv-events-prune-test-'))

const db = await import('../events-db.mjs')

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }

const DAY = 86_400_000
const now = Date.UTC(2026, 9, 20, 9, 0, 0)
const cut = now - db.EVENT_KEEP_DAYS * DAY

// --- the plan, on a fresh database with the real schema ---------------------------------------------
//
// Production never runs ANALYZE, so SQLite has no statistics and reads "ack_ms IS NULL" as an equality:
// without the +ack_ms it takes events_ack and visits every unacknowledged row (nearly every NVR row,
// over a million) to test start_ms, about half a second of the main thread with nothing to delete.
{
  db.getEvent(1) // opens the store as the server does: EVENTS_SCHEMA, then migrateEvents
  const look = new DatabaseSync(db.EVENTS_DB)
  const stats = look.prepare("SELECT name FROM sqlite_master WHERE name = 'sqlite_stat1'").all()
  check('the database has no ANALYZE statistics, as in production', stats.length === 0)
  const sql = db.PRUNE_EVENTS_SQL
  check('forgetEventsBefore\'s statement is exported as PRUNE_EVENTS_SQL', typeof sql === 'string' && /^DELETE FROM events\b/.test(sql ?? ''), String(sql))
  if (typeof sql === 'string') {
    const plan = look.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(cut).map((r) => r.detail).join(' | ')
    check('the prune range-scans events_start, not the acknowledgements\' index', /USING (COVERING )?INDEX events_start\b/.test(plan) && !/events_ack/.test(plan) && !/SCAN events/.test(plan), plan)
  }
  look.close()
  const source = readFileSync(new URL('../events-db.mjs', import.meta.url), 'utf8')
  check('... and it is the statement forgetEventsBefore runs', /\bforget: db\.prepare\(PRUNE_EVENTS_SQL\)/.test(source))
}

// --- what it drops ------------------------------------------------------------------------------------
{
  const add = (e) => db.addEvent({ type: 'motion', source: 'x', ...e }, now).event.id
  const oldOpen = add({ nvr: 'p1', ch: 0, startMs: cut - 1 })
  const veryOld = add({ nvr: 'p1', ch: 1, startMs: cut - 200 * DAY, type: 'ai', subtype: 'area entered' })
  const oldNoted = add({ nvr: 'p1', ch: 2, startMs: cut - DAY })
  db.acknowledge(oldNoted, 'alice', 'the gate was left open', now)
  const atCut = add({ nvr: 'p1', ch: 3, startMs: cut })
  const recent = add({ nvr: 'p1', ch: 4, startMs: cut + 1 })
  const recentNoted = add({ nvr: 'p1', ch: 5, startMs: now - DAY })
  db.acknowledge(recentNoted, 'alice', 'checked', now)

  const gone = db.forgetEventsBefore(cut)
  check('unacknowledged events older than the cut go, and the count says how many', gone === 2 && db.getEvent(oldOpen) === null && db.getEvent(veryOld) === null, String(gone))
  check('an old one somebody acknowledged stays, note and all', db.getEvent(oldNoted)?.ackNote === 'the gate was left open')
  check('one starting exactly at the cut stays (strictly older only)', db.getEvent(atCut) !== null)
  check('newer ones stay, acknowledged or not', db.getEvent(recent) !== null && db.getEvent(recentNoted) !== null)
  check('a second round finds nothing more', db.forgetEventsBefore(cut) === 0)
}

db.closeEvents()
console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exitCode = failures ? 1 : 0
