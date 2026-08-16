/**
 * `pyenv_remove` — delete a workspace virtual environment. Refuses to touch
 * anything that is not a real environment (pyvenv.cfg marker required) or
 * anything outside the session workspace.
 * @module dsh-python-env/tools/remove
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { rm, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { sessionCwd } from '../guard.js'
import { assertWritableSession } from '../policy.js'
import { secondaryDirs } from '../secondary.js'
import { isVenvDir } from '../layout.js'
import { resolveVenvArg } from '../venv.js'
import { ERROR_BRANCH } from '../render.js'

const RECORD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    removed: { type: 'boolean', required: true },
    name: { type: 'string', required: true },
    path: { type: 'string', required: true },
  },
}

export function registerRemoveTool(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'pyenv_remove',
      description:
        'Delete a workspace virtual environment. Refuses to delete directories that are not valid virtual environments (the pyvenv.cfg marker is required) or anything outside the session workspace.',
      parameters: {
        venv: {
          type: 'string',
          required: true,
          description: 'The environment to delete: a directory name or workspace path (e.g. ".venv" or "backend/env").',
        },
      },
      output: {
        schema: { oneOf: [ERROR_BRANCH, RECORD_SCHEMA] },
        render(_args, value) {
          if (value && typeof value.error === 'string') return [{ type: 'text', text: value.error }]
          return [{ type: 'text', text: 'removed virtual environment ' + value.path }]
        },
      },
      timeoutMs: 120_000,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        try {
          const ws = sessionCwd(exec)
          assertWritableSession(ctx, exec, 'remove a virtual environment')
          const extraRoots = await secondaryDirs(ctx, ws)
          if (args.venv === undefined || String(args.venv).trim().length === 0) {
            throw new Error('venv is required: the environment directory name or path to delete')
          }
          const target = resolveVenvArg(args.venv, ws, extraRoots)
          let exists = false
          try {
            exists = (await stat(target)).isDirectory()
          } catch {
            // absent — reject below
          }
          if (!exists) throw new Error('venv not found: ' + target)
          if (!(await isVenvDir(target))) {
            throw new Error('refusing to delete a non-virtual-environment directory (no pyvenv.cfg): ' + target)
          }
          await rm(target, { recursive: true, force: true })
          return { removed: true, name: basename(target), path: target }
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
        }
      },
      presentCall: (args) => ({ card: 'generic', title: 'pyenv_remove ' + String(args && args.venv ? args.venv : '') }),
    }),
  )
}
