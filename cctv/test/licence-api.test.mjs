// licence-api.mjs with an in-memory filesystem and injected providers, so it runs on Windows.
//   node cctv/test/licence-api.test.mjs
import { createPrivateKey, generateKeyPairSync, sign as edSign } from 'node:crypto'
import { canonical } from '../licence.mjs'
import { makeLicence, MAX_LICENCE_BYTES } from '../licence-api.mjs'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const KEYS = { 'argus-2026': publicKey.export({ type: 'spki', format: 'pem' }) }
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' })
const T0 = Date.UTC(2026, 9, 21, 12, 0, 0)

// A licence as the owner's signing tool makes one (that tool is not shipped with Community): the
// payload with its MACs normalised and defaults filled, signed over its canonical form.
const lc = (s) => String(s).trim().toLowerCase()
function buildPayload({ edition = 'pro', customer = '', custId = '', maxCameras = null, machineId, serverMacs = [], nvrMacs = [], nvrSerials = [], features = ['detection', 'smart', 'counting'], expiry = null, issuedAt } = {}) {
  return {
    v: 1, edition, features: [...features], maxCameras: maxCameras == null ? null : Number(maxCameras), machineId: String(machineId ?? ''),
    serverMacs: [...new Set(serverMacs.map(lc))].sort(), nvrMacs: [...new Set(nvrMacs.map(lc))].sort(),
    nvrSerials: [...new Set(nvrSerials.map((s) => String(s).trim().toUpperCase()))].sort(),
    customer: String(customer), custId: String(custId || ''), issuedAt: Number(issuedAt ?? Date.now()), expiry: expiry == null ? null : Number(expiry)
  }
}
function signLicence(payload, privateKeyPem, keyId = 'argus-2026') {
  const sig = edSign(null, Buffer.from(canonical(payload)), createPrivateKey(privateKeyPem)).toString('base64')
  return JSON.stringify({ payload, sig, keyId }, null, 2) + '\n'
}

// in-memory fs the service writes through
function memFs() {
  const files = new Map()
  return {
    files,
    readFileSync: (p) => { if (!files.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return files.get(p) },
    existsSync: (p) => files.has(p),
    rmSync: (p) => { files.delete(p) },
    writeFileAtomicSync: (p, data) => { files.set(p, String(data)) }
  }
}

const MACHINE = { machineId: 'MID-AAA', serverMacs: ['aa:bb:cc:00:11:22'] }
const RECORDERS = [{ id: 'n1', mac: 'cc:dd:ee:00:00:02', macs: ['cc:dd:ee:00:00:02'], serial: 'NB8AA056TDBC' }]
let audited = []
function svc(fs = memFs()) {
  audited = []
  return makeLicence({ dataDir: '/data', fs, keys: KEYS, now: () => T0, machine: () => MACHINE, recorders: async () => RECORDERS, cameraCount: () => 40, audit: (e) => audited.push(e) })
}
const licence = (over = {}) => JSON.parse(signLicence(buildPayload({ edition: 'pro', customer: 'Acme Port Ltd', maxCameras: 64, machineId: 'MID-AAA', serverMacs: ['aa:bb:cc:00:11:22'], nvrMacs: ['cc:dd:ee:00:00:02'], issuedAt: T0 - 1000, ...over }), priv, 'argus-2026'))

// ---- unlicensed (prod default) -----------------------------------------------------------------
{
  const L = svc()
  const [code, body] = await L.handle('GET', '/api/licence', { admin: true })
  check('GET with no file → 200, status none, name Argus Community', code === 200 && body.status === 'none' && body.appName === 'Argus Community')
  check('GET returns the fingerprint to send the owner', body.fingerprint.id && body.fingerprint.machineId === 'MID-AAA' && body.fingerprint.nvrSerials.includes('NB8AA056TDBC'), JSON.stringify(body.fingerprint))
  check('unlicensed: edition null, appName Argus Community, allows everything', L.edition() === null && L.appName() === 'Argus Community' && L.allows('detection'))
  const [c2] = await L.handle('GET', '/api/licence', { admin: false })
  check('non-admin is refused', c2 === 403)
  check('a different path is not ours', (await L.handle('GET', '/api/other', { admin: true })) === null)
}

// ---- install a good licence --------------------------------------------------------------------
{
  const fs = memFs(); const L = svc(fs)
  const [code, body] = await L.handle('POST', '/api/licence', { admin: true, body: licence(), user: 'mike', ip: '10.0.0.5' })
  check('POST a genuine licence → 200 active', code === 200 && body.status === 'active', JSON.stringify(body))
  check('it rebrands to Argus Pro and names the customer', body.appName === 'Argus Pro' && body.customer === 'Acme Port Ltd' && body.maxCameras === 64)
  check('it was stored on disk', fs.files.has(L.FILE))
  check('install is audited', audited.length === 1 && audited[0].action === 'licence-install' && audited[0].user === 'mike')
  check('edition/appName/allows now reflect the licence', L.edition() === 'pro' && L.appName() === 'Argus Pro' && L.allows('detection') && !L.allows('teleport'))
}

// ---- rejects forgeries and junk, keeps the old state -------------------------------------------
{
  const L = svc()
  check('POST junk → 400', (await L.handle('POST', '/api/licence', { admin: true, body: { nope: 1 } }))[0] === 400)
  const tampered = licence(); tampered.payload.maxCameras = 9999
  check('POST a tampered licence → 400, not stored', (await L.handle('POST', '/api/licence', { admin: true, body: tampered }))[0] === 400)
  const big = licence(); big.payload.customer = 'x'.repeat(MAX_LICENCE_BYTES)
  check('POST an over-size licence → 413', (await L.handle('POST', '/api/licence', { admin: true, body: big }))[0] === 413)
}

// ---- wrong machine is still a genuine licence (stored, warned) ---------------------------------
{
  const fs = memFs(); const L = svc(fs)
  const [code, body] = await L.handle('POST', '/api/licence', { admin: true, body: licence({ machineId: 'SOMEONE-ELSE' }) })
  check('a genuine licence for another machine is stored but shows wrong-machine', code === 200 && body.status === 'wrong-machine' && fs.files.has(L.FILE))
  check('a wrong-machine licence does NOT rebrand (stays Argus Community)', body.appName === 'Argus Community' && L.appName() === 'Argus Community')
}

// ---- delete ------------------------------------------------------------------------------------
{
  const fs = memFs(); const L = svc(fs)
  await L.handle('POST', '/api/licence', { admin: true, body: licence() })
  const [code, body] = await L.handle('DELETE', '/api/licence', { admin: true, user: 'mike' })
  check('DELETE → 200 none, file gone, audited', code === 200 && body.status === 'none' && !fs.files.has(L.FILE) && audited.some((a) => a.action === 'licence-remove'))
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exitCode = failures ? 1 : 0
