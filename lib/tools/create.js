/**
 * `pyenv_create` — create (or recognize an existing) workspace virtual
 * environment with the standard library, through the host subprocess
 * channel. Never touches the global Python environment.
 * @module dsh-python-env/tools/create
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { guardAllowedPath, sessionCwd } from '../guard.js'
import { assertWritableSession } from '../policy.js'
import { secondaryDirs } from '../secondary.js'
import { isVenvDir } from '../layout.js'
import { probeVenvInfo } from '../venv.js'
import { resolveBaseInterpreter } from '../python.js'
import { ensureEnvDirs, pythonChildEnv } from '../envdir.js'
import { runForeground, armDeadline, stdioSpec } from '../runner.js'
import { DEFAULT_TOOL_TIMEOUT_MS, DEFAULT_VENV_NAME, MAX_VENV_NAME_LENGTH, VENV_NAME_RE } from '../constants.js'
import { ERROR_BRANCH, renderAbortedReason, renderStopReason } from '../render.js'

const RECORD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    path: { type: 'string', required: true },
    python: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
    version: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
    hasPip: { type: 'boolean', required: true },
    valid: { type: 'boolean', required: true },
    created: { type: 'boolean', required: true },
    alreadyExisted: { type: 'boolean', required: true },
    baseInterpreter: { type: 'string', required: true },
  },
}

export function registerCreateTool(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'pyenv_create',
      description:
        'Create a Python virtual environment inside the session workspace with the standard library (python -m venv); no uv or other third-party tool is required. ' +
        'Runs through the host subprocess channel so venv creation and pip bootstrapping work even though the shell sandbox blocks temporary directories and network access. ' +
        'Never touches the global Python environment. Returns the interpreter path for running Python from the environment.',
      parameters: {
        name: {
          type: 'string',
          description: 'Environment directory name (a plain single-segment name). Defaults to ".venv". Conventional alternatives: venv, env, .env.',
        },
        root_dir: {
          type: 'string',
          description: 'Directory the environment is created in. Defaults to the session workspace; must stay inside it.',
        },
        python: {
          type: 'string',
          description:
            'Base interpreter: an executable name ("python3.12"), a command ("py -3.12"), or a path. Defaults to a platform-appropriate chain (python then py -3 on Windows, python3 then python on POSIX).',
        },
      },
      output: {
        schema: { oneOf: [ERROR_BRANCH, RECORD_SCHEMA] },
        render(_args, value) {
          if (value && typeof value.error === 'string') return [{ type: 'text', text: value.error }]
          return [
            {
              type: 'text',
              text:
                (value.created ? 'created virtual environment ' : 'virtual environment already exists: ') +
                value.path +
                (value.version !== null ? ' (' + value.version + ')' : '') +
                '\nbase interpreter: ' + value.baseInterpreter +
                '\npython: ' + (value.python === null ? 'missing' : value.python) +
                (value.hasPip ? '' : '\nnote: pip is missing (pyenv_install repairs it via ensurepip)'),
            },
          ]
        },
      },
      // No definition-level timeoutMs: the tool owns its deadline so a
      // timeout surfaces as a detailed stop-reason, not the framework's bare
      // "tool call timed out" message.
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        try {
          const ws = sessionCwd(exec)
          assertWritableSession(ctx, exec, 'create a virtual environment')
          const extraRoots = await secondaryDirs(ctx, ws)
          const root = args.root_dir !== undefined ? guardAllowedPath(args.root_dir, ws, extraRoots, 'root_dir') : ws
          const rawName = args.name === undefined ? '' : String(args.name).trim()
          const name = rawName.length === 0 ? DEFAULT_VENV_NAME : rawName
          if (name.length > MAX_VENV_NAME_LENGTH || name === '.' || name === '..' || !VENV_NAME_RE.test(name)) {
            throw new Error('invalid venv name "' + name + '": expected a plain single-segment name matching ' + VENV_NAME_RE.source)
          }
          // Guarded even though the regex is restrictive: join(root, name) must
          // never be able to escape any allowed root.
          const target = guardAllowedPath(join(root, name), ws, extraRoots, 'venv')
          const subprocess = ctx.get('subprocess')
          if (subprocess === undefined) {
            throw new Error('dsh-python-env: no subprocess service is mounted (cannot create environments)')
          }
          await ensureEnvDirs(ws)
          const env = pythonChildEnv(ws)

          // Plugin-owned deadline: when it fires, the live subprocess tree is
          // terminated and a detailed stop-reason is returned instead of the
          // result (or a bare timeout error).
          let current = null
          const deadline = armDeadline(DEFAULT_TOOL_TIMEOUT_MS, () => current)
          try {
            let exists = false
            try {
              exists = (await stat(target)).isDirectory()
            } catch {
              // absent — creation path below
            }
            if (exists) {
              if (!(await isVenvDir(target))) {
                throw new Error('target exists and is not a virtual environment: ' + target)
              }
              const info = await probeVenvInfo(subprocess, target, env, exec && exec.signal, { onSpawn: (handle) => { current = handle } })
              if (deadline.fired()) {
                return { error: renderStopReason({ tool: 'pyenv_create', operation: 'probing the existing environment ' + target, budgetMs: DEFAULT_TOOL_TIMEOUT_MS }) }
              }
              return { name, path: target, ...info, created: false, alreadyExisted: true, baseInterpreter: 'existing environment' }
            }

            const base = await resolveBaseInterpreter(subprocess, args.python, process.platform, exec && exec.signal, (handle) => { current = handle })
            if (deadline.fired()) {
              return { error: renderStopReason({ tool: 'pyenv_create', operation: 'resolving the base Python interpreter', budgetMs: DEFAULT_TOOL_TIMEOUT_MS }) }
            }
            const result = await runForeground(
              subprocess,
              {
                argv: [...base.argv, '-m', 'venv', target],
                cwd: root,
                stdio: stdioSpec(),
                graceMs: 15_000,
                env,
              },
              exec && exec.signal,
              (handle) => { current = handle },
            )
            if (deadline.fired()) {
              return {
                error: renderStopReason({
                  tool: 'pyenv_create',
                  operation: 'python -m venv ' + target,
                  budgetMs: DEFAULT_TOOL_TIMEOUT_MS,
                  stdout: result.stdout.text,
                  stderr: result.stderr.text,
                }),
              }
            }
            if (result.exitCode === null) {
              return {
                error: renderAbortedReason({
                  tool: 'pyenv_create',
                  operation: 'python -m venv ' + target,
                  stdout: result.stdout.text,
                  stderr: result.stderr.text,
                }),
              }
            }
            if (result.exitCode !== 0) {
              let hint = ''
              if (/ensurepip|No module named venv|python3-venv/i.test(result.stderr.text + result.stdout.text)) {
                hint = ' (hint: on Debian/Ubuntu the venv module may need the python3-venv package)'
              }
              throw new Error('python -m venv failed' + hint + '\n' + (result.stderr.text + '\n' + result.stdout.text).slice(-2000))
            }
            if (!(await isVenvDir(target))) {
              throw new Error('venv creation reported success but ' + target + ' is missing the pyvenv.cfg marker')
            }
            const info = await probeVenvInfo(subprocess, target, env, exec && exec.signal, { onSpawn: (handle) => { current = handle } })
            if (deadline.fired()) {
              return { error: renderStopReason({ tool: 'pyenv_create', operation: 'probing the new environment ' + target, budgetMs: DEFAULT_TOOL_TIMEOUT_MS }) }
            }
            return {
              name,
              path: target,
              ...info,
              created: true,
              alreadyExisted: false,
              baseInterpreter: base.label + ' (' + base.version.text + ')',
            }
          } finally {
            deadline.dispose()
          }
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
        }
      },
      presentCall: (args) => ({
        card: 'terminal',
        title: 'python -m venv ' + (args && args.name ? String(args.name) : DEFAULT_VENV_NAME),
      }),
    }),
  )
}
