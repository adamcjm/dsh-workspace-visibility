/**
 * Host half of `@adamcjm/dsh-workspace-visibility`.
 *
 * The whole feature lives in the browser half (`./client`): it filters the
 * sidebar's workspace projection and appends two menu entries to shipped
 * menus. A host row only has to exist so the Loader ships the `./client`
 * entry to the renderer alongside it — the same shape as
 * `dsh-window-drag-probe` and `dsh-genui-bugfix`.
 *
 * Deliberately no Host service, no config and no filesystem state: hidden
 * workspace ids live in the browser's localStorage, exactly like the shipped
 * sidebar view options.
 *
 * @module @adamcjm/dsh-workspace-visibility
 */

export const name = 'dsh-workspace-visibility'

/** No host-side behaviour, and no service dependency to declare. */
export const inject = []

/** Cordis plugin entry. */
export function apply() {}
