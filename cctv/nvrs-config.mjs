// The NVR list: data/nvrs.json, every NVR's address, login and password (mode 0600, never sent to a
// browser). Read and written here, with no SDK, so its handling can be tested on any machine: nvrs.mjs
// (which loads the TVT SDK) re-exports these for nvr.mjs, admin.mjs and nvr-worker.mjs, and watches
// the file.
import { chownSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DATA_DIR } from './auth.mjs'
import { writeFileAtomicSync } from './atomic-write.mjs'

export const NVRS_FILE = join(DATA_DIR, 'nvrs.json')

/** @returns {{ nvrs: Array<{ id: string, site: string, name: string, host: string, port: number, user: string, password: string, sn?: string }> }} (sn: reached by serial number through the P2P cloud; host/port are then not used) */
export const readConfig = () => {
  if (!existsSync(NVRS_FILE)) return { nvrs: [] }
  const cfg = JSON.parse(readFileSync(NVRS_FILE, 'utf8'))
  return { nvrs: Array.isArray(cfg.nvrs) ? cfg.nvrs : [] }
}

/**
 * The owner a save must put back on the file: when root saves it (`sudo node cctv/nvr.mjs ...`), the
 * new file is root's, and a root-owned 0600 list is one the service (its own user) cannot read.
 * Written in place, the file kept its owner whoever saved it; a renamed-in one does not. null: none.
 */
export const ownerToKeep = (file, { uid = process.getuid?.(), stat = statSync } = {}) => {
  if (uid !== 0) return null
  try {
    const st = stat(file)
    return st.uid === 0 && st.gid === 0 ? null : { uid: st.uid, gid: st.gid }
  } catch {
    return null // no file yet: whoever makes it owns it, as before
  }
}

// A new file renamed over the old one (atomic-write.mjs, mode 0600), as users, rights and settings are
// saved. It was the old file emptied and written again: a save on a full disk (or two saves at once,
// the app's and nvr.mjs's) left it empty or cut short, and then the Sites page could not even list,
// a worker that restarted could not start, and the next start had no NVRs at all, every password lost
// (2026-10-20, G4-config-file-durability-and-cli-tools#0). Now a failed save leaves the list as it was.
// The watchers (nvrs.mjs watchFile, nvr-worker, hik-worker) read by path, so they see the new file.
export const writeConfig = (cfg) => {
  mkdirSync(dirname(NVRS_FILE), { recursive: true })
  const owner = ownerToKeep(NVRS_FILE)
  writeFileAtomicSync(NVRS_FILE, `${JSON.stringify(cfg, null, 2)}\n`)
  // (the moment between the rename and this: the service's poll that hits it cannot read the file,
  // keeps the NVRs it has, and is told again by the owner changing)
  if (owner) chownSync(NVRS_FILE, owner.uid, owner.gid)
}
