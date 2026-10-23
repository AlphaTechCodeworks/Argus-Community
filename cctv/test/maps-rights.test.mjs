// Which maps a user is shown (maps.mjs handleMapsRead with a rights view). A map is where each
// camera is and what it covers, so its blind spots too: a viewer limited to one site used to get
// every site's placements and every floor plan. Pure: a temp data folder, no NVR, no SDK.
//   node cctv/test/maps-rights.test.mjs
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'

let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}

const DATA = mkdtempSync(join(tmpdir(), 'cctv-maps-rights-'))
process.env.DATA_DIR = DATA // maps.mjs reads it when first imported
const cone = (x, y) => ({ x, y, dir: 0, fov: 90, range: 10 })
const PLAN_A = 'aaaaaaaaaaaaaaaa.jpg'
const PLAN_B = 'bbbbbbbbbbbbbbbb.jpg'
writeFileSync(join(DATA, 'maps.json'), JSON.stringify({
  sites: {
    'IT Office': { mode: 'plan', plan: { file: PLAN_A, w: 100, h: 100, cams: { 'warehouse/0': cone(1, 1), 'nvr1/3': cone(2, 2) } }, geo: { lat: 1, lng: 2, zoom: 3, layer: 'street', cams: { 'warehouse/0': { lat: 1, lng: 2, dir: 0, fov: 90, range: 10 }, 'nvr1/3': { lat: 1, lng: 2, dir: 0, fov: 90, range: 10 } } } },
    'Main site': { mode: 'plan', plan: { file: PLAN_B, w: 100, h: 100, cams: { 'nvr1/0': cone(3, 3) } } }
  }
}))
mkdirSync(join(DATA, 'maps'), { recursive: true })
for (const f of [PLAN_A, PLAN_B]) writeFileSync(join(DATA, 'maps', f), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))

const { handleMapsRead } = await import('../maps.mjs')

/**
 * One request through handleMapsRead: the status and, for JSON, the body. A plan image is answered
 * once its file is open, so this waits for the response to end (or be destroyed); a response that
 * never ends gives up after two seconds with what it had.
 */
const get = (pathname, view) => new Promise((resolve) => {
  const out = { status: 0, body: null, bytes: 0, destroyed: false }
  const done = () => {
    clearTimeout(giveUp)
    resolve(out)
  }
  const giveUp = setTimeout(done, 2000)
  // a real writable, so createReadStream(...).pipe(res) behaves as it does on an http response
  const res = new Writable({
    write(chunk, _enc, cb) {
      out.bytes += chunk.length
      cb()
    }
  })
  res.headersSent = false
  res.writeHead = (s) => {
    out.status = s
    res.headersSent = true
    return res
  }
  res.on('finish', done)
  res.on('close', () => {
    out.destroyed = !res.writableFinished
    done()
  })
  const sendJson = (r, s, data) => {
    out.status = s
    out.body = data
    done()
  }
  handleMapsRead(pathname, res, sendJson, {}, view)
})

// a viewer who may see only the IT Office's camera warehouse/0
const viewer = { canSee: (nvr) => nvr === 'warehouse', siteVisible: (s) => s === 'IT Office' }
{
  const { body } = await get('/api/maps', viewer)
  check('a viewer gets only the site they may see', Object.keys(body?.sites ?? {}).join() === 'IT Office', Object.keys(body?.sites ?? {}).join())
  check('...and in it only their own camera\'s placement', Object.keys(body?.sites?.['IT Office']?.plan?.cams ?? {}).join() === 'warehouse/0')
  check('...on the street map as well', Object.keys(body?.sites?.['IT Office']?.geo?.cams ?? {}).join() === 'warehouse/0')
  check('another site\'s floor plan is 404', (await get(`/api/maps/plan/${PLAN_B}`, viewer)).status === 404)
  check('their own site\'s plan is served', (await get(`/api/maps/plan/${PLAN_A}`, viewer)).status === 200)
}
// an admin (view null) sees everything
{
  const { body } = await get('/api/maps', null)
  check('an admin gets every site', Object.keys(body.sites).sort().join() === 'IT Office,Main site')
  check('...with every camera', Object.keys(body.sites['IT Office'].plan.cams).length === 2)
  check('...and every plan', (await get(`/api/maps/plan/${PLAN_A}`, null)).status === 200 && (await get(`/api/maps/plan/${PLAN_B}`, null)).status === 200)
}
// a viewer with no grants at all
{
  const none = { canSee: () => false, siteVisible: () => false }
  check('a viewer with no cameras gets no sites', JSON.stringify((await get('/api/maps', none)).body) === '{"sites":{}}')
  check('...and no plan', (await get(`/api/maps/plan/${PLAN_A}`, none)).status === 404 && (await get(`/api/maps/plan/${PLAN_B}`, none)).status === 404)
}
check('an unknown plan is still 404 for an admin', (await get('/api/maps/plan/cccccccccccccccc.jpg', null)).status === 404)

// FAIL CLOSED: a caller that forgets the view hook entirely (the 5th argument left out, not an
// explicit null) must get nothing, never every site as an admin would. Admin is only ever the
// explicit null server.mjs passes for who.admin.
{
  const forgot = await get('/api/maps') // view left undefined, as a caller who forgot the hook would
  check('a forgotten view hook: no sites, not every site', JSON.stringify(forgot.body) === '{"sites":{}}', JSON.stringify(forgot.body))
  check('...and no plan either', (await get(`/api/maps/plan/${PLAN_A}`)).status === 404 && (await get(`/api/maps/plan/${PLAN_B}`)).status === 404)
}

// S9-hik-rtsp-maps-settings#0 (2026-10-20): a plan that is gone or unreadable by the time it is
// opened is answered, never left as an 'error' nobody listens for. That was an uncaught exception,
// and the server has no handler for those on purpose (process-guard.mjs): opening the Map page
// restarted the whole service. Here the plan is pruned between the existence check and the open
// (a new plan uploaded at that moment removes the old one): the file goes as soon as the handler
// returns, before the read stream's open has run.
{
  const PLAN_C = 'cccccccccccccccd.jpg'
  const file = join(DATA, 'maps', PLAN_C)
  writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))
  const ok = await get(`/api/maps/plan/${PLAN_C}`, null)
  check('a readable plan: 200 and the whole picture', ok.status === 200 && ok.bytes === 6, JSON.stringify(ok))
  const uncaught = []
  const onUncaught = (e) => uncaught.push(e)
  process.on('uncaughtException', onUncaught)
  const answer = get(`/api/maps/plan/${PLAN_C}`, null)
  unlinkSync(file)
  const gone = await answer
  await new Promise((r) => setTimeout(r, 50)) // (an error emitted late still has time to land)
  process.off('uncaughtException', onUncaught)
  check('a plan pruned before it opens: no uncaught error (the server would have ended)', uncaught.length === 0, uncaught[0]?.message)
  check('...and the viewer is told 404, not sent a 200 that never ends', gone.status === 404, JSON.stringify(gone))
}

// source-shape: server.mjs always hands handleMapsRead an explicit view (null for who.admin, the
// rights hook otherwise) rather than leaving the argument out and falling on the fail-closed default
{
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
  check(
    'server.mjs passes handleMapsRead an explicit view (who.admin ? null : { canSee, siteVisible })',
    /handleMapsRead\(pathname, res, sendJson, SECURITY_HEADERS, who\.admin \? null : \{ canSee, siteVisible \}\)/.test(server)
  )
}

rmSync(DATA, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
