// The Settings page's layout (settings.html, settings-tabs.js, settings.js, storage.js, style.css):
// a side list of its sections on a laptop and a "Section" dropdown on a phone, so the section you are
// in is always on screen (a deep link to Server once landed with its tab scrolled out of sight on a
// phone); the per-camera recording table folded away until a camera is set differently; one clear
// "No storage set up" card; and the long explanations behind "How this works", word for word.
// No browser and no SDK: runs anywhere.
//   node cctv/test/settings-layout.test.mjs
import { readFileSync } from 'node:fs'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }
const pub = new URL('../public/', import.meta.url)
const read = (f) => readFileSync(new URL(f, pub), 'utf8')
const html = read('settings.html')
const tabsJs = read('settings-tabs.js')
const settingsJs = read('settings.js')
const storageJs = read('storage.js')
const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '')
const squash = (t) => t.replace(/\s+/g, ' ').trim()

// ---- the sections: same ids, same order, same addresses -------------------------------------------
const { TABS, tabFor } = await import('../public/settings-tabs.js')
const IDS = ['recording', 'storage', 'overlay', 'alerts', 'links', 'connector', 'directory', 'licence', 'server']
const LABELS = ['Recording', 'Storage', 'On-screen text', 'Alerts', 'Camera links', 'Remote sites', 'Active Directory', 'Licence', 'Server']
check('the sections, in order, with their names', JSON.stringify(TABS?.map((t) => t.id)) === JSON.stringify(IDS) && JSON.stringify(TABS.map((t) => t.label)) === JSON.stringify(LABELS), JSON.stringify(TABS?.map((t) => t.id)))
const inPage = [...new Set([...html.matchAll(/<section class="se-section" data-tab="([\w-]+)"/g)].map((m) => m[1]))]
check('every section of the page belongs to one of them, and each has a section', inPage.every((id) => IDS.includes(id)) && IDS.every((id) => inPage.includes(id)), inPage.join(','))

// ---- deep links ----------------------------------------------------------------------------------
check('a deep link lands on its section (#storage, #alerts, #server)', ['storage', 'alerts', 'server'].every((id) => tabFor(`#${id}`)?.id === id))
check('... with or without the #', tabFor('directory')?.id === 'directory')
check('no hash, or one that is not a section, shows Recording', tabFor('')?.id === 'recording' && tabFor('#nope')?.id === 'recording' && tabFor(undefined)?.id === 'recording')
const redirect = read('storage.html')
check('storage.html still sends old links to Settings > Storage', /http-equiv="refresh" content="0; url=\/settings\.html#storage"/.test(redirect) && /href="\/settings\.html#storage"/.test(redirect))

// ---- side list and dropdown ------------------------------------------------------------------------
check('the page builds a side list of the sections (.se-menu) of links', /className = 'se-menu'/.test(tabsJs) && /a\.href = `#\$\{t\.id\}`/.test(tabsJs))
check('... marking the one shown aria-current="page"', /setAttribute\('aria-current', 'page'\)/.test(tabsJs) && /removeAttribute\('aria-current'\)/.test(tabsJs))
check('... and a "Section" dropdown that goes to the section picked', /'Section'/.test(tabsJs) && /createElement\('select'\)/.test(tabsJs) && /location\.hash = /.test(tabsJs))
check('... and no row of tabs any more (it hid later sections off the side of a phone)', !/tabs-ui/.test(tabsJs))
check('the dropdown follows the section shown (a deep link, Back)', /pick\.value = tab\.id/.test(tabsJs))
check('the sections move into the layout, so nothing in them is rebuilt (forms keep what is typed)', /\.append\([^)]*\.\.\.sections\)/.test(tabsJs))
const wide = /@media \(min-width: 900px\) \{(\s*\.se-layout[\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
check('900 px and wider: the list on the left, the section on the right', /\.se-layout \{[^}]*grid-template-columns:[^;]*minmax\(0, 1fr\)/.test(wide), wide.slice(0, 200))
check('... and no dropdown there', /\.se-pick \{[^}]*display: none/.test(wide))
check('narrower: no side list, the dropdown instead', /\.se-menu \{[^}]*display: none/.test(css.replace(wide, '')) && /\.se-pick \{[^}]*display: flex/.test(css.replace(wide, '')))
check('the selected section in the list is marked with the accent', /\.se-menu a\[aria-current="page"\] \{[^}]*var\(--accent/.test(css))

// ---- Recording: the per-camera table folded -------------------------------------------------------
const rec = html.match(/<section class="se-section" data-tab="recording"[\s\S]*?<\/section>/)?.[0] ?? ''
const fold = rec.match(/<details id="camFold"[\s\S]*?<\/details>/)?.[0] ?? ''
check('Recording: the per-camera table sits behind "Set a camera differently"', /<summary>[\s\S]*Set a camera differently[\s\S]*<\/summary>/.test(fold) && ['cams', 'camSearch', 'camChanged', 'saveCams', 'c-msg'].every((id) => fold.includes(`id="${id}"`)), fold.slice(0, 160))
check('... folded in the page (closed when no camera is set differently)', !/<details id="camFold"[^>]*\sopen/.test(rec))
check('... and opened when some camera is (once, on load: a fold someone closed stays closed)', /\$\('camFold'\)\.open = cameras\.some\(\(c\) => setDifferently\(/.test(settingsJs))

// ---- Storage: one card when there is none ---------------------------------------------------------
const card = html.match(/<article id="sr-empty"[\s\S]*?<\/article>/)?.[0] ?? ''
check('Storage: a "No storage set up" card with an "Add a location" button', /No storage set up/.test(card) && /<button[^>]*id="sr-add"[^>]*>Add a location<\/button>/.test(card) && /<article id="sr-empty"[^>]*\shidden/.test(card), card.slice(0, 200))
check('... and hidden really is hidden (its own display: flex would otherwise win over [hidden])', /\.sr-empty\[hidden\] \{[^}]*display: none/.test(css))
check('... shown when there are no locations (the overview\'s own count)', /getElementById\('sr-empty'\)\.hidden = !r\.empty/.test(storageJs))
check('... and by the location list, whichever answers first', /\$\('sr-empty'\)\.hidden = locations\.length > 0/.test(settingsJs))
check('... and only once: the location list no longer says it again', !/No storage locations yet: nothing can be recorded/.test(settingsJs))
check('"Add a location" opens the add-a-folder form and puts the cursor in it', /\$\('sr-add'\)\.addEventListener\('click'/.test(settingsJs) && /\$\('addFold'\)\.open = true/.test(settingsJs) && /\$\('l-path'\)\.focus\(/.test(settingsJs) && /<details id="addFold"/.test(html))

// ---- "How this works" -----------------------------------------------------------------------------
// The words as they were before the move, each of which must now be inside a "How this works".
const MOVED = [
  'Off for every camera until you turn it on here. Motion and AI modes record continuously until event support arrives.',
  'The two jobs that rewrite and delete recordings on purpose, every 5 minutes while the server records: time-lapse turns footage past its full-video days into one picture every few seconds, and retention deletes footage past its total days. The days are set on the Recording tab. These two jobs keep bookmarked and exported stretches.',
  'Separate from this switch, and whatever it is set to: the clean-up rules delete the oldest footage when a location runs low on space or goes over its space limit (set on each location below), and footage past a camera\'s total days, except bookmarked and exported stretches (a bookmark keeps the cameras it names; the automatic ones around line crossings end with their camera\'s total days).',
  'Each holds a marker file; a location without it (drive unplugged, share down) is never written and recording moves to the next one. Each can have a space limit for Argus\'s recordings and free-space marks of its own.',
  'The space limit is enforced: when Argus\'s recordings on a location go over it, the oldest are deleted down to it from the next clean-up (every 5 minutes, at most about 240 GB each), footage past its full-video days first; never the newest 24 hours, nor bookmarked or exported stretches. It is in GB of 1,000,000,000 bytes, at most the size of the drive or share. A limit saved before limits were enforced (29 September 2026) is not enforced until it is saved again on its card. Below a location\'s low mark, footage past its full-video days is deleted; below its hard floor, any footage, oldest first, and recording moves elsewhere. Empty: no limit, and the default marks (Clean-up rules, below).',
  'The whole share is mounted under /srv/cctv-net and, if you name a folder inside it, that folder is used. Test first: it mounts, writes a file, reads it back and undoes everything. The password is only ever held by the machine itself, never by this page and never in the settings file.',
  'Only drives that are not the system disk, not mounted and not in a pool are offered.'
]
const HOW = /<details class="se-more se-how">\s*<summary>How this works<\/summary>([\s\S]*?)<\/details>/g
const recStore = [...html.matchAll(/<section class="se-section" data-tab="(?:recording|storage)"[\s\S]*?<\/section>/g)].map((m) => m[0]).join('\n')
const hows = [...recStore.matchAll(HOW)].map((m) => squash(m[1].replace(/<[^>]+>/g, ' ')).replace(/ ([.,:;)])/g, '$1'))
for (const t of MOVED) check(`kept word for word in "How this works": ${t.slice(0, 50)}…`, hows.some((h) => h.includes(t)))
// what is left showing: one short sentence each, not a wall of text
const visible = recStore.replace(HOW, '')
const long = [...visible.matchAll(/<p class="(?:st-help|hp-note)[^"]*"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => squash(m[1].replace(/<[^>]+>/g, ''))).filter((t) => t.length > 120)
check('Recording and Storage show no long explanation outside "How this works"', long.length === 0, long.map((t) => t.slice(0, 60)).join(' | '))
check('each "How this works" has a short line showing above it', [...recStore.matchAll(/<p class="st-help">([^<]{10,120})<\/p>\s*(?:<!--[\s\S]*?-->\s*)?<details class="se-more se-how">/g)].length === hows.length, `${hows.length} disclosures`)


// ---- tick boxes beside their words, everywhere --------------------------------------------------------
// Page sheets lay field labels out as a column (words above the field); on Settings > Alerts that put
// each "Tell me about" box above its words (2026-10-19). One rule in css/components.css puts every
// label holding a tick box or radio button on one line, and it must outweigh every column rule.
const { readdirSync } = await import('node:fs')
const components = read('css/components.css').replace(/\/\*[\s\S]*?\*\//g, '')
const INLINE = 'label:has(> input:is([type="checkbox"][type], [type="radio"][type]))'
const inline = components.match(new RegExp(INLINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + String.raw`\s*\{([^}]*)\}`))?.[1] ?? ''
check('components.css: a label holding a tick box or radio is a row, box first', /display: flex/.test(inline) && /flex-direction: row/.test(inline), inline)
// specificity as (ids, classes/attributes/pseudo-classes, elements); :is/:not/:has count their argument
const spec = (sel) => {
  const s = sel.replace(/:(?:is|not|has|where)\(/g, '(').replace(/::[\w-]+/g, ' x')
  return [(s.match(/#[\w-]+/g) ?? []).length, (s.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) ?? []).length, (s.replace(/\[[^\]]+\]|\.[\w-]+|#[\w-]+|:[\w-]+/g, ' ').match(/\b[a-z][\w-]*\b/g) ?? []).length]
}
const heavier = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
const mine = spec(INLINE)
const sheetFiles = [...readdirSync(pub).filter((f) => f.endsWith('.css')), ...readdirSync(new URL('css/', pub)).filter((f) => f.endsWith('.css')).map((f) => `css/${f}`)]
// heavier rules whose labels never hold a tick box, each with what they do hold
const HOLDS_NO_BOX = new Set([
  '.live-page.has-shell .app-main > header .live-display > label' // Live's Layout dropdown (index.html)
])
const beats = []
for (const f of sheetFiles) {
  const text = read(f).replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/flex-direction:\s*column|display:\s*(block|grid)/.test(m[2])) continue
    for (const sel of m[1].split(',').map((x) => x.trim().replace(/^@media[^{]*$/, ''))) {
      if (!/(^|[\s>])label$/.test(sel)) continue
      if (heavier(spec(sel), mine) >= 0 && !HOLDS_NO_BOX.has(sel)) beats.push(`${f}: ${sel}`)
    }
  }
}
check('... and no page sheet\'s column rule for labels outweighs it', beats.length === 0, beats.join(' | '))

// ---- the alert kinds in plain words -------------------------------------------------------------------
const kinds = JSON.parse(`[${/export const KINDS = Object\.freeze\(\[([\s\S]*?)\]\)/.exec(readFileSync(new URL('../alerts.mjs', import.meta.url), 'utf8'))[1].replace(/'/g, '"')}]`)
const kindText = /const KIND_TEXT = \{([\s\S]*?)\n\}/.exec(settingsJs)?.[1] ?? ''
const missing = kinds.filter((k) => !new RegExp(`'${k}':`).test(kindText))
check('Settings > Alerts: every kind the server offers has words, none shows its id', kinds.length > 10 && missing.length === 0, missing.join(', '))
check('... the two storage forecasts as asked', /'drive-filling': 'the drive is filling faster than expected'/.test(kindText) && /'retention-short': "recordings won't last the target days"/.test(kindText))

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
