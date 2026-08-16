/**
 * Session sandbox-mode parity: the mutating tools (create / install /
 * uninstall / remove) consult the session's standing sandbox policy and
 * refuse to run when the session is not allowed to write — exactly the
 * semantics the shipped file and shell tools have. Host-side subprocess
 * execution bypasses the shell sandbox mechanically, so this gate is what
 * keeps the plugin's power aligned with the mode the user granted the
 * session. Fails closed when the policy service is absent.
 * @module dsh-python-env/policy
 */

export const WRITABLE_MODES = ['workspace-write', 'danger-full-access']

/** The session's standing sandbox mode, or undefined when unmountable. */
export function sessionSandboxMode(ctx, exec) {
  const sandboxPolicy = ctx.get('sandboxPolicy')
  if (sandboxPolicy === undefined || typeof sandboxPolicy.resolve !== 'function') return undefined
  const standing = sandboxPolicy.resolve(exec && exec.agent ? { session: exec.agent.session } : {})
  return standing && typeof standing.mode === 'string' ? String(standing.mode) : undefined
}

/**
 * Allow only when the session's mode grants workspace writes. Throws
 * otherwise — including when no policy service is mounted (the plugin
 * cannot verify permission, so it must not proceed).
 */
export function assertWritableSession(ctx, exec, action) {
  const mode = sessionSandboxMode(ctx, exec)
  if (mode === undefined) {
    throw new Error(
      "dsh-python-env: cannot " + action + ': no sandbox policy service is mounted, so the session\'s write permission cannot be verified',
    )
  }
  if (!WRITABLE_MODES.includes(mode)) {
    throw new Error(
      'dsh-python-env: cannot ' + action + ': the session is in "' + mode +
        '" mode, which forbids workspace mutations. Switch the session to workspace-write or danger-full-access first.',
    )
  }
  return mode
}
