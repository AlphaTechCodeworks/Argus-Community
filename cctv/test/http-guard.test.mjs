// Plain HTTP is for this machine only (http-guard.mjs, audit 2026-10-20 S1a-core-http#2): the
// watchers, install scripts and RTSP server on the box keep port 8080 as before; an office PC that
// opens it is sent to https, and the sign-in cookie takes Secure from the connection itself or a
// proxy on this machine, never from a header anyone can send.
//   node cctv/test/http-guard.test.mjs
import { readFileSync } from 'node:fs'
import { isSecureRequest, plainHttpAction } from '../http-guard.mjs'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }

// a request as node's HTTP server hands it over: the peer, the address it reached (a different one
// from the Host the browser sent, so the tests tell them apart), its Host and path. null: not there
const req = ({ peer = '192.0.2.50', local = '::ffff:192.0.2.20', encrypted = false, host = '192.0.2.10:8080', url = '/', headers = {} } = {}) => ({
  socket: { ...(peer === null ? {} : { remoteAddress: peer }), localAddress: local, ...(encrypted ? { encrypted: true } : {}) },
  headers: { ...(host === null ? {} : { host }), ...headers },
  url
})
const opts = { publicUrl: 'https://cctv.example', httpsPort: '8443', lanAllowed: false }
const show = (a) => JSON.stringify(a)

// this machine itself: served exactly as before
for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
  check(`this machine (${peer}) on plain HTTP is served`, plainHttpAction(req({ peer, host: '127.0.0.1:8080', url: '/healthz' }), opts) === null)
}
check('... with no public address set too', plainHttpAction(req({ peer: '127.0.0.1', url: '/login.html' }), { ...opts, publicUrl: '' }) === null)

// anyone else: a 308 to https, the same path and query
{
  const a = plainHttpAction(req({ url: '/login.html?x=1' }), opts)
  check('an office PC is sent to the public https address, same path and query', a?.status === 308 && a?.location === 'https://cctv.example/login.html?x=1', show(a))
  const post = plainHttpAction(req({ url: '/api/login' }), opts)
  check('... its sign-in POST too (never answered over plain HTTP; 308 keeps the method)', post?.status === 308 && post?.location === 'https://cctv.example/api/login', show(post))
  const root = plainHttpAction(req({ url: '/' }), { ...opts, publicUrl: 'https://cctv.example/' })
  check('... a public address ending in / gives no double slash', root?.location === 'https://cctv.example/', show(root))
  const ipv4mapped = plainHttpAction(req({ peer: '::ffff:192.0.2.50', url: '/' }), opts)
  check('... an IPv4 office PC seen as ::ffff: is not this machine', ipv4mapped?.status === 308, show(ipv4mapped))
  const near = plainHttpAction(req({ peer: '127.0.0.2', url: '/' }), opts)
  check('... nor is another 127.x address (only the one the watchers use)', near?.status === 308, show(near))
  const nopeer = plainHttpAction(req({ peer: null, url: '/' }), opts)
  check('... nor a socket with no peer address', nopeer?.status === 308, show(nopeer))
}

// no https public address: the name the visitor typed, on the HTTPS port
{
  const a = plainHttpAction(req({ host: '192.0.2.10:8080', url: '/index.html?view=a' }), { ...opts, publicUrl: '' })
  check('no public address: the name the browser used, on HTTPS_PORT', a?.status === 308 && a?.location === 'https://192.0.2.10:8443/index.html?view=a', show(a))
  const named = plainHttpAction(req({ host: 'cctv-server', url: '/' }), { ...opts, publicUrl: '' })
  check('... a host name without a port', named?.location === 'https://cctv-server:8443/', show(named))
  const v6 = plainHttpAction(req({ peer: '2001:db8::50', host: '[2001:db8::10]:8080', url: '/' }), { ...opts, publicUrl: '' })
  check('... an IPv6 address keeps its brackets', v6?.location === 'https://[2001:db8::10]:8443/', show(v6))
  const http = plainHttpAction(req({ url: '/x' }), { ...opts, publicUrl: 'http://cctv.example' })
  check('a public address on plain http is not a target: the host-based https one is used', http?.location === 'https://192.0.2.10:8443/x', show(http))
  const junk = plainHttpAction(req({ host: 'evil.example\r\nSet-Cookie: a=b', url: '/' }), { ...opts, publicUrl: '' })
  check('a junk Host header is not copied into the redirect: the address the visitor reached is used', junk?.location === 'https://192.0.2.20:8443/', show(junk))
  const none = plainHttpAction(req({ host: null, url: '/' }), { ...opts, publicUrl: '' })
  check('... nor is a missing one', none?.location === 'https://192.0.2.20:8443/', show(none))
  const none6 = plainHttpAction(req({ peer: '2001:db8::50', local: '2001:db8::20', host: null, url: '/' }), { ...opts, publicUrl: '' })
  check('... an IPv6 address reached is put in brackets', none6?.location === 'https://[2001:db8::20]:8443/', show(none6))
  const port443 = plainHttpAction(req({ url: '/' }), { ...opts, publicUrl: '', httpsPort: '443' })
  check('... HTTPS on 443 needs no port in the address', port443?.location === 'https://192.0.2.10/', show(port443))
  const absolute = plainHttpAction(req({ url: 'http://192.0.2.10:8080/login.html?y=2' }), opts)
  check('a request line with a whole address keeps only its path and query', absolute?.location === 'https://cctv.example/login.html?y=2', show(absolute))
}

// switched off (Docker, development): served as before
check('CCTV_HTTP_LAN=on (lanAllowed): an office PC is served on plain HTTP as before', plainHttpAction(req({ url: '/login.html' }), { ...opts, lanAllowed: true }) === null)
check('an encrypted socket is never redirected', plainHttpAction(req({ encrypted: true }), opts) === null)

// the public address may be handed over as a function, asked only when a redirect is made: server.mjs
// read it with getSettings() (a copy of every setting) on every plain HTTP request, the RTSP server's
// auth calls on this machine among them (2026-10-20, final review of S1a-core-http#2)
{
  let asked = 0
  const lazy = { ...opts, publicUrl: () => { asked++; return 'https://cctv.example/' } }
  const served = [plainHttpAction(req({ peer: '127.0.0.1', url: '/internal/rtsp-auth' }), lazy), plainHttpAction(req({ url: '/' }), { ...lazy, lanAllowed: true }), plainHttpAction(req({ encrypted: true }), lazy)]
  check('a public address given as a function is not asked for this machine, CCTV_HTTP_LAN or an encrypted socket', served.every((a) => a === null) && asked === 0, String(asked))
  const sent = plainHttpAction(req({ url: '/login.html?x=1' }), lazy)
  check('... and is asked once for a redirect, which it makes', asked === 1 && sent?.status === 308 && sent.location === 'https://cctv.example/login.html?x=1', show(sent))
}

// isSecureRequest: the cookie's Secure flag
check('isSecureRequest: an encrypted socket', isSecureRequest(req({ encrypted: true })) === true)
check('isSecureRequest: a proxy on this machine saying https (x-forwarded-proto)', isSecureRequest(req({ peer: '127.0.0.1', headers: { 'x-forwarded-proto': 'https' } })) === true && isSecureRequest(req({ peer: '::1', headers: { 'x-forwarded-proto': 'https' } })) === true)
check('isSecureRequest: an office PC sending the header is not believed', isSecureRequest(req({ peer: '192.0.2.50', headers: { 'x-forwarded-proto': 'https' } })) === false)
check('isSecureRequest: plain HTTP from this machine without the header', isSecureRequest(req({ peer: '127.0.0.1' })) === false)
check('isSecureRequest: the header saying http', isSecureRequest(req({ peer: '127.0.0.1', headers: { 'x-forwarded-proto': 'http' } })) === false)

// server.mjs uses it: the plain HTTP server checks first, its upgrades are refused, and every
// sign-in cookie takes Secure from isSecureRequest (server.mjs cannot be imported in a test)
{
  const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
  const plainServer = /const httpServer = createServer\(\{[^}]*\}, (\w+)\)/.exec(src)?.[1]
  check('server.mjs: the plain HTTP server has its own request handler', Boolean(plainServer) && plainServer !== 'onRequest', plainServer ?? 'not found')
  const handler = plainServer ? src.slice(src.indexOf(`const ${plainServer} =`), src.indexOf(`const ${plainServer} =`) + 800) : ''
  check('... which asks plainHttpAction before anything else', /plainHttpAction\(req,/.test(handler) && handler.indexOf('plainHttpAction') < handler.indexOf('onRequest(req, res)'))
  check('... and is told CCTV_HTTP_LAN', /CCTV_HTTP_LAN/.test(src))
  check('... and reads the settings only for a redirect (publicUrl is a function)', /const plainHttp = \{ publicUrl: \(\) => getSettings\(\)\.publicUrl/.test(src) && !/plainHttpAction\(req, plainHttp\(\)\)/.test(src))
  check('server.mjs: the plain HTTP server\'s upgrades are checked', /httpServer\.on\('upgrade', \(req, socket, head\) => onUpgrade\(req, socket, head, true\)\)/.test(src) && /if \(plain && plainHttpAction\(req,/.test(src))
  const sites = [...src.matchAll(/auth\.sessionCookie\(([^\n]*)/g)].map((m) => m[1])
  const unsafe = sites.filter((s) => !/isSecureRequest\(req\)/.test(s) && !/, secure, DEVICE_SESSION_MS\)/.test(s))
  check('server.mjs: every sign-in cookie takes Secure from isSecureRequest(req)', sites.length >= 7 && unsafe.length === 0, unsafe.join(' | '))
  check('server.mjs: nothing takes x-forwarded-proto from any peer any more', !/req\.headers\['x-forwarded-proto'\]/.test(src) && /const secure = isSecureRequest\(req\)/.test(src))
}

// Docker reaches the app through its own network, never from loopback: plain HTTP stays open there
check('Docker: CCTV_HTTP_LAN=on in docker-compose.yml (unless .env says otherwise)', /^\s*CCTV_HTTP_LAN:\s*(?:['"]?on['"]?|\$\{CCTV_HTTP_LAN:-on\})\s*$/m.test(readFileSync(new URL('../../docker-compose.yml', import.meta.url), 'utf8')))
check('Docker: CCTV_HTTP_LAN=on in the Dockerfile\'s ENV', /^\s+CCTV_HTTP_LAN=on\s*$/m.test(readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8')))

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exitCode = failures ? 1 : 0
