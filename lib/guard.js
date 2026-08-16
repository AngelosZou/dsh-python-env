/**
 * Workspace confinement: the compensating control for host-side execution.
 * Every tool path the model can influence is resolved here and must land
 * inside the session working directory (case-insensitively on Windows).
 * @module dsh-python-env/guard
 */
import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * Absolute working directory the executing session was created in.
 * Falls back to process.cwd() for executors without an agent chain.
 */
export function sessionCwd(exec) {
  const header = exec && exec.agent && exec.agent.session && exec.agent.session.header
  if (header && typeof header.cwd === 'string' && header.cwd.length > 0) return header.cwd
  return process.cwd()
}

/** True when `target` equals `root` or lies inside it (case-insensitive on Windows). */
export function isWithin(root, target, platform = process.platform) {
  const rel = relative(root, target)
  if (rel === '') return true
  const normalized = platform === 'win32' ? rel.toLowerCase() : rel
  return normalized !== '..' && !normalized.startsWith('..' + sep) && !isAbsolute(normalized)
}

/** Raised when a requested path escapes the session working directory. */
export class OutsideWorkspaceError extends Error {
  constructor(requested, sessionRoot, label) {
    super(
      (label !== undefined ? label + ' must stay inside the session working directory' : 'the requested path must stay inside the session working directory') +
        ' (' + sessionRoot + '); got ' + requested + '.',
    )
    this.name = 'OutsideWorkspaceError'
    this.requested = requested
    this.sessionRoot = sessionRoot
  }
}

/**
 * Resolve a model-supplied path against the session workspace and refuse
 * anything outside it. Relative paths resolve against the workspace itself;
 * `undefined`/empty falls back to the workspace.
 */
export function guardWorkspacePath(requested, sessionRoot, label) {
  const root = resolve(sessionRoot)
  const target = resolve(root, requested === undefined || String(requested).trim().length === 0 ? root : requested)
  if (isWithin(root, target)) return target
  throw new OutsideWorkspaceError(target, root, label)
}
