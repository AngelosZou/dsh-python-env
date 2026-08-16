import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { discoverVenvCandidates, hasKnownName, isVenvDir } from '../lib/layout.js'

const root = join(process.cwd(), 'test', '.tmp', 'layout')

async function touch(file) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, 'home = fake\n')
}

async function buildTree() {
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  await touch(join(root, '.venv', 'pyvenv.cfg'))
  await mkdir(join(root, 'venv'), { recursive: true }) // known name, no marker
  await touch(join(root, 'env', 'pyvenv.cfg'))
  await touch(join(root, 'backend', 'env', 'pyvenv.cfg'))
  await mkdir(join(root, 'backend', 'plain'), { recursive: true })
  await touch(join(root, 'custom', 'pyvenv.cfg'))
  await touch(join(root, 'node_modules', 'pkg', '.venv', 'pyvenv.cfg')) // pruned subtree
}

test.after(async () => {
  await rm(join(process.cwd(), 'test', '.tmp'), { recursive: true, force: true })
})

test('isVenvDir: marker file decides', async () => {
  await buildTree()
  assert.equal(await isVenvDir(join(root, '.venv')), true)
  assert.equal(await isVenvDir(join(root, 'venv')), false)
  assert.equal(await isVenvDir(join(root, 'does-not-exist')), false)
})

test('hasKnownName: conventional names, case-insensitive on windows', () => {
  assert.equal(hasKnownName('.venv', 'linux'), true)
  assert.equal(hasKnownName('virtualenv', 'win32'), true)
  assert.equal(hasKnownName('.VENV', 'win32'), true)
  assert.equal(hasKnownName('.VENV', 'linux'), false)
  assert.equal(hasKnownName('plain', 'linux'), false)
})

test('discoverVenvCandidates: markers, known names, depth, pruning', async () => {
  await buildTree()
  const found = await discoverVenvCandidates(root)
  const key = (p) => p.replaceAll('\\', '/')
  const byDir = new Map(found.map((entry) => [key(entry.dir), entry]))
  const expected = [
    root + '/.venv',
    root + '/backend/env',
    root + '/custom',
    root + '/env',
    root + '/venv',
  ]
  assert.deepEqual(
    [...byDir.keys()].sort(),
    expected.map(key).sort(),
  )
  assert.equal(byDir.get(key(root + '/.venv')).byMarker, true)
  assert.equal(byDir.get(key(root + '/.venv')).knownName, true)
  assert.equal(byDir.get(key(root + '/venv')).byMarker, false, 'known name without marker still reported')
  assert.equal(byDir.get(key(root + '/venv')).knownName, true)
  assert.equal(byDir.get(key(root + '/custom')).byMarker, true)
  assert.equal(byDir.get(key(root + '/custom')).knownName, false, 'marker-only directory reported')
  assert.equal(byDir.has(key(root + '/backend/plain')), false, 'plain dirs are not candidates')
  assert.equal(byDir.has(key(root + '/node_modules/pkg/.venv')), false, 'pruned subtree never visited')
})

test('discoverVenvCandidates: scan root may BE the environment', async () => {
  await buildTree()
  const found = await discoverVenvCandidates(join(root, '.venv'))
  assert.equal(found.length, 1)
  assert.equal(found[0].dir, join(root, '.venv'))
  assert.equal(found[0].byMarker, true)
})

test('discoverVenvCandidates: empty or missing root yields nothing', async () => {
  await buildTree()
  assert.deepEqual(await discoverVenvCandidates(join(root, 'backend', 'plain')), [])
  assert.deepEqual(await discoverVenvCandidates(join(root, 'missing')), [])
})
