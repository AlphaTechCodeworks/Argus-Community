// Durable atomic replace of a small file: write a temp file, fsync its contents, rename it over the
// target, then best-effort fsync the directory so the rename itself survives a power loss. Rename is
// atomic against a torn write on its own, but without the temp's fsync the bytes may not have reached
// disk, so a crash can leave an empty or short file on reboot. The state files this guards (backfill
// run flag, storage stalls, thin pace) all tolerate a missing file on read, so the worst a lost write
// did was forget learned state — but forgetting it on every power loss is avoidable, and cheap here.
//
// `fs`/`fsp` default to node's; a test passes a stand-in to watch the order (fsync before rename). The
// temp is named per-process so two processes never write the same one; one process serialises its own.
import * as nodeFs from 'node:fs'
import * as nodeFsp from 'node:fs/promises'
import { dirname } from 'node:path'

const tmpName = (file) => `${file}.tmp-${process.pid}`

/** Best-effort fsync of a directory, so a rename in it is durable; never throws (Windows cannot fsync a dir). */
function syncDirSync(dir, fs) {
  let fd
  try {
    fd = fs.openSync(dir, 'r')
    fs.fsyncSync(fd)
  } catch {
    // a platform that will not open a directory for fsync (Windows): the rename is as durable as it gets
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {}
    }
  }
}

/** Writes `data` to `file` atomically and durably (temp + fsync + rename). Throws on an I/O error. */
export function writeFileAtomicSync(file, data, fs = nodeFs, mode = 0o600) {
  const tmp = tmpName(file)
  const fd = fs.openSync(tmp, 'w', mode)
  try {
    fs.fchmodSync?.(fd, mode)
    // every byte, in a loop: one writeSync can return a short count without throwing (Linux, a disk
    // that fills partway), and renaming that short temp over the target would lose its tail for good,
    // as the audit prune did with the newest rows of the trail. The next write after a short one
    // throws ENOSPC, before the rename (2026-10-20, X3-database#0).
    const buf = typeof data === 'string' ? Buffer.from(data) : data
    for (let off = 0; off < buf.length; ) {
      const n = fs.writeSync(fd, buf, off, buf.length - off)
      if (!(n > 0)) throw new Error(`short write to ${tmp}: ${off} of ${buf.length} bytes`)
      off += n
    }
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
  syncDirSync(dirname(file), fs)
}

async function syncDir(dir, fsp) {
  let fh
  try {
    fh = await fsp.open(dir, 'r')
    await fh.sync()
  } catch {
    // Windows: directories cannot be fsynced; the rename is as durable as it gets
  } finally {
    if (fh) {
      try {
        await fh.close()
      } catch {}
    }
  }
}

/** Writes `data` to `file` atomically and durably (temp + fsync + rename). Rejects on an I/O error. */
export async function writeFileAtomic(file, data, fsp = nodeFsp, mode = 0o600) {
  const tmp = tmpName(file)
  const fh = await fsp.open(tmp, 'w', mode)
  try {
    await fh.chmod?.(mode)
    await fh.writeFile(data)
    await fh.sync()
  } finally {
    await fh.close()
  }
  await fsp.rename(tmp, file)
  await syncDir(dirname(file), fsp)
}
