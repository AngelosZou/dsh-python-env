# dsh-python-env

DeepSeek Harness plugin: **workspace-scoped Python virtual environment
management for agents**. Discover, create, install into, and remove virtual
environments — with every mutation confined to the session workspace and the
global Python environment never touched.

## Why

The DSH shell sandbox blocks two things pip needs: CPython's owner-only
temporary directories (Windows `[Errno 13]` during `ensurepip`/wheel
unpacking) and package-index network access. This plugin runs
`python`/`pip`/`venv` through the platform **subprocess channel** (host
process, like the graphlint plugin) instead of the sandboxed shell, and
compensates with strict workspace confinement:

- every path resolves inside the workspace (case-insensitive on Windows);
- caches and temp state live under `<workspace>/.dsh-pyenv/`;
- commands are argv arrays — no shell interpolation;
- the global interpreter/pip cache/system temp are never touched;
- on network failure, installs retry across mirrors (TUNA, Aliyun, USTC)
  and probe common local proxy ports.

**Standard library only** — no uv, no virtualenv, no other plugin.

## Tools

| Tool | What it does |
| ---- | ------------ |
| `pyenv_discover` | Find environments up to two levels deep by the `pyvenv.cfg` marker or conventional names (`.venv`, `venv`, `env`, `.env`, `virtualenv`); report path, interpreter, version, pip. |
| `pyenv_create` | Create an environment with `python -m venv` (name / root_dir / base interpreter args; idempotent). |
| `pyenv_install` | Install `packages` and/or a `requirements` file into an environment (explicit / discovered / auto-created `.venv`); repairs missing pip via `ensurepip`; mirror/proxy fallback; background mode. |
| `pyenv_remove` | Delete a real workspace environment (refuses non-environments). |

Cross-platform: Windows (`Scripts\python.exe`), macOS/Linux (`bin/python`).

## Install

```sh
dsh plugin --profile <profile> add link:<absolute-path-to-this-repo>
```

(The standard web profile is `web`.) Restart the DSH host (or reload
plugins) so the bundle row activates. The tools then appear in agent
sessions: `pyenv_discover`, `pyenv_create`, `pyenv_install`,
`pyenv_remove`, plus the `python-env` skill.

## Quickstart (agent side)

```text
pyenv_create                                  # -> .venv, python path reported
pyenv_install { packages: ["pytest>=8"] }     # installs into .venv
pyenv_install { requirements: "requirements.txt" }
pyenv_discover                                # inspect everything
# run code with the reported interpreter, e.g. <ws>\.venv\Scripts\python.exe
```

## Development

```sh
# tests (no DSH runtime required; mocks stand in for the platform services)
node --test --test-isolation=none "test/*.test.js"
```

Local dev resolves `@deepseek-ai/dsh-tools` via the profile's node_modules
(junction) or `npm install`. See [docs/design.md](docs/design.md) for the
architecture and [SECURITY.md](SECURITY.md) for the threat model.

## License

MIT
