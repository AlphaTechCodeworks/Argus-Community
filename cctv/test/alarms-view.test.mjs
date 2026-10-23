// Offline tests for the Alarms page's line-crossing additions in public/alarms-view.js: the picture
// a line-crossing row carries, when a picture that failed to load is worth asking for again, the
// alarm a phone alert's link points at (/alarms.html#event=<id>), and what the page says when that
// alarm is not in the list it is showing.
//
// Pure: no DOM, no database, no SDK, so it runs on Windows with plain node:
//   node cctv/test/alarms-view.test.mjs
import {
  EVENT_KINDS, kindParams, urgencyCounts, OTHER_OBJECTS_TYPES, PEOPLE_VEHICLES_TYPES, SMART_RULES_TYPES, detectionChipParams, smartRulesParams, otherObjectsParams, SNAPSHOT_KINDS, SNAPSHOT_SETTLE_MS, peopleVehiclesParams, alarmRows, eventFromHash, labelOf, linkedEventNote, ruleSummary, snapshotMayArrive, snapshotUrl
} from '../public/alarms-view.js'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }

const T0 = Date.UTC(2026, 8, 27, 14, 0, 0)
const MIN = 60_000

// --- which rows carry a picture ------------------------------------------------------------------
{
  check('line crossings are the kind that comes with a picture', SNAPSHOT_KINDS.includes('line-crossing'))
  const url = snapshotUrl({ id: 42, type: 'line-crossing' })
  check('a line crossing points at its own picture', url === '/api/events/42/snapshot', url)
  check('motion has none (nothing takes one)', snapshotUrl({ id: 42, type: 'motion' }) === null)
  check('nor does the old smart-detection kind', snapshotUrl({ id: 42, type: 'ai', subtype: 'tripwire' }) === null)
  // the id goes into a URL: only the whole number the database gave is let through
  check('an id that is not a positive whole number gives no address', [0, -1, 1.5, '7', 'x', true, null, undefined].every((id) => snapshotUrl({ id, type: 'line-crossing' }) === null))
  check('nothing at all gives nothing', snapshotUrl(null) === null && snapshotUrl(undefined) === null)

  const rows = alarmRows([
    { id: 9, camera: 'Maingate Roadway', nvr: 'nvr-2', ch: 2, type: 'line-crossing', subtype: 'tripwire', priority: 'high', startMs: T0, endMs: T0 + 10_000, ackMs: null },
    { id: 10, camera: 'Gate', nvr: 'nvr1', ch: 0, type: 'motion', subtype: '', priority: 'low', startMs: T0, endMs: null, ackMs: null }
  ], { now: T0 + MIN })
  check('the row of a line crossing carries its picture', rows[0].snapshot === '/api/events/9/snapshot', rows[0].snapshot)
  check('and says what it was in words', rows[0].what === `${labelOf('line-crossing')} (tripwire)`, rows[0].what)
  check('a motion row carries none', rows[1].snapshot === null)
  check('the rest of the row is as before', rows[0].id === 9 && rows[0].camera === 'Maingate Roadway' && rows[0].lasted === '10 s' && rows[0].needsAck === true && rows[0].nvr === 'nvr-2' && rows[0].ch === 2)
}

// --- people and vehicles come from this server, with a picture ----------------------------------------
{
  const kind = (t) => EVENT_KINDS.find((k) => k.type === t)
  check('ai-person is a confirmed kind called Person', kind('ai-person')?.confirmed === true && kind('ai-person').label === 'Person')
  check('ai-vehicle is a confirmed kind called Vehicle', kind('ai-vehicle')?.confirmed === true && kind('ai-vehicle').label === 'Vehicle')
  check('both carry a picture', snapshotUrl({ id: 5, type: 'ai-person' }) === '/api/events/5/snapshot' && snapshotUrl({ id: 6, type: 'ai-vehicle' }) === '/api/events/6/snapshot')
  const p = peopleVehiclesParams(new URLSearchParams('acked=false&types=motion&text=gate'))
  check('the People & vehicles chip asks for both types', p.get('types') === 'ai-person,ai-vehicle' && PEOPLE_VEHICLES_TYPES.join() === 'ai-person,ai-vehicle', p.get('types'))
  check('... with acknowledged rows included (no acked filter)', !p.has('acked'))
  check('... and keeps the other filters', p.get('text') === 'gate')
  const NEW = [['ai-bicycle', 'Bicycle'], ['ai-boat', 'Boat'], ['ai-animal', 'Animal'], ['ai-bag', 'Bag']]
  check('the four new kinds are confirmed, with their labels', NEW.every(([t, l]) => kind(t)?.confirmed === true && kind(t).label === l))
  check('... each carries a picture', NEW.every(([t], i) => snapshotUrl({ id: i + 1, type: t }) === '/api/events/' + (i + 1) + '/snapshot'))
  const o = otherObjectsParams(new URLSearchParams('acked=false&types=motion&text=gate'))
  check('the Other objects chip asks for the four types, acknowledged rows included', o.get('types') === 'ai-bicycle,ai-boat,ai-animal,ai-bag' && OTHER_OBJECTS_TYPES.join() === o.get('types') && !o.has('acked') && o.get('text') === 'gate', o.get('types'))
  const both = detectionChipParams(new URLSearchParams(), { people: true, objects: true })
  check('both chips ticked ask for all six', both.get('types') === 'ai-person,ai-vehicle,ai-bicycle,ai-boat,ai-animal,ai-bag')
}

// --- smart rules (zones and lines) come from this server, with a picture ----------------------------------
{
  const kind = (t) => EVENT_KINDS.find((k) => k.type === t)
  check('zone-enter is a confirmed kind called "Zone entered"', kind('zone-enter')?.confirmed === true && kind('zone-enter').label === 'Zone entered')
  check('line-cross is a confirmed kind called "Line crossed"', kind('line-cross')?.confirmed === true && kind('line-cross').label === 'Line crossed')
  check('... both carry a picture', snapshotUrl({ id: 3, type: 'zone-enter' }) === '/api/events/3/snapshot' && snapshotUrl({ id: 4, type: 'line-cross' }) === '/api/events/4/snapshot')
  const STAY = [['loitering', 'Loitering'], ['parked-too-long', 'Parked too long'], ['left-object', 'Left object'], ['crowding', 'Crowding']]
  check('the four stay rules are confirmed kinds, with their labels', STAY.every(([t, l]) => kind(t)?.confirmed === true && kind(t).label === l && labelOf(t) === l))
  check('... each carries a picture', STAY.every(([t], i) => snapshotUrl({ id: i + 5, type: t }) === '/api/events/' + (i + 5) + '/snapshot'))
  const r = smartRulesParams(new URLSearchParams('acked=false&types=motion&text=gate'))
  check('the Smart rules chip asks for all six types, acknowledged rows included', r.get('types') === 'zone-enter,line-cross,loitering,parked-too-long,left-object,crowding' && SMART_RULES_TYPES.join() === r.get('types') && !r.has('acked') && r.get('text') === 'gate', r.get('types'))
  const all3 = detectionChipParams(new URLSearchParams(), { people: true, objects: true, rules: true })
  check('all three chips ticked ask for all twelve', all3.get('types') === 'ai-person,ai-vehicle,ai-bicycle,ai-boat,ai-animal,ai-bag,zone-enter,line-cross,loitering,parked-too-long,left-object,crowding', all3.get('types'))
}

// --- the page's own wiring: one chip, found by the script ------------------------------------------
{
  const { readFileSync } = await import('node:fs')
  const html = readFileSync(new URL('../public/alarms.html', import.meta.url), 'utf8')
  const js = readFileSync(new URL('../public/alarms.js', import.meta.url), 'utf8')
  // two inputs of one name make form.people a RadioNodeList and the page's start() throws
  check('alarms.html has exactly one name="people" input', (html.match(/name="people"/g) ?? []).length === 1)
  check('alarms.html has exactly one name="objects" input, labelled Other objects', (html.match(/name="objects"/g) ?? []).length === 1 && /name="objects"[^>]*\/> Other objects</.test(html))
  check('alarms.js reads that chip as f.objects', js.includes('f.objects.checked') && js.includes('f.objects.addEventListener'))
  check('alarms.js reads the chip as f.people', js.includes('f.people.checked') && js.includes('f.people.addEventListener'))
  check('alarms.html has exactly one name="rules" input, labelled Smart rules', (html.match(/name="rules"/g) ?? []).length === 1 && /name="rules"[^>]*\/> Smart rules</.test(html))
  check('alarms.js reads that chip as f.rules', js.includes('f.rules.checked') && js.includes('f.rules.addEventListener'))
  // the rule form's two ticks: the phone and the bell, each set per rule, each one input
  check('the rule form has one notify tick, labelled "Send a phone notification"', (html.match(/name="notify"/g) ?? []).length === 1 && /name="notify"[^>]*>\s*Send a phone notification</.test(html))
  check('and one bell tick, labelled "Turn the bell red"', (html.match(/name="bell"/g) ?? []).length === 1 && /name="bell"[^>]*>\s*Turn the bell red</.test(html))
  check('alarms.js sends the bell tick with the rule', js.includes('bell: f.bell.checked'))
  check('and an existing rule\'s bell can be switched from the rules list', js.includes('patchRule(rule.id, { bell: !rule.bell })'))
  // the bell's link (?acked=false&from=...): read by alarm-bell.js bellFilters (tested in alarm-bell.test.mjs)
  // and put into the filters, the start day included, before the first load
  check('alarms.js reads the bell link through bellFilters', /const asked = bellFilters\(location\.search\)/.test(js))
  check('... and sets the Show filter and the start day from it', js.includes('f.acked.value = asked.acked') && js.includes('f.from.value = asked.from'))
  check('... before the filters are first applied', js.indexOf('bellFilters(location.search)') > 0 && js.indexOf('bellFilters(location.search)') < js.indexOf('await Promise.all([loadAlarms(), loadRules()])'))
}
{
  check('a bell rule says so in the rules list', /turns the bell red/.test(ruleSummary({ types: [], cameras: [], schedule: [], priority: 'high', notify: false, bell: true })))
  check('a rule for all kinds says it leaves out people and vehicles', /anything but people and vehicles/.test(ruleSummary({ types: [], cameras: [], schedule: [], priority: 'high' })))
  {
    const { readFileSync } = await import('node:fs')
    const html = readFileSync(new URL('../public/alarms.html', import.meta.url), 'utf8')
    check('... and the rule form says so next to the kinds', /name="types"[^\n]*People and vehicles must be ticked by name\./.test(html))
  }
  check('one without the bell does not',!/bell/.test(ruleSummary({ types: [], cameras: [], schedule: [], priority: 'high', notify: true })))
}

// --- a picture that failed to load: ask again, or stop asking --------------------------------------
{
  check('just after the crossing: it may still come', snapshotMayArrive(T0, T0 + 30_000))
  check('three minutes on: still possible (the snapshot waits that long for the recording)', snapshotMayArrive(T0, T0 + 3 * MIN))
  check('past the settle time: not coming', !snapshotMayArrive(T0, T0 + SNAPSHOT_SETTLE_MS))
  check('the settle time is longer than the snapshot\'s own three-minute wait', SNAPSHOT_SETTLE_MS > 3 * MIN)
  check('no start time: never worth asking again', !snapshotMayArrive(null, T0) && !snapshotMayArrive(undefined, T0))
}

// --- the link in a phone alert ---------------------------------------------------------------------
{
  check('#event=<id> names that alarm', eventFromHash('#event=123') === 123)
  check('without the #, too', eventFromHash('event=5') === 5)
  check('beside other things in the address', eventFromHash('#event=77&from=alert') === 77)
  check('a tab name is not an alarm', eventFromHash('#rules') === null && eventFromHash('#list') === null)
  check('an empty address is not an alarm', eventFromHash('') === null && eventFromHash(undefined) === null && eventFromHash(null) === null)
  const junk = ['#event=', '#event=abc', '#event=-4', '#event=1.5', '#event=0', '#event=1e3', '#event=12345678901234567890']
  check('nonsense is not an alarm', junk.every((h) => eventFromHash(h) === null), junk.filter((h) => eventFromHash(h) !== null).join(' '))
}

// --- when the linked alarm is not in the list ------------------------------------------------------
{
  const rows = alarmRows([{ id: 9, camera: 'Maingate Roadway', nvr: 'nvr-2', ch: 2, type: 'line-crossing', subtype: 'tripwire', priority: 'high', startMs: T0, endMs: null, ackMs: null }], { now: T0 })
  check('no link: nothing to say', linkedEventNote(null, rows) === '')
  check('the linked alarm is listed: nothing to say', linkedEventNote(9, rows) === '')
  const note = linkedEventNote(8, rows)
  check('not listed: the page says so and names it', /\b8\b/.test(note) && /not in the list/.test(note), note)
  // never "it does not exist": the list is a window of dates, and the server leaves out the alarms
  // of cameras this viewer may not see (alarms.mjs), so absence here proves neither
  check('and gives the likely reasons instead of claiming it does not exist', /older/.test(note) && /cannot see/.test(note) && !/does not exist/.test(note), note)
  check('an empty or missing list is handled', /not in the list/.test(linkedEventNote(8, [])) && /not in the list/.test(linkedEventNote(8, undefined)))
}

// --- motion on request (GUI refresh stage 2, task 3) -------------------------------------------------
{
  const others = EVENT_KINDS.map((k) => k.type).filter((t) => t !== 'motion')
  const off = kindParams(new URLSearchParams('acked=false&text=gate'), {})
  check('motion off by default: every kind but motion is asked for by name', off.get('types') === others.join(','), off.get('types'))
  check('... so nothing else is left out', others.length === EVENT_KINDS.length - 1 && others.every((t) => off.get('types').split(',').includes(t)))
  check('... and the other filters are kept', off.get('acked') === 'false' && off.get('text') === 'gate')
  const on = kindParams(new URLSearchParams('acked=false'), { motion: true })
  check('Motion ticked: no kind filter at all, as before', !on.has('types') && on.get('acked') === 'false')
  const chosen = kindParams(new URLSearchParams('types=motion'), {})
  check('a kind picked under More filters wins, motion included', chosen.get('types') === 'motion')
  const people = kindParams(new URLSearchParams('acked=false'), { people: true })
  check('People & vehicles keeps its meaning with motion off', people.get('types') === 'ai-person,ai-vehicle' && !people.has('acked'))
  const both = kindParams(new URLSearchParams('acked=false'), { people: true, motion: true })
  check('People & vehicles and Motion add up', both.get('types') === 'ai-person,ai-vehicle,motion', both.get('types'))
  const three = kindParams(new URLSearchParams(), { people: true, objects: true, rules: true })
  check('the three chips together still ask for their twelve', three.get('types') === detectionChipParams(new URLSearchParams(), { people: true, objects: true, rules: true }).get('types'))
}

// --- the page: one row of filters, a short Done, a phone Filters button ----------------------------
{
  const { readFileSync } = await import('node:fs')
  const html = readFileSync(new URL('../public/alarms.html', import.meta.url), 'utf8')
  const js = readFileSync(new URL('../public/alarms.js', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../public/css/alarms.css', import.meta.url), 'utf8')
  const form = html.slice(html.indexOf('<form id="filters"'), html.indexOf('</form>', html.indexOf('<form id="filters"')))
  const at = (s) => form.indexOf(s)
  // Browse is put first in the form by camera-browser.js (host.prepend)
  check('Browse sits in the filter row', /mountCameraBrowser\(\{ host: \$\('filters'\)/.test(js))
  check('the row reads Show, the four chips, Camera, Search, then More filters', [at('name="acked"'), at('name="people"'), at('name="objects"'), at('name="rules"'), at('name="motion"'), at('name="camera"'), at('name="text"'), at('More filters')].every((v, i, a) => v > 0 && (i === 0 || v > a[i - 1])))
  check('Show offers Needs review, All and Done', /<option value="false">Needs review<\/option>\s*<option value="">All<\/option>\s*<option value="true">Done<\/option>/.test(form))
  check('one Motion chip, labelled Motion, not ticked', (html.match(/name="motion"/g) ?? []).length === 1 && /<input type="checkbox" name="motion" \/> Motion</.test(form) && !/name="motion"[^>]*checked/.test(form))
  check('alarms.js reads the Motion chip and applies it', js.includes('motion: f.motion.checked') && js.includes('f.motion.addEventListener'))
  check('no Apply button: the row applies as it changes', !/>Apply</.test(form) && !/type="submit"/.test(form))
  check('Reset filters is still there, under More filters', at('id="resetAlarmFilters"') > at('More filters'))
  check('the search box starts empty', /<input type="search" name="text"(?![^>]*value=)[^>]*autocomplete="off"/.test(form))
  check('an old search is neither saved nor brought back', !/\['acked', 'type', 'priority', 'text'/.test(js) && /const SAVED_FILTERS = \['acked', 'type', 'priority', 'from', 'to'\]/.test(js))
  check('the four urgency cards are gone', !html.includes('Urgency filters for loaded results') && !js.includes("'In loaded results'"))
  check('one urgency line takes their place', /id="alarmOverview" class="al-overview"/.test(html) && js.includes('urgencyCounts(byPriority)'))
  // the cards were the one-click way to see just the urgent ones: each count still is
  check('each count is a quiet button that filters to its urgency, and a second click clears it', js.includes("button(u.text, () => { f.priority.value = f.priority.value === u.priority ? '' : u.priority; applyAlarmFilters() }, 'btn btn-ghost btn-sm')"))
  check('... and says whether it is the one applied', js.includes("b.setAttribute('aria-pressed', String(f.priority.value === u.priority))"))
  check('... in a group named for what it does', /id="alarmOverview" class="al-overview" role="group" aria-label="Urgency[^"]*"/.test(html))
  check('urgencyCounts: one part per urgency with something in it, most urgent first', JSON.stringify(urgencyCounts({ critical: 0, high: 2, medium: 0, low: 3 })) === JSON.stringify([{ priority: 'high', count: 2, text: '2 high' }, { priority: 'low', count: 3, text: '3 low' }]) && urgencyCounts(null).length === 0)
  check('the row colour stays on the left edge', /tr\.pri-critical td:first-child \{ box-shadow: inset 3px 0 var\(--bad\)/.test(css) && /tr\.pri-high td:first-child \{ box-shadow: inset 3px 0 var\(--warn\)/.test(css))
  // the row's action: short on screen, the same acknowledge as before underneath
  check('the row action reads Done, titled Acknowledge, named for its alarm', js.includes("const done = button('Done', () => acknowledge(r), 'btn btn-primary')") && js.includes("done.title = 'Acknowledge'") && js.includes("done.setAttribute('aria-label', `Done: ${r.what} on ${r.camera}`)"))
  check('the note dialog\'s button says Done too', js.includes("multiline: true, action: 'Done' })"))
  // dates typed digit by digit do not reload at every digit
  check('a date applies on leaving the field or Enter, not at each typed digit', js.includes("addEventListener('change', () => { if (document.activeElement !== f[key]) applyAlarmFilters() })") && /for \(const key of \['from', 'to'\]\)[\s\S]{0,700}addEventListener\('blur'/.test(js) && !js.includes("['acked', 'camera', 'from'"))
  check('the Motion chip says that with a detection chip it lists done motion alarms too', /name="motion"/.test(html) && /title="Show motion:[^"]*done ones included/.test(html))
  check('... and acknowledging is the same request as before', js.includes("fetch(`/api/alarms/${row.id}/ack`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note }) })"))
  // the bell's link and a phone alert's link must find their alarm, even a motion one
  check('the bell link shows motion too', /if \(asked\) \{[^}]*f\.motion\.checked = true/.test(js))
  check('a link to one alarm shows motion too', /if \(linked !== null\) \{[^}]*f\.motion\.checked = true/.test(js) && /if \(id === null\) return\s*[\s\S]{0,200}elements\.motion\.checked = true/.test(js))
  // phones: Browse and Filters in one line, the rest in a sheet
  check('a Filters button opens the sheet', /<button type="button" id="alarmFiltersToggle" class="btn al-filters-toggle" aria-expanded="false" aria-controls="alarmFilterSheet">Filters<\/button>/.test(form) && form.includes('id="alarmFilterSheet"'))
  check('the sheet takes the keyboard and gives it back', js.includes(".elements.acked.focus()") && js.includes("$('alarmFiltersToggle').focus()"))
  check('Escape and a tap outside close it', /e\.key === 'Escape'/.test(js) && /pointerdown/.test(js))
  check('on phones the sheet is folded until asked for', /@media \(max-width: 699px\)[\s\S]*\.al-filter-sheet \{ display: none; \}[\s\S]*\.al-filters\.is-open \.al-filter-sheet \{/.test(css))
  check('the chips have their box beside the words', /\.al-chip \{[^}]*flex-direction: row/.test(css))
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
