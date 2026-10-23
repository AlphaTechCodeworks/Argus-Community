// Tests for nvrs-config.mjs: data/nvrs.json, the list of NVRs with every address and password. A save
// is a new file renamed over the old one (atomic-write.mjs), never the old file truncated and written
// again: a save on a full disk emptied it and then failed, and the next start came up with no NVRs and
// no way back from the app (2026-10-20, G4-config-file-durability-and-cli-tools#0).
// Temp data folder only; no SDK, so this runs on any machine.
//   node cctv/test/nvrs-config.test.mjs
import fs, { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = mkdtempSync(join(tmpdir(), 'cctv-nvrs-config-'))
process.env.DATA_DIR = join(ROOT, 'data') // not there yet: the first save makes it
const M = await import('../nvrs-config.mjs')
const { NVRS_FILE, readConfig, writeConfig } = M

let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}
const J = JSON.stringify
const nvr = (id) => ({ id, site: 'Test site', name: id.toUpperCase(), host: `${id}.invalid`, port: 6036, user: 'u', password: 'p' })

// ---- an ordinary save ----------------------------------------------------------------------------
check('no file yet: no NVRs', J(readConfig()) === J({ nvrs: [] }))
writeConfig({ nvrs: [nvr('n1'), nvr('n2')] })
check('a save makes the data folder and the file', existsSync(NVRS_FILE))
check('... and reads back as saved', J(readConfig().nvrs.map((n) => n.id)) === J(['n1', 'n2']))
// Windows has no POSIX modes (node reports 0666 whatever was asked for); Linux is where it matters
const mode = statSync(NVRS_FILE).mode & 0o777
check(process.platform === 'win32' ? 'nvrs.json mode: not checked on Windows' : 'nvrs.json is mode 0600 (it holds NVR passwords)', process.platform === 'win32' || mode === 0o600, mode.toString(8))
writeConfig({ nvrs: [nvr('n1')] })
check('a second save replaces the list', J(readConfig().nvrs.map((n) => n.id)) === J(['n1']))
const beside = () => readdirSync(process.env.DATA_DIR).filter((n) => n.startsWith('nvrs.json')).join()
check('... and leaves no temp file beside it', beside() === 'nvrs.json', beside())

// ---- a save on a full disk -----------------------------------------------------------------------
// What a full disk does: opening a file for writing still works (and 'w' empties it), then the write
// fails with ENOSPC. Both of node's write paths are made to behave so; the module's own imports see it
// through syncBuiltinESMExports.
{
  const real = { writeFileSync: fs.writeFileSync, writeSync: fs.writeSync }
  const enospc = () => Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
  fs.writeFileSync = (file, ...rest) => {
    if (typeof file !== 'string' || !file.startsWith(process.env.DATA_DIR)) return real.writeFileSync(file, ...rest)
    fs.closeSync(fs.openSync(file, 'w')) // emptied, as the real call's open does
    throw enospc()
  }
  fs.writeSync = () => {
    throw enospc()
  }
  syncBuiltinESMExports()
  let error = null
  try {
    writeConfig({ nvrs: [nvr('n1'), nvr('n3')] })
  } catch (e) {
    error = e
  } finally {
    Object.assign(fs, real)
    syncBuiltinESMExports()
  }
  check('a save on a full disk fails with the disk\'s error', error?.code === 'ENOSPC', error?.message)
  let after = null
  try {
    after = readConfig().nvrs.map((n) => n.id)
  } catch (e) {
    after = `unreadable: ${e.message}`
  }
  check('... and nvrs.json still holds the list from before it (every NVR and password kept)', J(after) === J(['n1']), J(after))
  check('... byte for byte', readFileSync(NVRS_FILE, 'utf8') === `${J({ nvrs: [nvr('n1')] }, null, 2)}\n`)
  writeConfig({ nvrs: [nvr('n1'), nvr('n3')] })
  check('the next save, with room again, goes through', J(readConfig().nvrs.map((n) => n.id)) === J(['n1', 'n3']))
}

// ---- root saving the service's file keeps its owner --------------------------------------------------
// Written in place, the file kept its owner whoever saved it. A renamed-in file is its writer's: after
// `sudo node cctv/nvr.mjs ...` it would be root's, mode 0600, and the service (its own user) could not
// read the NVR list at all. So when root saves, the old file's owner is put back on the new one.
{
  const keep = M.ownerToKeep
  check('ownerToKeep is there', typeof keep === 'function')
  if (typeof keep === 'function') {
    const statOf = (uid, gid) => () => ({ uid, gid })
    const missing = () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }
    check('root saving a file the service owns: its owner is kept', J(keep(NVRS_FILE, { uid: 0, stat: statOf(1000, 1000) })) === J({ uid: 1000, gid: 1000 }))
    check('root saving a root-owned file: nothing to put back', keep(NVRS_FILE, { uid: 0, stat: statOf(0, 0) }) === null)
    check('root making the first file: nothing to put back (as before)', keep(NVRS_FILE, { uid: 0, stat: missing }) === null)
    check('the service saving its own file: nothing to put back', keep(NVRS_FILE, { uid: 1000, stat: statOf(1000, 1000) }) === null)
    check('Windows (no uids): nothing to put back', keep(NVRS_FILE, { uid: undefined, stat: statOf(0, 0) }) === null)
  }
  const src = readFileSync(new URL('../nvrs-config.mjs', import.meta.url), 'utf8')
  check('writeConfig puts the kept owner back on the saved file', /const owner = ownerToKeep\(NVRS_FILE\)[\s\S]*?writeFileAtomicSync\(NVRS_FILE[\s\S]*?if \(owner\) chownSync\(NVRS_FILE, owner\.uid, owner\.gid\)/.test(src))
}

// ---- every save of the list goes through writeConfig ------------------------------------------------
{
  const dir = new URL('../', import.meta.url)
  const writers = readdirSync(dir)
    .filter((f) => f.endsWith('.mjs') && f !== 'nvrs-config.mjs')
    .filter((f) => /write\w*\(\s*(NVRS_FILE|[^,)]*['"`]nvrs\.json['"`])/.test(readFileSync(new URL(f, dir), 'utf8')))
  check('no other module writes nvrs.json itself (nvr.mjs and admin.mjs save through writeConfig)', writers.length === 0, writers.join())
  const nvrs = readFileSync(new URL('nvrs.mjs', dir), 'utf8')
  check('nvrs.mjs hands out this module\'s writeConfig', /import \{ NVRS_FILE, readConfig, writeConfig \} from '\.\/nvrs-config\.mjs'/.test(nvrs) && /export \{ NVRS_FILE, readConfig, writeConfig \}/.test(nvrs))
}

rmSync(ROOT, { recursive: true, force: true })
console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
