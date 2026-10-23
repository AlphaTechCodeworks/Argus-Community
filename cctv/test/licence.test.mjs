// Offline tests for licence.mjs: no machine, no NVR, no real keys — a test keypair is made here and
// the public half is handed in, so this runs on a Windows development PC as well as on the server.
//   node cctv/test/licence.test.mjs
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import {
  canonical, physicalMacs, fingerprintId, licenceStatus, allows
} from '../licence.mjs'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }

// ---- a throwaway signing key, as the real tool would make ---------------------------------------
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const PUB_PEM = publicKey.export({ type: 'spki', format: 'pem' })
const KEYS = { 'argus-test': PUB_PEM }
const KEYS_OTHER = { 'argus-test': generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }) }

function make(payload, { key = privateKey, keyId = 'argus-test' } = {}) {
  const sig = edSign(null, Buffer.from(canonical(payload)), key).toString('base64')
  return JSON.stringify({ payload, sig, keyId })
}
const T0 = Date.UTC(2026, 9, 21, 12, 0, 0)
const basePayload = {
  v: 1, edition: 'pro', features: ['detection', 'smart', 'counting'],
  maxCameras: 64, machineId: 'MID-AAA', serverMacs: ['aa:bb:cc:00:11:22'],
  nvrMacs: ['cc:dd:ee:00:00:01', 'cc:dd:ee:00:00:02'], nvrSerials: ['NB8AA056TDBC'],
  customer: 'Acme Port Ltd', issuedAt: T0 - 86_400_000, expiry: null
}
// the machine as the server would read it, and the recorders currently seen
const CTX = {
  machine: { machineId: 'MID-AAA', serverMacs: ['aa:bb:cc:00:11:22', 'de:ad:be:ef:00:01'] },
  nvrs: [{ id: 'nvr1', mac: 'cc:dd:ee:00:00:02', serial: 'NB8AA056TDBC' }, { id: 'nvr2', mac: 'ff:ff:ff:00:00:09' }],
  cameraCount: 40
}
const now = () => T0
const S = (file, ctx = CTX) => licenceStatus(file, ctx, KEYS, now)

// ---- canonical JSON ----------------------------------------------------------------------------
check('canonical sorts keys, same bytes regardless of input order',
  canonical({ b: 1, a: { d: 4, c: 3 } }) === canonical({ a: { c: 3, d: 4 }, b: 1 }) &&
  canonical({ b: 1, a: { d: 4, c: 3 } }) === '{"a":{"c":3,"d":4},"b":1}')
check('canonical keeps array order', canonical({ x: [3, 1, 2] }) === '{"x":[3,1,2]}')

// ---- physical MAC filtering --------------------------------------------------------------------
{
  const ifaces = [
    { name: 'lo', address: '00:00:00:00:00:00', type: '772', virtual: true },
    { name: 'ens34', address: 'AA:BB:CC:00:11:22', type: '1', virtual: false },
    { name: 'ens37', address: 'aa:bb:cc:00:11:33', type: '1', virtual: false },
    { name: 'tailscale0', address: 'bb:00:00:00:00:00', type: '65534', virtual: true },
    { name: 'docker0', address: '02:42:ab:cd:ef:00', type: '1', virtual: true },
    { name: 'veth1a2b', address: '7a:11:22:33:44:55', type: '1', virtual: true },
    { name: 'ens38', address: '00:00:00:00:00:00', type: '1', virtual: false } // unset MAC
  ]
  const macs = physicalMacs(ifaces)
  check('physical MACs: only real ethernet, lower-cased, sorted, de-duped',
    JSON.stringify(macs) === JSON.stringify(['aa:bb:cc:00:11:22', 'aa:bb:cc:00:11:33']), JSON.stringify(macs))
  check('physical MACs: drops lo, virtual (tailscale/docker/veth) and all-zero', !macs.includes('bb:00:00:00:00:00') && !macs.includes('02:42:ab:cd:ef:00') && !macs.some((m) => /^00:00:00/.test(m)))
}

// ---- fingerprintId -----------------------------------------------------------------------------
{
  const a = fingerprintId({ machineId: 'MID-AAA', serverMacs: ['aa:bb:cc:00:11:22'] })
  const b = fingerprintId({ machineId: 'MID-AAA', serverMacs: ['aa:bb:cc:00:11:22'] })
  const c = fingerprintId({ machineId: 'MID-BBB', serverMacs: ['aa:bb:cc:00:11:22'] })
  check('fingerprintId deterministic', a === b)
  check('fingerprintId changes with the machine', a !== c)
  check('fingerprintId shape ARGUS-XXXX-XXXX-XXXX', /^ARGUS-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(a), a)
  check('fingerprintId order of MACs does not matter',
    fingerprintId({ machineId: 'M', serverMacs: ['a', 'b'] }) === fingerprintId({ machineId: 'M', serverMacs: ['b', 'a'] }))
}

// ---- status: the happy path and every failure --------------------------------------------------
check('no file → none, and allows everything', (() => {
  const st = S(undefined); return st.status === 'none' && allows(st, 'detection') && allows(st, 'anything')
})())
check('no file → none for empty string too', S('').status === 'none')

{
  const st = S(make(basePayload))
  check('valid, right machine, a recorder present, under camera limit → active', st.status === 'active', st.status)
  check('active carries edition/customer/maxCameras', st.edition === 'pro' && st.customer === 'Acme Port Ltd' && st.maxCameras === 64, JSON.stringify(st))
  check('active allows a licensed feature and not an unlisted one', allows(st, 'detection') && !allows(st, 'teleport'))
}
check('malformed JSON → malformed', S('{not json').status === 'malformed')
check('missing payload/sig → malformed', S(JSON.stringify({ hello: 1 })).status === 'malformed')
check('unknown keyId → unknown-key', S(make(basePayload, { keyId: 'nope' })).status === 'unknown-key')
check('signed by a different key → bad-signature', licenceStatus(make(basePayload), CTX, KEYS_OTHER, now).status === 'bad-signature')
check('tampered payload (one field changed after signing) → bad-signature', (() => {
  const good = JSON.parse(make(basePayload)); good.payload.maxCameras = 9999; return S(JSON.stringify(good)).status === 'bad-signature'
})())
check('expired → expired', S(make({ ...basePayload, expiry: T0 - 1 })).status === 'expired')
check('perpetual (expiry null) never expires', S(make({ ...basePayload, expiry: null })).status === 'active')
check('wrong machine-id → wrong-machine', S(make({ ...basePayload, machineId: 'OTHER' })).status === 'wrong-machine')
check('right machine-id but no licensed server MAC present → wrong-machine',
  S(make({ ...basePayload, serverMacs: ['99:99:99:99:99:99'] })).status === 'wrong-machine')
check('server matches but none of the licensed recorders present → wrong-site',
  S(make({ ...basePayload, nvrMacs: ['11:11:11:11:11:11'], nvrSerials: ['ZZZZNOPE'] })).status === 'wrong-site')
check('server-only licence (no recorders named) skips the site check → active',
  S(make({ ...basePayload, nvrMacs: [], nvrSerials: [] })).status === 'active')
check('over the camera limit → over-cameras, but still licensed (allows features)', (() => {
  const st = licenceStatus(make({ ...basePayload, maxCameras: 10 }), CTX, KEYS, now)
  return st.status === 'over-cameras' && allows(st, 'detection')
})())
check('maxCameras null → unlimited, never over', S(make({ ...basePayload, maxCameras: null })).status === 'active')
check('a swapped secondary recorder still validates (one of two still present)',
  S(make({ ...basePayload, nvrMacs: ['cc:dd:ee:00:00:02', 'was:removed:00:00:00'] })).status === 'active')
// site binding matches a recorder by MAC OR serial (a recorder's MAC may be unknown but its serial known)
check('binds by recorder serial when no MAC matches (serial present in the licence and on the NVR)',
  S(make({ ...basePayload, nvrMacs: [], nvrSerials: ['NB8AA056TDBC'] })).status === 'active')
check('wrong-site when neither a licensed MAC nor serial is present',
  S(make({ ...basePayload, nvrMacs: ['11:11:11:11:11:11'], nvrSerials: ['ZZZZNOPE'] })).status === 'wrong-site')

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exitCode = failures ? 1 : 0
