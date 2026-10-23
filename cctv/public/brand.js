// The product name shown around the app comes from the server's licence edition (pro → "Argus Pro",
// community → "Argus Community", unlicensed → "Argus"). The ARGUS mark itself is kept; a small PRO /
// COMMUNITY badge sits beside it, and the browser-tab title and installed-app name take the full name.
// Pure helpers + applyBrand; no side effects, so shell.js (signed-in pages, which get the edition from
// /api/me) and brand-boot.js (the pre-auth pages, which read the public /api/brand) both use it.

/** Put the edition into a page title that starts with "Argus" (e.g. "Argus · Live" → "Argus Pro · Live"). Pure. */
export function brandTitle(current, name) {
  if (!name || name === 'Argus' || !current) return current
  return current.startsWith('Argus') ? name + current.slice('Argus'.length) : current
}
/** The short badge word beside the mark, or '' for the base edition. Pure. */
export function editionLabel(edition) {
  return edition === 'pro' ? 'Pro' : edition === 'community' ? 'Community' : ''
}

/**
 * Apply the brand to a page (or a freshly-rendered part of one): set the title and the installed-app
 * name, and place a small edition badge after each ARGUS mark. Idempotent — a re-render never doubles
 * the badge. `root` lets the shell re-brand just the piece it redrew.
 */
export function applyBrand({ name, edition } = {}, root = typeof document !== 'undefined' ? document : null) {
  if (!root) return
  const isDoc = root.nodeType === 9 // a whole document (vs. a re-rendered element): set the title too
  const doc = isDoc ? root : (root.ownerDocument ?? document)
  if (isDoc && name) {
    doc.title = brandTitle(doc.title, name)
    doc.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', name)
  }
  const label = editionLabel(edition)
  for (const mark of root.querySelectorAll('.shell-brand-type > strong, .login-wordmark > svg')) {
    const after = mark.nextElementSibling
    if (after?.classList?.contains('brand-edition')) { if (label) after.textContent = label; else after.remove(); continue }
    if (!label) continue
    const b = doc.createElement('span')
    b.className = 'brand-edition'
    b.textContent = label
    mark.after(b)
  }
}
