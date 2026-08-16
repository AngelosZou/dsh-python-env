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
