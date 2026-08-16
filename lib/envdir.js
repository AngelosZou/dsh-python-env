/**
 * Workspace-local plugin state and child environment construction.
 *
 * Everything the plugin writes lives under `<workspace>/.dsh-pyenv/`:
 * pip's http cache, the TMP handed to children, and a .gitignore that keeps
 * the whole tree out of version control. Redirecting these locations means
 * the host-wide pip cache and system temp directories are never touched.
 * @module dsh-python-env/envdir
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CACHE_DIR_NAME, ENV_DIR_NAME, TMP_DIR_NAME } from './constants.js'

export function envRoot(ws) {
  return join(ws, ENV_DIR_NAME)
}

export function cacheDir(ws) {
  return join(envRoot(ws), CACHE_DIR_NAME)
}

export function tmpDir(ws) {
  return join(envRoot(ws), TMP_DIR_NAME)
}

/** Create the workspace cache/tmp tree (idempotent) plus its .gitignore. */
export async function ensureEnvDirs(ws) {
  const root = envRoot(ws)
  await mkdir(cacheDir(ws), { recursive: true })
  await mkdir(tmpDir(ws), { recursive: true })
  try {
    await writeFile(join(root, '.gitignore'), CACHE_DIR_NAME + '/\n' + TMP_DIR_NAME + '/\n', { flag: 'wx' })
  } catch {
    // already present — keep the existing file
  }
}

/**
 * Explicit child environment for every python/pip subprocess the plugin
 * spawns. The subprocess service merges these entries after its credential
 * scrub, so ambient PATH/proxy variables still reach the child while all
 * writable state is re-pointed into the workspace.
 */
export function pythonChildEnv(ws, extra = {}) {
  return {
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1',
    PIP_CACHE_DIR: cacheDir(ws),
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    TMP: tmpDir(ws),
    TEMP: tmpDir(ws),
    TMPDIR: tmpDir(ws),
    ...extra,
  }
}
