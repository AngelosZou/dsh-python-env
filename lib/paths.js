/**
 * Cross-platform virtual environment layout helpers. Every function takes an
 * explicit platform argument (defaulting to the host) so tests can pin the
 * three layouts deterministically.
 * @module dsh-python-env/paths
 */
import { join } from 'node:path'

/**
 * Candidate interpreter executables inside a virtual environment directory,
 * most likely first. Windows: Scripts\python.exe. POSIX: bin/python then
 * bin/python3 (some environments ship only the versioned symlink).
 */
export function venvPythonCandidates(venvDir, platform = process.platform) {
  if (platform === 'win32') return [join(venvDir, 'Scripts', 'python.exe')]
  return [join(venvDir, 'bin', 'python'), join(venvDir, 'bin', 'python3')]
}

/**
 * Candidate pip executables inside a virtual environment directory.
 * pip presence is reported from these; bootstrapping itself uses
 * `python -m ensurepip`, which needs no console script.
 */
export function venvPipCandidates(venvDir, platform = process.platform) {
  if (platform === 'win32') return [join(venvDir, 'Scripts', 'pip.exe')]
  return [join(venvDir, 'bin', 'pip'), join(venvDir, 'bin', 'pip3')]
}

/** Case-insensitive name comparison on Windows, exact on POSIX. */
export function sameName(a, b, platform = process.platform) {
  return platform === 'win32' ? String(a).toLowerCase() === String(b).toLowerCase() : a === b
}
