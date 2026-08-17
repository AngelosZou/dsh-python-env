# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — 2026-08-17

### Changed

- **Time budgets cut to two minutes.** Every pyenv_* tool now must finish
  within 120 seconds: `pyenv_create` and `pyenv_uninstall` moved from 5-minute
  budgets, `pyenv_install` from a 10-minute foreground budget, and background
  installs from a 30-minute hard cap to the same 2-minute cap. A per-call
  `timeoutMs` override on install/uninstall is honored but capped at 120000 ms
  — environment management commands no longer run for tens of minutes.
- **Detailed stop-reasons on timeout.** The tools now own their deadlines
  instead of declaring a framework budget (which surfaced only a bare "tool
  call timed out" message). When a deadline fires, the running process tree is
  terminated and the tool returns a detailed explanation: the operation that
  was still running, the attempts already tried (index/proxy/exit), the last
  output, likely causes (slow or unreachable index/network, oversized
  dependency set), and concrete next steps. A subprocess terminated without a
  normal exit (caller cancellation) gets the same treatment via a dedicated
  aborted-reason message.
- Termination grace periods trimmed so a stopped process tree settles quickly
  (pip install/uninstall attempts 15s → 5s, venv creation 60s → 15s,
  ensurepip bootstrap 60s → 30s), keeping the detailed stop-reason close to
  the time budget.

## [0.1.0] — 2026-08-16

### Added

- `pyenv_discover`: bounded workspace scan (two levels deep) recognizing virtual
  environments by the standard `pyvenv.cfg` marker or conventional names
  (`.venv`, `venv`, `env`, `.env`, `virtualenv`, `.virtualenv`), reporting path,
  interpreter, version, and pip availability. The scan root's own directory
  name is never treated as an environment hint.
- `pyenv_create`: standard-library `python -m venv` with platform interpreter
  chains (`python` → `py -3` on Windows, `python3` → `python` on POSIX),
  version verification (≥ 3.8), explicit `name` / `root_dir` / `python`
  arguments, and idempotent recognition of existing environments.
- `pyenv_install`: target resolution (explicit `venv` / discovered /
  auto-created `.venv`), offline pip repair via `ensurepip`, package specs
  and/or workspace `requirements` files, the mirror fallback chain
  (default → TUNA → Aliyun → USTC) driven by network-failure classification,
  common-local-proxy-port probing, explicit `index` / `proxy` arguments,
  foreground timeouts, and background execution through the jobs registry with
  a 30-minute hard cap.
- `pyenv_install` `upgrade` flag (pip `--upgrade`).
- Editable installs (`-e` / `--editable`) with workspace confinement: local
  paths are validated and rewritten to their guarded absolute form; remote
  and VCS editable URLs are rejected.
- `pyenv_uninstall`: uninstall packages from a workspace environment
  (`pip uninstall -y`); fully offline and never auto-creates an environment.
  Shares one target-resolution core with `pyenv_install`
  (`resolveExistingVenv`).
- `pyenv_remove`: deletion of real workspace environments only (marker
  required, workspace confinement enforced).
- Workspace-scoped state: `.dsh-pyenv/` cache/tmp directories with
  `PIP_CACHE_DIR` and TMP/TEMP/TMPDIR re-pointing for every child process,
  plus a `.gitignore` for the whole tree.
- Session policy parity: the mutating tools consult the session's standing
  sandbox policy and refuse to run in read-only sessions; they fail closed
  when the policy service is absent. Discovery remains available everywhere.
- Optional, zero-dependency compatibility with dsh-multi-folder: when that
  plugin is installed, its configured secondary working directories
  automatically become valid roots for every pyenv_* tool under the same
  session mode; without it, nothing changes (silent capability probe, no
  inject declaration, no extra context).
- `python-env` skill and the `dsh-python-env:guidance` system-prompt section
  (order 120, the tool-guidance band), covering uninstall, upgrade, editable
  installs, version pinning, and the read-only gate.
- Security documentation: an "Automated environment management risks"
  section in SECURITY.md (malicious/typosquatted packages, hash pinning via
  hashed requirements files, blast radius, transparency, policy parity) and
  a Security section in both READMEs.
- Runtime-free test suite covering confinement, discovery, the install
  chain, interpreter resolution, policy parity, secondary-directory
  compatibility, background jobs, and full tool smoke flows against mock
  services.
