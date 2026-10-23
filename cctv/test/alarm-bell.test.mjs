// The bell in the sidebar (public/alarm-bell.js, painted by alert-banner.js): red for open problems
// (the Health page's list) and for alarms a rule asked to ring it for, what its tooltip says, and
// where clicking it goes. Pure code, no browser.
//   node cctv/test/alarm-bell.test.mjs
import { BELL_HREF, BELL_SHOWN, bellFilters, bellLine, bellState } from '../public/alarm-bell.js'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }

// times are this machine's local time, as the browser shows them
const at = (h, m) => new Date(2026, 9, 18, h, m, 30).getTime()
const person = { id: 7, nvr: 'nvr1', ch: 0, camera: 'Main Gate', type: 'ai-person', startMs: at(2, 14), ruleName: 'Gate at night' }
const van = { id: 8, nvr: 'nvr1', ch: 3, camera: 'Yard', type: 'ai-vehicle', startMs: at(14, 5), ruleName: 'Yard' }

check('an alarm reads as kind, camera and local time', bellLine(person) === 'Person at Main Gate, 02:14', bellLine(person))
check('a vehicle too, afternoon in 24-hour time', bellLine(van) === 'Vehicle at Yard, 14:05', bellLine(van))
check('a camera with no name keeps its key', bellLine({ ...person, camera: undefined }) === 'Person at nvr1/0, 02:14', bellLine({ ...person, camera: undefined }))

{
  const calm = bellState({ problems: '', alarms: [] })
  check('nothing open: the bell is normal', calm.red === false && calm.title === 'Alarms' && calm.href === null, JSON.stringify(calm))
  const nothingGiven = bellState()
  check('and with nothing given at all', nothingGiven.red === false && nothingGiven.href === null)
}
{
  const s = bellState({ problems: '', alarms: [person] })
  check('one bell alarm and no health problems: red', s.red === true, JSON.stringify(s))
  check('its tooltip names it', s.title.startsWith('Person at Main Gate, 02:14'), s.title)
  check('clicking opens the Alarms page on what still needs review, from the alarm', s.href === `/alarms.html?acked=false&from=${person.startMs}` && BELL_HREF === '/alarms.html?acked=false', s.href)
}
{
  const s = bellState({ problems: '2 cameras offline', alarms: [] })
  check('health problems alone: red, as before', s.red === true && s.title === '2 cameras offline. Open Health for the details.', s.title)
  check('and clicking goes where it always did', s.href === null)
}
{
  const s = bellState({ problems: '2 cameras offline', alarms: [van, person] })
  check('both: red, the alarms listed first', s.red && s.title.indexOf('Vehicle at Yard, 14:05') === 0 && s.title.indexOf('Person at Main Gate, 02:14') > 0 && s.title.indexOf('2 cameras offline') > s.title.indexOf('Person at Main Gate'), s.title)
  check('and the click goes to the alarms, from the older of the two', s.href === `${BELL_HREF}&from=${person.startMs}`, s.href)
}
{
  const many = Array.from({ length: BELL_SHOWN + 3 }, (_, i) => ({ ...person, id: i, startMs: at(3, i) }))
  const s = bellState({ problems: '', alarms: many })
  const listed = (s.title.match(/Person at/g) ?? []).length
  check(`a long list names the first ${BELL_SHOWN} and counts the rest`, listed === BELL_SHOWN && s.title.includes('and 3 more'), s.title)
}
{
  // back to normal once both lists are empty again (acknowledged on the Alarms page, problems fixed)
  const before = bellState({ problems: '', alarms: [person] })
  const after = bellState({ problems: '', alarms: [] })
  check('back to normal when both are empty', before.red && !after.red && after.title === 'Alarms')
}

{
  // the feed names the newest 50; the oldest ringing it can be weeks older, and the link must reach it
  const tenDaysAgo = at(2, 14) - 10 * 86_400_000
  const s = bellState({ problems: '', alarms: [van, person], oldestMs: tenDaysAgo })
  check('the link starts at the oldest alarm ringing the bell, not only the ones named', s.href === `${BELL_HREF}&from=${tenDaysAgo}`, s.href)
  check('a missing oldest falls back to the oldest named', bellState({ alarms: [van], oldestMs: null }).href === `${BELL_HREF}&from=${van.startMs}`)

  // the Alarms page reading that link (alarms.js start)
  const asked = bellFilters(s.href.slice(s.href.indexOf('?')))
  const d = new Date(tenDaysAgo)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  check('the page opens on what needs review, from the day of the oldest (a date input value)', asked?.acked === 'false' && asked.from === day, JSON.stringify(asked))
  check('acked=true is honoured too, with no start day', JSON.stringify(bellFilters('?acked=true')) === JSON.stringify({ acked: 'true', from: '' }))
  check('an address that asks for nothing changes nothing', bellFilters('') === null && bellFilters('?from=5') === null && bellFilters('?acked=maybe') === null)
  check('a start that is not a time is left out', bellFilters('?acked=false&from=soon')?.from === '' && bellFilters('?acked=false&from=')?.from === '')
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exitCode = failures ? 1 : 0
