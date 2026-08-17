/**
 * pip execution: argv construction, pip bootstrap repair, network-failure
 * classification, and the mirror/proxy fallback chain.
 *
 * The chain runs pip against the default index first; a failure classified
 * as NETWORK-level (connection reset/timeout/DNS/unreachable) moves on to
 * the TUNA, Aliyun, and USTC mirrors. After the first network-classified
 * failure with no proxy configured, common local proxy ports on 127.0.0.1
 * are probed once — a live one is retried against the same index. Package
 * resolution errors (e.g. "No matching distribution found") are never
 * retried: they are real answers, not network problems.
 * @module dsh-python-env/pip
 */
import net from 'node:net'
import {
  DEFAULT_INDEXES,
  PIP_RETRIES,
  PIP_SOCKET_TIMEOUT,
  PROXY_PROBE_PORTS,
  PROXY_PROBE_TIMEOUT_MS,
} from './constants.js'
import { runForeground, stdioSpec } from './runner.js'

const NETWORK_MARKERS = [
  /connection\s+(?:reset|aborted|refused|failed)/i,
  /failed to establish a new connection/i,
  /getaddrinfo|name or service not known|nodename nor servname/i,
  /(?:connect|read)\s*timed?\s*out/i,
  /timed out/i,
  /network is unreachable/i,
  /no route to host/i,
  /proxyerror/i,
  /retrying \(retry\(total=/i,
  /could not fetch url/i,
]

/**
 * Whether pip's stderr describes a network-level failure worth retrying on
 * another index or through a proxy. Resolution failures and TLS errors are
 * deliberately excluded.
 */
export function classifyNetworkFailure(stderrText) {
  const text = String(stderrText ?? '')
  if (
    text.includes('No matching distribution found') ||
    text.includes('ERROR: Could not find a version') ||
    text.includes('ERROR: No matching distribution')
  ) {
    return false
  }
  return NETWORK_MARKERS.some((marker) => marker.test(text))
}

/** Accept "host:port" and URLs; anything without a scheme gets http://. */
export function normalizeProxyUrl(raw) {
  const text = String(raw ?? '').trim()
  if (text.length === 0) return undefined
  return /^https?:\/\//i.test(text) ? text : 'http://' + text
}

/** An explicit index override must be a real http(s) URL. */
export function normalizeIndexUrl(raw) {
  const text = String(raw ?? '').trim()
  if (text.length === 0) return undefined
  if (!/^https?:\/\//i.test(text)) throw new Error('index must be an http(s) URL, e.g. https://pypi.tuna.tsinghua.edu.cn/simple')
  return text.replace(/\/+$/, '')
}

/** Ambient proxy configured on the HOST process (the plugin's own env). */
export function ambientProxyEnv(env = process.env) {
  return env.HTTPS_PROXY || env.HTTP_PROXY || env.ALL_PROXY || env.https_proxy || env.http_proxy || env.all_proxy
}

function probePort(port, host, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const done = (ok) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** Probe the common local proxy ports; the first live listener wins. */
export async function probeLocalProxyPorts(
  ports = PROXY_PROBE_PORTS,
  host = '127.0.0.1',
  timeoutMs = PROXY_PROBE_TIMEOUT_MS,
) {
  for (const port of ports) {
    if (await probePort(port, host, timeoutMs)) return port
  }
  return null
}

/** Full `pip install` argv; index/proxy/upgrade are omitted when unset. */
export function buildInstallArgv({ venvPython, specs, requirementsPath, indexUrl, proxyUrl, upgrade }) {
  const argv = [
    venvPython,
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--no-color',
    '--no-input',
    '--retries',
    PIP_RETRIES,
    '--timeout',
    PIP_SOCKET_TIMEOUT,
  ]
  if (upgrade === true) argv.push('--upgrade')
  if (indexUrl !== undefined && indexUrl !== null) argv.push('--index-url', indexUrl)
  if (proxyUrl !== undefined && proxyUrl !== null) argv.push('--proxy', proxyUrl)
  if (requirementsPath !== undefined) argv.push('-r', requirementsPath)
  for (const spec of specs) argv.push(spec)
  return argv
}

/** `pip uninstall` argv: non-interactive, no network needed. */
export function buildUninstallArgv(venvPython, specs) {
  return [venvPython, '-m', 'pip', 'uninstall', '--disable-pip-version-check', '-y', ...specs]
}

/**
 * Ensure a virtual environment can run pip: probe `python -m pip`, and when
 * it is missing run `python -m ensurepip --upgrade` (offline, bundled
 * wheels) to repair it. Throws with a platform-aware hint when neither works.
 * An optional `onSpawn` callback receives each live handle so a caller's
 * deadline watchdog can terminate it.
 */
export async function ensurePip(subprocess, venvPython, env, signal, onSpawn) {
  const probe = await runForeground(
    subprocess,
    { argv: [venvPython, '-m', 'pip', '--version'], stdio: stdioSpec(), graceMs: 5_000, env },
    signal,
    onSpawn,
  )
  if (probe.exitCode === 0) return
  const boot = await runForeground(
    subprocess,
    { argv: [venvPython, '-m', 'ensurepip', '--upgrade'], stdio: stdioSpec(), graceMs: 30_000, env },
    signal,
    onSpawn,
  )
  if (boot.exitCode === 0) return
  const stderr = boot.stderr.text + '\n' + boot.stdout.text
  let hint = ''
  if (/No module named ensurepip|ensurepip is (disabled|not available)/i.test(stderr)) {
    hint = ' The interpreter cannot bootstrap pip (missing ensurepip; on Debian/Ubuntu install the python3-venv package).'
  }
  throw new Error('pip is missing from the virtual environment and could not be bootstrapped.' + hint + '\n' + stderr.slice(-2000))
}

function shapeAttempt(indexId, proxyUrl, exitCode) {
  return { index: indexId, proxy: proxyUrl === undefined ? null : proxyUrl, exitCode }
}

/**
 * Run the install attempts (mirror chain + one local-proxy discovery).
 *
 * Hooks (both optional):
 * - onSpawn(handle) — called after each spawn, so a caller can terminate the
 *   live attempt (background cap timers).
 * - onAttempt(result) — called after each attempt settles with the raw
 *   result, so a caller can stream attempt output.
 * - shouldStop() — consulted between attempts; true ends the chain early
 *   (the last attempt's result is returned as the failure).
 *
 * @returns
 *   { ok: true,  result, tried, indexUsed, proxyUsed } on success, or
 *   { ok: false, result, tried, indexUsed, proxyUsed } with the failing
 *   attempt's raw output after the chain is exhausted or a non-network
 *   failure ends it early.
 */
export async function runInstallAttempts({
  subprocess,
  signal,
  cwd,
  venvPython,
  specs,
  requirementsPath,
  index,
  proxy,
  upgrade,
  env,
  onSpawn,
  onAttempt,
  shouldStop,
  probeProxy,
}) {
  const pinnedIndex = normalizeIndexUrl(index)
  const explicitProxy = normalizeProxyUrl(proxy)
  const ambient = explicitProxy === undefined ? ambientProxyEnv() : undefined
  const attempts = pinnedIndex !== undefined ? [{ id: 'custom-index', indexUrl: pinnedIndex }] : DEFAULT_INDEXES
  let proxyUrl = explicitProxy !== undefined ? explicitProxy : normalizeProxyUrl(ambient)
  const probeFn = probeProxy !== undefined ? probeProxy : probeLocalProxyPorts
  let probedLocal = false
  const tried = []
  let last = null

  for (let i = 0; i < attempts.length; i += 1) {
    if (shouldStop !== undefined && shouldStop()) break
    const attempt = attempts[i]
    const argv = buildInstallArgv({ venvPython, specs, requirementsPath, indexUrl: attempt.indexUrl, proxyUrl, upgrade })
    // Short grace: when a deadline fires, the tree must settle fast so the
    // tool can return its detailed stop-reason close to the time budget.
    const spec = { argv, cwd, stdio: stdioSpec(), graceMs: 5_000, env }
    const result = await runForegroundWith(signal, subprocess, spec, onSpawn)
    tried.push(shapeAttempt(attempt.id, proxyUrl, result.exitCode))
    last = { result, argv }
    if (onAttempt !== undefined) onAttempt(result)
    if (result.exitCode === 0) {
      return { ok: true, result, tried, indexUsed: attempt.id, proxyUsed: proxyUrl === undefined ? null : proxyUrl }
    }
    if (shouldStop !== undefined && shouldStop()) break
    if (classifyNetworkFailure(result.stderr.text)) {
      if (proxyUrl === undefined && !probedLocal) {
        probedLocal = true
        const port = await probeFn()
        if (port !== null && port !== undefined) {
          proxyUrl = 'http://127.0.0.1:' + port
          i -= 1 // retry the same index through the discovered proxy
          continue
        }
      }
      continue // next mirror
    }
    break // non-network failure: surface immediately
  }

  const lastAttempt = tried[tried.length - 1]
  const failed = last !== null ? last.result : { exitCode: null, timedOut: false, stdout: { text: '', truncated: false }, stderr: { text: '', truncated: false } }
  return {
    ok: false,
    result: failed,
    tried,
    indexUsed: lastAttempt === undefined ? null : lastAttempt.index,
    proxyUsed: proxyUrl === undefined ? null : proxyUrl,
  }
}

async function runForegroundWith(signal, subprocess, spec, onSpawn) {
  const handle = subprocess.spawn(signal === undefined ? spec : { ...spec, signal })
  if (onSpawn !== undefined) onSpawn(handle)
  const outcome = await handle.done
  return {
    exitCode: outcome.exitCode === undefined ? null : outcome.exitCode,
    timedOut: outcome.exitCode === null,
    stdout: streamShape(handle.collected && handle.collected.stdout),
    stderr: streamShape(handle.collected && handle.collected.stderr),
  }
}

function streamShape(reader) {
  if (reader === undefined || reader === null) return { text: '', truncated: false }
  const read = reader.readFrom(0)
  return {
    text: typeof read.text === 'string' ? read.text : '',
    truncated: !!read.lossy,
    ...(read.spillPath !== undefined ? { spillPath: read.spillPath } : {}),
  }
}
