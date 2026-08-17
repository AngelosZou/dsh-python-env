# Security

`dsh-python-env` executes Python toolchains in the DSH host process (outside
the agent sandbox) on the agent's behalf. This document states the threat
model and the compensating controls.

## What the plugin can do

- Spawn `python` / `pip` processes with the host token, including network
  access to package indexes and arbitrary code execution inside wheels and
  sdists during install/build.
- Read files anywhere the host user can read (interpreter discovery probes).
- Write files — by construction only inside the session workspace.

## Threat model

The **agent** is the untrusted party: it may attempt to misuse the tools to
escape the sandbox or affect the host.

The **user** (plugin installer) is trusted: installing the plugin is
consent for workspace-scoped environment management with host-side
execution.

Malicious or compromised **packages** execute during install with host
privileges — identical to any local `pip install`; the mirror chain and
proxy handling add no new attack surface beyond what pip already exposes
(HTTPS everywhere; proxy URLs are applied via pip's own `--proxy`).

## Compensating controls

1. **Workspace confinement.** Every model-influenced path passes
   `guardWorkspacePath`: absolute resolution plus containment check
   (case-insensitive on Windows), rejecting `..` escapes and foreign roots.
   Venv names are single-segment regex-validated and re-guarded after join.
   `pyenv_remove` additionally requires the `pyvenv.cfg` marker, so it can
   never be pointed at arbitrary directories.
2. **No shell.** All commands are argv arrays handed to the subprocess
   service; pip specs cannot inject shell syntax. Package specs are
   length/count capped.
3. **Scoped writable state.** `PIP_CACHE_DIR`, TMP/TEMP/TMPDIR, and all
   plugin files live under `<workspace>/.dsh-pyenv/`; the host pip cache
   and system temp are never used. The global Python installation is never
   a target: pip always runs as `<venv-python> -m pip` with no `--user`.
4. **No credential leak.** The subprocess service scrubs
   credential-shaped environment names and `DSH_*` facts from children;
   the plugin forwards only its explicit env layer (encoding, cache/tmp
   paths, pip knobs).
5. **Bounded resources.** Collected output is byte-capped with spill files;
   every spawn has grace-kill semantics; every tool owns a 2-minute deadline
   that terminates the live process tree and returns a detailed stop-reason;
   background installs have the same 2-minute hard cap; discovery is
   budgeted (depth, dir count, probes).
6. **Concurrency.** Mutating tools are exclusive at the scheduler level,
   so the agent cannot race two installs against one environment.
7. **Transparent routing.** Install results report every attempt
   (index/proxy/exit code), so the user can audit exactly where package
   traffic went.
8. **Session policy parity.** The mutating tools refuse to run in read-only
   sessions and fail closed when the policy service is absent — the
   plugin's host-side power never outranks the mode the user granted.
9. **Secondary roots are user-managed.** The optional dsh-multi-folder
   compatibility only extends the allowed roots to directories the USER
   configured; the agent can never self-grant a secondary directory
   (multi-folder owns that guard), and without multi-folder installed the
   probe is a no-op.

## Automated environment management risks

Installing packages automatically is executing third-party code, and this
plugin makes that reachable from the agent side. The concrete risks:

- **Malicious or typosquatted packages** — `pyenv_install` (including the
  auto-created `.venv` path) downloads and executes code from the
  configured index; nothing in that code is sandboxed. A typo in a
  requested name can pull an attacker's package.
- **Untrusted local code** — editable installs (`-e`) import the
  in-workspace project into the environment; that project's build steps
  run as-is. VCS/remote editable URLs are rejected precisely to keep this
  surface local and visible.
- **Supply-chain integrity** — the plugin does not pin hashes itself; the
  index content is trusted.

Mitigations:

- **Opt-in**: the plugin is installed per profile by the user; profiles
  whose agents must not install packages should not load it.
- **Index trust**: only HTTPS index URLs are accepted; the defaults and
  the mirror chain (TUNA/Aliyun/USTC) are long-standing public mirrors.
- **Hash pinning**: pip's own hash enforcement is honored — pass a hashed
  requirements file to `pyenv_install` and pip verifies every artifact.
- **Blast radius**: every write lands in the workspace (venv,
  `.dsh-pyenv`); a compromised environment is disposable with
  `pyenv_remove` and cannot silently mutate the global Python
  installation.
- **Transparency**: each install reports every attempt (index/proxy/exit
  code), and every invocation is a recorded tool call the user can audit.
- **Policy parity**: read-only sessions cannot trigger any of this.

## Residual risks (accepted)

- Package code (wheels, sdist build scripts) runs with host privileges.
  This is inherent to installing Python packages anywhere and is why the
  plugin is opt-in. Do not install it in profiles whose agents should not
  be able to install packages at all.
- A second DSH process against the same workspace is not coordinated
  (documented limitation, not a security boundary breach).
- The plugin's own code runs with host privileges; it is dependency-free
  and its only execution surface is the five tools documented above.

## Reporting a vulnerability

Please report security issues privately through
<https://github.com/AngelosZou/dsh-python-env/security/advisories> instead of
opening a public issue. You should receive a response within a week.
