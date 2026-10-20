/**
 * Zero-dependency self-check for the Host half.
 *
 * Mounts `lib/index.js` against a fake Cordis context (a capturing
 * `webServer.register`), points `DSH_HOME` at a temp directory, and drives the
 * three routes with Node-style request/response fakes:
 *
 *   GET  /workspace-visibility/state
 *   POST /workspace-visibility/mutate
 *   GET  /workspace-visibility/stream   (SSE)
 *
 * It verifies durable atomic writes, incremental mutations (two clients
 * hiding different workspaces), the SSE broadcast, the one-shot legacy flag,
 * reload from disk and corrupt-file tolerance.
 *
 * Run: node test/host.mjs
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { apply } from '../lib/index.js'

const checks = []
function check(name, pass, detail) {
  checks.push({ name, pass, detail })
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail === undefined ? '' : `  (${detail})`}`)
}
function equal(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `actual=${JSON.stringify(actual)}`)
}

/** Node-style request fake carrying an optional JSON body. */
function makeReq(method, url, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.url = url
  return req
}

/** Node-style response fake recording status/headers/body. */
function makeRes() {
  const handlers = new Map()
  const res = {
    statusCode: 200,
    headers: null,
    body: '',
    headersSent: false,
    ended: false,
    writeHead(status, headers) {
      res.statusCode = status
      res.headers = headers
      res.headersSent = true
      return res
    },
    write(chunk) {
      res.body += String(chunk)
      return true
    },
    end(chunk) {
      if (chunk !== undefined) res.body += String(chunk)
      res.ended = true
      res.emit('close')
      return res
    },
    on(event, listener) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(listener)
      return res
    },
    emit(event) {
      for (const listener of handlers.get(event) ?? []) listener()
    },
  }
  return res
}

/** Read the last SSE data frame of a fake response. */
function lastFrame(res) {
  const frames = res.body.split('\n\n').filter((frame) => frame.startsWith('data: '))
  if (frames.length === 0) return null
  return JSON.parse(frames[frames.length - 1].slice('data: '.length))
}

/** Mount the plugin on a fake context; returns the captured route and disposers. */
function mount() {
  const routes = []
  const effects = []
  const warnings = []
  const ctx = {
    logger: { warn: (message) => warnings.push(String(message)) },
    webServer: {
      register(route) {
        routes.push(route)
        let disposed = false
        return () => {
          disposed = true
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
    },
    effect(fn) {
      const dispose = fn()
      effects.push(dispose)
      return () => { if (typeof dispose === 'function') dispose() }
    },
  }
  apply(ctx)
  const route = routes[0]
  return {
    ctx,
    route,
    warnings,
    dispose() {
      for (const dispose of effects) {
        if (typeof dispose === 'function') dispose()
      }
    },
  }
}

async function call(route, method, path, body) {
  const req = makeReq(method, '/workspace-visibility' + path, body)
  const res = makeRes()
  await route.handler(req, res)
  return res
}

const home = await mkdtemp(join(tmpdir(), 'wv-host-'))
process.env.DSH_HOME = home
const stateFile = join(home, 'storages', 'workspace-visibility.json')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

try {
  const first = mount()
  check('registers one prefix route', first.route !== undefined
    && first.route.kind === 'prefix' && first.route.path === '/workspace-visibility')

  const empty = await call(first.route, 'GET', '/state')
  equal('GET /state starts empty', {
    hidden: JSON.parse(empty.body).hidden,
    showHidden: JSON.parse(empty.body).showHidden,
    legacyCleanupDone: JSON.parse(empty.body).legacyCleanupDone,
  }, { hidden: [], showHidden: false, legacyCleanupDone: false })
  check('reading does not create the state file', await readFile(stateFile, 'utf8').then(() => false, () => true))

  const hiddenOne = JSON.parse((await call(first.route, 'POST', '/mutate', { type: 'setHidden', workspaceId: 'w1', value: true })).body)
  equal('mutate hides the workspace', hiddenOne.hidden, ['w1'])
  const disk = JSON.parse(await readFile(stateFile, 'utf8'))
  equal('state file persisted the hide', disk.hidden, ['w1'])
  equal('state file carries the schema version', disk.version, 1)

  const hiddenTwo = JSON.parse((await call(first.route, 'POST', '/mutate', { type: 'setHidden', workspaceId: 'w2', value: true })).body)
  equal('increments keep both client ids', hiddenTwo.hidden, ['w1', 'w2'])

  const stream = await call(first.route, 'GET', '/stream')
  equal('SSE responds with the baseline', lastFrame(stream).hidden, ['w1', 'w2'])
  check('SSE stays open', stream.ended === false && stream.headers['content-type'].startsWith('text/event-stream'))

  const shown = JSON.parse((await call(first.route, 'POST', '/mutate', { type: 'setShowHidden', value: true })).body)
  equal('switch mutation applied', shown.showHidden, true)
  equal('SSE broadcast the switch', lastFrame(stream).showHidden, true)

  const legacy = JSON.parse((await call(first.route, 'POST', '/mutate', { type: 'setLegacyCleanupDone', value: true })).body)
  equal('legacy cleanup flag applied', legacy.legacyCleanupDone, true)

  const bad = await call(first.route, 'POST', '/mutate', { type: 'nope' })
  check('unknown mutation answers 400', bad.statusCode === 400, String(bad.statusCode))
  const missing = await call(first.route, 'POST', '/mutate', { type: 'setHidden' })
  check('setHidden without id answers 400', missing.statusCode === 400, String(missing.statusCode))

  first.dispose()
  check('dispose ends the SSE response', stream.ended === true)

  // Reload from disk in a fresh instance (simulates a Host restart).
  const second = mount()
  const reloaded = JSON.parse((await call(second.route, 'GET', '/state')).body)
  equal('state reloaded from disk after restart', {
    hidden: reloaded.hidden, showHidden: reloaded.showHidden, legacyCleanupDone: reloaded.legacyCleanupDone,
  }, { hidden: ['w1', 'w2'], showHidden: true, legacyCleanupDone: true })
  second.dispose()

  // Corrupt file degrades to empty state with a warning, not a crash.
  await mkdir(join(home, 'storages'), { recursive: true })
  await writeFile(stateFile, '{ definitely not json', 'utf8')
  const third = mount()
  const recovered = JSON.parse((await call(third.route, 'GET', '/state')).body)
  equal('corrupt state file degrades to empty', recovered.hidden, [])
  check('corrupt state file logged a warning', third.warnings.some((message) => message.includes('无法读取')))
  third.dispose()
  await sleep(20)
} finally {
  await rm(home, { recursive: true, force: true })
}

const failed = checks.filter((item) => !item.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) {
  console.error('\nFailures:')
  for (const item of failed) console.error(` - ${item.name}${item.detail === undefined ? '' : ` (${item.detail})`}`)
  process.exit(1)
}
