/**
 * Shared test helpers: canned subprocess fakes with the platform service's
 * handle contract (done promise, offset-based collected readers, terminate).
 * No DSH runtime is required.
 */

export function collector(text) {
  const content = String(text ?? '')
  return {
    readFrom(offset) {
      const start = typeof offset === 'number' && offset >= 0 ? offset : 0
      return {
        text: start === 0 ? content : '',
        nextOffset: content.length,
        lossy: false,
      }
    },
  }
}

export function makeHandle({ exitCode = 0, stdout = '', stderr = '' } = {}) {
  return {
    done: Promise.resolve({ exitCode }),
    collected: { stdout: collector(stdout), stderr: collector(stderr) },
    terminated: false,
    terminate() {
      this.terminated = true
    },
  }
}

/**
 * A fake subprocess service driven by a response list. Each entry is either
 * a static outcome or a function (spec, index) => outcome; the function may
 * perform filesystem side effects synchronously (e.g. simulate venv
 * creation) before the outcome is returned.
 */
export function makeSubprocess(responses) {
  const spawns = []
  const subprocess = {
    spawn(spec) {
      const index = spawns.length
      const entry = responses[Math.min(index, responses.length - 1)]
      const outcome = typeof entry === 'function' ? entry(spec, index) : entry
      const handle = makeHandle(outcome)
      spawns.push({ spec, handle })
      return handle
    },
  }
  return { spawns, subprocess }
}
