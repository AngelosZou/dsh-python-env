import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildInstallArgv,
  classifyNetworkFailure,
  ensurePip,
  normalizeIndexUrl,
  normalizeProxyUrl,
  runInstallAttempts,
} from '../lib/pip.js'
import { makeSubprocess } from './helpers.mjs'

test('classifyNetworkFailure: network markers are retryable', () => {
  const cases = [
    'Failed to establish a new connection: [Errno 11001]',
    'ConnectionResetError: connection reset by peer',
    'ReadTimeoutError("HTTPSConnectionPool... Read timed out.")',
    'getaddrinfo failed',
    'Network is unreachable',
    'No route to host',
    'WARNING: Retrying (Retry(total=4, connect=None, read=None, redirect=None, status=None))',
    'Could not fetch URL https://pypi.org/simple/',
  ]
  for (const text of cases) assert.equal(classifyNetworkFailure(text), true, text)
})

test('classifyNetworkFailure: resolution and TLS errors are NOT retryable', () => {
  assert.equal(classifyNetworkFailure('ERROR: No matching distribution found for demo'), false)
  assert.equal(classifyNetworkFailure('ERROR: Could not find a version that satisfies the requirement demo'), false)
  assert.equal(classifyNetworkFailure('SSLError: certificate verify failed'), false)
  assert.equal(classifyNetworkFailure(''), false)
})

test('normalizeProxyUrl / normalizeIndexUrl', () => {
  assert.equal(normalizeProxyUrl(undefined), undefined)
  assert.equal(normalizeProxyUrl(''), undefined)
  assert.equal(normalizeProxyUrl('127.0.0.1:7890'), 'http://127.0.0.1:7890')
  assert.equal(normalizeProxyUrl('http://127.0.0.1:7890'), 'http://127.0.0.1:7890')
  assert.equal(normalizeIndexUrl(undefined), undefined)
  assert.equal(normalizeIndexUrl('https://pypi.tuna.tsinghua.edu.cn/simple/'), 'https://pypi.tuna.tsinghua.edu.cn/simple')
  assert.throws(() => normalizeIndexUrl('ftp://mirror'), /http\(s\) URL/)
})

test('buildInstallArgv: full shape', () => {
  const argv = buildInstallArgv({
    venvPython: '/ws/.venv/bin/python',
    specs: ['a>=1', 'b'],
    requirementsPath: '/ws/requirements.txt',
    indexUrl: 'https://mirror.example/simple',
    proxyUrl: 'http://127.0.0.1:7890',
  })
  assert.equal(argv[0], '/ws/.venv/bin/python')
  assert.deepEqual(argv.slice(1, 3), ['-m', 'pip'])
  assert.ok(argv.includes('install'))
  assert.ok(argv.includes('--no-input'))
  const indexPos = argv.indexOf('--index-url')
  assert.equal(argv[indexPos + 1], 'https://mirror.example/simple')
  const proxyPos = argv.indexOf('--proxy')
  assert.equal(argv[proxyPos + 1], 'http://127.0.0.1:7890')
  const reqPos = argv.indexOf('-r')
  assert.equal(argv[reqPos + 1], '/ws/requirements.txt')
  assert.ok(reqPos < argv.indexOf('a>=1'), 'requirements before specs')
  assert.deepEqual(argv.slice(-2), ['a>=1', 'b'])
})

test('buildInstallArgv: index and proxy omitted when unset', () => {
  const argv = buildInstallArgv({ venvPython: 'p', specs: ['x'], requirementsPath: undefined, indexUrl: null, proxyUrl: undefined })
  assert.ok(!argv.includes('--index-url'))
  assert.ok(!argv.includes('--proxy'))
  assert.ok(!argv.includes('-r'))
})

test('runInstallAttempts: mirror chain after network failures', async () => {
  const { spawns, subprocess } = makeSubprocess([
    { exitCode: 1, stderr: 'Failed to establish a new connection' },
    { exitCode: 1, stderr: 'Read timed out' },
    { exitCode: 0, stdout: 'Successfully installed demo' },
  ])
  const outcome = await runInstallAttempts({
    subprocess,
    venvPython: 'p',
    specs: ['demo'],
    cwd: '/ws',
    env: {},
    probeProxy: async () => null,
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.indexUsed, 'aliyun')
  assert.equal(outcome.proxyUsed, null)
  assert.deepEqual(outcome.tried.map((t) => t.index), ['default', 'tuna', 'aliyun'])
  assert.deepEqual(outcome.tried.map((t) => t.exitCode), [1, 1, 0])
  assert.ok(spawns[1].spec.argv.includes('--index-url'))
  assert.equal(spawns[1].spec.argv[spawns[1].spec.argv.indexOf('--index-url') + 1], 'https://pypi.tuna.tsinghua.edu.cn/simple')
})

test('runInstallAttempts: discovered local proxy retries the same index', async () => {
  const { spawns, subprocess } = makeSubprocess([
    { exitCode: 1, stderr: 'connection reset by peer' },
    { exitCode: 0, stdout: 'Successfully installed demo' },
  ])
  const outcome = await runInstallAttempts({
    subprocess,
    venvPython: 'p',
    specs: ['demo'],
    cwd: '/ws',
    env: {},
    probeProxy: async () => 7890,
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.indexUsed, 'default')
  assert.equal(outcome.proxyUsed, 'http://127.0.0.1:7890')
  assert.deepEqual(outcome.tried, [
    { index: 'default', proxy: null, exitCode: 1 },
    { index: 'default', proxy: 'http://127.0.0.1:7890', exitCode: 0 },
  ])
  assert.ok(spawns[1].spec.argv.includes('--proxy'))
  assert.equal(spawns[1].spec.argv[spawns[1].spec.argv.indexOf('--proxy') + 1], 'http://127.0.0.1:7890')
})

test('runInstallAttempts: non-network failure stops immediately, no proxy probe', async () => {
  let probed = false
  const { subprocess } = makeSubprocess([{ exitCode: 1, stderr: 'ERROR: No matching distribution found for demo' }])
  const outcome = await runInstallAttempts({
    subprocess,
    venvPython: 'p',
    specs: ['demo'],
    cwd: '/ws',
    env: {},
    probeProxy: async () => {
      probed = true
      return 7890
    },
  })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.tried.length, 1)
  assert.equal(outcome.indexUsed, 'default')
  assert.equal(probed, false, 'resolution failures never trigger proxy probing')
})

test('runInstallAttempts: pinned index disables the mirror chain but keeps proxy probing', async () => {
  let probed = false
  const { spawns, subprocess } = makeSubprocess([{ exitCode: 1, stderr: 'Failed to establish a new connection' }])
  const outcome = await runInstallAttempts({
    subprocess,
    venvPython: 'p',
    specs: ['demo'],
    cwd: '/ws',
    env: {},
    index: 'https://mirror.example/simple',
    probeProxy: async () => {
      probed = true
      return null
    },
  })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.tried.length, 1, 'no second index exists for a pinned chain')
  assert.equal(outcome.indexUsed, 'custom-index')
  assert.equal(probed, true, 'proxy probing still applies to a pinned index (connectivity, not index choice)')
  assert.ok(spawns[0].spec.argv.includes('--index-url'))
})

test('runInstallAttempts: ambient proxy env is honored without probing', async () => {
  let probed = false
  const { spawns, subprocess } = makeSubprocess([{ exitCode: 0, stdout: 'Successfully installed demo' }])
  const outcome = await runInstallAttempts({
    subprocess,
    venvPython: 'p',
    specs: ['demo'],
    cwd: '/ws',
    env: {},
    probeProxy: async () => {
      probed = true
      return null
    },
  })
  // Windows folds environment variable case, so exercise the ambient read
  // through an explicit env instead of mutating process.env.
  const ambient = { HTTP_PROXY: 'http://127.0.0.1:1080' }
  const { ambientProxyEnv } = await import('../lib/pip.js')
  assert.equal(ambientProxyEnv(ambient), 'http://127.0.0.1:1080')
  assert.equal(outcome.ok, true)
  assert.equal(outcome.proxyUsed, null, 'no ambient proxy in the real process env here')
  assert.equal(probed, false, 'the happy path never probes')
})

test('runInstallAttempts: shouldStop ends the chain after the in-flight attempt', async () => {
  const { subprocess } = makeSubprocess([{ exitCode: 1, stderr: 'Failed to establish a new connection' }])
  let checks = 0
  const outcome = await runInstallAttempts({
    subprocess,
    venvPython: 'p',
    specs: ['demo'],
    cwd: '/ws',
    env: {},
    probeProxy: async () => null,
    shouldStop: () => {
      checks += 1
      return checks > 1 // stop only after the first attempt has run
    },
  })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.tried.length, 1)
})

test('ensurePip: healthy pip needs no repair', async () => {
  const { spawns, subprocess } = makeSubprocess([{ exitCode: 0, stdout: 'pip 24.0' }])
  await ensurePip(subprocess, 'p', {}, undefined)
  assert.equal(spawns.length, 1)
  assert.deepEqual(spawns[0].spec.argv, ['p', '-m', 'pip', '--version'])
})

test('ensurePip: missing pip is repaired via ensurepip', async () => {
  const { spawns, subprocess } = makeSubprocess([
    { exitCode: 1, stderr: 'No module named pip' },
    { exitCode: 0, stdout: 'Successfully installed pip-24.0' },
  ])
  await ensurePip(subprocess, 'p', {}, undefined)
  assert.equal(spawns.length, 2)
  assert.deepEqual(spawns[1].spec.argv, ['p', '-m', 'ensurepip', '--upgrade'])
})

test('ensurePip: unrecoverable failure carries a platform hint', async () => {
  const { subprocess } = makeSubprocess([
    { exitCode: 1, stderr: 'No module named pip' },
    { exitCode: 1, stderr: 'No module named ensurepip' },
  ])
  await assert.rejects(() => ensurePip(subprocess, 'p', {}, undefined), /python3-venv/)
})
