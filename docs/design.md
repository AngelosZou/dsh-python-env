# Design

Architecture and invariants of `dsh-python-env`.

## Goal

One DSH project (workspace) gains agent-facing **Python virtual environment
management** that works despite the DSH shell sandbox: discover, create,
install into, and remove virtual environments, with every mutation confined
to the workspace and the global Python environment never touched. The plugin
is self-contained (no uv, no virtualenv, no other plugin), cross-platform
(Windows / macOS / Linux), and network-resilient (mirror fallback chain plus
local proxy probing).

## Why host-side subprocess execution

The DSH shell sandbox blocks two things pip needs:

1. **Temporary directories** — on Windows the sandbox token cannot re-open
   CPython's owner-only (0o700) temp directories, so `python -m venv`'s
   `ensurepip` bootstrap fails with `[Errno 13]` and pip installs fail while
   unpacking wheels. TMP redirection inside the workspace does not help
   because the 0o700 DACL is applied by CPython itself, not by the temp path.
2. **Package-index network access** — outbound connections from sandboxed
   commands are closed at the network layer.

Plugin code runs in the DSH **host process**, outside the agent sandbox. This
plugin therefore executes every python/pip/venv invocation through the
platform **subprocess service** (`ctx.get('subprocess')`, the channel the
dsh-graphlint plugin uses) instead of the sandboxed shell executor. The
service is a plain child-process manager: host token, piped collected stdio
with byte caps and spill files, tree-scoped termination (Windows taskkill /
POSIX groups). The sandbox boundary itself is untouched — the plugin
compensates for the unrestricted token with strict workspace confinement
(see below). This is the same execution-world decision the graphlint
integration makes.

## Planes

| Half | Files | Role |
| ---- | ----- | ---- |
| Host | `lib/index.js`, `lib/tools/*` | Four model tools, skill, guidance section |
| Host | `lib/guard.js`, `lib/venv.js` | Workspace confinement, venv resolution |
| Host | `lib/layout.js`, `lib/paths.js`, `lib/python.js` | Discovery, platform layouts, interpreter chains |
| Host | `lib/runner.js`, `lib/pip.js`, `lib/envdir.js` | Subprocess seam, install chain, workspace caches |

No client half: the tools return plain structured results plus text renders.

## Confinement model

- Every model-influenced path goes through `guardWorkspacePath` and must
  resolve **inside** the session workspace (case-insensitive on Windows,
  `..`-safe via `path.resolve` + `relative`). Venv names are regex-validated
  and additionally guarded after `join` so no composition can escape.
- All plugin state lives under `<workspace>/.dsh-pyenv/`: `cache/`
  (`PIP_CACHE_DIR`), `tmp/` (TMP/TEMP/TMPDIR for every child), and a
  `.gitignore` that excludes the whole tree.
- Children get explicit env: `PYTHONIOENCODING=utf-8`,
  `PIP_DISABLE_PIP_VERSION_CHECK=1`, plus the re-pointed cache/tmp. The
  subprocess service scrubs credential-shaped env names; ambient PATH and
  proxy variables survive for the child.
- Commands are **argv arrays** — no shell is ever involved, so package
  specs cannot inject shell syntax.
- pip never runs against the global interpreter: the venv's own python is
  resolved per platform and invoked as `<venv-python> -m pip ...`.
- Editable installs (`-e` / `--editable`) are confined too: targets must be
  local paths inside the workspace (rewritten to their guarded absolute
  form); remote and VCS editable URLs are rejected, so this execution
  surface stays local and visible.

## Session policy parity

Host-side execution would otherwise outrank the mode the user granted the
session, so every mutating tool starts by consulting the session's standing
sandbox policy (`sandboxPolicy.resolve({ session })`, the multi-folder
pattern): `read-only` sessions are refused with a clear error,
`workspace-write` and `danger-full-access` pass, and an unmounted policy
service fails closed. `pyenv_discover` stays available in every mode
(read-only by construction).

## Tools

| Tool | Semantics | Concurrency |
| ---- | --------- | ----------- |
| `pyenv_discover` | Bounded BFS (depth 2, ≤256 dirs, pruned noise subtrees) recognizing `pyvenv.cfg` markers or conventional names (`.venv`, `venv`, `env`, `.env`, `virtualenv`, `.virtualenv`); probes interpreter existence, version (capped), pip presence | safe (read-only) |
| `pyenv_create` | Resolve a verified base interpreter (explicit arg or platform chain: `python` → `py -3` on Windows, `python3` → `python` on POSIX, all version-checked ≥3.8); run `<base> -m venv <target>`; idempotent on existing environments | exclusive |
| `pyenv_install` | Resolve target (explicit `venv` / discovered / auto-created `.venv`) via the shared `resolveExistingVenv` core; validate specs (editable confinement); repair pip via `ensurepip` when missing; run the install attempt chain with optional `--upgrade`; foreground or background via `ctx.jobs` | exclusive |
| `pyenv_uninstall` | Resolve target (never auto-created); run `pip uninstall -y`; fully offline | exclusive |
| `pyenv_remove` | Delete a directory that carries the `pyvenv.cfg` marker, inside the workspace only | exclusive |

Mutating tools declare `isConcurrencySafe: () => false`, so the tool
scheduler serializes them natively; discovery stays read-only. No custom
mutex is needed inside one DSH process (see Limitations for multi-process).

## Install attempt chain

1. `pip install` against pip's own default index (`--index-url` absent),
   with `--retries 2 --timeout 15 --no-input --no-color`.
2. On a **network-classified** failure (connection reset/timeout/DNS/
   unreachable/urllib3 retry banner — never "No matching distribution
   found" or TLS errors), two independent fallbacks kick in:
   - **Mirrors**: TUNA → Aliyun → USTC, in order.
   - **Local proxy**: after the first network failure with no proxy
     configured, common proxy ports on 127.0.0.1 (7890, 7891, 10809, 10808,
     8888) are probed once (400 ms each); a live listener is retried against
     the same index via `--proxy`.
3. An explicit `index` pins one index (chain disabled, proxy probing kept);
   an explicit `proxy` or ambient `HTTP(S)_PROXY` skips port probing.
4. The result reports every attempt (`index`, `proxy`, `exitCode`) so the
   agent can see exactly how the install was routed.

Background installs run the same chain inside a jobs-registry job with an
in-memory bounded `JobLog` streaming reads and a 30-minute hard cap that
terminates the live attempt tree.

## pip repair (ensurepip)

A virtual environment whose pip is missing (e.g. created earlier by a
sandboxed `python -m venv` that failed at ensurepip) is repaired offline:
`<venv-python> -m ensurepip --upgrade` uses the interpreter's bundled wheels.
If ensurepip itself is absent, the error carries the Debian/Ubuntu
`python3-venv` hint.

## Cross-platform notes

- Layouts: `Scripts/python.exe` / `Scripts/pip.exe` (Windows) vs
  `bin/python`(+`bin/python3` fallback) / `bin/pip`(+`bin/pip3`) (POSIX).
- Interpreter chains per platform; Windows also falls back to the `py`
  launcher (`py -3`).
- Path containment is case-insensitive on Windows, exact on POSIX.
- Env vars set for children cover all three temp spellings (TMP, TEMP,
  TMPDIR) and are harmless on every platform.
- Version probes force `PYTHONIOENCODING=utf-8` so localized code pages
  cannot garble output.

## Skill and guidance

- The `python-env` skill (`ctx.skills.register`) teaches tool-first usage,
  the sandbox root cause, per-platform interpreter paths, and the
  "never escalate for pip" rule.
- One system-prompt section (`dsh-python-env:guidance`, order 120, the
  tool-guidance band) reminds every session that pyenv_* is the sanctioned
  path.

## Tests

`test/*.test.js` run without the DSH runtime (`node --test
--test-isolation=none "test/*.test.js"`): pure-logic units (guard, paths,
policy gate, venv target resolution, pip chain/classification/argv, JobLog,
interpreter resolution) plus a smoke suite that applies the real plugin
against a mock ctx and drives all five tools with fake subprocess/jobs
services and a real temporary workspace. Because the real `defineTool`
runs, every parameter and output schema is validated against the enforced
JSON Schema subset at registration time.

## Known limitations

- **Multi-process concurrency**: exclusivity is scheduler-native within one
  DSH process. Two DSH instances mutating the same workspace concurrently
  are not coordinated (venv/pip operations are largely idempotent or fail
  visibly).
- **sdist builds** need a working compiler; the failure surfaces pip's own
  error (network for build deps uses the same mirror chain).
- **conda environments** (no `pyvenv.cfg`) are not recognized.
- **Editable installs are local-only**: `-e git+https://...` URLs are
  rejected; clone the project into the workspace or install it as a plain
  VCS requirement spec.
- Version probing skips environments beyond the discovery probe cap, so
  very large workspaces may report `version: null` for some environments.
- The plugin requires the platform subprocess, jobs, and sandbox-policy
  services, which the standard DSH profiles provide.
- The tools give the agent network egress limited to package indexes and
  the ability to execute arbitrary package build/install code inside the
  workspace venv — the same capability pip grants, now reachable from the
  sandbox. See SECURITY.md for the threat model and mitigations.
