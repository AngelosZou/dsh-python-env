/**
 * One compact system-prompt guidance section (the 100–129 tool-guidance
 * band) so every session knows the pyenv_* tools are the sanctioned path for
 * Python environment management and shell-side pip/venv is a known trap.
 * @module dsh-python-env/guidance
 */

const SECTION_NAME = 'dsh-python-env:guidance'
const SECTION_ORDER = 120

const GUIDANCE_TEXT =
  'Python environment management (creating a virtual environment or installing packages) must go through the pyenv_* tools ' +
  'provided by the dsh-python-env plugin: pyenv_discover, pyenv_create, pyenv_install, pyenv_remove. ' +
  'Do not run pip, python -m venv, or ensurepip directly in a shell — the shell sandbox blocks pip\'s temporary directories and ' +
  'package-index network access; the tools execute through the host channel with every write confined to the workspace ' +
  '(.dsh-pyenv holds the caches) and never touch the global Python environment. ' +
  'Run code with the interpreter path the tools report (Windows <venv>\\Scripts\\python.exe, macOS/Linux <venv>/bin/python).'

export function registerGuidance(ctx) {
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: () => GUIDANCE_TEXT,
  })
}
