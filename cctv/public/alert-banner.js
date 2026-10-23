// Open problems (the Health page's list: cameras offline, a recorder refusing streams, the server's
// own alerts) shown as the bell in the sidebar and the phone bar turning red, on every page (shell.js
// loads this). It used to be a red strip across the top of the page; the owner asked for the bell
// instead (2026-10-15: "just make the bell red on the side bar", "don't have it at the top").
// Hovering the bell lists the problems; the Health page has them in full.
// Since 2026-10-18 it also goes red for alarms an alarm rule asked to ring it for (a person at the gate
// at night): GET /api/alarms/bell, fetched in the same round. Those are listed first, and while there
// are any a click on the bell opens the Alarms page on what needs review, where they are acknowledged;
// only that clears them. What the bell says is worked out in alarm-bell.js, tested without a browser.
//
// The wording comes from renderHealth() so the bell and the Health page can never disagree.
// A failed request is ignored on purpose: if the server is unreachable the page has bigger problems
// to report, and a bell that turned red about its own fetch would be noise. Each list keeps what it
// last said until its own request answers again.

import { renderHealth } from './health.js'
import { bellState } from './alarm-bell.js'

const POLL_MS = 30_000
let said = '' // the problems, kept to put back after the shell is drawn again
let ringing = [] // the bell's alarms, as last fetched
let oldestMs = null // and when the oldest of them started
let state = bellState()

/** The bell's links (sidebar, phone bar, More sheet), as the shell has drawn them now. */
const bells = () => document.querySelectorAll('a[href="/alarms.html"]')

/** Turns every bell red (with what is open as its tooltip) or back to normal. */
function paint() {
  state = bellState({ problems: said, alarms: ringing, oldestMs })
  document.body.classList.toggle('has-problems', state.red)
  for (const a of bells()) if (a.title !== state.title) a.title = state.title
}

/** One request's JSON, or undefined when it failed in any way (ignored: see the top). */
async function fetchJson(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) return undefined
    return await res.json()
  } catch {
    return undefined
  }
}

async function poll() {
  const [health, bell] = await Promise.all([fetchJson('/api/health'), fetchJson('/api/alarms/bell')])
  if (health !== undefined) {
    const { bannerText, criticalText } = renderHealth(health)
    said = [criticalText, bannerText].filter(Boolean).join(' · ')
  }
  if (Array.isArray(bell?.alarms)) {
    ringing = bell.alarms
    oldestMs = Number.isFinite(bell.oldestMs) ? bell.oldestMs : null
  }
  paint()
}

// While alarms ring it, the bell opens the Alarms page on what needs review. Caught on the document,
// not on each link: the shell draws its links again and would drop a listener put on them. A click
// with a modifier (new tab, new window) is left to the browser and the link as drawn.
document.addEventListener('click', (e) => {
  if (!state.href || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
  const a = e.target instanceof Element ? e.target.closest('a[href="/alarms.html"]') : null
  if (!a) return
  e.preventDefault()
  location.href = state.href
})

// (the red comes from body.has-problems, so it survives the shell drawing its links again; the
// tooltip goes back on at the next poll)
poll()
setInterval(poll, POLL_MS)
