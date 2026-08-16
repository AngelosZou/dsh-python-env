# Contributing

Thanks for your interest in `dsh-python-env`!

## Development loop

There is **no build step** — the plugin is plain ESM (`lib/`) and the tests
run with Node directly. The mock ctx stands in for the DSH services, and the
real `defineTool` validates every parameter/output schema at registration:

```bash
npm test
# or: node --test --test-isolation=none "test/*.test.js"
```

> `--test-isolation=none` keeps the Node test runner in-process. This also
> makes the suite run inside DSH-sandboxed shells, where the runner's
> per-file child spawns would otherwise hit the sandbox's named-pipe
> boundary (EPERM).

### Dependency resolution

The only dependencies are peer/dev pairs (`@deepseek-ai/cordis`,
`@deepseek-ai/dsh-tools`). Install them with `npm install`, or — for offline
development — junction your DSH profile's scope into the checkout:

```powershell
New-Item -ItemType Junction -Path node_modules\@deepseek-ai -Target "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai"
```

`node_modules/` is gitignored.

## Trying changes locally

```bash
dsh plugin --profile web add link:<path-to-this-repo>
# restart the DSH backend
```

Host changes need a backend restart; the five `pyenv_*` tools and the
`python-env` skill then appear in new sessions.

## Before submitting

- Keep `npm test` green and extend the suite for new behavior.
- Update `CHANGELOG.md` under the current `[Unreleased]` section.
- Update `docs/design.md` if invariants change (especially anything touching
  the confinement model described in `SECURITY.md`).
- Keep `README.md` and `README.zh.md` in sync.
- Keep the plugin dependency-free at runtime: standard-library
  `python -m venv` / pip only. New code may not require uv, virtualenv, or
  any other plugin.

## Commit style

Small, focused commits with a clear imperative summary. No enforced format
beyond that.
