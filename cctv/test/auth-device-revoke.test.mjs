// A phone or TV set up by a set-up code (setup-codes.mjs, a 10-year session) is signed out with its
// user: an admin's Sign out, a password change and an account removed and made again all end it, as
// they end an ordinary 7-day sign-in. verifySession took every token's issue time as expiry - 7 days,
// which for a device token is years ahead of any `since`, so none of them did (audit 2026-10-20
// X2-security#0). The token keeps its three parts, so the devices already set up are covered too.
//
// Temp data folder only; no NVR, no SDK, no network. The clock is held still (Date.now), so the
// same-millisecond cases happen every run, not by chance.
//   node cctv/test/auth-device-revoke.test.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// auth.mjs reads DATA_DIR (users.json, the session secret) when it is first imported
const dir = mkdtempSync(join(tmpdir(), 'cctv-auth-device-'))
process.env.DATA_DIR = dir
const auth = await import('../auth.mjs')
const { DEVICE_SESSION_MS } = await import('../setup-codes.mjs')

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }

const realNow = Date.now
let clock = realNow()
Date.now = () => clock
const DAY = 24 * 60 * 60_000
const device = (user) => auth.createSession(user, DEVICE_SESSION_MS)

try {
  const hash = await auth.hashPassword('first-password-1')
  auth.saveUsers({ phone: { hash, role: 'viewer', since: clock - 60_000 }, boss: { hash, role: 'admin', since: clock - 60_000 } })

  // ---- an admin's Sign out ------------------------------------------------------------------------
  const dev = device('phone')
  const bossDev = device('boss')
  check('a device token has the same three parts as any session (no format change)', dev.split('.').length === 3)
  check('a device token issued after `since` signs in', auth.verifySession(dev) === 'phone')
  const day = auth.createSession('phone')
  clock += 1000
  check('(an admin signs the user out)', auth.signOutUser('phone') === true)
  check('the device set up by code is signed out with them', auth.verifySession(dev) === null)
  check('...as their ordinary sign-in is', auth.verifySession(day) === null)
  check('an ordinary sign-in made in the same millisecond as the sign-out works', auth.verifySession(auth.createSession('phone')) === 'phone')
  check('a device set up again after the sign-out works', auth.verifySession(device('phone')) === 'phone')
  check('another user\'s device is not touched', auth.verifySession(bossDev) === 'boss')

  // ---- a password change ----------------------------------------------------------------------------
  clock += 1000
  const dev2 = device('phone')
  clock += 1000
  check('(the user changes their password)', (await auth.changePassword('phone', 'first-password-1', 'second-password-2'))?.ok === true)
  check('the device is signed out by the password change', auth.verifySession(dev2) === null)
  check('a sign-in after it works', auth.verifySession(auth.createSession('phone')) === 'phone')

  // An admin's reset (users-api.mjs: a temporary password, mustChangePassword, `since` moved on), then
  // the user's own new password: the device stays out after both, not only until the second.
  clock += 1000
  const dev3 = device('phone')
  clock += 1000
  {
    const users = auth.loadUsers()
    users.phone = { ...users.phone, hash: await auth.hashPassword('temporary-pass-3'), mustChangePassword: true, since: Math.max(Date.now() + 1, (users.phone.since || 0) + 1) }
    auth.saveUsers(users)
  }
  check('after an admin resets the password the device is refused', auth.verifySession(dev3) === null && auth.verifySession(dev3, { allowPasswordChange: true }) === null)
  clock += 1000
  check('(the user picks their own new password)', (await auth.changePassword('phone', 'temporary-pass-3', 'fourth-password-4'))?.ok === true)
  check('...and the device stays signed out', auth.verifySession(dev3) === null)

  // ---- an account removed and made again ------------------------------------------------------------
  clock += 1000
  const dev4 = device('phone')
  check('(a fresh device for the viewer works)', auth.verifySession(dev4) === 'phone')
  clock += 1000
  { const users = auth.loadUsers(); delete users.phone; auth.saveUsers(users) }
  check('a removed account\'s device is refused', auth.verifySession(dev4) === null)
  clock += 1000
  { const users = auth.loadUsers(); users.phone = { hash, role: 'admin', since: Date.now() }; auth.saveUsers(users) }
  check('(the name is made again, as an admin)', auth.isAdmin('phone'))
  check('the earlier viewer\'s device does not sign in as the new admin', auth.verifySession(dev4) === null)
  check('the new account\'s own device works', auth.verifySession(device('phone')) === 'phone')

  // ---- what did not change ------------------------------------------------------------------------
  clock += 1000
  const week = auth.createSession('phone')
  const longDev = device('phone')
  clock += 6 * DAY
  check('an ordinary sign-in near the end of its 7 days still works', auth.verifySession(week) === 'phone')
  clock += 2 * DAY
  check('...and runs out after them', auth.verifySession(week) === null)
  clock += 400 * DAY
  check('a device token over a year old still works while nobody signs it out', auth.verifySession(longDev) === 'phone')
  check('(signed out over a year on)', auth.signOutUser('phone') === true)
  check('...and is signed out then', auth.verifySession(longDev) === null)

  // an account made before `since` existed keeps its sessions, a device's among them
  auth.saveUsers({ ...auth.loadUsers(), old: { hash, role: 'viewer' } })
  check('an account without `since` keeps its device session', auth.verifySession(device('old')) === 'old')

  // ---- the clock steps back ---------------------------------------------------------------------------
  // An NTP step after boot or a VM resume can put the clock back a while: a 7-day sign-in made before the
  // step then has over 7 days left. Taken for a device's, it was dated 10 years back and refused, so
  // someone who had just signed in was signed out (2026-10-20, final review of X2-security#0)
  clock += 1000
  const beforeStep = auth.createSession('phone')
  clock -= 2 * 60 * 60_000
  check('an ordinary sign-in still works after the clock steps back 2 hours', auth.verifySession(beforeStep) === 'phone')
  clock -= 3 * DAY
  check('...or 3 days', auth.verifySession(beforeStep) === 'phone')
  const stepDev = device('phone')
  check('(a device set up after the step works)', auth.verifySession(stepDev) === 'phone')
  check('...and is still signed out with its user', auth.signOutUser('phone') === true && auth.verifySession(stepDev) === null)
} finally {
  Date.now = realNow
  rmSync(dir, { recursive: true, force: true })
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exitCode = failures ? 1 : 0
