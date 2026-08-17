/**
 * Shared constants: naming, discovery budgets, install policy, and the
 * mirror/proxy fallback tables. Everything here is tunable without touching
 * control flow.
 * @module dsh-python-env/constants
 */

/** Workspace-local state root; all plugin caches live under it. */
export const ENV_DIR_NAME = '.dsh-pyenv'
/** pip http cache, redirected here so the host-wide cache is never touched. */
export const CACHE_DIR_NAME = 'cache'
/** Temporary directory handed to python/pip children (TMP/TEMP/TMPDIR). */
export const TMP_DIR_NAME = 'tmp'

/** Conventional virtual environment directory names, matched case-insensitively on Windows. */
export const KNOWN_VENV_NAMES = ['.venv', 'venv', 'env', '.env', 'virtualenv', '.virtualenv']

/** Discovery BFS: maximum directories inspected per scan. */
export const DISCOVERY_MAX_DIRS = 256
/** Discovery BFS: how many levels below the scan root to descend. */
export const DISCOVERY_DEPTH = 2
/** Depth-1 children that are never descended into (perf noise). */
export const DISCOVERY_PRUNED_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode',
  '__pycache__',
  'dist',
  'build',
  '.dsh-pyenv',
])
/** Hard cap on interpreter --version probes per discovery call. */
export const DISCOVERY_MAX_PROBES = 8

/** Default venv directory name used by auto-create flows. */
export const DEFAULT_VENV_NAME = '.venv'
/** Venv directory names must be plain single-segment names. */
export const VENV_NAME_RE = /^[A-Za-z0-9._-]+$/
export const MAX_VENV_NAME_LENGTH = 64

/** Minimum acceptable base interpreter for creating environments. */
export const MIN_PYTHON_MAJOR = 3
export const MIN_PYTHON_MINOR = 8

/** pip knobs: fewer internal retries and a short socket timeout so the
 *  mirror/proxy fallback chain kicks in quickly instead of hanging. */
export const PIP_RETRIES = '2'
export const PIP_SOCKET_TIMEOUT = '15'

/** Package spec limits for one install call. */
export const MAX_PACKAGES = 200
export const MAX_SPEC_LENGTH = 1000

/**
 * Time budgets. Environment management commands must not run for tens of
 * minutes: every pyenv_* tool is budgeted to finish within two minutes, and
 * when a budget elapses the tool terminates the live process tree and returns
 * a detailed stop-reason (what was running, last output, likely cause, next
 * steps) instead of hanging or producing a bare timeout error.
 */
/** Shared budget for the mutating tools (create / install / uninstall / remove). */
export const DEFAULT_TOOL_TIMEOUT_MS = 120_000
/** Default budget for installs, also the ceiling any per-call timeoutMs override is capped at. */
export const DEFAULT_INSTALL_TIMEOUT_MS = 120_000
/** Hard ceiling for a model-supplied timeoutMs override on install/uninstall. */
export const MAX_TOOL_TIMEOUT_MS = 120_000
/** Hard cap for background installs (jobs outlive the tool call; same 2-minute budget). */
export const BACKGROUND_INSTALL_CAP_MS = 120_000

/**
 * Mirror fallback chain. `indexUrl: null` means pip's own default index
 * resolution (pip config + PIP_INDEX_URL), i.e. plain PyPI for most users.
 */
export const DEFAULT_INDEXES = [
  { id: 'default', indexUrl: null },
  { id: 'tuna', indexUrl: 'https://pypi.tuna.tsinghua.edu.cn/simple' },
  { id: 'aliyun', indexUrl: 'https://mirrors.aliyun.com/pypi/simple/' },
  { id: 'ustc', indexUrl: 'https://mirrors.ustc.edu.cn/simple' },
]

/** Common local HTTP proxy ports probed after a network-classified failure. */
export const PROXY_PROBE_PORTS = [7890, 7891, 10809, 10808, 8888]
export const PROXY_PROBE_TIMEOUT_MS = 400
