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
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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
  async function mutate(payload) {
    await loadState()
    const type = payload?.type
    const value = payload?.value === true
    if (type === 'setHidden' || type === 'toggleHidden') {
      const requested = typeof payload?.workspaceId === 'string' ? payload.workspaceId.trim() : ''
      if (requested === '' || requested.length > 200) throw new Error('workspaceId is required')
      const hidden = new Set(state.hidden)
      const next = type === 'toggleHidden' ? !hidden.has(requested) : value
      if (next === hidden.has(requested)) return state
      if (next) hidden.add(requested)
      else hidden.delete(requested)
      state = {
        ...state,
        hidden: uniqueIds(Array.from(hidden)),
        updatedAt: new Date().toISOString(),
      }
    } else if (type === 'setShowHidden') {
      if (state.showHidden === value) return state
      state = { ...state, showHidden: value, updatedAt: new Date().toISOString() }
    } else if (type === 'setLegacyCleanupDone') {
      if (state.legacyCleanupDone === value) return state
      state = { ...state, legacyCleanupDone: value, updatedAt: new Date().toISOString() }
    } else {
      throw new Error(`unknown mutation type: ${String(type)}`)
    }
    await persist()
    broadcast()
    return state
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const sub = url.pathname.slice(PREFIX.length)

    if (req.method === 'GET' && (sub === '/state' || sub === '/')) {
      sendJson(res, 200, await loadState())
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
    return () => {
      if (ROUTES_HOLDER.value !== mine) return
      ROUTES_HOLDER.value = undefined
      mine()
    }
  }, 'dsh-workspace-visibility: host state routes')
}
