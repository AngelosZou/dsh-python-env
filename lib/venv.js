/**
 * Virtual environment resolution and probing shared by the tools: turn a
 * model-supplied name/path into a guarded absolute directory, pick the
 * platform-correct interpreter executable, and probe an environment's
 * health (marker, interpreter, version, pip).
 * @module dsh-python-env/venv
 */
import { stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { isWithin, OutsideWorkspaceError } from './guard.js'
import { discoverVenvCandidates, isVenvDir } from './layout.js'
import { venvPipCandidates, venvPythonCandidates } from './paths.js'
import { probeVersion } from './python.js'

/**
 * Resolve a venv argument (a directory name, a relative path, or an absolute
 * path) and enforce containment: relative paths resolve against the primary
 * workspace, absolute targets must land inside the primary workspace or one
 * of the extra roots (e.g. multi-folder secondary directories). An empty
 * argument resolves to the workspace root itself and is the caller's
 * responsibility to reject.
 */
export function resolveVenvArg(requested, ws, extraRoots = []) {
  const text = String(requested ?? '').trim()
  const primary = resolve(ws)
  const target = resolve(primary, isAbsolute(text) ? text : join(ws, text))
  for (const root of [primary, ...extraRoots]) {
    if (isWithin(resolve(root), target)) return target
  }
  throw new OutsideWorkspaceError(target, primary, 'venv')
}

/**
 * Resolve the target environment for mutating operations.
 *
 * An explicit `requested` (name or path) is validated strictly: it must
 * exist inside an allowed root (primary workspace plus extra roots) and
 * carry the pyvenv.cfg marker. Without one, discovered environments across
 * all allowed roots decide: exactly one wins; several prefer `.venv` and
 * otherwise raise; none returns `null` and the caller decides whether
 * auto-creation is appropriate.
 */
export async function resolveExistingVenv(ws, requested, extraRoots = []) {
  if (requested !== undefined && String(requested).trim().length > 0) {
    const dir = resolveVenvArg(requested, ws, extraRoots)
    let exists = false
    try {
      exists = (await stat(dir)).isDirectory()
    } catch {
      // absent — reject below
    }
    if (!exists) throw new Error('venv not found: ' + dir)
    if (!(await isVenvDir(dir))) throw new Error('not a virtual environment (no pyvenv.cfg): ' + dir)
    return dir
  }
  const candidates = []
  const seen = new Set()
  for (const root of [ws, ...extraRoots]) {
    for (const candidate of await discoverVenvCandidates(root)) {
      if (!candidate.byMarker) continue
      const key = process.platform === 'win32' ? candidate.dir.toLowerCase() : candidate.dir
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push(candidate)
    }
  }
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0].dir
  const preferred = candidates.find((candidate) => candidate.name.toLowerCase() === '.venv')
  if (preferred !== undefined) return preferred.dir
  throw new Error(
    'multiple virtual environments found; pass "venv" to choose: ' + candidates.map((candidate) => candidate.dir).join(', '),
  )
}

async function firstExisting(candidates) {
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate)
      if (info.isFile()) return candidate
    } catch {
      // not present — try the next candidate
    }
  }
  return null
}

/** Absolute path of the environment's interpreter, or null. */
export function pickVenvInterpreter(venvDir, platform = process.platform) {
  return firstExisting(venvPythonCandidates(venvDir, platform))
}

export function venvHasPip(venvDir, platform = process.platform) {
  return firstExisting(venvPipCandidates(venvDir, platform)).then((path) => path !== null)
}

/**
 * Probe one environment directory:
 * { valid: marker present, python: interpreter path|null, version: string|null,
 *   hasPip: boolean }. Version probing is optional and best-effort.
 */
export async function probeVenvInfo(subprocess, venvDir, env, signal, { withVersion = true } = {}) {
  const platform = process.platform
  const python = await pickVenvInterpreter(venvDir, platform)
  const valid = await isVenvDir(venvDir)
  const hasPip = await venvHasPip(venvDir, platform)
  let version = null
  if (withVersion && python !== null && valid) {
    try {
      const parsed = await probeVersion(subprocess, [python], signal)
      if (parsed !== null) version = parsed.text
    } catch {
      // version is cosmetic — never fail the whole probe for it
    }
  }
  return { valid, python, version, hasPip }
}
