/**
 * Unit tests for the shared venv target resolution: explicit validation,
 * discovery defaults, .venv preference, ambiguity errors, and the null
 * result that lets callers decide about auto-creation.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveExistingVenv } from '../lib/venv.js'

const root = join(process.cwd(), 'test', '.tmp', 'venv-targets')

async function venv(dir) {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'pyvenv.cfg'), 'home = fake\n')
}

async function dirOnly(dir) {
  await mkdir(dir, { recursive: true })
}

async function reset() {
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
}

test.beforeEach(reset)
test.after(async () => {
  await rm(join(process.cwd(), 'test', '.tmp', 'venv-targets'), { recursive: true, force: true })
})

test('explicit venv: valid environment resolves', async () => {
  await venv(join(root, 'env'))
  assert.equal(await resolveExistingVenv(root, 'env'), join(root, 'env'))
  assert.equal(await resolveExistingVenv(root, join(root, 'env')), join(root, 'env'))
})

test('explicit venv: missing or non-environment is rejected', async () => {
  await dirOnly(join(root, 'plain'))
  await assert.rejects(() => resolveExistingVenv(root, 'missing'), /venv not found/)
  await assert.rejects(() => resolveExistingVenv(root, 'plain'), /not a virtual environment/)
  await assert.rejects(() => resolveExistingVenv(root, '..'), /must stay inside/)
})

test('discovery: none returns null, one wins', async () => {
  assert.equal(await resolveExistingVenv(root, undefined), null)
  await venv(join(root, 'backend', 'env'))
  assert.equal(await resolveExistingVenv(root, undefined), join(root, 'backend', 'env'))
})

test('discovery: several prefer .venv', async () => {
  await venv(join(root, 'venv'))
  await venv(join(root, '.venv'))
  await venv(join(root, 'env'))
  assert.equal(await resolveExistingVenv(root, undefined), join(root, '.venv'))
})

test('discovery: several without .venv raise ambiguity', async () => {
  await venv(join(root, 'venv'))
  await venv(join(root, 'env'))
  await assert.rejects(() => resolveExistingVenv(root, undefined), /multiple virtual environments found/)
})

test('discovery: marker-less name directories are ignored for targets', async () => {
  await dirOnly(join(root, 'venv'))
  assert.equal(await resolveExistingVenv(root, undefined), null, 'known name without marker is not a usable target')
})

test('explicit venv: absolute path inside an extra root resolves', async () => {
  const sec = join(root, '..', 'venv-sec')
  await venv(join(sec, '.venv'))
  try {
    assert.equal(await resolveExistingVenv(root, join(sec, '.venv'), [sec]), join(sec, '.venv'))
  } finally {
    await rm(sec, { recursive: true, force: true })
  }
})

test('discovery: spans the primary workspace and extra roots', async () => {
  const sec = join(root, '..', 'venv-sec')
  await venv(join(sec, '.venv'))
  try {
    assert.equal(await resolveExistingVenv(root, undefined, [sec]), join(sec, '.venv'))
  } finally {
    await rm(sec, { recursive: true, force: true })
  }
})

test('discovery: relative venv arguments still resolve against the primary workspace', async () => {
  await venv(join(root, 'env'))
  const sec = join(root, '..', 'venv-sec')
  await venv(join(sec, 'env'))
  try {
    assert.equal(await resolveExistingVenv(root, 'env', [sec]), join(root, 'env'))
  } finally {
    await rm(sec, { recursive: true, force: true })
  }
})
