import test from 'node:test'
import assert from 'node:assert/strict'
import { JobLog, startBackgroundJob } from '../lib/runner.js'

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
