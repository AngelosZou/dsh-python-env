import test from 'node:test'
import assert from 'node:assert/strict'
import { candidateList, parseVersion, resolveBaseInterpreter, versionSupported } from '../lib/python.js'
import { makeSubprocess } from './helpers.mjs'

test('parseVersion: canonical output', () => {
  assert.deepEqual(parseVersion('Python 3.11.2\n'), { major: 3, minor: 11, text: 'Python 3.11.2' })
  assert.deepEqual(parseVersion('Python 3.13.14'), { major: 3, minor: 13, text: 'Python 3.13.14' })
  assert.deepEqual(parseVersion('Python 2.7.18'), { major: 2, minor: 7, text: 'Python 2.7.18' }, 'py2 parses; versionSupported filters it')
  assert.equal(parseVersion(''), null)
  assert.equal(parseVersion('pypy'), null)
})

test('versionSupported: >= 3.8 only', () => {
  assert.equal(versionSupported({ major: 3, minor: 8 }), true)
  assert.equal(versionSupported({ major: 3, minor: 13 }), true)
  assert.equal(versionSupported({ major: 3, minor: 7 }), false)
  assert.equal(versionSupported({ major: 4, minor: 0 }), true)
})

test('candidateList: platform defaults', () => {
  assert.deepEqual(
    candidateList(undefined, 'win32').map((c) => c.argv),
    [['python'], ['py', '-3']],
  )
  assert.deepEqual(
    candidateList(undefined, 'linux').map((c) => c.argv),
    [['python3'], ['python']],
  )
})

test('candidateList: explicit request wins, multi-token supported', () => {
  assert.deepEqual(candidateList('py -3.12', 'win32').map((c) => c.argv), [['py', '-3.12']])
  assert.deepEqual(candidateList('C:/tools/python.exe', 'linux').map((c) => c.argv), [['C:/tools/python.exe']])
  assert.deepEqual(candidateList('   ', 'linux').map((c) => c.argv), [['python3'], ['python']], 'blank falls back to chain')
})

test('resolveBaseInterpreter: falls through the chain and returns a verified prefix', async () => {
  const { spawns, subprocess } = makeSubprocess([
    { exitCode: 1, stderr: 'not found' }, // python fails
    { exitCode: 0, stdout: 'Python 3.13.2\n' }, // py -3 works
  ])
  const base = await resolveBaseInterpreter(subprocess, undefined, 'win32')
  assert.deepEqual(base.argv, ['py', '-3'])
  assert.equal(base.version.text, 'Python 3.13.2')
  assert.equal(spawns.length, 2)
  assert.deepEqual(spawns[0].spec.argv, ['python', '--version'])
  assert.deepEqual(spawns[1].spec.argv, ['py', '-3', '--version'])
})

test('resolveBaseInterpreter: explicit unsupported version does not fall back', async () => {
  const { spawns, subprocess } = makeSubprocess([{ exitCode: 0, stdout: 'Python 3.7.9\n' }])
  await assert.rejects(() => resolveBaseInterpreter(subprocess, 'python3.7', 'linux'), /unsupported Python 3\.7\.9/)
  assert.equal(spawns.length, 1, 'explicit request must not silently fall back')
})

test('resolveBaseInterpreter: exhaustive failure carries guidance', async () => {
  const { subprocess } = makeSubprocess([
    { exitCode: 1, stderr: 'boom' },
    { exitCode: 1, stderr: 'boom' },
  ])
  await assert.rejects(() => resolveBaseInterpreter(subprocess, undefined, 'linux'), /no usable base Python interpreter found/)
})
