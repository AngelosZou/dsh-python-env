/**
 * The `python-env` skill: teaches the agent when and how to use the pyenv_*
 * tools, why shell-side pip fails under the DSH sandbox, and how to run code
 * from a workspace environment on each platform.
 * @module dsh-python-env/skill
 */

const SKILL = {
  name: 'python-env',
  description:
    'Manage workspace Python virtual environments through the pyenv_* tools (discover, create, install, remove) without sandbox, network, or subprocess pitfalls.',
  whenToUse:
    'When a task needs Python packages installed, a virtual environment created/discovered/removed in the workspace, or when pip / python -m venv fails in a shell with permission or network errors.',
  source: 'custom',
  invocation: { modelInvocable: true, userInvocable: true },
  content: `# python-env

## Use the tools
- \`pyenv_discover\` — find existing virtual environments in the workspace (up to two levels deep, by the pyvenv.cfg marker or common names: .venv, venv, env, .env, virtualenv). Reports path, interpreter, version, and pip availability. Read-only; available in every session mode.
- \`pyenv_create\` — create an environment with the standard library (\`python -m venv\`); no uv or other third-party tool is required. Pass \`name\` (default .venv), \`root_dir\`, or \`python\` (an executable name, a command like "py -3.12", or a path) when the defaults do not fit.
- \`pyenv_install\` — install packages (\`packages\` list of pip specs and/or a workspace \`requirements\` file) into a workspace environment. Without a \`venv\` argument it uses the single discovered environment (preferring .venv) or auto-creates .venv. Set \`run_in_background: true\` for long installs and poll with \`job_output\`.
  - Pin versions with pip specs (\`"pkg==1.2.3"\`, \`"pkg>=2,<3"\`).
  - Upgrade requested packages to their newest versions with \`upgrade: true\` (\`pip --upgrade\`).
  - Install a local project editable with \`packages: ["-e", "."]\` (or \`["--editable=./subdir"]\`); the editable path must stay inside the workspace, and remote/VCS editable URLs are rejected.
- \`pyenv_uninstall\` — remove packages from a workspace environment (\`packages\` list of names; \`pip uninstall -y\`). Offline; never auto-creates an environment.
- \`pyenv_remove\` — delete a workspace environment. Refuses anything that is not a real virtual environment.

## Why not pip / python -m venv in a shell
The DSH shell sandbox blocks pip's temporary directories (Windows) and all package-index network access, so shell-side installs fail or require escalation. The pyenv_* tools execute through the plugin's host subprocess channel and confine every write to the workspace, so they succeed where shell pip fails. Do NOT request sandbox escalation (\`sandbox_permissions\`) for pip — call \`pyenv_install\` instead.

## Running code from an environment
Use the interpreter path the tools report with your normal shell tools:
- Windows: \`<venv>\\Scripts\\python.exe\`
- macOS/Linux: \`<venv>/bin/python\`
Run tests and scripts with that interpreter so installed packages are importable. Creating/installing stays with the tools; running code stays in the shell.

## Behavior notes
- The mutating tools (create / install / uninstall / remove) respect the session's sandbox mode: they refuse to run in read-only sessions. Discovery still works.
- \`pyenv_install\` repairs a missing pip via \`ensurepip\` automatically.
- On network failure the install retries across mirrors (TUNA, Aliyun, USTC) and probes common local proxy ports; pin a mirror/proxy with the \`index\`/\`proxy\` arguments when needed.
- Every mutation stays inside the workspace (\`.dsh-pyenv\` holds caches and temp state); the global Python environment is never touched.
- Installing packages executes third-party code — install only what the task needs, prefer pinned versions, and remember any environment is disposable with \`pyenv_remove\`.
`,
}

export function registerSkill(ctx) {
  ctx.skills.register(SKILL)
}
