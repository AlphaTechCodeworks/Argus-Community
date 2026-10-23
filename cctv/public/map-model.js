// The one map: every site's cameras on a single street/satellite map, and the sites you move
// between on it. This module is the thinking behind that page and nothing else -- which sites
// there are and whether each has been placed, the badge a site collapses into when you are zoomed
// too far out to tell its cameras apart, where to fly to for a site or for everything, where
// unplaced cameras are dropped when a site is first placed, and what a save sends. map.js paints
// what this returns, the same split map-cameras.js has, so all of it is tested with no browser.
//
// Nothing here decides what a person may see: the page is handed only the sites and placements
// GET /api/maps gave this user (maps.mjs mapsFor), and works with those.
//
// Stored data is used as it is. A site's place on the one map is the lat/lng its geo block has
// always had; a site saved as a plan with no geo block simply is not placed yet, and its plan
// still opens as before.
import { MAX_LAT, STATES, boundsOf, clamp, latToY, lngToX, metresPerUnit, worstState, xToLng, yToLat } from './map-cameras.js'

/** At this zoom and closer a site always shows its cameras, however close together they are. */
export const DETAIL_ZOOM = 17
/** Further out than that, a site whose cameras span fewer pixels than this is drawn as one badge. */
export const BADGE_SPAN = 90
/** The closest a fit will go: the last zoom the tile servers have pictures for. */
const FIT_MAX_ZOOM = 19
const FIT_MIN_ZOOM = 1
/** The zoom a newly placed site is saved with, and flown to: close enough to see a building. */
export const PLACE_ZOOM = 18

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

// ---- cone colours (admin-assigned groups) -------------------------------------------------------
//
// An admin may colour a camera's VIEW CONE by a named group, or with a per-camera override, while
// the camera's recording status stays on the small marker dot (so green/amber/red for
// recording/degraded/offline is never lost). A camera with no colour of its own keeps today's cone
// (coloured by status), so old stored data needs no migration: no group, no override, no change.
//
// Storage: a site's geo block may carry `groups: [{ id, name, color, opacity? }]`, and a placement
// may carry `group` (a group id) or `color` (a direct hex override). Groups are a street-map
// feature; a plan camera can still carry a direct `color`.

/** The most groups one site may define: enough to label a real site, small enough to stay bounded. */
export const MAX_GROUPS = 32
/** The cone fill opacity used when a group gives no opacity of its own. Matches today's blue cone. */
export const DEFAULT_CONE_OPACITY = 0.2

/** A CSS hex colour, #rgb or #rrggbb. Nothing else is let near a stored map or an inline style. */
export const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
export const isHexColor = (s) => typeof s === 'string' && HEX_RE.test(s)

/**
 * The cone colour a placement resolves to: its own `color` override first, then its `group`'s
 * colour, then null for "no colour of its own" (the caller leaves today's status-coloured cone).
 * @param {{group?: string, color?: string}|null|undefined} placement
 * @param {{id: string, name?: string, color: string, opacity?: number}[]} groups the site's groups
 * @returns {{ color: string, opacity: number }|null}
 */
export function coneStyle(placement, groups = []) {
  if (isHexColor(placement?.color)) return { color: placement.color, opacity: DEFAULT_CONE_OPACITY }
  const id = placement?.group
  if (id === undefined || id === null || id === '') return null
  const g = (groups ?? []).find((x) => x && x.id === id)
  if (!g || !isHexColor(g.color)) return null
  const opacity = isNum(g.opacity) && g.opacity > 0 && g.opacity <= 1 ? g.opacity : DEFAULT_CONE_OPACITY
  return { color: g.color, opacity }
}

/**
 * A site's groups, cleaned for storage and for the edit UI: each one a { id, name, color } (and an
 * optional opacity), ids unique, colours valid hex, capped at MAX_GROUPS. `strict` throws on the
 * first bad entry (the server, which must reject junk); otherwise bad entries are dropped (the
 * page, which must still draw). A group whose colour is not hex is never kept: an invalid colour is
 * not a colour.
 * @param {unknown} input
 * @param {{ strict?: boolean, max?: number }} [opts]
 * @returns {{ id: string, name: string, color: string, opacity?: number }[]}
 */
export function cleanGroups(input, { strict = false, max = MAX_GROUPS } = {}) {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) {
    if (strict) throw new Error('Groups must be a list')
    return []
  }
  if (input.length > max) {
    if (strict) throw new Error(`Too many groups (max ${max})`)
    input = input.slice(0, max)
  }
  const out = []
  const seen = new Set()
  for (const g of input) {
    const bad = (msg) => { if (strict) throw new Error(msg) }
    if (!g || typeof g !== 'object') { bad('Bad group'); continue }
    const id = String(g.id ?? '').slice(0, 40)
    if (!id || seen.has(id)) { bad('Bad or duplicate group id'); continue }
    if (!isHexColor(g.color)) { bad(`Bad colour for group "${id}"`); continue }
    seen.add(id)
    const entry = { id, name: String(g.name ?? '').slice(0, 60), color: g.color }
    if (isNum(g.opacity) && g.opacity > 0 && g.opacity <= 1) entry.opacity = Math.round(g.opacity * 100) / 100
    out.push(entry)
  }
  return out
}

// ---- live lighting (motion / alarm) -------------------------------------------------------------
//
// A marker reacts when something happens on its camera. The page polls GET /api/events (newest
// first, already filtered to the cameras this user may see) and asks which markers are "active":
// a brief motion pulse, or a stronger alarm highlight that lingers. Offline is folded in by the
// caller from the health poll it already has, so a camera the server cannot reach rings too.

/**
 * The event kinds that light a marker with the stronger, lingering alarm highlight rather than the
 * brief motion pulse. 'motion' is deliberately not here: motion is the quiet, common thing and gets
 * its own short pulse. Kinds the app cannot actually produce yet are left out.
 */
export const ALARM_EVENT_TYPES = Object.freeze([
  'line-crossing', 'tamper', 'sensor', 'ai', 'face', 'pos', 'video-loss', 'camera-offline', 'nvr-event'
])

/**
 * Which markers are active, from the latest events and a decay window. Pure: the same events and
 * the same `now` always give the same answer, so it is tested with no clock and no DOM.
 *
 * An event in the future (a clock skew) is ignored rather than lit forever. A key is in `motion`
 * while a motion event on it is younger than `motionMs`, and in `alarm` while an alarm-kind event
 * on it is younger than `alarmMs`; the same key can be in both.
 *
 * @param {{nvr: string, ch: number, type: string, startMs: number}[]} events from GET /api/events
 * @param {{ now?: number, motionMs?: number, alarmMs?: number, alarmTypes?: readonly string[] }} [opts]
 * @returns {{ motion: Set<string>, alarm: Set<string> }} keyed "nvr/ch"
 */
export function activeMarkers(events, { now = Date.now(), motionMs = 6000, alarmMs = 60_000, alarmTypes = ALARM_EVENT_TYPES } = {}) {
  const motion = new Set()
  const alarm = new Set()
  const alarmSet = alarmTypes instanceof Set ? alarmTypes : new Set(alarmTypes)
  for (const e of events ?? []) {
    if (!e || e.nvr === undefined || e.ch === undefined) continue
    const t = Number(e.startMs)
    if (!Number.isFinite(t)) continue
    const age = now - t
    if (age < 0) continue
    const key = `${e.nvr}/${e.ch}`
    if (e.type === 'motion') {
      if (age <= motionMs) motion.add(key)
    } else if (alarmSet.has(e.type)) {
      if (age <= alarmMs) alarm.add(key)
    }
  }
  return { motion, alarm }
}

/**
 * The view the old editor gave a site the moment "Street map" was chosen: the middle of the
 * Atlantic, zoomed right out. Saved with no camera on it, it was never anyone's idea of where the
 * site is, so it must not put a badge in the ocean.
 */
const OLD_DEFAULT = { lat: 30, lng: -40, zoom: 2 }

/** Where a site is on the one map, or null when nobody has placed it. */
export function sitePosition(siteMap) {
  const g = siteMap?.geo
  if (!g || !isNum(g.lat) || !isNum(g.lng)) return null
  const untouched = g.lat === OLD_DEFAULT.lat && g.lng === OLD_DEFAULT.lng && g.zoom === OLD_DEFAULT.zoom && !Object.keys(g.cams ?? {}).length
  return untouched ? null : { lat: g.lat, lng: g.lng }
}

/**
 * A site's street-map placements that really have a position, as [key, placement] pairs. With
 * `keys` (the site's cameras in the roster), only those: a placement left behind by a camera that
 * has been removed, or moved to another site, is not a camera anyone can open.
 */
const geoCams = (siteMap, keys) => {
  const mine = keys && new Set(keys)
  return Object.entries(siteMap?.geo?.cams ?? {}).filter(([k, c]) => c && isNum(c.lat) && isNum(c.lng) && (!mine || mine.has(k)))
}

/** The same, as a map boundsOf and buildMarkers can read. */
const geoOnly = (siteMap, keys) => ({ mode: 'geo', geo: { cams: Object.fromEntries(geoCams(siteMap, keys)) } })

/**
 * The sites in the row along the top: one per site in the camera roster, in name order.
 * `count` is the site's real cameras (an empty channel slot is not a camera); `onMap` is how many
 * of them are on the one map; `placed` is whether the site itself has a position.
 * @param {{ cameras: object[], maps: { sites: object } }} o  /api/cameras and /api/maps
 */
export function siteList({ cameras = [], maps }) {
  const by = new Map()
  for (const c of cameras) {
    if (!c || c.configured === false) continue
    if (!by.has(c.site)) by.set(c.site, [])
    by.get(c.site).push(c)
  }
  return [...by.keys()].sort((a, b) => String(a).localeCompare(String(b))).map((name) => {
    const siteMap = maps?.sites?.[name]
    const position = sitePosition(siteMap)
    const cams = by.get(name).sort((a, b) => String(a.nvrName ?? '').localeCompare(String(b.nvrName ?? '')) || a.ch - b.ch)
    const keys = cams.map((c) => `${c.nvr}/${c.ch}`)
    return {
      name,
      keys,
      count: cams.length,
      position,
      placed: Boolean(position),
      hasPlan: Boolean(siteMap?.plan?.file),
      onMap: geoCams(siteMap, keys).length
    }
  })
}

/**
 * Every named site's street-map placements gathered into one map, in the shape a single site's
 * map has, so everything that draws a site's map draws this one unchanged. The placements are the
 * stored objects themselves, not copies: moving one on the map moves it in its site.
 * @param {Record<string, object>} sites  maps.sites (or the drafts being edited)
 * @param {string[]} names  the sites to include
 * @returns {{ map: object, siteOf: Record<string, string> }} siteOf: which site each key is under
 */
export function mergeGeo(sites, names = []) {
  const cams = {}
  const siteOf = {}
  for (const name of names) {
    for (const [key, c] of geoCams(sites?.[name])) {
      cams[key] = c
      siteOf[key] = name
    }
  }
  return { map: { mode: 'geo', geo: { cams } }, siteOf }
}

/**
 * One badge per placed site: what the site looks like from too far away to see its cameras.
 * It carries the site's camera count and how many of them are offline, takes the worst state of
 * its cameras (a fault must not hide inside a badge any more than inside a cluster), and sits in
 * the middle of the cameras it would open into -- or at the site's own position when none of its
 * cameras has been placed yet. `box` is the bare box of its cameras, with no view ranges added.
 * @param {{ sites: ReturnType<typeof siteList>, maps: { sites: object }, states: Record<string, {state: string}> }} o
 */
export function siteBadges({ sites = [], maps, states = {} }) {
  const out = []
  for (const s of sites) {
    if (!s.placed) continue
    // only the site's own cameras shape the badge: what it opens into is what the roster holds
    const pts = geoCams(maps?.sites?.[s.name], s.keys).map(([, c]) => ({ x: lngToX(c.lng), y: latToY(c.lat) }))
    const box = pts.length
      ? { x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) }
      : null
    const camStates = s.keys.map((k) => states[k]?.state ?? 'unknown')
    out.push({
      name: s.name,
      count: s.count,
      offline: camStates.filter((st) => st === 'offline').length,
      state: worstState(camStates),
      x: box ? (box.x0 + box.x1) / 2 : lngToX(s.position.lng),
      y: box ? (box.y0 + box.y1) / 2 : latToY(clamp(s.position.lat, -MAX_LAT, MAX_LAT)),
      box,
      onMap: pts.length,
      keys: s.keys
    })
  }
  return out
}

/** "Value 4 U · 26": what a badge, and the site's button in the row, says. */
export const badgeLabel = (b) => `${b.name} · ${b.count}`

/** The badge's tooltip: the same in a sentence, with the state in the legend's own words. */
export const badgeTitle = (b) =>
  `${b.name}: ${b.count} camera${b.count === 1 ? '' : 's'}${b.offline ? `, ${b.offline} offline` : ''} — ${(STATES[b.state] ?? STATES.unknown).title}. Click to go there.`

/**
 * How wide a site's badge is on screen, in pixels. SVG has no box that grows with its text, so it
 * is reckoned from the length of the words (about 6.6 px a character at the badge's font, plus the
 * dot and the rounded ends); a few pixels out either way does not show. The page draws the pill
 * this wide, and the clustering below uses the same number, so "touching" means touching as drawn.
 */
export const badgeWidth = (b) => Math.round((badgeLabel(b).length + (b.offline ? ` · ${b.offline} offline`.length : 0)) * 6.6) + 34
/** A badge's height on screen, in pixels: the pill's. */
export const BADGE_HEIGHT = 26
/**
 * Two site labels closer than this are one group. A few pixels of air, so labels that only
 * just miss each other (and read as one smudge anyway) still merge into one bubble.
 */
export const SITE_LABEL_GAP = 8

/**
 * Which labels overlap, as groups. Two boxes are in one group when they touch or come within
 * gapPx of each other, and the grouping is transitive: A touching B and B touching C makes one
 * group of three even when A and C are far apart, because splitting them would leave B's label
 * drawn under one of the other two. A label touching nothing is a group of one.
 *
 * Plain union-find over every pair: the map has tens of sites, not thousands, and this runs only
 * when a zoom or pan has finished, never on each frame of one.
 * @param {{x0:number,y0:number,x1:number,y1:number}[]} boxes screen boxes
 * @param {number} gapPx
 * @returns {number[][]} groups of indices into boxes, each in ascending order, ordered by their first
 */
export function clusterLabels(boxes, gapPx = 0) {
  const n = boxes?.length ?? 0
  const parent = Array.from({ length: n }, (_, i) => i)
  const root = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]]
    return i
  }
  const gap = Math.max(0, Number(gapPx) || 0)
  for (let i = 0; i < n; i++) {
    const a = boxes[i]
    for (let j = i + 1; j < n; j++) {
      const b = boxes[j]
      if (a.x0 - gap <= b.x1 && b.x0 - gap <= a.x1 && a.y0 - gap <= b.y1 && b.y0 - gap <= a.y1) {
        const [ra, rb] = [root(i), root(j)]
        // the lower index stays the root, so each group is listed where its first member is
        if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
      }
    }
  }
  const groups = new Map()
  for (let i = 0; i < n; i++) {
    const r = root(i)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(i)
  }
  return [...groups.values()]
}

/**
 * Which site badges sit on top of each other at this zoom, as groups of site names. Only the zoom
 * matters, not where the map is panned to: panning moves every label by the same amount, so what
 * overlaps stays the same. A site named in `alone` (the one chosen) is never put in a group: a
 * person who has just picked it must be able to see it.
 * @param {ReturnType<typeof siteBadges>} badges the badges being drawn
 * @param {number} zoom
 * @returns {string[][]}
 */
export function siteGroups(badges, zoom, { gapPx = SITE_LABEL_GAP, alone = [] } = {}) {
  const solo = new Set(alone)
  const s = 2 ** zoom
  const pool = badges.filter((b) => !solo.has(b.name))
  const boxes = pool.map((b) => {
    const half = badgeWidth(b) / 2
    return { x0: b.x * s - half, x1: b.x * s + half, y0: b.y * s - BADGE_HEIGHT / 2, y1: b.y * s + BADGE_HEIGHT / 2 }
  })
  const groups = clusterLabels(boxes, gapPx).map((g) => g.map((i) => pool[i].name))
  return [...groups, ...badges.filter((b) => solo.has(b.name)).map((b) => [b.name])]
}

/**
 * Several site badges drawn as one bubble: how many sites and cameras, how many offline, and the
 * worst state among them, so a pile of sites never looks calmer than the worst site in it. It sits
 * at the middle of its members.
 * @param {ReturnType<typeof siteBadges>} members two or more badges
 */
export function siteCluster(members) {
  const n = members.length
  return {
    names: members.map((b) => b.name),
    sites: n,
    count: members.reduce((t, b) => t + b.count, 0),
    offline: members.reduce((t, b) => t + b.offline, 0),
    state: worstState(members.map((b) => b.state)),
    x: members.reduce((t, b) => t + b.x, 0) / n,
    y: members.reduce((t, b) => t + b.y, 0) / n
  }
}

/**
 * Whether zooming in can ever take a bubble of sites apart. It cannot when the map is already as
 * close as it goes, or when its sites would still sit on top of each other at the closest zoom and
 * none of them opens into its cameras there (a site with no camera placed stays a label at every
 * zoom, so two of them at the same spot stay one bubble for good). Then a click lists the sites
 * instead, rather than flying to where it already is and doing nothing.
 * @param {ReturnType<typeof siteBadges>} members the bubble's badges
 * @param {number} zoom the map's zoom now
 * @param {number} maxZoom the closest the map goes
 */
export function bubbleSplits(members, zoom, maxZoom) {
  if (!(zoom < maxZoom - 0.01)) return false
  if (members.some((b) => b.onMap && b.box)) return true // it opens into its cameras by DETAIL_ZOOM
  return siteGroups(members, maxZoom).length > 1
}

/** "3 sites · 54 cameras": what a bubble of sites says. */
export const clusterLabel = (c) => `${c.sites} sites · ${c.count} camera${c.count === 1 ? '' : 's'}`

/** The bubble's tooltip: which sites are in it, and what clicking does. */
export const clusterTitle = (c) =>
  `${c.names.join(', ')}: ${c.count} camera${c.count === 1 ? '' : 's'}${c.offline ? `, ${c.offline} offline` : ''} — ${(STATES[c.state] ?? STATES.unknown).title}. Click to zoom in and split them.`

/** The bubble's width on screen, reckoned as a badge's is. */
export const clusterWidth = (c) => Math.round((clusterLabel(c).length + (c.offline ? ` · ${c.offline} offline`.length : 0)) * 6.6) + 34

/**
 * Which sites are drawn as one badge at this zoom, by name.
 *
 * A site is a badge while its cameras would land within BADGE_SPAN pixels of each other, where
 * they would be a smudge; from DETAIL_ZOOM in, it always shows its cameras, so a one-camera site
 * (which spans nothing at any zoom) opens too. A site named in `open` -- the one holding the
 * camera being watched -- is never collapsed under the person's hands, and nothing is collapsed
 * while editing, when every camera must be there to be dragged. A site with no camera placed has
 * nothing to open into and stays a badge.
 * @param {ReturnType<typeof siteBadges>} badges
 * @param {number} zoom
 * @param {{ open?: Iterable<string>, editing?: boolean }} [opts]
 * @returns {Set<string>}
 */
export function collapsedSites(badges, zoom, { open = [], editing = false } = {}) {
  const shut = new Set()
  if (editing) return shut
  const keep = new Set(open)
  for (const b of badges) {
    if (!b.onMap || !b.box) {
      shut.add(b.name)
      continue
    }
    if (keep.has(b.name) || zoom >= DETAIL_ZOOM) continue
    const span = Math.max(b.box.x1 - b.box.x0, b.box.y1 - b.box.y0) * 2 ** zoom
    if (span < BADGE_SPAN) shut.add(b.name)
  }
  return shut
}

/** The markers left once the collapsed sites' own cameras are taken out. */
export const visibleMarkers = (markers, siteOf, shut) => (shut.size ? markers.filter((m) => !shut.has(siteOf[m.key])) : markers)

/**
 * The view (centre and zoom) that shows a world box with a little margin, or null when there is
 * no box or no room to show it in. The same sum MapView.fit does, here so a flight's destination
 * can be worked out without moving the map there first.
 * @param {{x0:number,y0:number,x1:number,y1:number}|null} box
 * @param {{w:number,h:number}} size the map's size on screen
 */
export function boxView(box, size, { minZoom = FIT_MIN_ZOOM, maxZoom = FIT_MAX_ZOOM } = {}) {
  if (!box || !size?.w || !size?.h) return null
  const bw = Math.max(box.x1 - box.x0, 1e-9)
  const bh = Math.max(box.y1 - box.y0, 1e-9)
  return {
    cx: (box.x0 + box.x1) / 2,
    cy: (box.y0 + box.y1) / 2,
    zoom: clamp(Math.log2(Math.min(size.w / bw, size.h / bh) * 0.9), minZoom, maxZoom)
  }
}

/**
 * Where to fly for one site: its cameras and what they see, fitted to the screen -- but never so
 * far out that the site arrives still collapsed into its badge, which would make the button look
 * as if it had done nothing. A site with no cameras placed is shown at its own position.
 * @param {object|null} badge the site's badge (siteBadges), null when it is not placed
 * @param {object} siteMap the site's stored map
 */
export function siteView(badge, siteMap, size) {
  if (!badge || !size?.w || !size?.h) return null
  if (!badge.onMap || !badge.box) {
    const z = siteMap?.geo?.zoom
    return { cx: badge.x, cy: badge.y, zoom: clamp(isNum(z) ? z : PLACE_ZOOM, FIT_MIN_ZOOM, FIT_MAX_ZOOM) }
  }
  const fit = boxView(boundsOf(geoOnly(siteMap, badge.keys)), size)
  if (!fit) return null
  const span = Math.max(badge.box.x1 - badge.box.x0, badge.box.y1 - badge.box.y0)
  const opens = span > 0 ? Math.min(DETAIL_ZOOM, Math.log2(BADGE_SPAN / span) + 0.01) : DETAIL_ZOOM
  return { ...fit, zoom: clamp(Math.max(fit.zoom, opens), FIT_MIN_ZOOM, FIT_MAX_ZOOM) }
}

/** Where to fly for "All sites": every placed site, with or without cameras. Null when none is. */
export function allView(badges, maps, size) {
  if (!badges.length) return null
  if (badges.length === 1) return siteView(badges[0], maps?.sites?.[badges[0].name], size)
  const boxes = badges.map((b) => (b.onMap ? boundsOf(geoOnly(maps?.sites?.[b.name], b.keys)) : null) ?? { x0: b.x, y0: b.y, x1: b.x, y1: b.y })
  return boxView({
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1))
  }, size)
}

/**
 * Placements for cameras that have none yet, in a ring around their site's position: every one
 * visible and grabbable at once, ready to be dragged to where it really is. The ring grows with
 * the number of cameras so neighbours never overlap, the first camera is due north and the rest
 * follow clockwise in the order given, and each looks outwards so the cones do not pile up.
 * @param {{lat:number, lng:number}} centre the site's position
 * @param {string[]} keys the cameras to place, "nvr/ch"
 * @returns {Record<string, {lat:number, lng:number, dir:number, fov:number, range:number}>}
 */
export function ringPlacements(centre, keys, { spacing = 8, minRadius = 12, fov = 90, range = 25 } = {}) {
  const out = {}
  const n = keys.length
  if (!n) return out
  const lat = clamp(centre.lat, -MAX_LAT, MAX_LAT)
  const radius = Math.max(minRadius, (n * spacing) / (2 * Math.PI)) / metresPerUnit(lat) // metres -> world units
  const cx = lngToX(centre.lng)
  const cy = latToY(lat)
  keys.forEach((key, i) => {
    const deg = (360 * i) / n
    const a = (deg * Math.PI) / 180
    out[key] = {
      lat: clamp(yToLat(cy - radius * Math.cos(a)), -MAX_LAT, MAX_LAT),
      lng: clamp(xToLng(cx + radius * Math.sin(a)), -180, 180),
      dir: Math.round(deg) % 360,
      fov,
      range
    }
  })
  return out
}

/**
 * "42.7070, -71.1631" (as pasted from a map, with or without a trailing ", 17z"), or a Google
 * Maps link with @lat,lng in it; null when it is neither. The plain form must be the whole text:
 * two numbers picked out of a sentence ("Site 5, 42.7, -71.1") would put a site somewhere nobody
 * meant, and a wrong place on a map looks exactly as sure of itself as a right one.
 */
export function parseLatLng(text) {
  const t = String(text ?? '')
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(t) ?? /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*\d+(?:\.\d+)?z)?\s*$/.exec(t)
  if (!at) return null
  const lat = Number(at[1])
  const lng = Number(at[2])
  if (Math.abs(lat) > MAX_LAT || Math.abs(lng) > 180) return null
  return { lat, lng }
}

/**
 * What to tell the admin after a save in which some sites failed: every site that failed and why,
 * which ones were stored, and that the rest is still there. Empty when nothing failed.
 * @param {string[]} stored
 * @param {{name: string, error: string}[]} failed
 */
export function saveSummary(stored, failed) {
  if (!failed.length) return ''
  const bad = failed.map((f) => `${f.name} (${f.error})`).join('; ')
  return `Could not save ${bad}.${stored.length ? ` Stored: ${stored.join(', ')}.` : ''} What failed is still unsaved here: put it right and press Save again.`
}

/**
 * What PUT /api/admin/maps/<site> is sent for one edited site, or null when it has neither a plan
 * nor a position and so nothing to store.
 *
 * `mode` no longer chooses what the page shows (the one map shows the geo block, the Plan button
 * the plan), but it is still stored and camera-links.mjs still reads it to pick which placements
 * to guess neighbours from. So it is left as it was saved, except that an empty plan never
 * outranks cameras that are on the street map.
 * @param {object} draft the site's map as edited
 * @param {'street'|'satellite'} layer the layer in use, stored with the position
 */
export function saveBody(draft, layer) {
  const position = sitePosition(draft)
  const hasPlan = Boolean(draft?.plan?.file)
  if (!position && !hasPlan) return null
  const groups = cleanGroups(draft?.geo?.groups)
  const geo = position
    ? {
        ...position,
        zoom: isNum(draft.geo.zoom) ? draft.geo.zoom : PLACE_ZOOM,
        layer: layer === 'satellite' ? 'satellite' : 'street',
        cams: draft.geo.cams ?? {},
        ...(groups.length ? { groups } : {})
      }
    : undefined
  const plan = hasPlan ? { cams: draft.plan.cams ?? {} } : undefined
  let mode = draft.mode === 'geo' ? 'geo' : 'plan'
  if (!plan) mode = 'geo'
  else if (!geo) mode = 'plan'
  else if (mode === 'plan' && !Object.keys(plan.cams).length && Object.keys(geo.cams).length) mode = 'geo'
  return { mode, plan, geo }
}
