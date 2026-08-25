# dsh-python-env

**English** | [中文](README.zh.md)

> Workspace-scoped Python virtual environment management for a DeepSeek Harness project — discover, create, install into, and remove virtual environments without sandbox, network, or subprocess pitfalls.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/Node.js-%3E%3D20-brightgreen)](https://nodejs.org/)
[![npm version](https://img.shields.io/npm/v/dsh-python-env)](https://www.npmjs.com/package/dsh-python-env)
[![GitHub issues](https://img.shields.io/github/issues/AngelosZou/dsh-python-env)](https://github.com/AngelosZou/dsh-python-env/issues)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that gives one project (workspace) agent-facing Python virtual environment management:

- **Five model tools** — `pyenv_discover`, `pyenv_create`, `pyenv_install`, `pyenv_uninstall`, `pyenv_remove` — plus the `python-env` skill and a system-prompt guidance section.
- Runs the **standard library** `python -m venv` / `pip` through the platform **subprocess channel** (host process) instead of the sandboxed shell, so venv creation, `ensurepip` bootstrapping, and package-index network access work where shell-side pip fails.
- **Mirror and proxy fallback** — on a network-classified failure, installs retry across PyPI mirrors (TUNA, Aliyun, USTC) and probe common local proxy ports; `index` / `proxy` arguments pin either.
- **Workspace confinement** — every path resolves inside the session workspace (case-insensitive on Windows); caches and temp state live under `<workspace>/.dsh-pyenv/`; commands are argv arrays (no shell); the global Python environment, host pip cache, and system temp are never touched.
- **Cross-platform** — Windows / macOS / Linux layouts and interpreter chains (`Scripts` vs `bin`, `py -3` vs `python3`).
- **No third-party dependency** — no uv, no virtualenv, no other plugin. A pip-less environment is repaired offline via `ensurepip`.
- **Session policy parity** — the mutating tools consult the session's sandbox policy and refuse to run in read-only sessions; discovery stays available everywhere.

## Requirements

- Node.js >= 20
- A DSH profile composed from `@deepseek-ai/dsh-base` (it provides the `subprocess`, `jobs`, `tools`, and `skills` services the plugin uses)
- Python >= 3.8 (on PATH, or passed explicitly) — only for the environments the plugin manages

## Install

From npm:

```bash
dsh plugin --profile web add dsh-python-env
```

From a local checkout (development):

```bash
dsh plugin --profile web add link:<absolute-path-to-this-repo>
```

Then **restart the DSH backend** — the host composition loads at process start. The tools appear in new sessions: `pyenv_discover`, `pyenv_create`, `pyenv_install`, `pyenv_uninstall`, `pyenv_remove`, plus the `python-env` skill.

## Usage

Agent side:

| Tool | What it does |
| ---- | ------------ |
| `pyenv_discover` | Find environments up to two levels deep by the `pyvenv.cfg` marker or conventional names (`.venv`, `venv`, `env`, `.env`, `virtualenv`); report path, interpreter, version, pip availability. |
| `pyenv_create` | Create an environment with `python -m venv` — `name` / `root_dir` / base `python` arguments, idempotent on existing environments. |
| `pyenv_install` | Install `packages` and/or a `requirements` file into an environment (explicit `venv` / discovered / auto-created `.venv`); repairs missing pip via `ensurepip`; mirror/proxy fallback; `upgrade` flag; editable installs of local projects; `run_in_background` for long installs. |
| `pyenv_uninstall` | Remove packages from an environment (`pip uninstall -y`); offline; never auto-creates an environment. |
| `pyenv_remove` | Delete a real workspace environment only (refuses non-environments and workspace escapes). |

```text
pyenv_create                                  # -> .venv, interpreter path reported
pyenv_install { packages: ["pytest>=8"] }     # installs into .venv
pyenv_install { requirements: "requirements.txt" }
pyenv_uninstall { packages: ["pytest"] }      # removes packages again
pyenv_discover                                # inspect every environment
# run code with the reported interpreter:
#   Windows: <venv>\Scripts\python.exe    macOS/Linux: <venv>/bin/python
```

Behavior notes:

- The mutating tools (create / install / uninstall / remove) respect the session sandbox mode and refuse to run in **read-only** sessions; discovery still works.
- Common flows are all covered: pin versions (`"pkg==1.2.3"`), upgrade (`upgrade: true`), install from `requirements.txt` (`requirements`), and editable installs of local projects (`packages: ["-e", "."]` — the editable path must stay inside the workspace; remote/VCS editable URLs are rejected).
- Without a `venv` argument, `pyenv_install` uses the single discovered environment (preferring `.venv`), auto-creates `.venv` when none exists, and asks for an explicit `venv` when several exist.
- Background installs register with the jobs registry — poll with `job_output`, stop with `job_kill`.
- **Two-minute budget.** Every pyenv tool must finish within 2 minutes (discovery within 1). A tool that exceeds its budget terminates the running process tree and returns a detailed stop-reason — what was still running, the attempts tried, the last output, likely causes, and next steps — instead of hanging or reporting a bare timeout. Background installs share the same 2-minute cap; a per-call `timeoutMs` override on install/uninstall is honored but capped at 120000 ms.

## How it works

- **Subprocess channel** — the DSH shell sandbox blocks CPython's owner-only temp directories (Windows `[Errno 13]` during `ensurepip`/wheel unpacking) and package-index network access. Plugin code runs in the host process, so every python/pip/venv invocation goes through `ctx.subprocess` (the same channel the graphlint plugin uses) with argv arrays, byte-capped collected output, and tree-scoped termination. The unrestricted token is compensated by the confinement model below — not by weakening the sandbox.
- **Confinement** — every model-influenced path passes `guardWorkspacePath` (absolute resolution + containment, `..`-safe); venv names are single-segment regex-validated and re-guarded after `join`; children get `PIP_CACHE_DIR` / TMP / TEMP / TMPDIR re-pointed into `<workspace>/.dsh-pyenv/`.
- **Install attempt chain** — default index first; a network-classified failure (connection reset/timeout/DNS — never "No matching distribution found" or TLS errors) falls back across TUNA → Aliyun → USTC mirrors and, once, probes common local proxy ports (7890, 7891, 10809, 10808, 8888) to retry the same index through a live one.
- **ensurepip repair** — `<venv-python> -m ensurepip --upgrade` bootstraps pip offline from bundled wheels; when ensurepip itself is absent the error carries the Debian/Ubuntu `python3-venv` hint.
- **Concurrency** — mutating tools declare `isConcurrencySafe: false`, so the scheduler serializes them; discovery stays read-only.
- **Skill & guidance** — the `python-env` skill teaches tool-first usage and the "never escalate for pip" rule; one system-prompt section (`dsh-python-env:guidance`, order 120) reminds every session that the pyenv tools are the sanctioned path.

## Project layout

| Path | Purpose |
| ---- | ------- |
| `cordis.patch.yml` | Profile patch layer inserting the `dsh-python-env` row |
| `lib/index.js` | Host plugin: registers the five tools, the skill, and the guidance section |
| `lib/tools/` | The five model tools (`discover` / `create` / `install` / `uninstall` / `remove`) |
| `lib/guard.js`, `lib/venv.js`, `lib/layout.js`, `lib/paths.js`, `lib/python.js` | Workspace confinement, venv resolution, discovery, platform layouts, interpreter chains |
| `lib/runner.js`, `lib/pip.js`, `lib/envdir.js` | Subprocess seam, install chain, workspace caches |
| `test/` | Runtime-free behavior tests (see Development) |
| `docs/` | Design and analysis documents |

## Development

No build step: the plugin is plain ESM and the tests run with Node directly
(the mock ctx stands in for the DSH services; the real `defineTool` validates
every schema):

```bash
npm test
# or: node --test --test-isolation=none "test/*.test.js"
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development loop, including
offline dependency resolution.

## Compatibility

When DSH also has the [dsh-multi-folder](https://github.com/AngelosZou/dsh-multi-folder) plugin installed, the Agent can use the tools provided by dsh-python-env to manage the secondary working directories specified by the user in dsh-multi-folder, even when those working directories are outside the main working directory. Environment management permissions for the secondary working directories are the same as for the main working directory; when the Agent runs in Read Only mode, the tools refuse any operation. This compatibility is automatic and optional — it takes effect automatically whenever both dsh-multi-folder and dsh-python-env are installed in the DSH environment. If dsh-multi-folder is not installed, dsh-python-env's functionality is unaffected. This compatibility introduces no additional performance burden or context overhead.

## Security

Installing packages means executing third-party code: `pyenv_install` (including the auto-created `.venv` path) downloads and runs code from the configured index with the host user's privileges, and editable installs import in-workspace projects as-is. The plugin mitigates this with HTTPS-only indexes, workspace-only blast radius (a compromised environment is disposable via `pyenv_remove`), full routing transparency, session policy parity (read-only sessions cannot trigger any of it), and per-profile opt-in. See [SECURITY.md](SECURITY.md) for the complete threat model and mitigation list.

## Documentation

- [docs/design.md](docs/design.md) — architecture, confinement model, install chain, known limitations
- [SECURITY.md](SECURITY.md) — threat model and compensating controls

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and pull requests are welcome.

## License

[MIT](LICENSE)
