/**
 * `pyenv_install` — install packages into a workspace virtual environment
 * through the host subprocess channel, with the mirror/proxy fallback chain.
 * Supports foreground and background execution.
 * @module dsh-python-env/tools/install
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { guardWorkspacePath, sessionCwd } from '../guard.js'
import { isVenvDir } from '../layout.js'
import { pickVenvInterpreter, resolveExistingVenv } from '../venv.js'
import { resolveBaseInterpreter } from '../python.js'
import { assertWritableSession } from '../policy.js'
import { ensureEnvDirs, pythonChildEnv } from '../envdir.js'
import { ensurePip, runInstallAttempts } from '../pip.js'
import { JobLog, runForeground, startBackgroundJob, stdioSpec } from '../runner.js'
import { BACKGROUND_INSTALL_CAP_MS, DEFAULT_INSTALL_TIMEOUT_MS, DEFAULT_VENV_NAME, MAX_PACKAGES, MAX_SPEC_LENGTH } from '../constants.js'
import { BACKGROUND_BRANCH, ERROR_BRANCH, FOREGROUND_PROPERTIES, renderForegroundText } from '../render.js'

const ATTEMPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    index: { type: 'string', required: true },
    proxy: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
    exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
  },
}

const INSTALL_FOREGROUND_BRANCH = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...FOREGROUND_PROPERTIES,
    tried: { type: 'array', required: true, items: ATTEMPT_SCHEMA },
    indexUsed: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
    proxyUsed: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
}

/**
 * Validate and normalize install specs, with editable-install confinement:
 * `-e` / `--editable` targets must be LOCAL paths inside the workspace;
 * remote/VCS editable URLs are rejected (install them as plain VCS
 * requirement specs instead). Validated paths are rewritten to their
 * guarded absolute form.
 */
function validateAndNormalizeSpecs(specs, ws) {
  const out = []
  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i]
    if (spec === '-e' || spec === '--editable') {
      if (i + 1 >= specs.length) throw new Error('editable spec "' + spec + '" is missing its project path')
      out.push(spec, editablePath(specs[i + 1], ws))
      i += 1
      continue
    }
    const longForm = /^--editable=(.+)$/.exec(spec)
    if (longForm !== null) {
      out.push('--editable=' + editablePath(longForm[1], ws))
      continue
    }
    const shortForm = /^-e(.+)$/.exec(spec)
    if (shortForm !== null) {
      out.push('-e', editablePath(shortForm[1], ws))
      continue
    }
    out.push(spec)
  }
  return out
}

function editablePath(raw, ws) {
  const text = String(raw).trim()
  if (text.length === 0) throw new Error('editable install requires a project path')
  if (/^(git|hg|svn|bzr)\+/.test(text) || /^https?:\/\//i.test(text)) {
    throw new Error(
      'editable install from ' + text.slice(0, 40) + ' is not supported: only local editable paths inside the session workspace are allowed (clone the project into the workspace first, or install it as a plain VCS requirement spec)',
    )
  }
  return guardWorkspacePath(text, ws, 'editable path')
}

export function registerInstallTool(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'pyenv_install',
      description:
        'Install Python packages into a workspace virtual environment. Resolves the target environment (explicit venv argument, discovered environments, or auto-created .venv), repairs a missing pip, then runs pip install through the host subprocess channel. ' +
        'On network failure it automatically retries across PyPI mirrors (TUNA, Aliyun, USTC) and probes common local proxy ports. ' +
        'Use this instead of pip in a shell — the shell sandbox blocks package-index network access and pip\'s temporary directories. Accepts package requirement specs and/or a workspace requirements file. Never touches the global Python environment.',
      parameters: {
        packages: {
          type: 'array',
          items: { type: 'string' },
          description: 'pip requirement specs to install, e.g. ["pytest>=8", "tree-sitter"]. At least one package or a requirements file is required.',
        },
        requirements: {
          type: 'string',
          description: 'Workspace-relative path to a requirements.txt-style file to install from.',
        },
        venv: {
          type: 'string',
          description:
            'Target environment: a directory name or workspace path. Defaults to the single discovered environment (preferring .venv) and auto-creates .venv when none exists. Multiple environments require this argument.',
        },
        python: {
          type: 'string',
          description: 'Base interpreter for the auto-created environment (see pyenv_create).',
        },
        upgrade: {
          type: 'boolean',
          description: 'Upgrade the requested packages to the newest available versions (pip --upgrade; applies to every requested spec).',
        },
        index: {
          type: 'string',
          description: 'Pin one package index URL, e.g. https://pypi.tuna.tsinghua.edu.cn/simple (disables the automatic mirror fallback chain).',
        },
        proxy: {
          type: 'string',
          description:
            'Explicit HTTP proxy for pip ("host:port" or http(s) URL). Defaults to the ambient HTTP_PROXY/HTTPS_PROXY, then to common local proxy ports after a network failure.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Foreground timeout in milliseconds (default 600000). The framework kills the process tree on expiry.',
        },
        run_in_background: {
          type: 'boolean',
          description: 'Run the install as a background job (poll with job_output). No timeout applies; a 30-minute hard cap is enforced.',
        },
      },
      output: {
        schema: { oneOf: [BACKGROUND_BRANCH, INSTALL_FOREGROUND_BRANCH, ERROR_BRANCH] },
        render(_args, value) {
          if (value && typeof value.error === 'string') return [{ type: 'text', text: value.error }]
          if (value && value.kind === 'background') {
            return [{ type: 'text', text: 'started background job ' + value.jobId + ' (poll with job_output)' }]
          }
          let text = renderForegroundText(value)
          if (Array.isArray(value.tried) && value.tried.length > 0) {
            if (text.length > 0 && !text.endsWith('\n')) text += '\n'
            text +=
              'attempts: ' +
              value.tried
                .map((attempt) => attempt.index + (attempt.proxy !== null ? ' via ' + attempt.proxy : '') + ' (exit ' + attempt.exitCode + ')')
                .join(' -> ')
          }
          return [{ type: 'text', text }]
        },
      },
      timeoutMs: DEFAULT_INSTALL_TIMEOUT_MS,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        try {
          const ws = sessionCwd(exec)
          assertWritableSession(ctx, exec, 'install packages')
          await ensureEnvDirs(ws)
          const env = pythonChildEnv(ws)
          const subprocess = ctx.get('subprocess')
          if (subprocess === undefined) {
            throw new Error('dsh-python-env: no subprocess service is mounted (cannot install packages)')
          }

          const specs = []
          if (args.packages !== undefined) {
            if (!Array.isArray(args.packages)) throw new Error('packages must be an array of requirement strings')
            for (const raw of args.packages) {
              const spec = typeof raw === 'string' ? raw.trim() : ''
              if (spec.length === 0) continue
              if (spec.length > MAX_SPEC_LENGTH) {
                throw new Error('package spec too long (max ' + MAX_SPEC_LENGTH + '): ' + spec.slice(0, 80) + '...')
              }
              specs.push(spec)
            }
            if (specs.length > MAX_PACKAGES) throw new Error('too many packages (max ' + MAX_PACKAGES + ')')
          }
          let requirementsPath
          if (args.requirements !== undefined && String(args.requirements).trim().length > 0) {
            requirementsPath = guardWorkspacePath(args.requirements, ws, 'requirements')
            const info = await stat(requirementsPath)
            if (!info.isFile()) throw new Error('requirements is not a file: ' + requirementsPath)
          }
          if (specs.length === 0 && requirementsPath === undefined) {
            throw new Error('nothing to install: pass "packages" and/or a "requirements" file')
          }
          const normalizedSpecs = validateAndNormalizeSpecs(specs, ws)

          // Resolve the target environment (shared logic with pyenv_uninstall).
          let venvDir = await resolveExistingVenv(ws, args.venv)
          let created = false
          if (venvDir === null) {
            venvDir = join(ws, DEFAULT_VENV_NAME)
            created = true
          }
          if (created) {
            const base = await resolveBaseInterpreter(subprocess, args.python, process.platform, exec && exec.signal)
            const createResult = await runForeground(
              subprocess,
              { argv: [...base.argv, '-m', 'venv', venvDir], cwd: ws, stdio: stdioSpec(), graceMs: 60_000, env },
              exec && exec.signal,
            )
            if (createResult.exitCode !== 0) {
              throw new Error('auto venv creation failed\n' + (createResult.stderr.text + '\n' + createResult.stdout.text).slice(-2000))
            }
            if (!(await isVenvDir(venvDir))) {
              throw new Error('auto venv creation reported success but ' + venvDir + ' has no pyvenv.cfg marker')
            }
          }
          const venvPython = await pickVenvInterpreter(venvDir)
          if (venvPython === null) throw new Error('virtual environment has no usable interpreter: ' + venvDir)
          await ensurePip(subprocess, venvPython, env, exec && exec.signal)

          const opts = {
            subprocess,
            signal: exec && exec.signal,
            cwd: ws,
            venvPython,
            specs: normalizedSpecs,
            requirementsPath,
            index: args.index,
            proxy: args.proxy,
            upgrade: args.upgrade === true,
            env,
          }

          if (args.run_in_background === true) {
            if (exec && exec.signal && exec.signal.aborted) throw new Error('tool call aborted')
            const log = new JobLog()
            let current = null
            let capped = false
            const capTimer = setTimeout(() => {
              capped = true
              if (current !== null) current.terminate()
            }, BACKGROUND_INSTALL_CAP_MS)
            if (typeof capTimer.unref === 'function') capTimer.unref()
            const jobId = startBackgroundJob(ctx, exec, 'pyenv-install', 'pip install in ' + venvDir, log, {
              cancel: () => {
                if (current !== null) current.terminate()
              },
              done: async () => {
                try {
                  const outcome = await runInstallAttempts({
                    ...opts,
                    signal: undefined,
                    onSpawn: (handle) => {
                      current = handle
                    },
                    onAttempt: (result) => {
                      log.append(result.stdout.text)
                      if (result.stderr.text.length > 0) log.append(result.stderr.text)
                    },
                    shouldStop: () => capped,
                  })
                  if (capped) {
                    return {
                      status: 'failed',
                      detail: 'install exceeded the ' + Math.round(BACKGROUND_INSTALL_CAP_MS / 60_000) + '-minute background cap and was terminated',
                    }
                  }
                  if (outcome.ok) return { status: 'completed', detail: 'install finished (index: ' + outcome.indexUsed + ')' }
                  return { status: 'failed', detail: 'install failed (exit ' + outcome.result.exitCode + ', index: ' + outcome.indexUsed + ')' }
                } finally {
                  clearTimeout(capTimer)
                }
              },
            })
            return { kind: 'background', jobId }
          }

          const outcome = await runInstallAttempts(opts)
          return {
            kind: 'foreground',
            exitCode: outcome.result.exitCode,
            timedOut: outcome.result.timedOut,
            stdout: outcome.result.stdout,
            stderr: outcome.result.stderr,
            tried: outcome.tried,
            indexUsed: outcome.indexUsed,
            proxyUsed: outcome.proxyUsed,
          }
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
        }
      },
      presentCall: (args) => ({
        card: 'terminal',
        title: 'pip install' + (args && Array.isArray(args.packages) && args.packages.length > 0 ? ' ' + args.packages.join(' ') : ''),
      }),
    }),
  )
}
