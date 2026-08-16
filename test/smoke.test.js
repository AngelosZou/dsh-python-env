/**
 * Host-half smoke test: import the real plugin module, apply it against a
 * mock ctx, and drive all four tools end to end with fake subprocess and
 * jobs services plus a real (temporary) workspace directory. The real
 * defineTool runs, so every declared parameter/output schema is validated
 * against the enforced JSON Schema subset at registration time.
 * Does not require the DSH runtime. Run: node --test test/
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { apply, inject, name } from '../lib/index.js'
import { makeSubprocess } from './helpers.mjs'

const tmpRoot = join(process.cwd(), 'test', '.tmp', 'smoke')
const ws = join(tmpRoot, 'ws')

// ---------------------------------------------------------------- mocks
const tools = []
const skills = []
const sections = []
const jobsStarted = []
let subprocessService = { spawn: () => { throw new Error('no subprocess mounted') } }
let standingMode = 'workspace-write'
let policyMounted = true
let secondaryDirsList = []

const mockCtx = {
  tools: { register: (tool) => tools.push(tool) },
  skills: { register: (skill) => skills.push(skill) },
  systemPrompt: { section: (section) => sections.push(section) },
  get: (serviceName) => {
    if (serviceName === 'subprocess') return subprocessService
    if (serviceName === 'jobs') {
      return { start: (entry) => (jobsStarted.push(entry), 'job-' + jobsStarted.length) }
    }
    if (serviceName === 'sandboxPolicy') {
      return policyMounted ? { resolve: () => ({ mode: standingMode, workspaceRoot: ws }) } : undefined
    }
    if (serviceName === 'multiFolder') {
      return secondaryDirsList.length > 0 ? { list: async () => ({ dirs: secondaryDirsList }) } : undefined
    }
    return undefined
  },
}

apply(mockCtx)
const tool = (toolName) => tools.find((t) => t.name === toolName)
const execFor = (cwd = ws) => ({ agent: { session: { header: { cwd } } }, signal: undefined })

/** Create a plausible environment: pyvenv.cfg + both platform layouts. */
function fakeVenv(dir) {
  mkdirSync(join(dir, 'Scripts'), { recursive: true })
  mkdirSync(join(dir, 'bin'), { recursive: true })
  writeFileSync(join(dir, 'pyvenv.cfg'), 'home = fake\n')
  writeFileSync(join(dir, 'Scripts', 'python.exe'), '')
  writeFileSync(join(dir, 'Scripts', 'pip.exe'), '')
  writeFileSync(join(dir, 'bin', 'python'), '')
  writeFileSync(join(dir, 'bin', 'pip'), '')
}

/** Subprocess outcome factory with a synchronous venv-creation side effect. */
const venvCreateOutcome = (spec) => {
  fakeVenv(spec.argv[spec.argv.length - 1])
  return { exitCode: 0, stdout: 'created\n' }
}
const versionOutcome = (text) => ({ exitCode: 0, stdout: text + '\n' })

async function resetWorkspace() {
  await rm(tmpRoot, { recursive: true, force: true })
  await mkdir(ws, { recursive: true })
  jobsStarted.length = 0
  standingMode = 'workspace-write'
  policyMounted = true
  secondaryDirsList = []
}

test.beforeEach(resetWorkspace)
test.after(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

// ------------------------------------------------------------- registration
test('apply: registers tools, skill, and guidance', () => {
  assert.equal(name, 'dsh-python-env')
  assert.ok(
    Array.isArray(inject) && inject.includes('tools') && inject.includes('subprocess') && inject.includes('jobs') && inject.includes('sandboxPolicy'),
  )
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ['pyenv_create', 'pyenv_discover', 'pyenv_install', 'pyenv_remove', 'pyenv_uninstall'],
  )
  for (const toolName of ['pyenv_create', 'pyenv_install', 'pyenv_uninstall', 'pyenv_remove']) {
    const registered = tool(toolName)
    assert.equal(typeof registered.isConcurrencySafe, 'function', toolName + ' declares concurrency safety')
    assert.equal(registered.isConcurrencySafe({}), false, toolName + ' is exclusive (mutating)')
  }
  assert.equal(tool('pyenv_discover').isConcurrencySafe({}), true, 'discovery is read-only')
  assert.equal(skills.length, 1)
  assert.equal(skills[0].name, 'python-env')
  assert.equal(typeof skills[0].content, 'string')
  assert.ok(skills[0].content.includes('pyenv_install'))
  assert.ok(skills[0].content.includes('pyenv_uninstall'))
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'dsh-python-env:guidance')
  assert.equal(sections[0].order, 120)
})

// ---------------------------------------------------------------- discover
test('pyenv_discover: reports environments with probe data', async () => {
  fakeVenv(join(ws, '.venv'))
  const { subprocess } = makeSubprocess([
    (spec) => (spec.argv[spec.argv.length - 1] === '--version' ? versionOutcome('Python 3.11.9') : { exitCode: 1, stderr: 'unexpected' }),
  ])
  subprocessService = subprocess
  const value = await tool('pyenv_discover').execute({}, execFor())
  assert.equal(value.error, undefined)
  assert.deepEqual(value.scanned, [ws])
  assert.equal(value.venvs.length, 1)
  const venv = value.venvs[0]
  assert.equal(venv.name, '.venv')
  assert.equal(venv.valid, true)
  assert.equal(venv.hasPip, true)
  assert.equal(venv.version, 'Python 3.11.9')
  assert.ok(venv.python.endsWith('python.exe') || venv.python.endsWith('python'), venv.python)
})

test('pyenv_discover: empty workspace reports none', async () => {
  const { subprocess } = makeSubprocess([])
  subprocessService = subprocess
  const value = await tool('pyenv_discover').execute({}, execFor())
  assert.equal(value.venvs.length, 0)
})

test('pyenv_discover: root_dir outside the workspace is rejected', async () => {
  const { subprocess } = makeSubprocess([])
  subprocessService = subprocess
  const value = await tool('pyenv_discover').execute({ root_dir: join(tmpRoot, '..', 'escape') }, execFor())
  assert.match(String(value.error), /must stay inside the session working directory/)
})

// ----------------------------------------------------------------- create
test('pyenv_create: creates with the standard library and probes the result', async () => {
  const { spawns, subprocess } = makeSubprocess([
    (spec) => (spec.argv[spec.argv.length - 1] === '--version' ? versionOutcome('Python 3.13.2') : venvCreateOutcome(spec)),
    venvCreateOutcome,
    (spec) => (spec.argv[spec.argv.length - 1] === '--version' ? versionOutcome('Python 3.13.2') : { exitCode: 1 }),
  ])
  subprocessService = subprocess
  const value = await tool('pyenv_create').execute({}, execFor())
  assert.equal(value.error, undefined)
  assert.equal(value.created, true)
  assert.equal(value.alreadyExisted, false)
  assert.equal(value.path, join(ws, '.venv'))
  assert.equal(value.version, 'Python 3.13.2')
  assert.equal(value.hasPip, true)
  assert.match(value.baseInterpreter, /Python 3\.13\.2/)
  assert.equal(spawns[1].spec.argv.slice(-3, -1).join(' '), '-m venv')
  assert.equal(spawns[1].spec.argv[spawns[1].spec.argv.length - 1], join(ws, '.venv'))
  assert.ok(existsSync(join(ws, '.venv', 'pyvenv.cfg')))
})

test('pyenv_create: existing environment is recognized, not recreated', async () => {
  fakeVenv(join(ws, 'env'))
  const { spawns, subprocess } = makeSubprocess([
    (spec) => (spec.argv[spec.argv.length - 1] === '--version' ? versionOutcome('Python 3.11.9') : { exitCode: 1 }),
  ])
  subprocessService = subprocess
  const value = await tool('pyenv_create').execute({ name: 'env' }, execFor())
  assert.equal(value.created, false)
  assert.equal(value.alreadyExisted, true)
  assert.equal(value.path, join(ws, 'env'))
  assert.equal(spawns.length, 1, 'no venv creation spawn happened')
})

test('pyenv_create: invalid names are rejected', async () => {
  const { subprocess } = makeSubprocess([])
  subprocessService = subprocess
  for (const bad of ['..', '.', 'a/b', 'a\\b', 'x'.repeat(65)]) {
    const value = await tool('pyenv_create').execute({ name: bad }, execFor())
    assert.match(String(value.error), /invalid venv name|must stay inside/, bad)
  }
})

test('pyenv_create: refuses to create over a non-venv directory', async () => {
  await mkdir(join(ws, 'plain'), { recursive: true })
  const { subprocess } = makeSubprocess([])
  subprocessService = subprocess
  const value = await tool('pyenv_create').execute({ name: 'plain' }, execFor())
  assert.match(String(value.error), /not a virtual environment/)
})

// ----------------------------------------------------------------- install
test('pyenv_install: happy path installs into the discovered environment', async () => {
  fakeVenv(join(ws, '.venv'))
  const { spawns, subprocess } = makeSubprocess([
    (spec) => (spec.argv.includes('-m') && spec.argv.includes('pip') ? { exitCode: 0, stdout: 'pip 24.0' } : { exitCode: 1 }),
    { exitCode: 0, stdout: 'Collecting demo\nSuccessfully installed demo-1.0' },
  ])
  subprocessService = subprocess
  const value = await tool('pyenv_install').execute({ packages: ['demo==1.0'] }, execFor())
  assert.equal(value.error, undefined)
  assert.equal(value.kind, 'foreground')
  assert.equal(value.exitCode, 0)
  assert.equal(value.indexUsed, 'default')
  assert.equal(value.proxyUsed, null)
  assert.deepEqual(value.tried, [{ index: 'default', proxy: null, exitCode: 0 }])
  const installSpawn = spawns[1].spec
  assert.ok(installSpawn.argv[0].endsWith('python.exe') || installSpawn.argv[0].endsWith('python'))
  assert.deepEqual(installSpawn.argv.slice(1, 3), ['-m', 'pip'])
  assert.ok(installSpawn.argv.includes('install'))
  assert.equal(installSpawn.argv[installSpawn.argv.length - 1], 'demo==1.0')
})

test('pyenv_install: auto-creates .venv when nothing exists', async () => {
  const { spawns, subprocess } = makeSubprocess([
    (spec) => (spec.argv[spec.argv.length - 1] === '--version' ? versionOutcome('Python 3.13.2') : { exitCode: 1 }),
    venvCreateOutcome,
    (spec) => (spec.argv.includes('-m') && spec.argv.includes('pip') ? { exitCode: 0, stdout: 'pip 24.0' } : { exitCode: 1 }),
    { exitCode: 0, stdout: 'Successfully installed demo' },
  ])
  subprocessService = subprocess
  const value = await tool('pyenv_install').execute({ packages: ['demo'] }, execFor())
  assert.equal(value.error, undefined)
  assert.equal(value.kind, 'foreground')
  assert.equal(value.exitCode, 0)
  assert.equal(spawns[1].spec.argv.slice(-3, -1).join(' '), '-m venv')
  assert.ok(existsSync(join(ws, '.venv', 'pyvenv.cfg')))
})

test('pyenv_install: ambiguous environments require an explicit venv', async () => {
  fakeVenv(join(ws, 'venv'))
  fakeVenv(join(ws, 'backend', 'env'))
  const { subprocess } = makeSubprocess([])
  subprocessService = subprocess
  const value = await tool('pyenv_install').execute({ packages: ['demo'] }, execFor())
  assert.match(String(value.error), /multiple virtual environments found/)
})

test('pyenv_install: nothing to install is rejected', async () => {
  fakeVenv(join(ws, '.venv'))
  const { subprocess } = makeSubprocess([])
  subprocessService = subprocess
  const value = await tool('pyenv_install').execute({}, execFor())
  assert.match(String(value.error), /nothing to install/)
})

test('pyenv_install: background path registers a job and streams', async () => {
  fakeVenv(join(ws, '.venv'))
  const { subprocess } = makeSubprocess([
    (spec) => (spec.argv.includes('-m') && spec.argv.includes('pip') && spec.argv.includes('--version') ? { exitCode: 0, stdout: 'pip 24.0' } : { exitCode: 1 }),
    { exitCode: 0, stdout: 'Collecting demo\nSuccessfully installed demo-1.0\n' },
  ])
  subprocessService = subprocess
  const value = await tool('pyenv_install').execute({ packages: ['demo'], run_in_background: true }, execFor())
  assert.equal(value.kind, 'background')
  assert.equal(value.jobId, 'job-1')
  assert.equal(jobsStarted.length, 1)
  const body = jobsStarted[0].run()
  const outcome = await body.done
  assert.equal(outcome.status, 'completed')
  assert.match(outcome.detail, /default/)
  assert.match(body.readOutput(), /Successfully installed demo/)
})

// ----------------------------------------------------------------- remove
test('pyenv_remove: deletes a real environment', async () => {
  fakeVenv(join(ws, 'venv'))
  const { subprocess } = makeSubprocess([])
  subprocessService = subprocess
  const value = await tool('pyenv_remove').execute({ venv: 'venv' }, execFor())
  assert.equal(value.error, undefined)
  assert.equal(value.removed, true)
  assert.equal(value.path, join(ws, 'venv'))
  assert.equal(existsSync(join(ws, 'venv')), false)
})

test('pyenv_remove: refuses non-environments and escapes', async () => {
  await mkdir(join(ws, 'plain'), { recursive: true })
  const { subprocess } = makeSubprocess([])
  subprocessService = subprocess
  const nonVenv = await tool('pyenv_remove').execute({ venv: 'plain' }, execFor())
  assert.match(String(nonVenv.error), /refusing to delete/)
  assert.equal(existsSync(join(ws, 'plain')), true)
  const escape = await tool('pyenv_remove').execute({ venv: '..' }, execFor())
  assert.match(String(escape.error), /must stay inside/)
})

// --------------------------------------------------- session policy parity
test('read-only sessions: mutating tools refuse, discovery still works', async () => {
  fakeVenv(join(ws, '.venv'))
  standingMode = 'read-only'
  const { spawns, subprocess } = makeSubprocess([])
  subprocessService = subprocess
  const cases = [
    ['pyenv_create', {}],
    ['pyenv_install', { packages: ['demo'] }],
    ['pyenv_uninstall', { packages: ['demo'] }],
    ['pyenv_remove', { venv: '.venv' }],
  ]
  for (const [toolName, args] of cases) {
    const value = await tool(toolName).execute(args, execFor())
    assert.match(String(value.error), /read-only mode|read-only/, toolName + ' is denied in read-only sessions')
  }
  assert.equal(spawns.length, 0, 'no subprocess ever spawned in a read-only session')
  const discover = await tool('pyenv_discover').execute({}, execFor())
  assert.equal(discover.error, undefined, 'discovery stays available in read-only sessions')
})

test('mutating tools: fail closed when the policy service is absent', async () => {
  fakeVenv(join(ws, '.venv'))
  policyMounted = false
  const { spawns, subprocess } = makeSubprocess([])
  subprocessService = subprocess
  const value = await tool('pyenv_create').execute({}, execFor())
  assert.match(String(value.error), /cannot be verified/)
  assert.equal(spawns.length, 0)
})

// ------------------------------------------------------ install extras
test('pyenv_install: upgrade flag reaches pip as --upgrade', async () => {
  fakeVenv(join(ws, '.venv'))
  const { spawns, subprocess } = makeSubprocess([
    (spec) => (spec.argv.includes('-m') && spec.argv.includes('pip') ? { exitCode: 0, stdout: 'pip 24.0' } : { exitCode: 1 }),
    { exitCode: 0, stdout: 'Successfully installed demo' },
  ])
  subprocessService = subprocess
  const value = await tool('pyenv_install').execute({ packages: ['demo'], upgrade: true }, execFor())
  assert.equal(value.exitCode, 0)
  assert.ok(spawns[1].spec.argv.includes('--upgrade'))
})

test('pyenv_install: editable local path is accepted and confined', async () => {
  fakeVenv(join(ws, '.venv'))
  const { spawns, subprocess } = makeSubprocess([
    (spec) => (spec.argv.includes('-m') && spec.argv.includes('pip') ? { exitCode: 0, stdout: 'pip 24.0' } : { exitCode: 1 }),
    { exitCode: 0, stdout: 'Successfully installed demo' },
  ])
  subprocessService = subprocess
  const value = await tool('pyenv_install').execute({ packages: ['-e', '.'] }, execFor())
  assert.equal(value.exitCode, 0)
  const installArgv = spawns[1].spec.argv
  const editablePos = installArgv.indexOf('-e')
  assert.ok(editablePos >= 0, 'editable flag present')
  assert.equal(installArgv[editablePos + 1], ws, 'editable path rewritten to the guarded absolute workspace path')
})

test('pyenv_install: editable escapes and remote URLs are rejected before any spawn', async () => {
  fakeVenv(join(ws, '.venv'))
  const { spawns, subprocess } = makeSubprocess([])
  subprocessService = subprocess
  const escape = await tool('pyenv_install').execute({ packages: ['-e', '..'] }, execFor())
  assert.match(String(escape.error), /must stay inside/)
  const remote = await tool('pyenv_install').execute({ packages: ['-e', 'git+https://example.com/x.git'] }, execFor())
  assert.match(String(remote.error), /only local editable paths/)
  assert.equal(spawns.length, 0)
})

// ---------------------------------------------------------------- uninstall
test('pyenv_uninstall: uninstalls from the discovered environment', async () => {
  fakeVenv(join(ws, '.venv'))
  const { spawns, subprocess } = makeSubprocess([
    (spec) => (spec.argv.includes('-m') && spec.argv.includes('pip') && spec.argv.includes('--version') ? { exitCode: 0, stdout: 'pip 24.0' } : { exitCode: 1 }),
    { exitCode: 0, stdout: 'Successfully uninstalled demo-1.0' },
  ])
  subprocessService = subprocess
  const value = await tool('pyenv_uninstall').execute({ packages: ['demo'] }, execFor())
  assert.equal(value.error, undefined)
  assert.equal(value.kind, 'foreground')
  assert.equal(value.exitCode, 0)
  const uninstallArgv = spawns[1].spec.argv
  assert.deepEqual(uninstallArgv.slice(1, 4), ['-m', 'pip', 'uninstall'])
  assert.ok(uninstallArgv.includes('-y'))
  assert.equal(uninstallArgv[uninstallArgv.length - 1], 'demo')
})

test('pyenv_uninstall: never auto-creates an environment', async () => {
  const { spawns, subprocess } = makeSubprocess([])
  subprocessService = subprocess
  const value = await tool('pyenv_uninstall').execute({ packages: ['demo'] }, execFor())
  assert.match(String(value.error), /no virtual environment found/)
  assert.equal(spawns.length, 0)
})

// --------------------------------- optional multi-folder compatibility
test('optional compatibility: secondary directories join the allowed roots', async () => {
  const sec = join(tmpRoot, 'sec')
  fakeVenv(join(sec, '.venv'))
  secondaryDirsList = [sec]
  const { subprocess } = makeSubprocess([
    (spec) => (spec.argv[spec.argv.length - 1] === '--version' ? versionOutcome('Python 3.12.4') : { exitCode: 1 }),
  ])
  subprocessService = subprocess
  const discover = await tool('pyenv_discover').execute({}, execFor())
  assert.equal(discover.error, undefined)
  assert.ok(discover.scanned.includes(ws) && discover.scanned.includes(sec), 'both roots scanned')
  assert.ok(discover.venvs.some((v) => v.path === join(sec, '.venv')), 'secondary environment reported')
})

test('optional compatibility: create and install work inside a secondary directory', async () => {
  const sec = join(tmpRoot, 'sec')
  secondaryDirsList = [sec]
  const { spawns, subprocess } = makeSubprocess([
    (spec) => (spec.argv[spec.argv.length - 1] === '--version' ? versionOutcome('Python 3.13.2') : venvCreateOutcome(spec)),
    venvCreateOutcome,
    (spec) => (spec.argv[spec.argv.length - 1] === '--version' ? versionOutcome('Python 3.13.2') : { exitCode: 1 }),
    (spec) => (spec.argv.includes('-m') && spec.argv.includes('pip') ? { exitCode: 0, stdout: 'pip 24.0' } : { exitCode: 1 }),
    { exitCode: 0, stdout: 'Successfully installed demo' },
  ])
  subprocessService = subprocess
  const created = await tool('pyenv_create').execute({ root_dir: sec, name: 'env' }, execFor())
  assert.equal(created.error, undefined)
  assert.equal(created.created, true)
  assert.equal(created.path, join(sec, 'env'))
  const installed = await tool('pyenv_install').execute({ packages: ['demo'], venv: join(sec, 'env') }, execFor())
  assert.equal(installed.error, undefined)
  assert.equal(installed.exitCode, 0)
  assert.ok(spawns[4].spec.argv[0].startsWith(join(sec, 'env')), 'pip ran with the secondary environment interpreter')
})

test('optional compatibility: read-only sessions still deny secondary mutations', async () => {
  const sec = join(tmpRoot, 'sec')
  fakeVenv(join(sec, '.venv'))
  secondaryDirsList = [sec]
  standingMode = 'read-only'
  const { spawns, subprocess } = makeSubprocess([])
  subprocessService = subprocess
  const value = await tool('pyenv_install').execute({ packages: ['demo'], venv: join(sec, '.venv') }, execFor())
  assert.match(String(value.error), /read-only/)
  assert.equal(spawns.length, 0)
})

test('no multi-folder installed: zero effect, no extra context', async () => {
  const discover = await tool('pyenv_discover').execute({}, execFor())
  assert.deepEqual(discover.scanned, [ws])
  const { spawns, subprocess } = makeSubprocess([])
  subprocessService = subprocess
  const escape = await tool('pyenv_create').execute({ root_dir: join(tmpRoot, 'outside') }, execFor())
  assert.match(String(escape.error), /must stay inside/)
  assert.equal(spawns.length, 0)
})
