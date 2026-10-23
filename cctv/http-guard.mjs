// Plain HTTP is for this machine only (audit 2026-10-20, S1a-core-http#2).
//
// Port 8080 (HTTP_PORT) listens on every address, and the office network could open the sign-in page
// on it: an AD user's Windows password then crossed the LAN in clear text, and the session cookie
// went out without Secure. Everything that needs plain HTTP is on this machine itself (the watchers,
// install-pages.sh, install-ubuntu.sh, cctv-watch.ps1, the RTSP server's /internal calls),
// so this machine is served exactly as before, and anyone else is sent to https with a 308:
// old LAN bookmarks keep working, and a sign-in POST is never answered in clear. The port is not
// bound to 127.0.0.1 for that reason. CCTV_HTTP_LAN=on keeps the old behaviour (Docker, where every
// visitor arrives from the container network, and development).
//
// The same rule decides the cookie's Secure flag: the socket itself, or x-forwarded-proto from a
// proxy on this machine (cloudflared); a header from anyone else proves nothing.
import { LOOPBACK } from './security.mjs'

const fromThisMachine = (req) => LOOPBACK.test(req?.socket?.remoteAddress ?? '')

/** Whether the browser reached us over https: the socket's own TLS, or a proxy on this machine saying so. */
export const isSecureRequest = (req) => Boolean(req?.socket?.encrypted) || (fromThisMachine(req) && req?.headers?.['x-forwarded-proto'] === 'https')

// A Host header is the visitor's to send: only a plain name or address (an IPv6 one in brackets) is
// copied into the redirect. Without one, the address this visitor reached us on.
const HOST_NAME = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])$/
const hostOf = (req) => {
  const host = String(req?.headers?.host ?? '').trim()
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  if (HOST_NAME.test(name)) return name
  const local = String(req?.socket?.localAddress ?? '').replace(/^::ffff:/i, '')
  return local.includes(':') ? `[${local}]` : local
}

// the path and query asked for (a request line may carry a whole address: only its path counts)
const pathOf = (url) => {
  const u = String(url ?? '/')
  if (u.startsWith('/')) return u
  try {
    const parsed = new URL(u)
    return parsed.pathname + parsed.search
  } catch {
    return '/'
  }
}

// the public address (settings publicUrl) when it is an https one, with no trailing slash
const httpsPublic = (publicUrl) => {
  try {
    const u = new URL(String(publicUrl ?? ''))
    return u.protocol === 'https:' ? `${u.origin}${u.pathname.replace(/\/+$/, '')}` : null
  } catch {
    return null
  }
}

/**
 * What the plain HTTP server does with this request: null serves it as before (this machine, an
 * encrypted socket, or CCTV_HTTP_LAN=on); otherwise { status: 308, location } sends the browser to
 * the public https address, or to the name it used on HTTPS_PORT when there is none, with the same
 * path and query. A WebSocket upgrade that gets an action is refused (server.mjs). publicUrl may be
 * a function, asked only for a redirect: server.mjs reads it from the settings, and most plain HTTP
 * requests are this machine's own (2026-10-20, final review of S1a-core-http#2).
 */
export function plainHttpAction(req, { publicUrl = '', httpsPort = 8443, lanAllowed = false } = {}) {
  if (lanAllowed || req?.socket?.encrypted || fromThisMachine(req)) return null
  const port = Number(httpsPort)
  const base = httpsPublic(typeof publicUrl === 'function' ? publicUrl() : publicUrl) ?? `https://${hostOf(req)}${port === 443 ? '' : `:${port}`}`
  return { status: 308, location: base + pathOf(req?.url) }
}
