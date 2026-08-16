import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { sameName, venvPipCandidates, venvPythonCandidates } from '../lib/paths.js'

test('venvPythonCandidates: windows uses Scripts', () => {
  assert.deepEqual(venvPythonCandidates('v', 'win32'), [join('v', 'Scripts', 'python.exe')])
})

test('venvPythonCandidates: posix uses bin with python3 fallback', () => {
  assert.deepEqual(venvPythonCandidates('v', 'linux'), [join('v', 'bin', 'python'), join('v', 'bin', 'python3')])
  assert.deepEqual(venvPythonCandidates('v', 'darwin'), [join('v', 'bin', 'python'), join('v', 'bin', 'python3')])
})

test('venvPipCandidates: per-platform layouts', () => {
  assert.deepEqual(venvPipCandidates('v', 'win32'), [join('v', 'Scripts', 'pip.exe')])
  assert.deepEqual(venvPipCandidates('v', 'linux'), [join('v', 'bin', 'pip'), join('v', 'bin', 'pip3')])
})

test('sameName: case-insensitive only on windows', () => {
  assert.equal(sameName('.venv', '.VENV', 'win32'), true)
  assert.equal(sameName('venv', 'VENV', 'win32'), true)
  assert.equal(sameName('venv', 'VENV', 'linux'), false)
  assert.equal(sameName('venv', 'venv', 'linux'), true)
  assert.equal(sameName('env', 'venv', 'win32'), false)
})
