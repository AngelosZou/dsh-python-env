/**
 * Base interpreter resolution for creating virtual environments.
 *
 * The requested `python` argument may be an executable name ("python3.12"),
 * a multi-token command ("py -3.12"), or a path to an interpreter. Without a
 * request, a per-platform candidate chain is tried: Windows prefers the
 * `python` shim then the `py` launcher; POSIX prefers `python3` then
 * `python`. Every candidate is verified by running `--version`; only a
 * supported CPython (>= 3.8) is accepted. An explicit request never falls
 * back silently — a wrong interpreter is an error, not a hint.
 * @module dsh-python-env/python
 */
import { MIN_PYTHON_MAJOR, MIN_PYTHON_MINOR } from './constants.js'

const VERSION_RE = /Python\s+(\d+)\.(\d+)(?:\.(\d+))?/

/** Parse the canonical `python --version` output ("Python 3.11.2"). */
export function parseVersion(text) {
  const match = VERSION_RE.exec(String(text ?? ''))
  if (match === null) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return null
  return { major, minor, text: 'Python ' + major + '.' + minor + (match[3] !== undefined ? '.' + match[3] : '') }
}

export function versionSupported(version) {
  return version.major > MIN_PYTHON_MAJOR || (version.major === MIN_PYTHON_MAJOR && version.minor >= MIN_PYTHON_MINOR)
}

/** Candidate chain: an explicit request wins; otherwise platform defaults. */
export function candidateList(requested, platform = process.platform) {
  const text = requested === undefined ? '' : String(requested).trim()
  if (text.length > 0) {
    const tokens = text.split(/\s+/)
    if (tokens.some((token) => token.length === 0)) return []
    return [{ argv: tokens, label: text }]
  }
  return platform === 'win32'
    ? [
        { argv: ['python'], label: 'python (PATH)' },
        { argv: ['py', '-3'], label: 'py -3 (launcher)' },
      ]
    : [
        { argv: ['python3'], label: 'python3 (PATH)' },
        { argv: ['python'], label: 'python (PATH)' },
      ]
}

/** Run one candidate's `--version` probe; null when it is not usable CPython. */
export async function probeVersion(subprocess, argv, signal, onSpawn) {
  const handle = subprocess.spawn({
    argv: [...argv, '--version'],
    stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
    graceMs: 5_000,
    signal,
    env: { PYTHONIOENCODING: 'utf-8' },
  })
  if (onSpawn !== undefined) onSpawn(handle)
  const outcome = await handle.done
  if (outcome.exitCode !== 0) return null
  const text = [handle.collected && handle.collected.stdout, handle.collected && handle.collected.stderr]
    .map((reader) => (reader ? reader.readFrom(0).text : ''))
    .join('')
  return parseVersion(text)
}

/**
 * Resolve a verified base interpreter.
 * @returns { argv, label, version } — `argv` is the full command prefix to
 *   run, e.g. `['py', '-3']` or `['/usr/bin/python3']`.
 */
export async function resolveBaseInterpreter(subprocess, requested, platform = process.platform, signal = undefined, onSpawn = undefined) {
  const failures = []
  const candidates = candidateList(requested, platform)
  if (candidates.length === 0) throw new Error('invalid "python" argument: expected an executable name, command, or path')
  for (const candidate of candidates) {
    let version
    try {
      version = await probeVersion(subprocess, candidate.argv, signal, onSpawn)
    } catch (error) {
      failures.push(candidate.label + ': ' + String(error && error.message ? error.message : error))
      continue
    }
    if (version === null) {
      failures.push(candidate.label + ': not a usable CPython (--version failed)')
      continue
    }
    if (!versionSupported(version)) {
      failures.push(
        candidate.label + ': unsupported ' + version.text + ' (need >= ' + MIN_PYTHON_MAJOR + '.' + MIN_PYTHON_MINOR + ')',
      )
      if (requested !== undefined && String(requested).trim().length > 0) break // explicit requests never fall back
      continue
    }
    return { argv: candidate.argv, label: candidate.label, version }
  }
  const tried = failures.length > 0 ? ' Tried: ' + failures.join('; ') + '.' : ''
  throw new Error(
    'no usable base Python interpreter found. Install Python >= ' +
      MIN_PYTHON_MAJOR + '.' + MIN_PYTHON_MINOR +
      ' (https://www.python.org/downloads/) or pass the "python" argument.' + tried,
  )
}
