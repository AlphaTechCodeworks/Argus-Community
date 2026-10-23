// Public verification keys for Argus licences, keyed by the `keyId` a licence carries. ONLY public
// keys live here, so this file is safe to ship and commit. The matching PRIVATE signing key is made
// by the owner's signing tool (not shipped with Community) and kept off every repo (see
// .gitignore). To rotate: add a new keyId here, start signing with the new private key; old licences
// keep verifying against their own keyId.
//
// Format: a SPKI PEM string ('-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n').
export const LICENCE_KEYS = {
  // argus-2026: generated 2026-10-21; its private key is kept by the publisher, never in a repo.
  'argus-2026': "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAgDiIxkloMnvI3RrAwyQEX9P1QfAC2X9RrcZ2uetNJ4I=\n-----END PUBLIC KEY-----\n",
}
