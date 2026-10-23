import { test } from 'node:test'
import assert from 'node:assert/strict'
import { browserResults, siteScopes } from '../public/camera-browser.js'

const cameras = [
  { site: 'North yard', name: 'Gate', nvrName: 'Recorder A', nvr: 'a', ch: 0, online: true },
  { site: 'North yard', name: 'Warehouse', nvrName: 'Recorder A', nvr: 'a', ch: 1, online: false },
  { site: 'South yard', name: 'Gate', nvrName: 'Recorder B', nvr: 'b', ch: 0, online: true }
]
test('site browser counts cameras and ranks favorites before recent sites', () => {
  assert.deepEqual(browserResults(cameras, { favorites: ['South yard'], recents: ['North yard'] }), [
    { name: 'South yard', count: 1 }, { name: 'North yard', count: 2 }
  ])
  assert.deepEqual(browserResults(cameras, { query: 'north yard' }), [{ name: 'North yard', count: 2 }])
})
test('camera search combines site scope with recorder and name words, retaining offline cameras', () => {
  assert.deepEqual(browserResults(cameras, { mode: 'cameras', site: 'North yard', query: 'warehouse recorder' }), [cameras[1]])
  assert.deepEqual(browserResults(cameras, { mode: 'cameras', site: 'South yard', query: 'warehouse' }), [])
  assert.equal(browserResults(cameras, { mode: 'cameras', query: 'gate' }).length, 2)
})
test('preferences do not add sites outside the supplied roster', () => {
  assert.equal(browserResults(cameras, { favorites: ['Private site'], recents: ['Removed site'] }).length, 2)
})
// Live's one site picker: every site, and one recorder of a site that has several (what the old
// Site list's indented rows offered)
test('site scopes: all sites, each site, and each recorder of a site with several', () => {
  const sites = [{ site: 'South yard', id: 'c', name: 'Recorder C' }, { site: 'North yard', id: 'a', name: 'Recorder A' }, { site: 'South yard', id: 'b', name: 'Recorder B' }]
  assert.deepEqual(siteScopes(sites), [
    { value: '', label: 'All sites', site: '' },
    { value: 'North yard', label: 'North yard', site: 'North yard' },
    { value: 'South yard', label: 'South yard', site: 'South yard' },
    { value: '@nvr:b', label: 'South yard · Recorder B', site: 'South yard', nvr: 'b', name: 'Recorder B' },
    { value: '@nvr:c', label: 'South yard · Recorder C', site: 'South yard', nvr: 'c', name: 'Recorder C' }
  ])
})
