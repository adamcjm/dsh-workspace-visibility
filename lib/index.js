/**
 * Host half of `@adamcjm/dsh-workspace-visibility`.
 *
 * Owns the durable visibility state and the HTTP surface the browser half
 * talks to:
 *
 *   GET  /workspace-visibility/state    → the current state
 *   POST /workspace-visibility/mutate   → one incremental mutation
 *   GET  /workspace-visibility/stream   → SSE stream, one state per change
 *
 * State file: `$DSH_HOME/storages/workspace-visibility.json`, written
 * atomically (temp file + rename) from a serialized queue. The Host is the
 * only authority: browsers never persist the state themselves (same model as
 * the shipped workspace registry, whose order lives in
 * `$DSH_HOME/storages/workspace.json`).
 *
 * Multi-client sync is push-based: every connected client holds one SSE
 * connection and receives the complete new state after any mutation, so a
 * change made in Desktop reaches an open Web page (and other tabs/browsers)
 * without a refresh — mirroring the shipped `workspace/follow` stream.
 *
 * @module @adamcjm/dsh-workspace-visibility
 */

import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'dsh-workspace-visibility'

/** One optional HTTP carrier; the browser half needs the routes below. */
export const inject = ['webServer']

/** Route prefix owned by this package. */
const PREFIX = '/workspace-visibility'
/** Durable state schema version. */
const STATE_VERSION = 1
/** Guard rails for a hostile or corrupted payload. */
const MAX_BODY_BYTES = 64 * 1024
const MAX_HIDDEN = 2000
/** Ignore an absurdly large state file instead of parsing it into memory. */
const MAX_STATE_FILE_BYTES = 1024 * 1024
/** How often stale ids (workspaces deleted while no browser was open) are pruned. */
const PRUNE_INTERVAL_MS = 60_000
/**
 * How often the state file is stat'ed for changes written by ANOTHER Host
 * process. DSH Desktop and `dsh web` run separate Host processes but share
 * `$DSH_HOME`; without this watch their in-memory states drift apart.
 */
const POLL_INTERVAL_MS = 800
/** A lock file older than this is considered abandoned (crashed writer). */
const LOCK_STALE_MS = 10_000
/** How long a mutation waits for the cross-process write lock. */
const LOCK_WAIT_MS = 1500
/** SSE keep-alive cadence (comment frames keep idle sockets alive). */
const STREAM_PING_MS = 25_000

/**
 * Hot-reload helper shared across module instances: the web server rejects a
 * duplicate (kind, path) route, so a freshly applied instance first releases
 * whatever the previous instance still holds.
 */
const ROUTES_HOLDER = (() => {
  const key = Symbol.for('@adamcjm/dsh-workspace-visibility/route-disposers')
  if (globalThis[key] === undefined) globalThis[key] = { value: undefined }
  return globalThis[key]
})()

function disposeRoutes() {
  const dispose = ROUTES_HOLDER.value
  if (typeof dispose !== 'function') return
  ROUTES_HOLDER.value = undefined
  try { dispose() } catch { /* the previous instance is already gone */ }
}

/** DSH home directory (`DSH_HOME`, else the platform default `~/.dsh`). */
function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/** Durable state file location. */
function statePath() {
  return join(resolveDshHome(), 'storages', 'workspace-visibility.json')
}

/** Default state used before the file exists (or after a corrupt read). */
function emptyState() {
  return {
    version: STATE_VERSION,
    hidden: [],
    showHidden: false,
    legacyCleanupDone: false,
    updatedAt: null,
  }
}

function uniqueIds(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= MAX_HIDDEN) break
  }
  return out
}

/** Validate a state read from disk or built by a mutation. */
function normalizeState(input) {
  const base = emptyState()
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return base
  return {
    version: STATE_VERSION,
    hidden: uniqueIds(input.hidden),
    showHidden: input.showHidden === true,
    legacyCleanupDone: input.legacyCleanupDone === true,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : null,
  }
}

/** Write a JSON response on the Node HTTP response object. */
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** Read and validate a JSON request body with a hard size cap. */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  const parsed = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object')
  }
  return parsed
}

/**
 * Cordis plugin entry: load the durable state lazily, then serve the three
 * routes. Mutations are serialized through one write chain and broadcast to
 * every SSE subscriber.
 */
export function apply(ctx) {
  const file = statePath()
  let state = null
  let loading = null
  let writeChain = Promise.resolve()
  /** Last file version observed by this process (for cross-process polling). */
  let lastSeenMtimeMs = 0
  let lastSeenSize = -1
  /** Live SSE responses. */
  const streams = new Set()

  function loggerWarn(message) {
    try { ctx.logger?.warn?.(message) } catch { /* logging must never break the plugin */ }
  }

  function loadState() {
    // Once loaded, always answer with the CURRENT in-memory state: mutations
    // replace `state`, so the cached loading promise alone would go stale.
    if (state !== null) return Promise.resolve(state)
    if (loading !== null) return loading
    loading = (async () => {
      try {
        const info = await stat(file)
        lastSeenMtimeMs = info.mtimeMs
        lastSeenSize = info.size
        if (info.size > MAX_STATE_FILE_BYTES) {
          loggerWarn('workspace-visibility: 状态文件异常过大，已忽略并使用空状态')
          state = emptyState()
          return state
        }
        const raw = await readFile(file, 'utf8')
        state = normalizeState(JSON.parse(raw))
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          loggerWarn(`workspace-visibility: 状态文件无法读取，使用空状态 (${String(error?.message || error)})`)
        }
        state = emptyState()
      }
      return state
    })()
    return loading
  }

  /** Optional registry lookup: never a hard dependency, never throws. */
  function registry() {
    try {
      const service = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : null
      return service !== null && service !== undefined && typeof service.get === 'function' ? service : null
    } catch (error) {
      return null
    }
  }

  /**
   * Drop hidden ids whose workspace no longer exists. Runs after load, on every
   * GET (so a deleted workspace never keeps a stale record in the file) and on
   * a slow timer. A registry hiccup keeps the id instead of losing state, and
   * an unavailable registry simply skips the pass.
   */
  async function pruneStale() {
    await loadState()
    if (state.hidden.length === 0) return false
    const reg = registry()
    if (reg === null) return false
    const kept = []
    let removed = 0
    for (const id of state.hidden) {
      try {
        if (reg.get(id) === undefined) removed += 1
        else kept.push(id)
      } catch (error) {
        kept.push(id)
      }
    }
    if (removed === 0) return false
    state = { ...state, hidden: kept, updatedAt: new Date().toISOString() }
    await persist()
    broadcast()
    loggerWarn(`workspace-visibility: 已清理 ${removed} 个已不存在的工作区隐藏记录`)
    return true
  }

  /** Two normalized states describe the same visibility configuration. */
  function sameState(left, right) {
    if (left === null || right === null) return left === right
    if (left.hidden.length !== right.hidden.length
      || left.showHidden !== right.showHidden
      || left.legacyCleanupDone !== right.legacyCleanupDone) return false
    for (let index = 0; index < left.hidden.length; index += 1) {
      if (left.hidden[index] !== right.hidden[index]) return false
    }
    return true
  }

  /** Read the state file as another Host process may have left it. */
  async function readDiskState() {
    try {
      const info = await stat(file)
      if (info.size > MAX_STATE_FILE_BYTES) return null
      const raw = await readFile(file, 'utf8')
      return normalizeState(JSON.parse(raw))
    } catch (error) {
      return null
    }
  }

  /**
   * Best-effort cross-process write lock: `mkdir`-free O_EXCL lock file so a
   * Desktop mutation and a web mutation read-modify-write the same state
   * without losing each other. Falls back to an unlocked write if the lock
   * cannot be taken in time (a hung lock must never freeze the sidebar).
   */
  async function withFileLock(fn) {
    const lockFile = `${file}.lock`
    const deadline = Date.now() + LOCK_WAIT_MS
    let handle = null
    for (;;) {
      try {
        handle = await open(lockFile, 'wx')
        break
      } catch (error) {
        if (error?.code !== 'EEXIST') return await fn()
        try {
          const info = await stat(lockFile)
          if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
            await unlink(lockFile).catch(() => {})
            continue
          }
        } catch (statError) { /* the lock vanished meanwhile: retry */ }
        if (Date.now() >= deadline) return await fn()
        await new Promise((resolve) => setTimeout(resolve, 20 + Math.floor(Math.random() * 40)))
      }
    }
    try {
      try { await handle.writeFile(String(process.pid)) } catch (error) { /* diagnostics only */ }
      return await fn()
    } finally {
      try { await handle.close() } catch (error) { /* ignore */ }
      try { await unlink(lockFile) } catch (error) { /* ignore */ }
    }
  }

  /**
   * Pull changes written by another Host process (Desktop ↔ web share one
   * `DSH_HOME`). Only touched when the file version actually moves, and our
   * own writes are ignored via a content comparison, so no echo broadcasts.
   */
  async function pollStateFile() {
    try {
      const info = await stat(file)
      if (info.mtimeMs === lastSeenMtimeMs && info.size === lastSeenSize) return
      lastSeenMtimeMs = info.mtimeMs
      lastSeenSize = info.size
      const disk = await readDiskState()
      if (disk === null) return
      await loadState()
      if (state !== null && sameState(disk, state)) return
      state = disk
      broadcast()
    } catch (error) { /* the file may vanish between stat and read */ }
  }

  function broadcast() {
    const payload = `data: ${JSON.stringify(state)}\n\n`
    for (const res of Array.from(streams)) {
      try {
        res.write(payload)
      } catch {
        streams.delete(res)
      }
    }
  }

  /** Queue one atomic write of the current in-memory state. */
  function persist() {
    const snapshot = `${JSON.stringify(state, null, 2)}\n`
    writeChain = writeChain.then(async () => {
      const dir = dirname(file)
      await mkdir(dir, { recursive: true })
      const tmp = `${file}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
      await writeFile(tmp, snapshot, { mode: 0o600 })
      await rename(tmp, file)
    }).catch((error) => {
      loggerWarn(`workspace-visibility: 写入状态失败 (${String(error?.message || error)})`)
    })
    return writeChain
  }

  /**
   * Apply one incremental mutation. Increments (not whole-state PUTs) keep two
   * clients that hide different workspaces from overwriting each other.
   */
  function applyMutation(base, payload) {
    const type = payload?.type
    const value = payload?.value === true
    if (type === 'setHidden' || type === 'toggleHidden') {
      const requested = typeof payload?.workspaceId === 'string' ? payload.workspaceId.trim() : ''
      if (requested === '' || requested.length > 200) throw new Error('workspaceId is required')
      if (value === true || type === 'toggleHidden') {
        // Never persist a hide for a workspace the registry does not know
        // (a stale client or a deleted workspace). Registry hiccups keep the
        // request instead of dropping it.
        const reg = registry()
        if (reg !== null) {
          let exists = true
          try { exists = reg.get(requested) !== undefined } catch (error) { exists = true }
          if (!exists) return base
        }
      }
      const hidden = new Set(base.hidden)
      const next = type === 'toggleHidden' ? !hidden.has(requested) : value
      if (next === hidden.has(requested)) return base
      if (next) hidden.add(requested)
      else hidden.delete(requested)
      return {
        ...base,
        hidden: uniqueIds(Array.from(hidden)),
        updatedAt: new Date().toISOString(),
      }
    }
    if (type === 'setShowHidden') {
      if (base.showHidden === value) return base
      return { ...base, showHidden: value, updatedAt: new Date().toISOString() }
    }
    if (type === 'setLegacyCleanupDone') {
      if (base.legacyCleanupDone === value) return base
      return { ...base, legacyCleanupDone: value, updatedAt: new Date().toISOString() }
    }
    throw new Error(`unknown mutation type: ${String(type)}`)
  }

  /**
   * Apply one incremental mutation.
   *
   * The file is read-modify-written under a cross-process lock: Desktop and
   * `dsh web` are separate Host processes sharing one state file, so a blind
   * in-memory overwrite could drop the other instance's change. If the lock
   * cannot be taken the mutation still applies, just without the merge.
   */
  async function mutate(payload) {
    await loadState()
    return withFileLock(async () => {
      const disk = await readDiskState()
      if (disk !== null && !sameState(disk, state)) {
        // Another Host process changed the state while this one was idle.
        state = disk
        broadcast()
      }
      const next = applyMutation(state, payload)
      if (next === state) return state
      state = next
      await persist()
      broadcast()
      return state
    })
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const sub = url.pathname.slice(PREFIX.length)

    if (req.method === 'GET' && (sub === '/state' || sub === '/')) {
      await loadState()
      await pruneStale()
      sendJson(res, 200, state)
      return
    }

    if (req.method === 'POST' && sub === '/mutate') {
      const payload = await readJsonBody(req)
      sendJson(res, 200, await mutate(payload))
      return
    }

    if (req.method === 'GET' && sub === '/stream') {
      const current = await loadState()
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      res.write('retry: 2000\n\n')
      res.write(`data: ${JSON.stringify(current)}\n\n`)
      streams.add(res)
      const ping = setInterval(() => {
        try { res.write(': ping\n\n') } catch { /* the close handler cleans up */ }
      }, STREAM_PING_MS)
      const cleanup = () => {
        clearInterval(ping)
        streams.delete(res)
      }
      req.on('close', cleanup)
      res.on('close', cleanup)
      return
    }

    sendJson(res, 404, { error: 'not found' })
  }

  ctx.effect(() => {
    disposeRoutes()
    const disposeRoute = ctx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: async (req, res) => {
        try {
          await handle(req, res)
        } catch (error) {
          loggerWarn(`workspace-visibility: 请求失败 (${String(error?.message || error)})`)
          if (!res.headersSent) {
            sendJson(res, 400, { error: String(error?.message || error) })
          } else {
            try { res.end() } catch { /* already closed */ }
          }
        }
      },
    })
    const mine = () => {
      try { disposeRoute() } catch { /* ignore */ }
      for (const res of Array.from(streams)) {
        try { res.end() } catch { /* ignore */ }
      }
      streams.clear()
    }
    ROUTES_HOLDER.value = mine
    const pruneTimer = setInterval(() => {
      if (streams.size === 0 && state !== null && state.hidden.length === 0) return
      pruneStale().catch((error) => loggerWarn(`workspace-visibility: 清理失效记录失败 (${String(error?.message || error)})`))
    }, PRUNE_INTERVAL_MS)
    if (typeof pruneTimer.unref === 'function') pruneTimer.unref()
    return () => {
      clearInterval(pruneTimer)
      if (ROUTES_HOLDER.value !== mine) return
      ROUTES_HOLDER.value = undefined
      mine()
    }
  }, 'dsh-workspace-visibility: host state routes')

  // Desktop and `dsh web` are separate Host processes sharing this file; the
  // poll is what makes a change in one surface show up in the other (< 1 s).
  ctx.effect(() => {
    const timer = setInterval(() => {
      pollStateFile().catch(() => { /* stat/read races are expected */ })
    }, POLL_INTERVAL_MS)
    if (typeof timer.unref === 'function') timer.unref()
    return () => clearInterval(timer)
  }, 'dsh-workspace-visibility: cross-process state watch')
}
