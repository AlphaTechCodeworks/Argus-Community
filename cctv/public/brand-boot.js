// Brands the pages shown before sign-in (login, set-up, register, change password), which have no
// /api/me to read the edition from. Reads the public /api/brand and applies it; the last-known brand
// is used first so there is no flash on a repeat visit.
import { applyBrand } from './brand.js'

let cached = null
try { cached = JSON.parse(sessionStorage.getItem('argus.brand') || 'null') } catch { /* private mode */ }
if (cached) applyBrand(cached)

fetch('/api/brand', { cache: 'no-store' })
  .then((r) => r.json())
  .then((brand) => { try { sessionStorage.setItem('argus.brand', JSON.stringify(brand)) } catch { /* ignore */ } applyBrand(brand) })
  .catch(() => {})
