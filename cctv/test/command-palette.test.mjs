// cctv/test/command-palette.test.mjs
// Ctrl+K (public/command-palette.js): one box that finds any camera, site, page or settings section.
// The rules are pure and tested here with plain node: what is listed for whom, how typing narrows
// it, where each result goes, and when the shortcut may fire (never while someone is typing).
//   node cctv/test/command-palette.test.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GROUPS, groupResults, itemHref, matches, paletteItems, shortcutOpens } from '../public/command-palette.js'
import { liveHref, readLiveLink } from '../public/pb-bar.js'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }

const cams = [
  { nvr: 'nvr1', ch: 0, name: 'Front Gate', site: 'Harbour', nvrName: 'North', online: true },
  { nvr: 'nvr1', ch: 1, name: 'Yard East', site: 'Harbour', nvrName: 'North', online: false },
  { nvr: 'n 2', ch: 4, name: '', site: 'Depot & Co', nvrName: 'Depot NVR', online: true }
]

// ---- what is listed, and for whom ----
const admin = paletteItems({ me: { admin: true }, cameras: cams })
const viewer = paletteItems({ me: { admin: false }, cameras: cams })
const watcher = paletteItems({ me: { watchOnly: true }, cameras: cams })
const labels = (items, kind) => items.filter((i) => i.kind === kind).map((i) => i.label)
check('groups are Cameras, Sites, Pages, Settings in that order', GROUPS.map((g) => g.id).join() === 'camera,site,page,setting')
check('every camera is listed', labels(admin, 'camera').length === 3)
check('a camera with no name is called by its channel', labels(admin, 'camera').includes('Camera 5'))
check('each site once, from the camera list', labels(admin, 'site').join() === 'Depot & Co,Harbour', labels(admin, 'site').join())
for (const p of ['Live', 'Playback', 'Map', 'Alarms', 'Health', 'Users & access', 'Sites', 'Settings', 'Storage', 'Reports']) check(`an admin can find ${p}`, labels(admin, 'page').includes(p))
for (const s of ['Recording', 'On-screen text', 'Alerts', 'Camera links', 'Remote sites', 'Active Directory', 'Server']) check(`an admin can find the ${s} settings`, labels(admin, 'setting').includes(s))
check('Storage is listed once (it is both a page and a settings section)', admin.filter((i) => i.href === '/settings.html#storage').length === 1)
check('a viewer sees only the pages navFor gives a viewer', labels(viewer, 'page').join() === 'Live,Playback,Map,Alarms,Health', labels(viewer, 'page').join())
check('a viewer gets no settings sections', labels(viewer, 'setting').length === 0)
check('a viewer never gets an admin page', !viewer.some((i) => /audit|settings|sites\.html|reports|storage|cameras\.html|register/.test(i.href)))
check('watch-only: Live, Playback and Map only', labels(watcher, 'page').join() === 'Live,Playback,Map')
check('someone unknown is treated as a viewer', labels(paletteItems({ me: {}, cameras: [] }), 'setting').length === 0 && labels(paletteItems({}), 'page').length === 5)
check('no cameras yet: still the pages', paletteItems({ me: { admin: true }, cameras: null }).some((i) => i.kind === 'page'))

// ---- where each one goes ----
const cam = admin.find((i) => i.label === 'Front Gate')
check('a camera opens Live full-size on that camera', cam.href === '/?nvr=nvr1&ch=0', cam.href)
check('odd characters in an NVR id are escaped', admin.find((i) => i.label === 'Camera 5').href === '/?nvr=n%202&ch=4')
check('a site opens Live showing that site', admin.find((i) => i.label === 'Depot & Co').href === '/?site=Depot%20%26%20Co', admin.find((i) => i.label === 'Depot & Co').href)
check('a page goes to its own address', admin.find((i) => i.label === 'Health').href === '/health.html')
check('a settings section goes to its tab', admin.find((i) => i.label === 'Alerts' && i.kind === 'setting').href === '/settings.html#alerts')
check('itemHref builds a camera link', itemHref({ kind: 'camera', nvr: 'a', ch: 2 }) === '/?nvr=a&ch=2')
check('liveHref takes a site', liveHref({ site: 'Harbour' }) === '/?site=Harbour')
check('a camera still wins over a site', liveHref({ nvr: 'a', ch: 1, site: 'Harbour' }) === '/?nvr=a&ch=1')
check('readLiveLink reads the site back', readLiveLink('?site=Depot%20%26%20Co').site === 'Depot & Co')
check('readLiveLink: no site, none', readLiveLink('?nvr=a&ch=1').site === null)

// ---- typing narrows it ----
check('words in any order', matches(cam, 'gate front') && matches(cam, 'harbour gate'))
check('case does not matter', matches(cam, 'FRONT'))
check('every word must be there', !matches(cam, 'front yard'))
check('the recorder name counts', matches(cam, 'north'))
check('an empty search matches all', matches(cam, '   '))
const g = groupResults(admin, 'harbour')
check('search "harbour": its cameras and the site', g.find((x) => x.id === 'camera')?.items.length === 2 && g.find((x) => x.id === 'site')?.items.length === 1)
check('empty groups are left out', !g.some((x) => x.items.length === 0))
check('groups keep their order', groupResults(admin, 's').map((x) => x.id).join() === GROUPS.map((x) => x.id).filter((id) => groupResults(admin, 's').some((y) => y.id === id)).join())
const empty = groupResults(admin, '')
check('nothing typed: pages and settings, not every camera', !empty.some((x) => x.id === 'camera') && empty.some((x) => x.id === 'page'))
const many = paletteItems({ me: {}, cameras: Array.from({ length: 30 }, (_, i) => ({ nvr: 'n', ch: i, name: `Cam ${i}`, site: 'S' })) })
const capped = groupResults(many, 'cam').find((x) => x.id === 'camera')
check('a long list is cut short with a count of the rest', capped.items.length === 8 && capped.more === 22, `${capped.items.length} +${capped.more}`)
check('nothing matches: no groups', groupResults(admin, 'zzzz').length === 0)

// ---- the shortcut ----
const el = (sel) => ({ closest: (s) => (sel && s.split(',').some((x) => x.trim() === sel) ? {} : null) })
const key = (k, o = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, target: el(null), ...o })
check('Ctrl+K opens it', shortcutOpens(key('k', { ctrlKey: true })))
check('Cmd+K opens it', shortcutOpens(key('k', { metaKey: true })))
check('Ctrl+Shift+K (caps) opens it too', shortcutOpens(key('K', { ctrlKey: true })))
check('plain K does nothing', !shortcutOpens(key('k')))
check('Ctrl+Alt+K is left alone', !shortcutOpens(key('k', { ctrlKey: true, altKey: true })))
check('"/" opens it off Live', shortcutOpens(key('/')))
check('"/" is Live\'s own find box on Live', !shortcutOpens(key('/'), { onLive: true }))
check('Ctrl+K still works on Live', shortcutOpens(key('k', { ctrlKey: true }), { onLive: true }))
for (const f of ['input', 'textarea', 'select', '[contenteditable]']) {
  check(`never while typing in ${f} (Ctrl+K)`, !shortcutOpens(key('k', { ctrlKey: true, target: el(f) })))
  check(`never while typing in ${f} ("/")`, !shortcutOpens(key('/', { target: el(f) })))
}
check('never over another open dialog', !shortcutOpens(key('k', { ctrlKey: true, target: el('dialog') })))
check('never when the page already took the key', !shortcutOpens(key('k', { ctrlKey: true, defaultPrevented: true })))
check('a target with no closest() (the document) is fine', shortcutOpens(key('k', { ctrlKey: true, target: {} })))

// ---- the shell loads it, and gives touch devices a button ----
const shell = readFileSync(join(import.meta.dirname, '..', 'public', 'shell.js'), 'utf8')
check('shell.js loads the palette', /import\(['"]\.\/command-palette\.js['"]\)/.test(shell))
check('the sidebar has a search button', /class="shell-pin shell-search"[^>]*data-open-search/.test(shell))
check('the phone top bar has a search button', /shell-top-search[^>]*data-open-search/.test(shell))
const css = readFileSync(join(import.meta.dirname, '..', 'public', 'css', 'shell.css'), 'utf8')
check('the palette is styled in shell.css (every page with the shell loads it)', css.includes('.cmdk'))
check('the phone search button is finger-sized', /\.shell-top-search\s*{[^}]*width:\s*44px[^}]*height:\s*44px/.test(css))

// ---- it must not disturb the page it opens on ----
// The palette is loaded on every page, so every module it imports runs on every page. settings-tabs.js
// lays out whatever .st-main it finds, and Users & access and Sites share that class: importing it once
// emptied Users & access. Walk the import graph, and import each module with a `document` that throws
// on any touch: a module that does page work when it is imported fails here.
const pub = join(import.meta.dirname, '..', 'public')
const graph = new Set()
const walk = (f) => {
  if (graph.has(f)) return
  graph.add(f)
  const src = readFileSync(join(pub, f), 'utf8')
  for (const m of src.matchAll(/^\s*import\s[^'"]*['"]\.\/([^'"]+)['"]/gm)) walk(m[1])
}
walk('command-palette.js')
check('the palette does not import settings-tabs.js (it lays out the page it runs on)', !graph.has('settings-tabs.js'), [...graph].join(' '))
check('it reads the sections from the data-only settings-sections.js', graph.has('settings-sections.js'))
const deps = [...graph].filter((f) => f !== 'command-palette.js')
const probe = `globalThis.document = new Proxy({}, { get(_, k) { throw new Error('touched document.' + String(k)) } });
globalThis.window = globalThis; globalThis.location = new Proxy({}, { get(_, k) { throw new Error('touched location.' + String(k)) } });
const bad = [];
for (const f of ${JSON.stringify(deps)}) { try { await import(new URL(f, ${JSON.stringify(`file:///${pub.replace(/\\/g, '/')}/`)})) } catch (e) { bad.push(f + ': ' + e.message) } }
console.log(JSON.stringify(bad))`
const { execFileSync } = await import('node:child_process')
let bad = ['(probe did not run)']
try { bad = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' }).trim().split('\n').pop()) } catch (e) { bad = [String(e.message).slice(0, 200)] }
check(`none of the ${deps.length} modules it imports touches the page when imported`, bad.length === 0, bad.join(' | '))
const paletteSrc = readFileSync(join(pub, 'command-palette.js'), 'utf8')
check('Escape in the search stops there (it used to close Live\'s full-size camera too)', /e\.key === 'Escape'\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); dialog\.close\(\) \}/.test(paletteSrc))
check('no key pressed in the search reaches the page (Space on Esc paused Playback)', /dialog\.addEventListener\('keydown', \(e\) => e\.stopPropagation\(\)\)/.test(paletteSrc))

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exitCode = failures ? 1 : 0
