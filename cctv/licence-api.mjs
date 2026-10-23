// The licence service the server wires in: it holds the current status (cheaply, from a short cache so
// /api/me stays fast), serves the Licence page's GET/POST/DELETE, and tells the app its edition and
// name. PROD-SAFE: with no licence.json the status is `none`, edition null, name "Argus".
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomicSync } from './atomic-write.mjs'
import { licenceStatus, fingerprintId, allows as licAllows } from './licence.mjs'
import { LICENCE_KEYS } from './licence-keys.mjs'

const APP_NAMES = { pro: 'Argus Pro', community: 'Argus Community' }
// The Community build names itself so even with no licence installed.
export const UNLICENSED_NAME = 'Argus Community'
export const MAX_LICENCE_BYTES = 64 * 1024

/**
 * @param {object} o
 * @param {string} o.dataDir                         where licence.json lives
 * @param {() => {machineId,serverMacs}} o.machine    this server's fingerprint (read once; it is fixed at runtime)
 * @param {() => Promise<{id,mac,macs,serial}[]>} o.recorders  the recorders currently seen (nvrIdentities)
 * @param {() => number} o.cameraCount                configured cameras across all recorders
 * @param {object} [o.keys]  public keys (defaults to the baked-in set); [o.now]; [o.audit]; [o.fs]; [o.ttlMs]
 */
export function makeLicence({ dataDir, machine, recorders, cameraCount, keys = LICENCE_KEYS, now = Date.now, audit = () => {}, ttlMs = 60_000, fs = { readFileSync, existsSync, rmSync, writeFileAtomicSync } }) {
  const FILE = join(dataDir, 'licence.json')
  const readFile = () => { try { return fs.readFileSync(FILE, 'utf8') } catch { return null } }
  let machineCache
  const machineFp = () => (machineCache ??= machine())

  let cache = null // { status, at }
  async function compute() {
    let nvrs = []
    try { nvrs = await recorders() } catch { nvrs = [] }
    let count = 0
    try { count = Number(cameraCount()) || 0 } catch { count = 0 }
    return licenceStatus(readFile(), { machine: machineFp(), nvrs, cameraCount: count }, keys, now)
  }
  async function refresh() { const status = await compute(); cache = { status, at: now() }; return status }
  async function status() { return (cache && now() - cache.at < ttlMs) ? cache.status : refresh() }
  /** The last computed status without awaiting (for the hot /api/me path); triggers a background refresh when stale. */
  function statusNow() {
    if (!cache) { refresh().catch(() => {}); return { status: 'unknown', edition: null } }
    if (now() - cache.at >= ttlMs) refresh().catch(() => {})
    return cache.status
  }
  const effectiveEdition = (st) => ((st.status === 'active' || st.status === 'over-cameras') ? (st.edition ?? 'pro') : null)
  const edition = () => effectiveEdition(statusNow())
  const appName = () => APP_NAMES[edition()] ?? UNLICENSED_NAME
  const allows = (feature) => licAllows(statusNow(), feature)

  async function fingerprint() {
    let nvrs = []
    try { nvrs = await recorders() } catch { nvrs = [] }
    const m = machineFp()
    return {
      id: fingerprintId(m),
      machineId: m.machineId,
      serverMacs: m.serverMacs,
      nvrMacs: [...new Set(nvrs.flatMap((n) => n.macs ?? []).filter(Boolean))].sort(),
      nvrSerials: [...new Set(nvrs.map((n) => n.serial).filter(Boolean))].sort()
    }
  }

  function present(st) {
    return { status: st.status, edition: st.edition ?? null, appName: APP_NAMES[effectiveEdition(st)] ?? UNLICENSED_NAME, customer: st.customer ?? null, custId: st.custId ?? null, maxCameras: st.maxCameras ?? null, cameraCount: st.cameraCount ?? null, expiry: st.expiry ?? null, fingerprintId: st.fingerprintId ?? null }
  }

  /**
   * Routes under /api/licence (admin only). `body` is the already-parsed JSON object for POST.
   * @returns {Promise<[number, object]|null>} null when the path is not ours.
   */
  async function handle(method, pathname, { admin, body, user = 'system', ip = '' } = {}) {
    if (pathname !== '/api/licence') return null
    if (!admin) return [403, { error: 'Admins only' }]

    if (method === 'GET') {
      const st = await refresh()
      return [200, { ...present(st), fingerprint: await fingerprint() }]
    }
    if (method === 'POST') {
      if (!body || typeof body !== 'object' || typeof body.sig !== 'string' || !body.payload) return [400, { error: 'That is not an Argus licence file.' }]
      const text = JSON.stringify(body)
      if (Buffer.byteLength(text) > MAX_LICENCE_BYTES) return [413, { error: 'That licence file is too large.' }]
      // Only store a genuine, cryptographically-valid licence; a licence for a different machine is
      // still stored (the page shows the warning), but forgeries/garbage are refused.
      const check = licenceStatus(text, { machine: machineFp(), nvrs: [], cameraCount: 0 }, keys, now)
      if (['malformed', 'unknown-key', 'bad-signature'].includes(check.status)) {
        return [400, { error: check.status === 'unknown-key' ? 'This licence was signed by an unknown key.' : 'This licence could not be verified — check you uploaded the right file.' }]
      }
      fs.writeFileAtomicSync(FILE, text, undefined, 0o600)
      const st = await refresh()
      audit({ user, action: 'licence-install', ip, detail: `${st.edition ?? 'licence'} for ${st.customer || 'customer'} (${st.status})` })
      return [200, present(st)]
    }
    if (method === 'DELETE') {
      if (fs.existsSync(FILE)) { try { fs.rmSync(FILE) } catch {} audit({ user, action: 'licence-remove', ip }) }
      const st = await refresh()
      return [200, present(st)]
    }
    return [405, { error: 'Method not allowed' }, { allow: 'GET, POST, DELETE' }]
  }

  return { status, statusNow, refresh, edition, appName, allows, fingerprint, present, handle, FILE }
}
