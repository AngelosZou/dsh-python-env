/**
 * Shared output vocabulary for process-shaped tool results, mirroring the
 * canonical foreground/background/error shapes of the shipped shell tools so
 * presentation stays consistent. Value schemas use the enforced JSON Schema
 * subset exactly as the shipped plugins do.
 * @module dsh-python-env/render
 */

export const STREAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string', required: true },
    truncated: { type: 'boolean', required: true },
    spillPath: { type: 'string' },
  },
}

export const ERROR_BRANCH = {
  type: 'object',
  additionalProperties: false,
  properties: {
    error: { type: 'string', required: true },
  },
}

export const BACKGROUND_BRANCH = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'background' },
    jobId: { type: 'string', required: true },
  },
}

export const FOREGROUND_PROPERTIES = {
  kind: { type: 'string', required: true, const: 'foreground' },
  exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
  timedOut: { type: 'boolean', required: true },
  stdout: STREAM_SCHEMA,
  stderr: STREAM_SCHEMA,
}

export const FOREGROUND_BRANCH = {
  type: 'object',
  additionalProperties: false,
  properties: FOREGROUND_PROPERTIES,
}

/** Compose stdout/stderr/exit-code into one displayable text body. */
export function renderForegroundText(value) {
  let text = value.stdout && typeof value.stdout.text === 'string' ? value.stdout.text : ''
  if (value.stderr && typeof value.stderr.text === 'string' && value.stderr.text.length > 0) {
    if (text.length > 0 && !text.endsWith('\n')) text += '\n'
    text += value.stderr.text
  }
  if (value.exitCode !== 0) {
    if (text.length > 0 && !text.endsWith('\n')) text += '\n'
    text += '[exit code: ' + value.exitCode + ']'
  }
  return text
}

/** Tail of combined stdout+stderr kept in stop-reason messages. */
const STOP_REASON_TAIL = 600

function outputTail(stdout, stderr) {
  const combined = [stdout, stderr].filter((text) => typeof text === 'string' && text.length > 0).join('\n')
  if (combined.length === 0) return ''
  const tail = combined.length > STOP_REASON_TAIL ? combined.slice(-STOP_REASON_TAIL) : combined
  return 'last output:\n' + tail + (combined.length > STOP_REASON_TAIL ? '\n… (output truncated to the last ' + STOP_REASON_TAIL + ' characters)' : '')
}

/**
 * The detailed stop-reason returned when a tool's own deadline fired before
 * the operation completed: the budget, what was still running, the attempts
 * already made, the last output, likely causes, and next steps. This replaces
 * the bare "tool call timed out" the framework would otherwise surface.
 */
export function renderStopReason({ tool, operation, budgetMs, stdout, stderr, tried }) {
  const minutes = Math.round(budgetMs / 60_000)
  const lines = [
    tool + ' stopped before completing: ' + operation + ' did not finish within the ' + minutes + '-minute time budget (' + budgetMs + ' ms) and the running process tree was terminated.',
  ]
  if (Array.isArray(tried) && tried.length > 0) {
    lines.push(
      'attempts: ' +
        tried
          .map((attempt) => attempt.index + (attempt.proxy !== null ? ' via ' + attempt.proxy : '') + ' (exit ' + attempt.exitCode + ')')
          .join(' -> '),
    )
  }
  const tail = outputTail(stdout, stderr)
  if (tail.length > 0) lines.push(tail)
  lines.push('Likely causes: a slow or unreachable package index/network, a large dependency set, or an oversized download.')
  lines.push(
    'Next steps: retry with fewer packages, pin a mirror via the "index" argument, pass an explicit "proxy", or split the install into smaller batches. ' +
      'Background installs are capped at the same ' + minutes + '-minute budget.',
  )
  return lines.join('\n')
}

/**
 * Stop-reason for a subprocess that was terminated without a normal exit
 * (caller cancellation or an abnormal kill) — no deadline fired, so the
 * message explains the termination instead of pretending it was a timeout.
 */
export function renderAbortedReason({ tool, operation, stdout, stderr, tried }) {
  const lines = [
    tool + ' was stopped before completing: ' + operation + ' was terminated without a normal exit code (the tool call may have been cancelled or the subprocess was killed). No further attempts were made.',
  ]
  if (Array.isArray(tried) && tried.length > 0) {
    lines.push(
      'attempts: ' +
        tried
          .map((attempt) => attempt.index + (attempt.proxy !== null ? ' via ' + attempt.proxy : '') + ' (exit ' + attempt.exitCode + ')')
          .join(' -> '),
    )
  }
  const tail = outputTail(stdout, stderr)
  if (tail.length > 0) lines.push(tail)
  return lines.join('\n')
}
