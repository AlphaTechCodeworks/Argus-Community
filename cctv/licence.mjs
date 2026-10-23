// Argus Pro licensing: a signed licence file, verified entirely offline, bound to this server and to
// the site's recorders, with a per-camera allowance. Design: docs/superpowers/specs/2026-10-21-licensing-design.md.
//
// A licence is a JSON document { payload, sig, keyId }. `sig` is an Ed25519 signature (Node's own
// crypto, no dependency) over the canonical JSON of `payload`, made by the owner's PRIVATE key; the
// app holds only the matching PUBLIC key (licence-keys.mjs), so it can tell a genuine licence from a
// forged one but can never mint one. No network is used, so an air-gapped CCTV box works.
//
// Binding is deliberately TOLERANT, because the customer is an honest business, not a cracker, and
// hardware changes: valid while the server's machine-id matches, one licensed server MAC is still
// present, AND (if the licence names recorders) one licensed recorder MAC is still seen. A clone
// moved to another site talks to different recorders and fails; swapping a camera or one recorder
// does not lock anyone out.
//
// PROD-SAFE: with no licence file at all, status is `none` and everything is allowed — the current
// server behaves exactly as before licensing existed.
import { readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { createHash, verify as edVerify } from 'node:crypto'
import { LICENCE_KEYS } from './licence-keys.mjs'

// ---- canonical JSON (shared with the signing tool) ---------------------------------------------
// Deterministic, key-sorted JSON so the bytes signed and the bytes verified are identical whatever
// order the fields were written in. Arrays keep their order; only object keys are sorted.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value) // string/number/boolean/null
}

// ---- machine fingerprint -----------------------------------------------------------------------
const VIRTUAL_IF = /^(lo$|tailscale|docker|veth|virbr|wg|br-|tun|tap|bond|dummy|vmnet|vnet|kube|cni|flannel|zt)/i
const norm = (mac) => String(mac ?? '').trim().toLowerCase()
const isZero = (mac) => /^(00:){5}00$/.test(mac) || mac === ''

/**
 * The server's physical NIC MACs from a list of interfaces, each { name, address, type, virtual }.
 * Keeps only real ethernet (type '1'), drops loopback, known-virtual names, interfaces flagged
 * virtual, and unset (all-zero) MACs. Lower-cased, de-duplicated, sorted. Pure, so it is tested
 * directly without /sys.
 */
export function physicalMacs(ifaces) {
  const out = new Set()
  for (const i of ifaces ?? []) {
    if (!i || i.virtual || VIRTUAL_IF.test(i.name ?? '')) continue
    if (String(i.type ?? '1') !== '1') continue // 1 = ARPHRD_ETHER
    const mac = norm(i.address)
    if (!isZero(mac) && /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac)) out.add(mac)
  }
  return [...out].sort()
}

/** Reads /sys/class/net to describe each interface (name, address, type, whether it is virtual). */
function readInterfaces(netDir, fs) {
  const out = []
  let names = []
  try { names = fs.readdirSync(netDir) } catch { return out }
  for (const name of names) {
    const read = (f) => { try { return String(fs.readFileSync(`${netDir}/${name}/${f}`, 'utf8')).trim() } catch { return '' } }
    // A virtual interface's /sys entry is a symlink into .../devices/virtual/...; readlink is the
    // most reliable "is this real hardware" test, with the name pattern as a backstop.
    let virtual = false
    try { virtual = /\/devices\/virtual\//.test(fs.readlinkSync(`${netDir}/${name}`)) } catch { /* not a link we can read: fall back to the name */ }
    out.push({ name, address: read('address'), type: read('type'), virtual })
  }
  return out
}

/**
 * This server's fingerprint: its machine-id (the stable anchor) and its physical MACs. Reads only
 * world-readable files, so it works as the restricted service user, and never throws.
 * @returns {{ machineId: string, serverMacs: string[] }}
 */
export function readMachineFingerprint({ fs = { readFileSync, readdirSync, readlinkSync }, netDir = '/sys/class/net', machineIdPaths = ['/etc/machine-id', '/var/lib/dbus/machine-id'] } = {}) {
  let machineId = ''
  for (const p of machineIdPaths) {
    try { machineId = String(fs.readFileSync(p, 'utf8')).trim(); if (machineId) break } catch { /* try the next */ }
  }
  return { machineId, serverMacs: physicalMacs(readInterfaces(netDir, fs)) }
}

// ---- fingerprint id (what the customer reads out) ----------------------------------------------
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
function base32(bytes) {
  let bits = 0, value = 0, out = ''
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8
    while (bits >= 5) { out += CROCKFORD[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31]
  return out
}
/** A short, human-readable code for the owner to tie a licence to (ARGUS-XXXX-XXXX-XXXX). */
export function fingerprintId({ machineId, serverMacs }) {
  const h = createHash('sha256').update(`${machineId}|${[...(serverMacs ?? [])].map(norm).sort().join(',')}`).digest()
  const s = base32(h.subarray(0, 9)).slice(0, 12) // 9 bytes = 72 bits ≥ 12 base32 chars
  return `ARGUS-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`
}

// ---- verify + status ---------------------------------------------------------------------------
function parse(fileText) {
  let doc
  try { doc = JSON.parse(fileText) } catch { return null }
  if (!doc || typeof doc !== 'object' || typeof doc.sig !== 'string' || typeof doc.keyId !== 'string' || !doc.payload || typeof doc.payload !== 'object') return null
  return doc
}

const some = (a, b) => { const set = new Set((b ?? []).map(norm)); return (a ?? []).some((x) => set.has(norm(x))) }

/**
 * Work out the licence status for this machine. `context` carries what the server sees right now:
 *   machine: { machineId, serverMacs }          (readMachineFingerprint)
 *   nvrs: [{ id, mac, serial }]                 (the recorders currently reachable)
 *   cameraCount: number                         (configured cameras across all recorders)
 * `keys` maps keyId → public PEM (defaults to the baked-in LICENCE_KEYS). `now` is injectable.
 * @returns {{ status, edition?, customer?, features?, maxCameras?, cameraCount?, expiry?, fingerprintId? }}
 */
export function licenceStatus(fileText, context = {}, keys = LICENCE_KEYS, now = Date.now) {
  const fp = context.machine ? fingerprintId(context.machine) : undefined
  if (fileText == null || fileText === '') return { status: 'none', edition: null, fingerprintId: fp }

  const doc = parse(fileText)
  if (!doc) return { status: 'malformed', fingerprintId: fp }
  const pub = keys[doc.keyId]
  if (!pub) return { status: 'unknown-key', fingerprintId: fp }
  let ok = false
  try { ok = edVerify(null, Buffer.from(canonical(doc.payload)), pub, Buffer.from(doc.sig, 'base64')) } catch { ok = false }
  if (!ok) return { status: 'bad-signature', fingerprintId: fp }

  const p = doc.payload
  // From here the licence is genuine; carry its details through whatever the verdict, so the UI can
  // explain (e.g. "this Pro licence for Acme is for a different machine").
  const info = { edition: p.edition ?? 'pro', customer: p.customer ?? '', custId: p.custId ?? '', features: p.features ?? [], maxCameras: p.maxCameras ?? null, expiry: p.expiry ?? null, cameraCount: context.cameraCount ?? null, fingerprintId: fp }
  const verdict = (status) => ({ status, ...info })

  if (p.expiry != null && now() > Number(p.expiry)) return verdict('expired')
  const m = context.machine ?? {}
  if (!p.machineId || p.machineId !== m.machineId || !some(p.serverMacs, m.serverMacs)) return verdict('wrong-machine')
  // Site binding: the licence names the site's recorders by MAC and/or serial; it is valid while at
  // least one named recorder is still present, matched by EITHER (a recorder's MAC may be unknown but
  // its serial known, or the reverse). A licence that names no recorders is server-only and skips this.
  const licensedRecorders = [...(p.nvrMacs ?? []), ...(p.nvrSerials ?? [])]
  if (licensedRecorders.length) {
    const seen = (context.nvrs ?? []).flatMap((n) => [n.mac, ...(n.macs ?? []), n.serial].filter(Boolean))
    if (!some(licensedRecorders, seen)) return verdict('wrong-site')
  }
  if (p.maxCameras != null && Number(context.cameraCount ?? 0) > Number(p.maxCameras)) return verdict('over-cameras')
  return verdict('active')
}

/**
 * Whether a feature is permitted under a computed status. v1 is lenient and NOTHING gates on this
 * yet (feature-gating arrives with the Community edition): `none` allows everything; a present,
 * genuine licence (`active`/`over-cameras`) allows the features it lists; anything else allows
 * nothing. Callers added later decide grace behaviour.
 */
export function allows(status, feature) {
  if (!status || status.status === 'none') return true
  if (status.status === 'active' || status.status === 'over-cameras') return (status.features ?? []).includes(feature)
  return false
}
