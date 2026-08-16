/**
 * dsh-python-env — host half.
 *
 * Workspace-scoped Python virtual environment management for agents, built
 * around one core insight: the DSH shell sandbox blocks pip's temporary
 * directories and package-index network access, while plugin code runs in
 * the host process. This plugin therefore executes python/pip/venv through
 * the platform subprocess service (the graphlint channel) and compensates
 * for the unrestricted token with strict workspace confinement:
 *
 * 1. Five model-facing tools:
 *    - pyenv_discover — find environments (pyvenv.cfg marker or conventional
 *      names) up to two levels deep and report interpreter/version/pip.
 *    - pyenv_create — standard-library `python -m venv`, verified base
 *      interpreter, idempotent on existing environments.
 *    - pyenv_install — resolve target (explicit / discovered / auto-created
 *      .venv), repair pip via ensurepip, run pip through the mirror/proxy
 *      fallback chain; upgrade flag and workspace-confined editable installs;
 *      foreground or background via ctx.jobs.
 *    - pyenv_uninstall — remove packages from a workspace environment
 *      (`pip uninstall`, offline; never auto-creates an environment).
 *    - pyenv_remove — delete a real environment only.
 * 2. Every model-influenced path resolves through guardWorkspacePath and
 *    must stay inside the session workspace (case-insensitively on Windows).
 *    All plugin state lives under <workspace>/.dsh-pyenv (pip cache, tmp);
 *    children get TMP/TEMP/TMPDIR + PIP_CACHE_DIR re-pointed there, so the
 *    global Python environment, host pip cache, and system temp are never
 *    touched. Commands are argv arrays — no shell interpolation anywhere.
 * 3. Standard library only: no uv/virtualenv dependency. Cross-platform
 *    layouts (Scripts vs bin), interpreter chains (python/py -3 vs
 *    python3/python), and mirror fallback (default -> TUNA -> Aliyun ->
 *    USTC, plus one common-local-proxy-port probe) are built in.
 * 4. Session policy parity: the mutating tools consult the session's
 *    standing sandbox policy and refuse to run in read-only sessions —
 *    host-side execution must not outrank the granted mode.
 * 5. One skill (python-env) and one system-prompt guidance section teach
 *    the agent to use the tools instead of shell pip.
 * 6. Concurrency: mutating tools declare isConcurrencySafe false, so the
 *    tool scheduler serializes them natively; discovery is read-only.
 */
import { registerSkill } from './skill.js'
import { registerGuidance } from './guidance.js'
import { registerDiscoverTool } from './tools/discover.js'
import { registerCreateTool } from './tools/create.js'
import { registerInstallTool } from './tools/install.js'
import { registerUninstallTool } from './tools/uninstall.js'
import { registerRemoveTool } from './tools/remove.js'

export const name = 'dsh-python-env'
export const inject = ['tools', 'skills', 'subprocess', 'jobs', 'sandboxPolicy', 'systemPrompt']

export function apply(ctx) {
  registerSkill(ctx)
  registerGuidance(ctx)
  registerDiscoverTool(ctx)
  registerCreateTool(ctx)
  registerInstallTool(ctx)
  registerUninstallTool(ctx)
  registerRemoveTool(ctx)
}
