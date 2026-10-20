/**
 * Browser half of `@adamcjm/dsh-workspace-visibility`.
 *
 * WHAT IT DOES
 * ------------
 * Hide selected workspaces from the DSH sidebar, and bring them back later:
 *
 *   1. Every Workspace row's own "…" menu gains **Hide workspace**; while the
 *      hidden rows are shown again, the same entry reads **Unhide workspace**.
 *   2. The sidebar **View options** menu gains a **Show hidden workspaces**
 *      switch, and a sidebar-foot fallback entry ("Hidden workspaces: N")
 *      toggles the same switch, so a menu-injection break can never strand a
 *      hidden workspace.
 *
 * Display only: nothing is archived, deleted, renamed or written into the
 * workspace registry, session logs or archive sets.
 *
 * PERSISTENCE AND SYNC
 * --------------------
 * Hidden ids and the switch live on the Host in
 * `$DSH_HOME/storages/workspace-visibility.json` (lib/index.js). The browser
 * keeps no copy: at boot the state is fetched once and then kept current by an
 * SSE stream (`/workspace-visibility/stream`), so a change made in Desktop
 * reaches an open Web page (and other tabs/browsers sharing the same Host)
 * without a refresh — the same push model as the shipped `workspace/follow`
 * stream. Local mutations travel as increments, so two clients hiding
 * different workspaces cannot overwrite each other.
 *
 * The one-time removal of the 0.1.x localStorage key is driven by the Host
 * flag `legacyCleanupDone`: it runs exactly once per state file and the
 * browser is never touched again afterwards. There is no migration — 0.1.x
 * hidden ids are discarded.
 *
 * WHY THERE IS NO SLOT
 * --------------------
 * In DSH 0.2.1-rc the shipped sidebar (`@deepseek-ai/dsh-client-ui-workspace`)
 * exposes slots for *Session* row menus and *Session* row buttons, but the
 * Workspace row menu (`ProjectRowItem`'s `workspaceMenuItems`) and the View
 * options menu (`ViewOptionsMenu`) are hardcoded arrays with no slot. So both
 * entries are appended to those menus as DOM, exactly where the user asked for
 * them. The entries clone the shipped menu item's own classes, so a restyle
 * keeps them native-looking; nothing hardcodes a hashed CSS-module name.
 *
 * The *hiding* itself does not touch the DOM: the plugin wraps the
 * `workspaces.list` client model (`getSnapshot`/`subscribe`, the same seam the
 * shipped sidebar reads lazily) and projects a filtered snapshot. That makes
 * the sidebar, its search results and the Hero workspace picker disappear the
 * workspace in one place, and it keeps working even if the menu DOM changes.
 *
 * THE "UNGROUPED" PITFALL
 * -----------------------
 * The shipped grouping builds one group per *visible* workspace and trails
 * every session that is not accounted by a visible workspace into an
 * "Ungrouped" bucket (`groupByWorkspace` in ui-workspace). Simply removing a
 * workspace from `items` would therefore spill all of its sessions into
 * "Ungrouped". The projection instead marks those sessions as archived
 * (view-only union into `archivedSessionIds`), so the shipped sidebar's own
 * archive visibility filter keeps them out — no Host archive write, no data
 * loss. Consequence: with the shipped **All conversations (show archived)**
 * view selected, those sessions would appear as archived rows under
 * "Ungrouped"; the default **Hide archived** view — and the Unhide action —
 * keeps the sidebar identical.
 *
 * FORMAT
 * ------
 * Plain `window.__ModuleLoader__.load` factory, no build step: edit, refresh
 * the page, done. Only `react` is taken from the platform module table.
 */

try {
  window.__ModuleLoader__.load({
  id: '@adamcjm/dsh-workspace-visibility',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    /* ------------------------------------------------------------------ *
     * React from the platform module table (fall back to the page global). *
     * ------------------------------------------------------------------ */
    let React = null
    try { React = require('react') } catch (error) { /* dynamic half: global fallback */ }
    if (!React) React = globalThis.React
    if (!React) throw new Error('dsh-workspace-visibility: React runtime unavailable')
    const h = React.createElement
    const useSyncExternalStore = typeof React.useSyncExternalStore === 'function'
      ? React.useSyncExternalStore
      : function fallbackUseSyncExternalStore(subscribe, getSnapshot) {
        // React < 18 fallback: re-render on every store notification.
        const value = React.useState(getSnapshot)[0]
        const force = React.useState(0)[1]
        React.useEffect(function () {
          let alive = true
          const off = subscribe(function () { if (alive) force(function (n) { return n + 1 }) })
          return function () { alive = false; if (typeof off === 'function') off() }
        }, [subscribe])
        return value
      }

    /* ------------------------------------------------------------------ *
     * Constants                                                          *
     * ------------------------------------------------------------------ */
    const NS = 'dsh-workspace-visibility'
    /** Host HTTP surface owned by lib/index.js. */
    const API_PREFIX = '/workspace-visibility'
    const STATE_URL = API_PREFIX + '/state'
    const MUTATE_URL = API_PREFIX + '/mutate'
    const STREAM_URL = API_PREFIX + '/stream'
    /** 0.1.x kept the hidden set here; removed once, then never touched again. */
    const LEGACY_STORAGE_KEY = 'dsh-workspace-visibility.state.v1'
    const STYLE_ID = 'dsh-workspace-visibility/style'
    const MENU_FLAG = 'data-dsh-wv-item'
    const ROW_FLAG = 'data-dsh-wv-hidden-row'
    const INSTALL_MARK = Symbol.for('@adamcjm/dsh-workspace-visibility/installed')

    const WORKSPACE_ROW_SELECTOR = '[data-row-key^="workspace:"]'
    const MENU_SELECTOR = '[role="menu"]'
    const MENU_ITEM_SELECTOR = '[role="menuitem"]'
    const MENU_VIEWPORT_SELECTOR = '[class*="viewport"]'

    /** How long a row/button click may arm the next opened menu. */
    const ARM_TTL_MS = 2500

    /** Shipped copy used to recognise which menu just opened (zh + en). */
    const SHIPPED_TEXT = {
      rename: ['重命名', 'Rename'],
      deleteWorkspace: ['删除工作区', 'Delete workspace'],
      groupBy: ['分组方式', 'Group by'],
      viewOptionsAria: ['视图选项', 'View options'],
    }

    const EYE_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.2"><path d="M8 3.5c-2.9 0-5.3 2.1-6.3 4.5 1 2.4 3.4 4.5 6.3 4.5s5.3-2.1 6.3-4.5C13.3 5.6 10.9 3.5 8 3.5Z"/><circle cx="8" cy="8" r="1.9"/><path d="M2.5 13.5 13.5 2.5"/></svg>'
    const CHECK_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.6"><path d="m3.5 8.5 3 3 6-7"/></svg>'

    /* ------------------------------------------------------------------ *
     * Dictionaries                                                        *
     * ------------------------------------------------------------------ */
    const zh = {
      'menu.hide': '隐藏工作区',
      'menu.unhide': '取消隐藏工作区',
      'viewOptions.showHidden': '显示隐藏工作区',
      'footer.label': '隐藏的工作区',
      'footer.show': '显示隐藏的工作区',
      'footer.hide': '隐藏已显示的工作区',
      'footer.count': '已隐藏 {n} 个',
    }
    const en = {
      'menu.hide': 'Hide workspace',
      'menu.unhide': 'Unhide workspace',
      'viewOptions.showHidden': 'Show hidden workspaces',
      'footer.label': 'Hidden workspaces',
      'footer.show': 'Show hidden workspaces',
      'footer.hide': 'Hide the shown workspaces again',
      'footer.count': '{n} hidden',
    }

    /** Bind a namespace translator and fill `{name}` placeholders. */
    function makeT(bind) {
      return function t(key, vars) {
        let text = ''
        try { text = bind(key) } catch (error) { text = key }
        if (typeof text !== 'string' || text === '') text = key
        if (vars === undefined) return text
        return text.replace(/\{(\w+)\}/g, function (_, name) {
          return vars[name] === undefined ? '' : String(vars[name])
        })
      }
    }

    /* ------------------------------------------------------------------ *
     * Pure helpers (also exported as `__test` for test/verify.mjs)        *
     * ------------------------------------------------------------------ */
    function asId(value) {
      return typeof value === 'string' && value.length > 0 ? value : null
    }

    /**
     * Normalize one Host state payload. The Host is the only source of truth;
     * anything malformed degrades to "nothing hidden" instead of throwing.
     */
    function normalizeRemoteState(input) {
      const object = (input !== null && typeof input === 'object' && !Array.isArray(input)) ? input : {}
      const hidden = []
      const seen = new Set()
      if (Array.isArray(object.hidden)) {
        for (const value of object.hidden) {
          const id = asId(value)
          if (id === null || seen.has(id)) continue
          seen.add(id)
          hidden.push(id)
        }
      }
      return {
        hidden: hidden,
        showHidden: object.showHidden === true,
        legacyCleanupDone: object.legacyCleanupDone === true,
      }
    }

    /** Include `extra` ids in a view-only archived list, order-stable. */
    function mergeArchived(base, extra) {
      const list = Array.isArray(base) ? base : []
      if (extra === null || extra.length === 0) return list
      const seen = new Set(list)
      let changed = false
      const out = list.slice()
      for (const id of extra) {
        if (typeof id !== 'string' || seen.has(id)) continue
        seen.add(id)
        out.push(id)
        changed = true
      }
      return changed ? out : list
    }

    /**
     * Project the client Workspace snapshot for the sidebar.
     *
     * - `items` loses the hidden workspaces;
     * - the sessions those workspaces account become view-only archived ids,
     *   so the shipped grouping cannot trail them into "Ungrouped";
     * - pins owned by them are dropped (the Host keeps pin and archive sets
     *   mutually exclusive, and these sessions are view-archived here).
     *
     * Returns the untouched snapshot object when nothing is hidden, keeping
     * `useSyncExternalStore` referentially stable.
     */
    function filterProjection(raw, hidden) {
      if (raw === null || typeof raw !== 'object') return raw
      const items = Array.isArray(raw.items) ? raw.items : []
      let hiddenCount = 0
      const hiddenSessionIds = []
      const hiddenSessionSet = new Set()
      for (const item of items) {
        if (item === null || typeof item !== 'object') continue
        if (!hidden.has(item.workspaceId)) continue
        hiddenCount += 1
        if (Array.isArray(item.sessionIds)) {
          for (const sessionId of item.sessionIds) {
            if (typeof sessionId !== 'string' || hiddenSessionSet.has(sessionId)) continue
            hiddenSessionSet.add(sessionId)
            hiddenSessionIds.push(sessionId)
          }
        }
      }
      if (hiddenCount === 0) return raw

      const base = Array.isArray(raw.archivedSessionIds) ? raw.archivedSessionIds : []
      const archivedSessionIds = mergeArchived(base, hiddenSessionIds)
      let pinnedSessionIds = raw.pinnedSessionIds
      if (Array.isArray(pinnedSessionIds)) {
        const kept = pinnedSessionIds.filter(function (id) { return !hiddenSessionSet.has(id) })
        if (kept.length !== pinnedSessionIds.length) pinnedSessionIds = kept
      }
      return {
        ...raw,
        items: items.filter(function (item) {
          return item !== null && typeof item === 'object' && !hidden.has(item.workspaceId)
        }),
        archivedSessionIds: archivedSessionIds,
        pinnedSessionIds: pinnedSessionIds,
      }
    }

    /** Which shipped menu is this? Answers by visible copy, so it is i18n-safe. */
    function menuKindFromText(text) {
      const value = typeof text === 'string' ? text : ''
      const hasAny = function (list) {
        return list.some(function (needle) { return value.includes(needle) })
      }
      if (hasAny(SHIPPED_TEXT.groupBy)) return 'viewOptions'
      if (hasAny(SHIPPED_TEXT.rename) && hasAny(SHIPPED_TEXT.deleteWorkspace)) return 'workspace'
      return null
    }

    /** True when a clicked element sits on the shipped View options trigger. */
    function isViewOptionsTrigger(target) {
      if (target === null || target === undefined || typeof target.closest !== 'function') return false
      const button = target.closest('button[aria-label]')
      if (button === null) return false
      const label = typeof button.getAttribute === 'function' ? button.getAttribute('aria-label') : null
      if (typeof label !== 'string') return false
      const value = label.trim()
      return SHIPPED_TEXT.viewOptionsAria.some(function (needle) { return value.includes(needle) })
    }

    /** Workspace id carried by the row that contains `target`, or null. */
    function workspaceIdFromTarget(target) {
      if (target === null || target === undefined || typeof target.closest !== 'function') return null
      const row = target.closest(WORKSPACE_ROW_SELECTOR)
      if (row === null || typeof row.getAttribute !== 'function') return null
      const key = row.getAttribute('data-row-key')
      if (typeof key !== 'string' || !key.startsWith('workspace:')) return null
      return asId(key.slice('workspace:'.length))
    }

    /* ------------------------------------------------------------------ *
     * View state store                                                    *
     * ------------------------------------------------------------------ */
    /**
     * The plugin's in-memory view state. NOTHING is persisted in the browser:
     * the Host state file is the single authority (see `installSync`), exactly
     * like the shipped Workspace registry.
     *
     * Local mutations update the projection immediately (optimistic UI) and are
     * forwarded to the Host through the registered mutation sink.
     */
    function createStore(options) {
      const opts = options === undefined ? {} : options
      let hidden = new Set()
      let showHidden = false
      let legacyCleanupDone = false
      let ready = false
      let version = 0
      let snapshot = null
      let sink = null
      const listeners = new Set()

      /** One stable object per version: React's useSyncExternalStore needs it. */
      function makeSnapshot() {
        return {
          hidden: hidden,
          showHidden: showHidden,
          legacyCleanupDone: legacyCleanupDone,
          ready: ready,
          version: version,
        }
      }
      snapshot = makeSnapshot()

      function notify() {
        version += 1
        snapshot = makeSnapshot()
        for (const listener of Array.from(listeners)) {
          try { listener() } catch (error) { /* a subscriber must not break the rest */ }
        }
      }

      function emit(mutation) {
        if (sink === null) return
        try { sink(mutation) } catch (error) { /* the sync bridge reports its own failures */ }
      }

      const store = {
        getState: function () { return snapshot },
        getVersion: function () { return version },
        subscribe: function (listener) {
          if (typeof listener !== 'function') return function () {}
          listeners.add(listener)
          return function () { listeners.delete(listener) }
        },
        isHidden: function (workspaceId) { return hidden.has(workspaceId) },
        hiddenCount: function () { return hidden.size },
        hiddenIds: function () { return Array.from(hidden) },
        /**
         * Apply the Host's authoritative state. Returns whether anything the UI
         * renders changed, so an echo of our own mutation does not repaint.
         */
        applyRemoteState: function (input) {
          const next = normalizeRemoteState(input)
          const nextHidden = new Set(next.hidden)
          let changed = ready !== true
          if (nextHidden.size !== hidden.size) {
            changed = true
          } else {
            for (const id of nextHidden) {
              if (!hidden.has(id)) { changed = true; break }
            }
          }
          if (next.showHidden !== showHidden) changed = true
          if (next.legacyCleanupDone !== legacyCleanupDone) changed = true
          legacyCleanupDone = next.legacyCleanupDone
          hidden = nextHidden
          showHidden = next.showHidden
          ready = true
          if (changed) notify()
          return changed
        },
        /** Record the one-shot legacy cleanup locally (no repaint needed). */
        markLegacyCleanupDone: function () {
          legacyCleanupDone = true
        },
        /** Bridge the Host mutation channel; returns a deregister function. */
        setMutationSink: function (fn) {
          sink = typeof fn === 'function' ? fn : null
          return function () { if (sink === fn) sink = null }
        },
        setHidden: function (workspaceId, next) {
          const id = asId(workspaceId)
          if (id === null) return false
          const already = hidden.has(id)
          if (next === true) {
            // Hiding always takes effect immediately: leaving the "show hidden"
            // switch on would keep the just-hidden row on screen.
            if (already && showHidden !== true) return false
            hidden.add(id)
            showHidden = false
          } else {
            if (!already) return false
            hidden.delete(id)
            // Nothing left to reveal: drop the switch back to its default.
            if (hidden.size === 0) showHidden = false
          }
          notify()
          emit({ type: 'setHidden', workspaceId: id, value: next === true })
          return true
        },
        toggleHidden: function (workspaceId) {
          const id = asId(workspaceId)
          if (id === null) return false
          return store.setHidden(id, !hidden.has(id))
        },
        setShowHidden: function (next) {
          const value = next === true
          if (showHidden === value) return false
          showHidden = value
          notify()
          emit({ type: 'setShowHidden', value: value })
          return true
        },
        toggleShowHidden: function () { return store.setShowHidden(!(showHidden === true)) },
        /** Drop ids whose workspace no longer exists (called on a ready snapshot). */
        prune: function (validIds) {
          const valid = validIds instanceof Set ? validIds : new Set(Array.isArray(validIds) ? validIds : [])
          let changed = false
          for (const id of Array.from(hidden)) {
            if (valid.has(id)) continue
            hidden.delete(id)
            changed = true
            emit({ type: 'setHidden', workspaceId: id, value: false })
          }
          if (changed) notify()
          return changed
        },
        dispose: function () {
          listeners.clear()
          sink = null
        },
      }
      return store
    }

    /* ------------------------------------------------------------------ *
     * Host bridge: one GET at boot, SSE afterwards, increments on change  *
     * ------------------------------------------------------------------ */
    /**
     * The browser keeps no copy of the state. At boot the authoritative state
     * is fetched once, then every change arrives through the SSE stream; local
     * mutations are sent as increments so two clients cannot overwrite each
     * other. This mirrors the shipped `workspace/follow` model.
     */
    function installSync(ctx, store, options) {
      const opts = options === undefined ? {} : options
      const warn = typeof opts.warn === 'function' ? opts.warn : function () {}
      const win = typeof window === 'undefined' ? null : window
      const fetchFn = (win !== null && typeof win.fetch === 'function')
        ? win.fetch.bind(win)
        : (typeof fetch === 'function' ? fetch : null)
      let disposed = false
      let source = null
      let retryTimer = null
      let queue = []
      let sending = false
      let booted = false

      if (fetchFn === null) {
        warn('fetch 不可用，隐藏状态无法同步 / fetch unavailable; state stays in memory')
        return function () {}
      }

      async function requestJson(url, init) {
        const response = await fetchFn(url, {
          credentials: 'same-origin',
          cache: 'no-store',
          ...(init === undefined ? {} : init),
        })
        if (!response || response.ok !== true) {
          throw new Error('HTTP ' + (response ? response.status : 'failure'))
        }
        return await response.json()
      }

      function scheduleRetry() {
        if (disposed || retryTimer !== null) return
        retryTimer = setTimeout(function () {
          retryTimer = null
          flush()
        }, 4000)
      }

      async function flush() {
        if (disposed || sending || queue.length === 0) return
        sending = true
        const batch = queue
        queue = []
        try {
          let latest = null
          for (const mutation of batch) {
            latest = await requestJson(MUTATE_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(mutation),
            })
          }
          if (latest !== null) store.applyRemoteState(latest)
        } catch (error) {
          queue = batch.concat(queue)
          if (queue.length > 64) queue.splice(0, queue.length - 64)
          warn('同步到 Host 失败，稍后重试 / failed to sync to the Host: ' + String((error && error.message) || error))
          scheduleRetry()
        } finally {
          sending = false
        }
        if (!disposed && queue.length > 0) flush()
      }

      function enqueue(mutation) {
        if (disposed) return
        queue.push(mutation)
        if (queue.length > 64) queue.splice(0, queue.length - 64)
        flush()
      }

      function removeLegacyKey() {
        try {
          if (win !== null && win.localStorage !== undefined) {
            win.localStorage.removeItem(LEGACY_STORAGE_KEY)
          }
        } catch (error) { /* private mode / storage disabled */ }
      }

      function connectStream() {
        if (disposed) return
        const Ctor = (win !== null && typeof win.EventSource === 'function') ? win.EventSource : null
        if (Ctor === null) {
          warn('EventSource 不可用，多客户端同步暂停 / EventSource unavailable; live sync is off')
          return
        }
        try {
          source = new Ctor(STREAM_URL)
        } catch (error) {
          source = null
          return
        }
        source.onmessage = function (event) {
          if (disposed || typeof event.data !== 'string') return
          let state = null
          try { state = JSON.parse(event.data) } catch (error) { return }
          store.applyRemoteState(state)
        }
        source.onerror = function () { /* EventSource reconnects by itself */ }
      }

      async function bootstrap() {
        try {
          const state = await requestJson(STATE_URL)
          if (disposed) return
          // One-shot legacy cleanup, recorded on the Host so later starts skip
          // it entirely (the browser is not touched again afterwards).
          if (state !== null && typeof state === 'object' && state.legacyCleanupDone !== true) {
            removeLegacyKey()
            enqueue({ type: 'setLegacyCleanupDone', value: true })
          }
          store.applyRemoteState(state)
          booted = true
          connectStream()
        } catch (error) {
          if (disposed) return
          warn('无法读取 Host 状态，稍后重试 / cannot read the Host state: ' + String((error && error.message) || error))
          if (retryTimer === null) {
            retryTimer = setTimeout(function () {
              retryTimer = null
              if (!disposed && !booted) bootstrap()
            }, 5000)
          }
        }
      }

      const offSink = store.setMutationSink(enqueue)
      bootstrap()

      return function dispose() {
        disposed = true
        if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null }
        offSink()
        try { if (source !== null) source.close() } catch (error) { /* ignore */ }
      }
    }

    /* ------------------------------------------------------------------ *
     * Data layer: wrap the client Workspace model                        *
     * ------------------------------------------------------------------ */
    /**
     * Replace `getSnapshot`/`subscribe` on `workspaces.list` with a filtering
     * projection. The shipped sidebar calls both lazily on that same model
     * instance, so the whole browsing surface (rows, search, the Hero picker)
     * reads the projection. A disposer restores the original own-property shape.
     */
    function installWorkspaceProjection(ctx, store, options) {
      const opts = options === undefined ? {} : options
      const warn = typeof opts.warn === 'function' ? opts.warn : function () {}
      let service = null
      try { service = typeof ctx.get === 'function' ? ctx.get('workspaces') : null } catch (error) { service = null }
      const model = service !== null && service !== undefined ? service.list : null
      if (model === null || model === undefined
        || typeof model.getSnapshot !== 'function' || typeof model.subscribe !== 'function') {
        warn('workspaces.list 不可用，隐藏功能未启用 / workspaces.list unavailable; hide is disabled')
        return function () {}
      }
      if (model[INSTALL_MARK] === true) {
        warn('workspaces.list 已被其它插件包装，跳过 / workspaces.list is already wrapped; skipped')
        return function () {}
      }

      const originalGetSnapshot = model.getSnapshot
      const originalSubscribe = model.subscribe
      const ownGetSnapshot = Object.getOwnPropertyDescriptor(model, 'getSnapshot')
      const ownSubscribe = Object.getOwnPropertyDescriptor(model, 'subscribe')

      let cacheRaw = null
      let cacheVersion = -1
      let cacheOut = null
      let pruneScheduled = false

      function schedulePrune(raw) {
        // Only prune on a settled baseline; an empty loading snapshot must not
        // be mistaken for "every hidden workspace was deleted".
        if (raw === null || typeof raw !== 'object' || raw.state !== 'ready') return
        if (pruneScheduled) return
        pruneScheduled = true
        const run = function () {
          pruneScheduled = false
          const current = raw
          if (current === null || typeof current !== 'object') return
          const valid = new Set()
          const items = Array.isArray(current.items) ? current.items : []
          for (const item of items) {
            if (item !== null && typeof item === 'object') valid.add(item.workspaceId)
          }
          store.prune(valid)
        }
        if (typeof setTimeout === 'function') setTimeout(run, 0)
        else run()
      }

      const wrappedGetSnapshot = function () {
        const raw = originalGetSnapshot.call(model)
        schedulePrune(raw)
        const state = store.getState()
        if (state.hidden.size === 0 || state.showHidden === true) {
          cacheRaw = raw
          cacheVersion = state.version
          cacheOut = raw
          return raw
        }
        if (cacheRaw === raw && cacheVersion === state.version) return cacheOut
        const out = filterProjection(raw, state.hidden)
        cacheRaw = raw
        cacheVersion = state.version
        cacheOut = out
        return out
      }

      const wrappedSubscribe = function (listener) {
        const offModel = originalSubscribe.call(model, listener)
        const offStore = store.subscribe(listener)
        return function () {
          if (typeof offModel === 'function') {
            try { offModel() } catch (error) { /* ignore */ }
          }
          offStore()
        }
      }

      try {
        model.getSnapshot = wrappedGetSnapshot
        model.subscribe = wrappedSubscribe
      } catch (error) {
        warn('包装 workspaces.list 失败：' + String(error) + ' / cannot wrap workspaces.list')
        return function () {}
      }
      if (model.getSnapshot !== wrappedGetSnapshot || model.subscribe !== wrappedSubscribe) {
        warn('workspaces.list 属性只读，隐藏功能未启用 / workspaces.list properties are read-only')
        return function () {}
      }
      try { Object.defineProperty(model, INSTALL_MARK, { value: true, configurable: true }) } catch (error) { /* marker optional */ }

      return function dispose() {
        try {
          if (model.getSnapshot === wrappedGetSnapshot) {
            if (ownGetSnapshot !== undefined) Object.defineProperty(model, 'getSnapshot', ownGetSnapshot)
            else delete model.getSnapshot
          }
          if (model.subscribe === wrappedSubscribe) {
            if (ownSubscribe !== undefined) Object.defineProperty(model, 'subscribe', ownSubscribe)
            else delete model.subscribe
          }
          if (model[INSTALL_MARK] === true) delete model[INSTALL_MARK]
        } catch (error) { /* best effort */ }
        cacheRaw = null
        cacheOut = null
      }
    }

    /* ------------------------------------------------------------------ *
     * DOM layer: menu entries, row marker, styles                         *
     * ------------------------------------------------------------------ */
    const CSS = `
.dsh-wv-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:inherit;font-size:13px;line-height:18px;text-align:left;cursor:pointer;font-family:inherit}
.dsh-wv-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsh-wv-menu-icon{display:inline-flex;flex:none;align-items:center;justify-content:center;width:16px;height:16px;color:var(--dsw-alias-label-secondary,#888)}
.dsh-wv-menu-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[${ROW_FLAG}]{opacity:.55}
[${ROW_FLAG}] [class*="title"]{font-style:italic}
.dsh-wv-foot{display:inline-flex;align-items:center;justify-content:center;gap:4px;box-sizing:border-box;height:28px;min-width:28px;padding:0 6px;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary,#888);font:inherit;font-size:12px;line-height:1;cursor:pointer}
.dsh-wv-foot:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsh-wv-foot[aria-pressed="true"]{color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dsh-wv-foot svg{display:block;flex:none}
.dsh-wv-foot-count{font-variant-numeric:tabular-nums}
`

    function installStyles(doc) {
      if (doc === null || doc === undefined || typeof doc.getElementById !== 'function' || typeof doc.createElement !== 'function') {
        return function () {}
      }
      if (doc.getElementById(STYLE_ID) !== null) return function () {}
      const style = doc.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      const parent = doc.head !== null && doc.head !== undefined ? doc.head : doc.documentElement
      if (parent !== null && parent !== undefined && typeof parent.appendChild === 'function') parent.appendChild(style)
      return function () {
        const existing = doc.getElementById(STYLE_ID)
        if (existing !== null && typeof existing.remove === 'function') existing.remove()
      }
    }

    /** Close the shipped menu the way its own keyboard handling does. */
    function closeShippedMenu(doc, win) {
      try {
        const target = (doc.activeElement !== null && doc.activeElement !== undefined)
          ? doc.activeElement
          : (doc.body !== null && doc.body !== undefined ? doc.body : doc.documentElement)
        if (target === null || target === undefined || typeof target.dispatchEvent !== 'function') return
        const KeyboardEventCtor = (win !== null && win !== undefined && typeof win.KeyboardEvent === 'function')
          ? win.KeyboardEvent
          : (typeof KeyboardEvent === 'function' ? KeyboardEvent : null)
        if (KeyboardEventCtor === null) return
        target.dispatchEvent(new KeyboardEventCtor('keydown', {
          key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
        }))
      } catch (error) { /* the menu closes on the next outside click anyway */ }
    }

    /** Copy one shipped menu item's wrapper + item classes. */
    function createMenuItem(doc, menu) {
      const sampleItem = menu.querySelector(MENU_ITEM_SELECTOR)
      const sampleWrap = sampleItem !== null && sampleItem.parentElement !== null ? sampleItem.parentElement : null
      const wrap = doc.createElement('div')
      if (sampleWrap !== null && typeof sampleWrap.className === 'string' && sampleWrap.className !== '') {
        wrap.className = sampleWrap.className
      }
      const button = doc.createElement('button')
      button.type = 'button'
      button.setAttribute('role', 'menuitem')
      button.className = (sampleItem !== null && typeof sampleItem.className === 'string' && sampleItem.className !== '')
        ? sampleItem.className
        : 'dsh-wv-menu-item'
      const icon = doc.createElement('span')
      icon.className = 'dsh-wv-menu-icon'
      if (sampleItem !== null) {
        const sampleIcon = sampleItem.querySelector('span')
        if (sampleIcon !== null && typeof sampleIcon.className === 'string' && sampleIcon.className !== '') {
          icon.className = sampleIcon.className
        }
      }
      const label = doc.createElement('span')
      label.className = 'dsh-wv-menu-label'
      if (sampleItem !== null) {
        const sampleLabel = sampleItem.querySelector('span:last-child')
        if (sampleLabel !== null && typeof sampleLabel.className === 'string' && sampleLabel.className !== '') {
          label.className = sampleLabel.className
        }
      }
      button.appendChild(icon)
      button.appendChild(label)
      wrap.appendChild(button)
      wrap.setAttribute(MENU_FLAG, '')
      return { wrap: wrap, button: button, icon: icon, label: label }
    }

    function setSvg(element, svg) {
      if (element === null || element === undefined) return
      if (typeof element.innerHTML === 'string') element.innerHTML = svg
    }

    /**
     * Wire the two shipped menus plus the hidden-row marker.
     *
     * A click captures which row (or the View options trigger) armed the next
     * menu; a MutationObserver scans for the menu's portal and appends the
     * matching entry. Both entries clone the shipped item's classes. The entry
     * lives outside the menu's React tree, so it closes the menu with the same
     * Escape keydown a keyboard user sends.
     */
    function installDomBridge(doc, win, store, bindLocale, options) {
      const opts = options === undefined ? {} : options
      const warn = typeof opts.warn === 'function' ? opts.warn : function () {}
      if (doc === null || doc === undefined || typeof doc.addEventListener !== 'function'
        || typeof doc.querySelectorAll !== 'function' || doc.body === null || doc.body === undefined) {
        return function () {}
      }
      /** Re-bind on every injection so a locale switch also changes the copies. */
      function translate() {
        return typeof bindLocale === 'function' ? makeT(bindLocale()) : makeT(function (key) { return key })
      }
      let armed = null
      let scanScheduled = false
      let disposed = false
      const disposers = []

      function now() { return Date.now() }

      function arm(kind, workspaceId) {
        armed = { kind: kind, workspaceId: workspaceId === undefined ? null : workspaceId, until: now() + ARM_TTL_MS }
      }

      function onPointerDownCapture(event) {
        if (disposed) return
        const target = event !== null && event !== undefined ? event.target : null
        const viewOptions = isViewOptionsTrigger(target)
        if (viewOptions) { arm('viewOptions'); return }
        const workspaceId = workspaceIdFromTarget(target)
        if (workspaceId !== null) arm('workspace', workspaceId)
      }

      function onKeyDownCapture(event) {
        if (disposed) return
        const key = event !== null && event !== undefined ? event.key : null
        if (key !== 'Enter' && key !== ' ') return
        onPointerDownCapture(event)
      }

      function scheduleScan() {
        if (disposed || scanScheduled) return
        scanScheduled = true
        const run = function () {
          scanScheduled = false
          if (!disposed) scan()
        }
        if (typeof setTimeout === 'function') setTimeout(run, 0)
        else run()
      }

      function scan() {
        if (armed !== null && now() > armed.until) armed = null
        const menus = Array.from(doc.querySelectorAll(MENU_SELECTOR))
        for (const menu of menus) {
          if (menu.querySelector('[' + MENU_FLAG + ']') !== null) continue
          const kind = menuKindFromText(typeof menu.textContent === 'string' ? menu.textContent : '')
          if (kind === null) continue
          if (armed === null || armed.kind !== kind) continue
          if (kind === 'workspace') {
            if (armed.workspaceId === null) continue
            injectWorkspaceEntry(menu, armed.workspaceId)
            armed = null
          } else {
            injectViewOptionsEntry(menu)
            armed = null
          }
        }
        markHiddenRows()
      }

      function injectWorkspaceEntry(menu, workspaceId) {
        const parts = createMenuItem(doc, menu)
        const hidden = store.isHidden(workspaceId)
        const action = function (event) {
          if (event !== null && event !== undefined && typeof event.preventDefault === 'function') event.preventDefault()
          if (event !== null && event !== undefined && typeof event.stopPropagation === 'function') event.stopPropagation()
          store.setHidden(workspaceId, !store.isHidden(workspaceId))
          closeShippedMenu(doc, win)
        }
        parts.button.addEventListener('click', action)
        parts.label.textContent = translate()(hidden ? 'menu.unhide' : 'menu.hide')
        setSvg(parts.icon, EYE_SVG)
        const viewport = menu.querySelector(MENU_VIEWPORT_SELECTOR)
        ;(viewport !== null ? viewport : menu).appendChild(parts.wrap)
      }

      function injectViewOptionsEntry(menu) {
        const parts = createMenuItem(doc, menu)
        const on = store.getState().showHidden === true
        const action = function (event) {
          if (event !== null && event !== undefined && typeof event.preventDefault === 'function') event.preventDefault()
          if (event !== null && event !== undefined && typeof event.stopPropagation === 'function') event.stopPropagation()
          store.setShowHidden(!(store.getState().showHidden === true))
          closeShippedMenu(doc, win)
        }
        parts.button.addEventListener('click', action)
        parts.button.setAttribute('aria-checked', on ? 'true' : 'false')
        parts.label.textContent = translate()('viewOptions.showHidden')
        setSvg(parts.icon, on ? CHECK_SVG : EYE_SVG)
        const viewport = menu.querySelector(MENU_VIEWPORT_SELECTOR)
        ;(viewport !== null ? viewport : menu).appendChild(parts.wrap)
      }

      function markHiddenRows() {
        const state = store.getState()
        const rows = Array.from(doc.querySelectorAll(WORKSPACE_ROW_SELECTOR))
        for (const row of rows) {
          const key = typeof row.getAttribute === 'function' ? row.getAttribute('data-row-key') : null
          const id = typeof key === 'string' && key.startsWith('workspace:') ? key.slice('workspace:'.length) : ''
          const shouldMark = id !== '' && state.hidden.has(id)
          if (shouldMark) {
            if (typeof row.setAttribute === 'function') row.setAttribute(ROW_FLAG, '')
          } else if (typeof row.removeAttribute === 'function') {
            row.removeAttribute(ROW_FLAG)
          }
        }
      }

      doc.addEventListener('pointerdown', onPointerDownCapture, true)
      doc.addEventListener('click', onPointerDownCapture, true)
      doc.addEventListener('keydown', onKeyDownCapture, true)
      disposers.push(function () {
        doc.removeEventListener('pointerdown', onPointerDownCapture, true)
        doc.removeEventListener('click', onPointerDownCapture, true)
        doc.removeEventListener('keydown', onKeyDownCapture, true)
      })

      const MutationObserverCtor = (win !== null && win !== undefined && typeof win.MutationObserver === 'function')
        ? win.MutationObserver
        : (typeof MutationObserver === 'function' ? MutationObserver : null)
      let observer = null
      if (MutationObserverCtor !== null && doc.body !== null && doc.body !== undefined) {
        observer = new MutationObserverCtor(scheduleScan)
        try { observer.observe(doc.body, { childList: true, subtree: true }) } catch (error) { observer = null }
        if (observer !== null) {
          disposers.push(function () {
            try { observer.disconnect() } catch (error) { /* already gone */ }
          })
        }
      } else {
        warn('MutationObserver 不可用，菜单入口不会出现 / MutationObserver unavailable; menu entries are off')
      }

      const offStore = store.subscribe(function () { scheduleScan() })
      disposers.push(offStore)
      scheduleScan()

      return function dispose() {
        disposed = true
        for (const fn of disposers) {
          try { fn() } catch (error) { /* ignore */ }
        }
      }
    }

    /* ------------------------------------------------------------------ *
     * React: sidebar-foot fallback entry                                  *
     * ------------------------------------------------------------------ */
    function makeFooterAction(store, bindLocale) {
      return function FooterAction(props) {
        const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
        const wide = props !== null && props !== undefined && props.wide === true
        if (state.hidden.size === 0) return null
        const t = makeT(bindLocale())
        const on = state.showHidden === true
        const label = t(on ? 'footer.hide' : 'footer.show')
        const icon = h('span', {
          key: 'icon',
          className: 'dsh-wv-foot-icon',
          style: { display: 'inline-flex', alignItems: 'center' },
          dangerouslySetInnerHTML: { __html: on ? CHECK_SVG : EYE_SVG },
        })
        const children = [icon]
        if (wide) {
          children.push(h('span', { key: 'count', className: 'dsh-wv-foot-count' }, String(state.hidden.size)))
        }
        return h('button', {
          type: 'button',
          className: 'dsh-wv-foot',
          title: label,
          'aria-label': label,
          'aria-pressed': on ? 'true' : 'false',
          onClick: function () { store.setShowHidden(!(store.getState().showHidden === true)) },
        }, children)
      }
    }

    /* ------------------------------------------------------------------ *
     * Plugin apply                                                       *
     * ------------------------------------------------------------------ */
    function apply(ctx) {
      const doc = typeof document === 'undefined' ? null : document
      const win = typeof window === 'undefined' ? null : window
      const warnOnce = function (message) {
        try { console.warn('[workspace-visibility] ' + message) } catch (error) { /* ignore */ }
      }

      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }) }, 'dsh-workspace-visibility: dictionaries')
      const bindLocale = function () { return ctx.locale.bind(NS) }

      const store = createStore()

      ctx.effect(function () { return installStyles(doc) }, 'dsh-workspace-visibility: styles')
      ctx.effect(function () { return installWorkspaceProjection(ctx, store, { warn: warnOnce }) }, 'dsh-workspace-visibility: projection')
      ctx.effect(function () { return installDomBridge(doc, win, store, bindLocale, { warn: warnOnce }) }, 'dsh-workspace-visibility: menus')
      ctx.effect(function () { return installSync(ctx, store, { warn: warnOnce }) }, 'dsh-workspace-visibility: host sync')

      const FooterAction = makeFooterAction(store, bindLocale)
      ctx.slots.inject('sidebar.footer.action', function () {
        return ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'workspace-visibility',
          order: 40,
          locale: NS,
          label: function () { return makeT(bindLocale())('footer.label') },
        }, FooterAction)
      })

      ctx.effect(function () { return function () { store.dispose() } }, 'dsh-workspace-visibility: store')
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale', 'workspaces']
    exports.__test = {
      createStore: createStore,
      normalizeRemoteState: normalizeRemoteState,
      filterProjection: filterProjection,
      mergeArchived: mergeArchived,
      menuKindFromText: menuKindFromText,
      installWorkspaceProjection: installWorkspaceProjection,
      installSync: installSync,
    }
    return module.exports
  },
  })
} catch (error) {
  const message = String((error !== null && error !== undefined && error.message) || error)
  if (!/duplicate factory registration/.test(message)) throw error
}
