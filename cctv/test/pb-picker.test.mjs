// cctv/test/pb-picker.test.mjs
// Playback opens on a big picture with one bar of controls under it. Above it, one slim row picks what
// to watch: One camera / Many cameras, Browse (the site) and a find box that lists matching cameras as
// you type (no "first 50 shown"). The picture is 16:9 from the moment the page opens, as wide as the
// page unless that would push the bar and timeline off a laptop screen, with a quiet placeholder until
// the first frame. Under it ONE bar: the day ‹ date ›, the time,
// the 30-second jumps, the transport and speed, and on the right Snapshot, Mark clip, Draw box, a small
// speaker that shows whether sound is on, Full screen and More, which holds Bookmarks, Sound (with its
// volume and Filter) and the rest. The page opens on the camera this browser
// watched last, unless the link names one.
//   node cctv/test/pb-picker.test.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }

const pub = join(import.meta.dirname, '..', 'public')
const read = (f) => { try { return readFileSync(join(pub, f), 'utf8') } catch { return '' } }
// (comments blanked, not removed, so positions hold)
const html = read('playback.html').replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length))
const pb = read('playback.js')
const css = read('css/playback.css').replace(/\/\*[\s\S]*?\*\//g, '')

// the inner HTML of the first element opened by `open` (a regex for its start tag), up to its own close
function inner(open, tag) {
  const m = html.match(open)
  if (!m) return ''
  let depth = 1, i = m.index + m[0].length
  const re = new RegExp(`<(/?)${tag}\\b`, 'g')
  re.lastIndex = i
  for (let t; (t = re.exec(html));) {
    depth += t[1] ? -1 : 1
    if (depth === 0) return html.slice(i, t.index)
  }
  return html.slice(i)
}
const has = (block, id) => new RegExp(`id="${id}"`).test(block)
const at = (block, id) => block.indexOf(`id="${id}"`)
const rising = (block, ids) => ids.map((id) => at(block, id)).every((n, i, all) => n >= 0 && (i === 0 || n > all[i - 1]))
const rule = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...css.matchAll(new RegExp(`(?:^|[},])\\s*${esc}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(';')
}

// ---- the pure part: which cameras the list shows, and which camera opens -------------------------
let mod = null
try { mod = await import('../public/pb-picker.js') } catch (e) { check('public/pb-picker.js loads', false, e.message) }
if (mod) {
  const { cameraChoices, startCamera, cameraLabel, readLastCamera, saveLastCamera, LAST_CAMERA_KEY } = mod
  const cam = (site, nvr, ch, name, online = true) => ({ site, nvr, nvrName: `${nvr} rec`, ch, name, online })
  const cams = [
    cam('Dock', 'n1', 0, 'Gate'), cam('Dock', 'n1', 1, 'Yard'), cam('Dock', 'n1', 2, 'Old store', false),
    cam('Office', 'n2', 0, 'Reception'), cam('Office', 'n2', 1, 'Gate house'),
    ...Array.from({ length: 300 }, (_, i) => cam('Big', 'n3', i, `Camera ${i + 1}`))
  ]
  const flat = (groups) => groups.flatMap((g) => g.cameras)
  const keys = (groups) => flat(groups).map((c) => `${c.nvr}/${c.ch}`)

  check('nothing typed, all sites: every online camera, none left out (no 50 cap)', flat(cameraChoices(cams)).length === 304, String(flat(cameraChoices(cams)).length))
  check('  offline cameras are not offered', !keys(cameraChoices(cams)).includes('n1/2'))
  check('  but the one being watched stays, marked offline', keys(cameraChoices(cams, { keep: 'n1/2' })).includes('n1/2') && /\(offline\)/.test(cameraLabel(cams[2])))
  check('  grouped by "site · recorder"', cameraChoices(cams).map((g) => g.label).join('|') === 'Dock · n1 rec|Office · n2 rec|Big · n3 rec', cameraChoices(cams).map((g) => g.label).join('|'))
  check('nothing typed, a site chosen in Browse: that site\'s cameras', keys(cameraChoices(cams, { site: 'Office' })).join(',') === 'n2/0,n2/1')
  check('  and the camera being watched, if it is elsewhere', keys(cameraChoices(cams, { site: 'Office', keep: 'n1/0' })).join(',') === 'n1/0,n2/0,n2/1', keys(cameraChoices(cams, { site: 'Office', keep: 'n1/0' })).join(','))
  check('typing finds cameras across all sites, the chosen site\'s first', keys(cameraChoices(cams, { site: 'Office', query: 'gate' })).join(',') === 'n2/1,n1/0', keys(cameraChoices(cams, { site: 'Office', query: 'gate' })).join(','))
  check('  every word must match (name, recorder, site or number)', keys(cameraChoices(cams, { query: 'dock yard' })).join(',') === 'n1/1')
  check('  a search with many answers is not cut short', flat(cameraChoices(cams, { query: 'camera' })).length === 300)
  check('  nothing found: no groups', cameraChoices(cams, { query: 'zzz' }).length === 0)
  check('the label is "number · name"', cameraLabel(cams[1]) === '2 · Yard', cameraLabel(cams[1]))

  check('a link\'s camera opens first (?nvr=&ch=)', startCamera(cams, { nvr: 'n2', ch: '1', last: 'n1/1' })?.name === 'Gate house')
  check('  without one, the camera this browser watched last', startCamera(cams, { last: 'n2/0', site: 'Dock' })?.name === 'Reception')
  check('  unless it is offline or gone: the chosen site\'s first online camera', startCamera(cams, { last: 'n1/2', site: 'Office' })?.name === 'Reception' && startCamera(cams, { last: 'x/9', site: 'Office' })?.name === 'Reception')
  check('  then the first online camera', startCamera(cams, {})?.name === 'Gate')
  check('  and nothing for no cameras', startCamera([], {}) === null)

  const store = new Map()
  const fake = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) }
  saveLastCamera(fake, 'n2/1')
  check('the last camera is kept per browser, under its own key', store.get(LAST_CAMERA_KEY) === 'n2/1' && readLastCamera(fake) === 'n2/1')
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  let threw = false
  try { saveLastCamera(broken, 'n1/0'); check('  storage that throws reads as nothing', readLastCamera(broken) === null) } catch { threw = true }
  check('  and never stops the page', !threw && readLastCamera(null) === null)
  check('  nonsense in storage is ignored', readLastCamera({ getItem: () => '{"x":1}' }) === null)
}

// ---- the picker row ----
const pickers = html.match(/<header class="pb-picker"/g) ?? []
check('playback.html has one picker row, <header class="pb-picker">', pickers.length === 1, String(pickers.length))
const picker = inner(/<header class="pb-picker"[^>]*>/, 'header')
check('  after the page header and before the picture', html.indexOf('class="page-head"') < html.indexOf('class="pb-picker"') && html.indexOf('class="pb-picker"') < html.indexOf('<main class="pb-main"'))
check('  it holds One camera / Many cameras', /class="pb-mode"/.test(picker) && has(picker, 'modeMany'))
check('  then the place Browse is put (.pb-scope), then the find box', rising(picker, ['modeMany']) && picker.indexOf('class="pb-scope"') > at(picker, 'modeMany') && at(picker, 'playbackCameraSearch') > picker.indexOf('class="pb-scope"'))
check('playback.js puts Browse in .pb-scope', /mountCameraBrowser\(\{[\s\S]{0,80}host: document\.querySelector\('\.pb-scope'\)/.test(pb))
const finder = html.match(/<input[^>]*id="playbackCameraSearch"[^>]*>/)?.[0] ?? ''
check('the find box is a combobox over a list of cameras', /role="combobox"/.test(finder) && /aria-controls="cameraList"/.test(finder) && /aria-autocomplete="list"/.test(finder) && /aria-expanded="false"/.test(finder), finder)
check('  with a name for screen readers', /<label[^>]*for="playbackCameraSearch"/.test(picker) || /aria-label="[^"]+"/.test(finder))
check('  the list is a listbox beside it, closed at first', /<ul[^>]*id="cameraList"[^>]*role="listbox"[^>]*hidden/.test(picker) || /<ul[^>]*role="listbox"[^>]*id="cameraList"[^>]*hidden/.test(picker))
check('no Site select, no separate Camera select to look at, no match count', !has(html, 'cameraSite') && !has(html, 'cameraResultCount') && !/<label[^>]*for="camera"/.test(html))
check('  the camera chosen is still held where the page reads it (#camera), out of sight', /<select id="camera"[^>]*hidden/.test(html))
check('  no "first N shown" anywhere', !/first \$\{|shown; refine|CAMERA_RESULT_LIMIT/.test(pb))
check('playback.js takes the list from pb-picker.js (cameraChoices) and mounts the find box', /from '\.\/pb-picker\.js'/.test(pb) && /cameraChoices\(/.test(pb) && /mountCameraFinder\(/.test(pb))
check('  typing does not ask the server: the list is the one already loaded (playbackCams)', /choices: \(query\) => cameraChoices\(playbackCams/.test(pb))
check('the date is not in the picker row', !has(picker, 'date'))

// ---- last camera watched ----
check('it opens on startCamera(…) with the link\'s camera and the last one watched', /startCamera\(cameras, \{ nvr: params\.get\('nvr'\), ch: params\.get\('ch'\), last: readLastCamera\(pageStorage\)/.test(pb))
check('  page storage is reached inside a try (it can throw)', /const pageStorage = \(\(\) => \{ try \{ return window\.localStorage \} catch \{ return null \} \}\)\(\)/.test(pb))
check('  the camera is remembered when it is opened and when it is changed', (pb.match(/saveLastCamera\(pageStorage, /g) ?? []).length >= 2)

// ---- the picture ----
check('css/playback.css is loaded after the older sheets', /href="css\/review\.css"[\s\S]*href="css\/playback\.css"/.test(read('playback.html')))
const video = rule('.playback-page .pb-video')
check('the picture is 16:9 from the start', /aspect-ratio: 16 \/ 9/.test(video), video.trim())
// on a laptop the picture, the bar and the timeline are all on screen together (review, 2026-10-19):
// as wide as the page, unless the height left for it (--pb-room) makes it narrower; never under 480 px
check('  as wide as the page, but no wider than the room under the screen\'s height allows (--pb-room × 16/9)', /width: min\(100%, max\(480px, calc\(var\(--pb-room, calc\(100dvh - \d+px\)\) \* 16 \/ 9\)\)\)/.test(video), video.trim())
check('  narrowed, it sits in the middle', /margin-inline: auto/.test(video))
const fit = pb.match(/function fitPicture\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
check('playback.js measures the room: the column\'s height less what is above the picture and the bar below it', /column\.clientHeight - above - below/.test(fit) && /pbBar\.offsetHeight/.test(fit) && /setProperty\('--pb-room'/.test(fit))
check('  not in full screen (the picture fills the screen there)', /is-fullscreen/.test(fit))
check('  again when the window, the picker row or the bar change size, and on leaving full screen', /addEventListener\('resize', fitPicture\)/.test(pb) && /new ResizeObserver\(\(\) => fitPicture\(\)\)/.test(pb) && /if \(!on\) fitPicture\(\)/.test(pb))
check('  the area round it is not squeezed by the page height (flex: none)', /flex: none/.test(rule('.playback-page .pb-main')), rule('.playback-page .pb-main').trim())
check('  the page scrolls instead', /overflow-y: auto/.test(rule('.playback-page.has-shell .app-main')))
check('  full screen still fills the screen', /aspect-ratio: auto/.test(rule('.playback-page.is-fullscreen .pb-video')) && /width: 100%/.test(rule('.playback-page.is-fullscreen .pb-video')))
// review minors: Escape, Bookmarks' state, the 30 s re-read
const esc = pb.match(/document\.addEventListener\('keydown', \(e\) => \{\r?\n  if \(e\.key !== 'Escape' \|\| moreEl\.hidden\) return[\s\S]*?\}, true\)/)?.[0] ?? ''
check('Escape with More open stops there only when the keyboard is in More or on its button', /if \(inside \|\| focus === moreBtn \|\| !focus \|\| focus === document\.body\) e\.stopPropagation\(\)/.test(esc), esc.slice(0, 80))
check('More is lit while the Bookmarks panel (opened from it) is open', /moreBtn\.classList\.toggle\('pb-on', on\)/.test(pb.match(/function showBookmarkPanel\([\s\S]*?\n\}/)?.[0] ?? ''))
check('the camera list re-read every 30 s refreshes the finder only when something changed', /if \(changed \|\| cameraSel\.value !== was\) cameraFinder\?\.refresh\(\)/.test(pb))
check('a placeholder sits in the picture until the first frame', /<div class="pb-placeholder" id="pbPlaceholder"/.test(inner(/<div class="tile pb-video" id="video"[^>]*>/, 'div')) && /placeholderEl\.hidden = true/.test(pb.match(/function noteStart\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''))

// ---- one bar ----
const bars = html.match(/class="pb-row pb-controls pb-xrow"/g) ?? []
check('one control row under the picture', bars.length === 1)
const row = inner(/<div class="pb-row pb-controls pb-xrow"[^>]*>/, 'div')
const ROW = ['dayPrev', 'date', 'dayNext', 'clock', 'back', 'fwd', 'toStart', 'seqPrev', 'framePrev', 'playBack', 'speedSlider', 'play', 'frameNext', 'seqNext', 'toEnd', 'snapshot', 'selectClip', 'exportClip', 'searchToggle', 'soundQuick', 'fullscreen', 'moreBtn']
check('  in the order ‹ date › time, ±30 s, transport and speed, Snapshot, Mark clip, Draw box, speaker, Full screen, More', rising(row, ROW), ROW.filter((id) => !has(row, id)).join(','))
check('the date appears once, as the date box in the bar', (html.match(/id="date"/g) ?? []).length === 1 && /<input id="date" type="date"/.test(row) && !has(html, 'pbDate') && !/dateEl\b/.test(pb))
const more = inner(/<div id="pbMore"[^>]*>/, 'div')
check('More holds Bookmarks, then Sound with its volume and Filter', rising(more, ['bookmark', 'soundBtn', 'soundExtras', 'soundVol', 'soundFilter']))
check('  and the rest it held: speeds, quality, shuttle, the colour key and the shortcuts', ['speeds', 'quality', 'shuttle', 'legendServer', 'shortcutsBtn'].every((id) => has(more, id)))
check('  it opens from the More button, right beside it', /<button id="moreBtn"[^>]*aria-controls="pbMore"/.test(row) && has(row, 'pbMore') && at(row, 'pbMore') > at(row, 'moreBtn'))
check('  neither is also on the bar outside it', ['bookmark', 'soundBtn'].every((id) => !has(row.replace(more, ''), id)))
// Draw box stays on the bar: the owner looked for it there (2026-10-12, and again for this layout)
check('Draw box is on the bar, after Mark clip, not in More', has(row.replace(more, ''), 'searchToggle') && !has(more, 'searchToggle') && at(row, 'searchToggle') > at(row, 'selectClip'))
// sound that is on can be seen without opening More
const quick = html.match(/<button id="soundQuick"[^>]*>/)?.[0] ?? ''
check('a small speaker on the bar says whether sound is on (aria-pressed), with a name', /aria-pressed="false"/.test(quick) && /aria-label="Sound"/.test(quick) && /class="pb-icon pb-sound-quick"/.test(quick) && !/pb-capped/.test(quick), quick)
check('  it is the same switch as Sound in More', /soundQuick\.addEventListener\('click', \(\) => soundBtn\.click\(\)\)/.test(pb))
const showSoundFn = pb.match(/function showSound\([^)]*\) \{[\s\S]*?\n\}/)?.[0] ?? ''
check('  it follows every change of the sound (showSound)', /soundQuick\.setAttribute\('aria-pressed', String\(sound\.on\)\)/.test(showSoundFn) && /soundQuick\.title = title/.test(showSoundFn))
check('  hidden where Sound is (the server\'s own recordings keep none)', /soundBtn\.hidden = server\r?\n\s*soundQuick\.hidden = server/.test(pb))
check('  a sounding speaker when on, a crossed-out one when off', /\.pb-sound-quick\[aria-pressed="true"\] \.i-sound-on \{ display: block; \}/.test(css) && /\.pb-sound-quick \.i-sound-on, \.pb-sound-quick\[aria-pressed="true"\] \.i-sound-off \{ display: none; \}/.test(css))
const moreJs = pb.match(/\/\/ More: [\s\S]*?\n\/\/ ---- Sound/)?.[0] ?? ''
check('  Escape and a click elsewhere close it, and it says so on the button', /'Escape'/.test(moreJs) && /pointerdown/.test(moreJs) && /setMore\(false\)/.test(moreJs) && /aria-expanded/.test(moreJs))
check('  Bookmarks closes it after its click (its panel opens instead)', /\$\('bookmark'\)\.addEventListener\('click', \(\) => setMore\(false\)\)/.test(moreJs))
const keys = (pb.match(/\ndocument\.addEventListener\('keydown', \(e\) => \{\r?\n  \/\/ a textarea counts too[\s\S]*?\n\}\)/)?.[0] ?? '')
check('every keyboard shortcut still calls what it did', ['togglePause()', 'addBookmark()', 'toggleFullscreen()', 'selectClipStart()', 'selectClipEnd()', 'openClockInput()', 'viewWholeDay()', 'stepSpeed(', 'jumpToEdge(', 'shortcutsDlg.showModal()'].every((s) => keys.includes(s)), String(keys.length))
check('under the bar: the overview, ruler, timeline, then Follow, Playback | Live and the spans', rising(html, ['moreBtn', 'overview', 'ruler', 'timeline', 'followBtn', 'liveLink', 'spanLabel']))

// ---- labels stay inside their buttons ----
const capped = rule('.playback-page .pb-capped')
check('captioned buttons grow to their words (width: auto, no fixed width)', /width: auto/.test(capped) && !/(^|;)\s*width: \d/.test(capped), capped.trim())
check('  the words do not wrap out of them', /white-space: nowrap/.test(rule('.playback-page .pb-cap')))
check('the More menu floats over the picture beside its button, not under the timeline', /position: absolute/.test(rule('.playback-page .pb-more')) && /position: relative/.test(rule('.playback-page .pb-tools')))
check('  in full screen it opens inside the glass bar (which scrolls) instead', /position: static/.test(rule('.playback-page.is-fullscreen .pb-more')))
check('nothing on the page is wider than a phone: the bar\'s groups wrap', /flex-wrap: wrap/.test(rule('.playback-page .pb-xrow')))

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exitCode = failures ? 1 : 0
