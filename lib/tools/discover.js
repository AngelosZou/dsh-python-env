/**
 * `pyenv_discover` — scan the workspace (and, when the dsh-multi-folder
 * plugin is installed, its configured secondary working directories) for
 * virtual environments and report their health. Read-only: never creates or
 * modifies anything.
 * @module dsh-python-env/tools/discover
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { guardAllowedPath, sessionCwd } from '../guard.js'
import { discoverVenvCandidates } from '../layout.js'
import { probeVenvInfo } from '../venv.js'
import { secondaryDirs } from '../secondary.js'
import { pythonChildEnv } from '../envdir.js'
import { DISCOVERY_MAX_PROBES } from '../constants.js'
import { ERROR_BRANCH } from '../render.js'

const VENV_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    path: { type: 'string', required: true },
    python: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
    version: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
    hasPip: { type: 'boolean', required: true },
    valid: { type: 'boolean', required: true },
  },
}

export function registerDiscoverTool(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'pyenv_discover',
      description:
        'Discover Python virtual environments inside the session workspace (up to two levels deep) by the standard pyvenv.cfg marker or conventional directory names (.venv, venv, env, .env, virtualenv). Reports each environment\'s path, Python interpreter path, version, and pip availability. Read-only.',
      parameters: {
        root_dir: {
          type: 'string',
          description:
            'Directory to scan. Defaults to the session workspace; must stay inside it. A path pointing at a virtual environment itself is also accepted.',
        },
      },
      output: {
        schema: {
          oneOf: [
            ERROR_BRANCH,
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                scanned: { type: 'array', required: true, items: { type: 'string' } },
                venvs: { type: 'array', required: true, items: VENV_SCHEMA },
              },
            },
          ],
        },
        render(_args, value) {
          if (value && typeof value.error === 'string') return [{ type: 'text', text: value.error }]
          const lines =
            value.venvs.length === 0
              ? ['no virtual environment found under ' + value.scanned.join(', ')]
              : value.venvs.map((venv) => {
                  const bits = [
                    venv.name +
                      ' (' +
                      (venv.valid ? 'valid' : 'invalid') +
                      ')' +
                      (venv.version !== null ? ' — ' + venv.version : '') +
                      (venv.hasPip ? ' — pip' : ' — no pip'),
                    '  python: ' + (venv.python === null ? 'missing' : venv.python),
                  ]
                  return bits.join('\n')
                })
          lines.push('scanned: ' + value.scanned.join(', '))
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      // Read-only scan, budgeted well under a minute; the declared framework
      // budget is a backstop and a bare timeout message is acceptable here.
      timeoutMs: 60_000,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        try {
          const ws = sessionCwd(exec)
          const extraRoots = await secondaryDirs(ctx, ws)
          let roots
          if (args.root_dir !== undefined) {
            roots = [guardAllowedPath(args.root_dir, ws, extraRoots, 'root_dir')]
          } else {
            roots = [ws, ...extraRoots]
          }
          const subprocess = ctx.get('subprocess')
          if (subprocess === undefined) {
            throw new Error('dsh-python-env: no subprocess service is mounted (cannot probe interpreters)')
          }
          const candidates = []
          const seen = new Set()
          for (const root of roots) {
            for (const candidate of await discoverVenvCandidates(root)) {
              const key = process.platform === 'win32' ? candidate.dir.toLowerCase() : candidate.dir
              if (seen.has(key)) continue
              seen.add(key)
              candidates.push(candidate)
            }
          }
          const env = pythonChildEnv(ws)
          const venvs = []
          let probes = 0
          for (const candidate of candidates) {
            const info = await probeVenvInfo(subprocess, candidate.dir, env, exec && exec.signal, {
              withVersion: probes < DISCOVERY_MAX_PROBES,
            })
            if (info.version !== null) probes += 1
            venvs.push({ name: candidate.name, path: candidate.dir, ...info })
          }
          return { scanned: roots, venvs }
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
        }
      },
      presentCall: (args) => ({
        card: 'generic',
        title: 'pyenv_discover' + (args && args.root_dir ? ' ' + args.root_dir : ''),
      }),
    }),
  )
}
