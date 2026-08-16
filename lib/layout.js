/**
 * Virtual environment discovery: a bounded BFS over the workspace that
 * recognizes environments by the standard `pyvenv.cfg` marker (written by
 * both stdlib `venv` and `virtualenv` on every platform) or by conventional
 * directory name. Pure filesystem logic; interpreter probing lives in the
 * tool layer so this module stays side-effect free.
 * @module dsh-python-env/layout
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DISCOVERY_DEPTH, DISCOVERY_MAX_DIRS, DISCOVERY_PRUNED_DIRS, KNOWN_VENV_NAMES } from './constants.js'
import { sameName } from './paths.js'

/** Whether a directory carries the standard virtual environment marker. */
export async function isVenvDir(dir) {
  try {
    const info = await stat(join(dir, 'pyvenv.cfg'))
    return info.isFile()
  } catch {
    return false
  }
}

/** Whether a directory name is one of the conventional venv names. */
export function hasKnownName(name, platform = process.platform) {
  return KNOWN_VENV_NAMES.some((known) => sameName(known, name, platform))
}

/** Directory entries that are directories (or symlinks to them), names only. */
export async function listSubdirs(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/**
 * Bounded breadth-first scan for virtual environment candidates.
 *
 * - The scan root itself is checked first (a root_dir may BE an environment).
 * - Candidates are recognized by the `pyvenv.cfg` marker or a conventional
 *   name; recognized directories are never descended into.
 * - Descent stops at DISCOVERY_DEPTH levels and prunes known noise
 *   directories, with a hard budget on visited directories.
 *
 * @returns [{ dir, name, byMarker, knownName }] in deterministic order.
 */
export async function discoverVenvCandidates(rootDir, platform = process.platform) {
  const found = new Map()
  const visited = new Set()
  let budget = DISCOVERY_MAX_DIRS
  const queue = [{ dir: rootDir, depth: 0 }]

  while (queue.length > 0 && budget > 0) {
    const { dir, depth } = queue.shift()
    const key = platform === 'win32' ? dir.toLowerCase() : dir
    if (visited.has(key)) continue
    visited.add(key)
    budget -= 1

    const name = dir.split(/[\\/]/).pop() ?? ''
    const byMarker = await isVenvDir(dir)
    const knownName = hasKnownName(name, platform)
    if (byMarker || knownName) {
      found.set(key, { dir, name, byMarker, knownName })
      continue // never descend into environments
    }
    if (depth >= DISCOVERY_DEPTH) continue
    if (depth > 0 && DISCOVERY_PRUNED_DIRS.has(name.toLowerCase())) continue
    const children = await listSubdirs(dir)
    for (const child of children) queue.push({ dir: join(dir, child), depth: depth + 1 })
  }

  return [...found.values()].sort((a, b) => a.dir.localeCompare(b.dir))
}
