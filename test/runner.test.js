import test from 'node:test'
import assert from 'node:assert/strict'
import { JobLog, armDeadline, startBackgroundJob } from '../lib/runner.js'
import { renderAbortedReason, renderStopReason } from '../lib/render.js'

test('JobLog: offset reads are non-consuming and contiguous', () => {
  const log = new JobLog(100)
  log.append('hello ')
  log.append('world')
  const first = log.readFrom(0)
  assert.equal(first.text, 'hello world')
  assert.equal(first.nextOffset, 11)
  assert.equal(first.lossy, false)
  const again = log.readFrom(0)
  assert.equal(again.text, 'hello world', 'non-consuming')
  const tail = log.readFrom(5)
  assert.equal(tail.text, ' world')
  const end = log.readFrom(11)
  assert.equal(end.text, '')
})

test('JobLog: head drop past the cap reports lossy reads', () => {
  const log = new JobLog(10)
  log.append('hello')
  log.append(' world') // 11 bytes -> drop 1
  const read = log.readFrom(0)
  assert.equal(read.text, 'ello world')
  assert.equal(read.nextOffset, 11)
  assert.equal(read.lossy, true)
  const afterDrop = log.readFrom(10)
  assert.equal(afterDrop.text, 'd')
  assert.equal(afterDrop.lossy, false, 'offset inside the retained window is complete')
  log.append('!') // 12 total -> drop another byte
  const tail = log.readFrom(11)
  assert.equal(tail.text, '!')
  assert.equal(tail.lossy, false, 'offset 11 is still inside the retained window')
  const early = log.readFrom(2)
  assert.equal(early.text, 'llo world!')
  assert.equal(early.lossy, false)
  const ancient = log.readFrom(0)
  assert.equal(ancient.text, 'llo world!')
  assert.equal(ancient.lossy, true, 'offsets below the window are lossy')
})

test('startBackgroundJob: registers body and streams reads', () => {
  const started = []
  const ctx = {
    get(name) {
      if (name === 'jobs') {
        return {
          start(entry) {
            started.push(entry)
            return 'job-7'
          },
        }
      }
      return undefined
    },
  }
  const log = new JobLog()
  let cancelled = false
  const body = {
    cancel: () => {
      cancelled = true
    },
    done: () => Promise.resolve({ status: 'completed', detail: 'ok' }),
  }
  const jobId = startBackgroundJob(ctx, { agent: { session: { id: 's1' } } }, 'k', 'label', log, body)
  assert.equal(jobId, 'job-7')
  assert.equal(started.length, 1)
  assert.equal(started[0].kind, 'k')
  assert.equal(started[0].owner.session.id, 's1')
  const run = started[0].run()
  log.append('chunk-1\n')
  assert.equal(run.readOutput(), 'chunk-1\n')
  assert.equal(run.readOutput(), '')
  run.cancel()
  assert.equal(cancelled, true)
})

test('startBackgroundJob: missing jobs service fails loudly', () => {
  const ctx = { get: () => undefined }
  assert.throws(
    () => startBackgroundJob(ctx, undefined, 'k', 'label', new JobLog(), { cancel: () => {}, done: () => Promise.resolve({}) }),
    /background jobs unavailable/,
  )
})

test('armDeadline: fires at the budget and terminates the tracked handle', async () => {
  const handle = { terminated: false, terminate() { this.terminated = true } }
  let tracked = null
  const deadline = armDeadline(10, () => tracked)
  tracked = handle
  await new Promise((resolve) => setTimeout(resolve, 40))
  try {
    assert.equal(deadline.fired(), true, 'deadline fired after the budget')
    assert.equal(handle.terminated, true, 'live handle was terminated')
  } finally {
    deadline.dispose()
  }
})

test('armDeadline: dispose before the budget prevents firing', async () => {
  const handle = { terminated: false, terminate() { this.terminated = true } }
  const deadline = armDeadline(10, () => handle)
  deadline.dispose()
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(deadline.fired(), false, 'disposed deadline never fires')
  assert.equal(handle.terminated, false)
})

test('renderStopReason: explains the budget, attempts, output tail, and next steps', () => {
  const text = renderStopReason({
    tool: 'pyenv_install',
    operation: 'pip install into D:\\ws\\.venv',
    budgetMs: 120_000,
    stdout: 'Collecting demo\n',
    stderr: 'Retrying (Retry(total=2))...\n',
    tried: [
      { index: 'default', proxy: null, exitCode: null },
      { index: 'tuna', proxy: 'http://127.0.0.1:7890', exitCode: null },
    ],
  })
  assert.match(text, /pyenv_install stopped before completing/)
  assert.match(text, /2-minute time budget \(120000 ms\)/)
  assert.match(text, /process tree was terminated/)
  assert.match(text, /attempts: default \(exit null\) -> tuna via http:\/\/127\.0\.0\.1:7890 \(exit null\)/)
  assert.match(text, /last output:/)
  assert.match(text, /Retrying \(Retry/)
  assert.match(text, /Likely causes: a slow or unreachable package index\/network/)
  assert.match(text, /pin a mirror via the "index" argument/)
})

test('renderAbortedReason: explains a non-exit termination with output tail', () => {
  const text = renderAbortedReason({
    tool: 'pyenv_create',
    operation: 'python -m venv D:\\ws\\.venv',
    stdout: '',
    stderr: 'terminated',
  })
  assert.match(text, /pyenv_create was stopped before completing/)
  assert.match(text, /without a normal exit code/)
  assert.match(text, /last output:/)
})
