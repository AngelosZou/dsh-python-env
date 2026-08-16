/**
 * Unit tests for the optional dsh-multi-folder compatibility probe: silent
 * no-op without the service, graceful degradation on failures, and clean
 * extraction of the configured directories.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { secondaryDirs } from '../lib/secondary.js'

test('secondaryDirs: absent or incompatible service is a silent no-op', async () => {
  assert.deepEqual(await secondaryDirs({ get: () => undefined }, '/ws'), [])
  assert.deepEqual(await secondaryDirs({ get: () => ({}) }, '/ws'), [])
  assert.deepEqual(await secondaryDirs({ get: () => ({ list: 'not-a-function' }) }, '/ws'), [])
})

test('secondaryDirs: failing list degrades silently', async () => {
  const throwing = { get: () => ({ list: async () => { throw new Error('boom') } }) }
  assert.deepEqual(await secondaryDirs(throwing, '/ws'), [])
  const malformed = { get: () => ({ list: async () => 'not-an-object' }) }
  assert.deepEqual(await secondaryDirs(malformed, '/ws'), [])
})

test('secondaryDirs: returns sanitized configured directories', async () => {
  const ctx = { get: () => ({ list: async () => ({ dirs: ['D:/sec', '', 42, 'D:/sec2'] }) }) }
  assert.deepEqual(await secondaryDirs(ctx, '/ws'), ['D:/sec', 'D:/sec2'])
})
