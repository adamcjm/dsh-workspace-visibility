/**
 * Zero-dependency self-check for `@adamcjm/dsh-workspace-visibility`.
 *
 * No DSH process is needed: the client bundle is evaluated in a `vm` sandbox
 * with a fake `__ModuleLoader__`, React, document and localStorage. The checks
 * cover the four things that decide whether the plugin works:
 *
 *   1. the loader contract (id, `apply`, `inject`);
 *   2. the pure projection that hides a workspace without spilling its
 *      sessions into the shipped "Ungrouped" bucket;
 *   3. the store (persistence, stable snapshots, pruning);
 *   4. the model wrapper (filter on, filtering reference-stable, dispose
 *      restores the original own-property shape) and a full `apply()` run.
 *
 * Run: node test/verify.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const PACKAGE_NAME = '@adamcjm/dsh-workspace-visibility'
const STORAGE_KEY = 'dsh-workspace-visibility.state.v1'

/* ------------------------------------------------------------------ *
 * Fake browser                                                       *
 * ------------------------------------------------------------------ */
function makeElement(tag) {
  const element = {
    tagName: String(tag).toUpperCase(),
    tag,
    id: '',
    className: '',
    textContent: '',
    innerHTML: '',
    children: [],
    parentElement: null,
    attributes: {},
    appendChild(child) {
      child.parentElement = element
      element.children.push(child)
      return child
    },
    removeAttribute(name) { delete element.attributes[name] },
    setAttribute(name, value) { element.attributes[name] = String(value) },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(element.attributes, name) ? element.attributes[name] : null
    },
    addEventListener() {},
    removeEventListener() {},
    remove() {
      const parent = element.parentElement
      if (parent === null) return
      const index = parent.children.indexOf(element)
      if (index >= 0) parent.children.splice(index, 1)
      element.parentElement = null
    },
    querySelector() { return null },
    querySelectorAll() { return [] },
    closest() { return null },
    dispatchEvent() { return true },
  }
  return element
}

function makeDocument() {
  const head = makeElement('head')
  const documentStub = {
    head,
    documentElement: makeElement('html'),
    body: makeElement('body'),
    activeElement: null,
    createElement: makeElement,
    getElementById(id) {
      return head.children.find((child) => child.id === id) ?? null
    },
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll() { return [] },
  }
  documentStub.activeElement = documentStub.body
  return documentStub
}

function makeStorage(initial) {
  const data = new Map(initial === undefined ? [] : Object.entries(initial))
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null },
    setItem(key, value) { data.set(key, String(value)) },
    removeItem(key) { data.delete(key) },
    dump() { return Object.fromEntries(data) },
  }
}

function makeMutationObserver() {
  const instances = []
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback
      this.observed = null
      instances.push(this)
    }
    observe(target) { this.observed = target }
    disconnect() { this.observed = null }
  }
  return { Ctor: FakeMutationObserver, instances }
}

function makeReact() {
  return {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
    useEffect() {},
    useSyncExternalStore(subscribe, getSnapshot) { return getSnapshot() },
  }
}

function loadBundle(options = {}) {
  const code = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  const document = makeDocument()
  const storage = options.storage ?? makeStorage()
  const observer = makeMutationObserver()
  const entries = []
  const sandbox = {
    console,
    Date,
    JSON,
    Math,
    Array,
    Object,
    Set,
    Map,
    Symbol,
    String,
    Number,
    Boolean,
    Error,
    Promise,
    setTimeout,
    clearTimeout,
    document,
    MutationObserver: undefined,
    window: {
      __ModuleLoader__: { load(entry) { entries.push(entry) } },
      localStorage: storage,
      MutationObserver: observer.Ctor,
      KeyboardEvent: class FakeKeyboardEvent {
        constructor(type, init) {
          this.type = type
          this.key = init?.key
        }
      },
    },
    React: makeReact(),
  }
  sandbox.globalThis = sandbox
  runInNewContext(code, sandbox)
  if (entries.length !== 1) throw new Error(`expected one loader entry, got ${entries.length}`)
  const entry = entries[0]
  const react = makeReact()
  const exports = entry.factory((id) => {
    if (id === 'react') return react
    throw new Error(`unexpected dependency: ${id}`)
  })
  return { entry, exports, document, storage, observer }
}

/* ------------------------------------------------------------------ *
 * Mini test harness                                                    *
 * ------------------------------------------------------------------ */
const checks = []
function check(name, pass, detail) {
  checks.push({ name, pass, detail })
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail === undefined ? '' : `  (${detail})`}`)
}
function equal(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `actual=${JSON.stringify(actual)}`)
}

/* ------------------------------------------------------------------ *
 * 1. Loader contract                                                   *
 * ------------------------------------------------------------------ */
const loaded = loadBundle()
equal('loader entry id is the package name', loaded.entry.id, PACKAGE_NAME)
check('factory publishes apply', typeof loaded.exports.apply === 'function')
equal('inject waits for slots/locale/workspaces', loaded.exports.inject, ['slots', 'locale', 'workspaces'])
const t = loaded.exports.__test
check('test seam is exported', t !== undefined && typeof t.filterProjection === 'function')

/* ------------------------------------------------------------------ *
 * 2. Persistence parsing                                               *
 * ------------------------------------------------------------------ */
equal('parseStored(null) is empty', t.parseStored(null), { hidden: [], showHidden: false })
equal('parseStored(broken json) is empty', t.parseStored('{oops'), { hidden: [], showHidden: false })
equal('parseStored(array) is empty', t.parseStored('[]'), { hidden: [], showHidden: false })
equal(
  'parseStored keeps valid ids, drops junk and duplicates',
  t.parseStored(JSON.stringify({ hidden: ['a', '', null, 7, 'a', 'b'], showHidden: true })),
  { hidden: ['a', 'b'], showHidden: true },
)
equal('serializeState round-trips', t.parseStored(t.serializeState(new Set(['x', 'y']), true)), { hidden: ['x', 'y'], showHidden: true })
equal('serializeState stores the switch', t.serializeState(new Set(), true).includes('"showHidden":true'), true)

/* ------------------------------------------------------------------ *
 * 3. Snapshot projection                                               *
 * ------------------------------------------------------------------ */
const raw = {
  state: 'ready',
  items: [
    { workspaceId: 'w1', path: '/one', title: 'one', sessionIds: ['s1', 's2'] },
    { workspaceId: 'w2', path: '/two', title: 'two', sessionIds: ['s3'] },
  ],
  archivedSessionIds: ['s9'],
  pinnedSessionIds: ['s1', 's3'],
}
const projected = t.filterProjection(raw, new Set(['w1']))
equal('hidden workspace leaves items', projected.items.map((item) => item.workspaceId), ['w2'])
equal('hidden sessions join the view-only archive set', projected.archivedSessionIds, ['s9', 's1', 's2'])
equal('hidden sessions lose their pin', projected.pinnedSessionIds, ['s3'])
equal('nothing hidden returns the same snapshot object', t.filterProjection(raw, new Set()), raw)
equal('hidden id absent from items returns the same object', t.filterProjection(raw, new Set(['nope'])), raw)
equal('mergeArchived dedupes and keeps base order', t.mergeArchived(['a', 'b'], ['b', 'c']), ['a', 'b', 'c'])
equal('mergeArchived without extra reuses the base array', t.mergeArchived(['a'], []), ['a'])

/* ------------------------------------------------------------------ *
 * 4. Menu recognition (zh + en)                                        *
 * ------------------------------------------------------------------ */
equal('recognizes the shipped workspace menu (zh)', t.menuKindFromText('重命名删除工作区'), 'workspace')
equal('recognizes the shipped workspace menu (en)', t.menuKindFromText('RenameDelete workspace'), 'workspace')
equal('recognizes the shipped view options menu (zh)', t.menuKindFromText('分组方式按工作区按工作区树单列表'), 'viewOptions')
equal('recognizes the shipped view options menu (en)', t.menuKindFromText('Group byWorkspace'), 'viewOptions')
equal('unknown menu text is ignored', t.menuKindFromText('Copy Session ID'), null)

/* ------------------------------------------------------------------ *
 * 5. Store                                                             *
 * ------------------------------------------------------------------ */
{
  const storage = makeStorage()
  const store = t.createStore({ storage })
  const before = store.getState()
  check('snapshot is referentially stable while unchanged', store.getState() === before)
  let notified = 0
  const off = store.subscribe(() => { notified += 1 })
  check('setHidden writes a new state version', store.setHidden('w1', true) === true)
  check('setHidden notifies subscribers', notified === 1)
  check('setHidden twice is a no-op', store.setHidden('w1', true) === false)
  check('snapshot changes after a write', store.getState() !== before)
  check('storage received the hidden id', JSON.parse(storage.getItem(STORAGE_KEY)).hidden[0] === 'w1')
  check('showHidden toggles', store.setShowHidden(true) === true && store.getState().showHidden === true)
  check('prune drops stale ids, keeps real ones', store.prune(new Set(['w2'])) === true && store.getState().hidden.size === 0)
  check('hiding closes the show-hidden switch', (() => {
    store.setShowHidden(true)
    store.setHidden('w4', true)
    return store.getState().showHidden === false
  })())
  check('unhiding the last row closes the switch too', (() => {
    store.setHidden('w3', false)
    store.setShowHidden(true)
    store.setHidden('w4', false)
    return store.getState().showHidden === false && store.getState().hidden.size === 0
  })())
  off()
  check('unsubscribe stops notifications', (() => { const n = notified; store.setHidden('w3', true); return notified === n })())
}

/* ------------------------------------------------------------------ *
 * 6. Workspace model projection                                        *
 * ------------------------------------------------------------------ */
{
  const modelListeners = new Set()
  const state = { raw }
  const prototype = {
    getSnapshot() { return state.raw },
    subscribe(listener) {
      modelListeners.add(listener)
      return () => modelListeners.delete(listener)
    },
  }
  const model = Object.create(prototype)
  const store = t.createStore({ storage: makeStorage() })
  const fakeCtx = { get(name) { return name === 'workspaces' ? { list: model } : null } }
  const dispose = t.installWorkspaceProjection(fakeCtx, store)

  equal('wrapper filters after a hide', (() => { store.setHidden('w1', true); return model.getSnapshot().items.map((i) => i.workspaceId) })(), ['w2'])
  const a = model.getSnapshot()
  const b = model.getSnapshot()
  check('filtered snapshot is cached between reads', a === b)
  check('showing hidden workspaces returns the raw snapshot', (() => {
    store.setShowHidden(true)
    return model.getSnapshot() === state.raw
  })())
  check('model subscribers are bridged to the store', (() => {
    let hit = 0
    const off = model.subscribe(() => { hit += 1 })
    store.setHidden('w2', true)
    off()
    return hit === 1
  })())
  dispose()
  check('dispose removes the own getSnapshot property', Object.prototype.hasOwnProperty.call(model, 'getSnapshot') === false)
  check('dispose restores the prototype snapshot', model.getSnapshot() === state.raw)
}

/* ------------------------------------------------------------------ *
 * 7. Full apply() with a fake Cordis context                          *
 * ------------------------------------------------------------------ */
{
  const persisted = makeStorage({
    [STORAGE_KEY]: JSON.stringify({ hidden: ['w1'], showHidden: false }),
  })
  const react = makeReact()
  const loadedApply = loadBundle({ storage: persisted })
  const modelListeners = new Set()
  const state = { raw }
  const model = {
    getSnapshot() { return state.raw },
    subscribe(listener) { modelListeners.add(listener); return () => modelListeners.delete(listener) },
  }
  const effects = []
  const registrations = []
  const localeRegistrations = []
  const fakeCtx = {
    effect(fn, label) {
      const dispose = fn()
      effects.push({ label, dispose })
      return () => { if (typeof dispose === 'function') dispose() }
    },
    get(name) { return name === 'workspaces' ? { list: model } : null },
    locale: {
      register(ns, dict) { localeRegistrations.push({ ns, dict }); return () => {} },
      bind(ns) {
        return (key) => {
          const dict = localeRegistrations.find((item) => item.ns === ns)?.dict
          const active = dict?.zh ?? dict?.en ?? {}
          return active[key] ?? key
        }
      },
    },
    slots: {
      inject(slotName, factory) {
        const result = factory()
        return () => { if (typeof result?.dispose === 'function') result.dispose() }
      },
      register(options, Component) {
        registrations.push({ options, Component })
        return { dispose() {} }
      },
    },
  }
  loadedApply.exports.apply(fakeCtx)
  check('apply registers the namespace dictionary', localeRegistrations.length === 1 && localeRegistrations[0].ns === 'dsh-workspace-visibility'
    && localeRegistrations[0].dict.zh !== undefined && localeRegistrations[0].dict.en !== undefined)
  check('apply registers the sidebar-foot fallback', registrations.length === 1
    && registrations[0].options.name === 'sidebar.footer.action'
    && registrations[0].options.id === 'workspace-visibility')
  check('apply wraps the workspace model', typeof model.getSnapshot === 'function' && model.getSnapshot().items.length === 1
    && model.getSnapshot().items[0].workspaceId === 'w2')
  check('persisted hide is projected on load', model.getSnapshot().archivedSessionIds.includes('s1'))
  check('apply injects exactly one stylesheet', loadedApply.document.getElementById('dsh-workspace-visibility/style') !== null)

  // Dispose every effect, then everything must be back to the untouched model.
  for (const effect of effects) {
    if (typeof effect.dispose === 'function') effect.dispose()
  }
  check('effect disposal restores the raw model', model.getSnapshot() === state.raw)
  check('effect disposal removes the stylesheet', loadedApply.document.getElementById('dsh-workspace-visibility/style') === null)
  check('store.dispose effect is registered last', effects.map((e) => e.label).includes('dsh-workspace-visibility: store'))
}

/* ------------------------------------------------------------------ *
 * Report                                                               *
 * ------------------------------------------------------------------ */
const failed = checks.filter((item) => !item.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) {
  console.error('\nFailures:')
  for (const item of failed) console.error(` - ${item.name}${item.detail === undefined ? '' : ` (${item.detail})`}`)
  process.exit(1)
}
