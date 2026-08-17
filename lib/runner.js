/**
 * Subprocess execution seam: every python/pip/venv invocation goes through
 * the platform subprocess service (the same channel the graphlint plugin
 * uses), NOT through the sandboxed shell executor. The sandbox blocks pip's
 * temporary directories and package-index network access; the subprocess
 * service runs children with the host token, while every path a child can
 * touch is confined to the workspace by the tool layer's guards.
 * @module dsh-python-env/runner
 */

/** Cap collected stream bytes; the tail is kept, spill files cover the head. */
export const STDOUT_CAP = 1_048_576
export const STDERR_CAP = 262_144

export function shapeStream(reader) {
  if (reader === undefined || reader === null) return { text: '', truncated: false }
  const read = reader.readFrom(0)
  return {
    text: typeof read.text === 'string' ? read.text : '',
    truncated: !!read.lossy,
    ...(read.spillPath !== undefined ? { spillPath: read.spillPath } : {}),
  }
}

export function stdioSpec() {
  return { stdin: 'ignore', stdout: { maxBytes: STDOUT_CAP }, stderr: { maxBytes: STDERR_CAP } }
}

/**
 * Run one subprocess to completion and shape the outcome into the canonical
 * foreground value ({ exitCode, timedOut, stdout, stderr }). `done` rejects
 * only on spawn-level failure, which is allowed to propagate. An optional
 * `onSpawn` callback receives the handle right after spawn so callers can
 * terminate the live process from their own deadline watchdog.
 */
export async function runForeground(subprocess, spec, signal, onSpawn) {
  const handle = subprocess.spawn(signal === undefined ? spec : { ...spec, signal })
  if (onSpawn !== undefined) onSpawn(handle)
  const outcome = await handle.done
  return {
    exitCode: outcome.exitCode === undefined ? null : outcome.exitCode,
    timedOut: outcome.exitCode === null,
    stdout: shapeStream(handle.collected && handle.collected.stdout),
    stderr: shapeStream(handle.collected && handle.collected.stderr),
  }
}

/**
 * Arm a cooperative deadline for a tool's execute body. When `budgetMs`
 * elapses the callback terminates the currently tracked subprocess handle
 * (the one returned by `getHandle`, refreshed by each spawn's onSpawn hook)
 * and `fired()` flips so the caller can return a detailed stop-reason instead
 * of a normal result. The timer is unref'd and must be cleared with
 * `dispose()` once the body settles.
 */
export function armDeadline(budgetMs, getHandle) {
  let fired = false
  const timer = setTimeout(() => {
    fired = true
    const handle = getHandle()
    if (handle !== null && handle !== undefined && typeof handle.terminate === 'function') handle.terminate()
  }, budgetMs)
  if (typeof timer.unref === 'function') timer.unref()
  return {
    fired: () => fired,
    dispose: () => clearTimeout(timer),
  }
}

/**
 * Bounded append-only log with offset-based non-consuming reads, shaped for
 * the jobs registry's readOutput contract. Head bytes are dropped past the
 * cap and reads that start below the retained window report lossy.
 */
export class JobLog {
  constructor(maxBytes = STDOUT_CAP) {
    this.buf = ''
    this.dropped = 0
    this.maxBytes = maxBytes
  }

  append(text) {
    const s = String(text ?? '')
    if (s.length === 0) return
    this.buf += s
    if (this.buf.length > this.maxBytes) {
      const excess = this.buf.length - this.maxBytes
      this.dropped += excess
      this.buf = this.buf.slice(excess)
    }
  }

  readFrom(offset) {
    const local = offset - this.dropped
    if (local < 0) return { text: this.buf, nextOffset: this.dropped + this.buf.length, lossy: true }
    return { text: this.buf.slice(local), nextOffset: this.dropped + this.buf.length, lossy: false }
  }
}

/**
 * Register a caller-owned body as a background job. Background runs outlive
 * the tool call, so no caller signal is forwarded; the body owns its
 * cancellation and terminal outcome mapping.
 *
 * @param body - { cancel(): void, done(): Promise<{status, detail}> }
 */
export function startBackgroundJob(ctx, exec, kind, label, log, body) {
  const jobs = ctx.get('jobs')
  if (jobs === undefined) {
    throw new Error('dsh-python-env: background jobs unavailable (load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs)')
  }
  let cursor = 0
  const jobId = jobs.start({
    kind,
    label,
    outputLimitBytes: STDOUT_CAP + STDERR_CAP,
    ...(exec && exec.agent !== undefined ? { owner: exec.agent } : {}),
    run: () => ({
      cancel: body.cancel,
      done: body.done(),
      readOutput: () => {
        const read = log.readFrom(cursor)
        cursor = read.nextOffset
        return read.text
      },
    }),
  })
  return jobId
}
