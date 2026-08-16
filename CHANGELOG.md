# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `pyenv_uninstall`: uninstall packages from a workspace environment
  (`pip uninstall -y`); fully offline and never auto-creates an environment.
- `pyenv_install` `upgrade` flag (pip `--upgrade`).
- Editable installs (`-e` / `--editable`) with workspace confinement: local
  paths are validated and rewritten to their guarded absolute form; remote
  and VCS editable URLs are rejected.
- Session policy parity: the mutating tools consult the session's standing
  sandbox policy and refuse to run in read-only sessions; they fail closed
  when the policy service is absent. Discovery remains available everywhere.
- Security documentation: an "Automated environment management risks"
  section in SECURITY.md (malicious/typosquatted packages, hash pinning via
  hashed requirements files, blast radius, transparency, policy parity) and
  a Security section in both READMEs.

### Changed

- `pyenv_install` and `pyenv_uninstall` share one target-resolution core
  (`resolveExistingVenv`).
- Discovery no longer treats the scan root's own directory name as a
  virtual-environment hint (a workspace literally named "venv" or "env" is
  not mistaken for an environment).
- The `python-env` skill and the guidance section now cover uninstall,
  upgrade, editable installs, version pinning, and the read-only gate.

## [0.1.0] — 2026-08-16

### Added

- `pyenv_discover`: bounded workspace scan (two levels deep) recognizing virtual
  environments by the standard `pyvenv.cfg` marker or conventional names
  (`.venv`, `venv`, `env`, `.env`, `virtualenv`, `.virtualenv`), reporting path,
  interpreter, version, and pip availability.
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
- `pyenv_remove`: deletion of real workspace environments only (marker
  required, workspace confinement enforced).
- Workspace-scoped state: `.dsh-pyenv/` cache/tmp directories with
  `PIP_CACHE_DIR` and TMP/TEMP/TMPDIR re-pointing for every child process,
  plus a `.gitignore` for the whole tree.
- `python-env` skill and the `dsh-python-env:guidance` system-prompt section
  (order 120, the tool-guidance band).
- Runtime-free test suite (55 tests) covering confinement, discovery, the
  install chain, interpreter resolution, background jobs, and full tool smoke
  flows against mock services.
- Cross-platform CI workflow (Node 20/24 × Ubuntu/Windows/macOS).
