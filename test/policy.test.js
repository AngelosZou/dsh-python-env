/**
 * Unit tests for the session policy gate: mode mapping, read-only denial,
 * writable acceptance, and fail-closed behavior without the policy service.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertWritableSession, sessionSandboxMode, WRITABLE_MODES } from '../lib/policy.js'

function ctxWith(modeOrUndefined, resolveMounted = true) {
  return {
    get(name) {
      if (name !== 'sandboxPolicy') return undefined
      if (!resolveMounted) return undefined
      return { resolve: () => ({ mode: modeOrUndefined, workspaceRoot: '/ws' }) }
    },
  }
}

const exec = { agent: { session: { id: 's' } } }

test('sessionSandboxMode: maps the standing policy', () => {
  assert.equal(sessionSandboxMode(ctxWith('workspace-write'), exec), 'workspace-write')
  assert.equal(sessionSandboxMode(ctxWith('read-only'), exec), 'read-only')
  assert.equal(sessionSandboxMode(ctxWith(undefined), exec), undefined, 'mode-less policy fails closed')
  assert.equal(sessionSandboxMode(ctxWith('workspace-write', false), exec), undefined, 'unmounted service fails closed')
})

test('assertWritableSession: writable modes pass, everything else throws', () => {
  for (const mode of WRITABLE_MODES) {
    assert.equal(assertWritableSession(ctxWith(mode), exec, 'act'), mode)
  }
  assert.throws(() => assertWritableSession(ctxWith('read-only'), exec, 'act'), /read-only/)
  assert.throws(() => assertWritableSession(ctxWith(undefined), exec, 'act'), /cannot be verified/)
  assert.throws(() => assertWritableSession(ctxWith('workspace-write', false), exec, 'act'), /cannot be verified/)
})
