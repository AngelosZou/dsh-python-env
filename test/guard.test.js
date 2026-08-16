import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { OutsideWorkspaceError, guardAllowedPath, guardWorkspacePath, isWithin, sessionCwd } from '../lib/guard.js'

test('isWithin: equality and containment', () => {
  assert.equal(isWithin('/a/b', '/a/b'), true)
  assert.equal(isWithin('/a/b', '/a/b/c'), true)
  assert.equal(isWithin('/a/b', '/a/b/c/d/e'), true)
})

test('isWithin: siblings and ancestors are outside', () => {
  assert.equal(isWithin('/a/b', '/a/bc'), false, 'sibling with common prefix')
  assert.equal(isWithin('/a/b', '/a'), false, 'ancestor')
  assert.equal(isWithin('/a/b', '/a/c'), false, 'sibling')
  assert.equal(isWithin('/a/b', '/'), false, 'root')
})

test('isWithin: windows case-insensitivity', () => {
  assert.equal(isWithin('C:\\Workspace', 'c:\\workspace\\venv', 'win32'), true)
  assert.equal(isWithin('C:\\Workspace', 'C:\\Workspace', 'win32'), true)
  assert.equal(isWithin('C:\\Workspace', 'C:\\Workspace2', 'win32'), false)
  assert.equal(isWithin('C:\\Workspace', 'C:\\Other\\venv', 'win32'), false)
})

test('guardWorkspacePath: resolves inside the workspace', () => {
  const ws = join('X:', 'ws') // platform-agnostic-ish: works for containment math on any OS
  assert.equal(guardWorkspacePath(undefined, ws), ws)
  assert.equal(guardWorkspacePath('', ws), ws)
  assert.equal(guardWorkspacePath('.venv', ws), join(ws, '.venv'))
  assert.equal(guardWorkspacePath(join(ws, 'a', '..', '.venv'), ws), join(ws, '.venv'), 'dot-dot that stays inside is allowed')
})

test('guardWorkspacePath: rejects escapes', () => {
  const ws = join('X:', 'ws')
  assert.throws(() => guardWorkspacePath('..', ws), OutsideWorkspaceError)
  assert.throws(() => guardWorkspacePath(join('X:', 'other'), ws), OutsideWorkspaceError)
  assert.throws(() => guardWorkspacePath(join(ws, '..', '..', 'escape'), ws), OutsideWorkspaceError)
  const error = (() => {
    try {
      guardWorkspacePath('..', ws, 'venv')
    } catch (e) {
      return e
    }
  })()
  assert.match(String(error.message), /venv must stay inside/)
})

test('guardAllowedPath: extra roots extend the allowed set', () => {
  const ws = join('X:', 'ws')
  const sec = join('X:', 'sec')
  assert.equal(guardAllowedPath(sec, ws, [sec]), sec)
  assert.equal(guardAllowedPath(join(sec, '.venv'), ws, [sec]), join(sec, '.venv'))
  assert.equal(guardAllowedPath('.venv', ws, [sec]), join(ws, '.venv'), 'relative paths stay primary')
  assert.equal(guardAllowedPath(undefined, ws, [sec]), ws)
  assert.throws(() => guardAllowedPath(join('X:', 'other'), ws, [sec]), OutsideWorkspaceError)
  assert.throws(() => guardAllowedPath(join(ws, '..', 'escape'), ws, [sec]), OutsideWorkspaceError)
  assert.equal(guardAllowedPath(join(ws, '.venv'), ws, []), join(ws, '.venv'), 'no extra roots = guardWorkspacePath')
})

test('sessionCwd: agent chain first, then process cwd', () => {
  assert.equal(sessionCwd({ agent: { session: { header: { cwd: '/session/ws' } } } }), '/session/ws')
  assert.equal(sessionCwd({}), process.cwd())
  assert.equal(sessionCwd(undefined), process.cwd())
})
