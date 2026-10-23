// brand.js pure helpers (the DOM part, applyBrand, is exercised in the browser). node cctv/test/brand.test.mjs
import { brandTitle, editionLabel } from '../public/brand.js'

let failures = 0
const check = (n, ok, e = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${e ? `  (${e})` : ''}`) }

check('title: edition replaces the Argus prefix', brandTitle('Argus · Live', 'Argus Pro') === 'Argus Pro · Live')
check('title: sign-in page too', brandTitle('Argus · Sign in', 'Argus Community') === 'Argus Community · Sign in')
check('title: base name leaves it alone', brandTitle('Argus · Live', 'Argus') === 'Argus · Live')
check('title: empty name or title is safe', brandTitle('Argus · Live', '') === 'Argus · Live' && brandTitle('', 'Argus Pro') === '')
check('title: a title not starting with Argus is left alone', brandTitle('Evidence pack', 'Argus Pro') === 'Evidence pack')
check('label: pro/community/none', editionLabel('pro') === 'Pro' && editionLabel('community') === 'Community' && editionLabel(null) === '' && editionLabel('weird') === '')

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exitCode = failures ? 1 : 0
