/**
 * `pyenv_uninstall` — remove packages from a workspace virtual environment
 * through the host subprocess channel (`pip uninstall`). Fully offline; the
 * target environment is never auto-created.
 * @module dsh-python-env/tools/uninstall
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { sessionCwd } from '../guard.js'
import { assertWritableSession } from '../policy.js'
import { pickVenvInterpreter, resolveExistingVenv } from '../venv.js'
import { ensureEnvDirs, pythonChildEnv } from '../envdir.js'
import { buildUninstallArgv, ensurePip } from '../pip.js'
import { runForeground, stdioSpec } from '../runner.js'
import { MAX_PACKAGES, MAX_SPEC_LENGTH } from '../constants.js'
import { ERROR_BRANCH, FOREGROUND_BRANCH, renderForegroundText } from '../render.js'

export function registerUninstallTool(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'pyenv_uninstall',
      description:
        'Uninstall Python packages from a workspace virtual environment by running <venv-python> -m pip uninstall through the host subprocess channel. ' +
        'No network access is needed. Use this instead of pip in a shell — the shell sandbox blocks pip\'s temporary directories. ' +
        'Never auto-creates an environment and never touches the global Python environment.',
      parameters: {
        packages: {
          type: 'array',
          required: true,
          items: { type: 'string' },
          description: 'Package names to uninstall, e.g. ["pytest", "tree-sitter"]. At least one name is required.',
        },
        venv: {
          type: 'string',
          description:
            'Target environment: a directory name or workspace path. Defaults to the single discovered environment (preferring .venv); never auto-creates one.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Foreground timeout in milliseconds (default 300000). The framework kills the process tree on expiry.',
        },
      },
      output: {
        schema: { oneOf: [FOREGROUND_BRANCH, ERROR_BRANCH] },
        render(_args, value) {
          if (value && typeof value.error === 'string') return [{ type: 'text', text: value.error }]
          return [{ type: 'text', text: renderForegroundText(value) }]
        },
      },
      timeoutMs: 300_000,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        try {
          const ws = sessionCwd(exec)
          assertWritableSession(ctx, exec, 'uninstall packages')
          const subprocess = ctx.get('subprocess')
          if (subprocess === undefined) {
            throw new Error('dsh-python-env: no subprocess service is mounted (cannot uninstall packages)')
          }

          const specs = []
          if (!Array.isArray(args.packages)) throw new Error('packages must be an array of package names')
          for (const raw of args.packages) {
            const spec = typeof raw === 'string' ? raw.trim() : ''
            if (spec.length === 0) continue
            if (spec.length > MAX_SPEC_LENGTH) {
              throw new Error('package name too long (max ' + MAX_SPEC_LENGTH + '): ' + spec.slice(0, 80) + '...')
            }
            specs.push(spec)
          }
          if (specs.length > MAX_PACKAGES) throw new Error('too many packages (max ' + MAX_PACKAGES + ')')
          if (specs.length === 0) throw new Error('nothing to uninstall: pass a non-empty "packages" list')

          const venvDir = await resolveExistingVenv(ws, args.venv)
          if (venvDir === null) {
            throw new Error('no virtual environment found under ' + ws + '; create one with pyenv_create first')
          }
          const venvPython = await pickVenvInterpreter(venvDir)
          if (venvPython === null) throw new Error('virtual environment has no usable interpreter: ' + venvDir)

          await ensureEnvDirs(ws)
          const env = pythonChildEnv(ws)
          await ensurePip(subprocess, venvPython, env, exec && exec.signal)
          const result = await runForeground(
            subprocess,
            { argv: buildUninstallArgv(venvPython, specs), cwd: ws, stdio: stdioSpec(), graceMs: 15_000, env },
            exec && exec.signal,
          )
          return {
            kind: 'foreground',
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            stdout: result.stdout,
            stderr: result.stderr,
          }
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
        }
      },
      presentCall: (args) => ({
        card: 'terminal',
        title: 'pip uninstall' + (args && Array.isArray(args.packages) && args.packages.length > 0 ? ' ' + args.packages.join(' ') : ''),
      }),
    }),
  )
}
