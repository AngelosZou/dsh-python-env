/**
 * Optional, automatic compatibility with the dsh-multi-folder plugin —
 * with NO dependency relationship.
 *
 * At call time each tool silently probes `ctx.get('multiFolder')`: the
 * service multi-folder provides (a plain object with a read-only
 * `list(workspace)` method returning `{ dirs }`). When the service is
 * absent, its `list` is missing, or it throws, every helper here is a
 * no-op — the plugin behaves exactly as if multi-folder did not exist:
 * no extra context, no user-visible difference, and `multiFolder` is
 * never declared in this plugin's inject list.
 *
 * When multi-folder IS configured, the session's secondary working
 * directories join the primary workspace as allowed roots, so environment
 * management works there under the same session mode multi-folder's
 * interception grants (mode parity: read-only sessions are still refused
 * by the policy gate in tools/policy.js).
 * @module dsh-python-env/secondary
 */

/**
 * Configured secondary working directories for the session workspace,
 * or [] when the multi-folder plugin is not installed/configured.
 */
export async function secondaryDirs(ctx, ws) {
  const service = ctx.get('multiFolder')
  if (service === undefined || typeof service.list !== 'function') return []
  try {
    const result = await service.list(ws)
    const dirs = Array.isArray(result && result.dirs) ? result.dirs : []
    return dirs.filter((dir) => typeof dir === 'string' && dir.length > 0)
  } catch {
    // absent, incompatible, or failing — behave as if multi-folder were not installed
    return []
  }
}
