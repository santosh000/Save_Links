// Tiny change-notification pub/sub.
//
// IndexedDB is authoritative, but the UI renders from the Vue refs owned by
// useLinks/useFolders. Those composables normally write outward (ref -> watch
// -> repository), so when data lands in IndexedDB from OUTSIDE the composables
// (e.g. a cloud pull/reconcile writing via the repository directly) the in-memory
// refs go stale. This module lets that external writer (the sync coordinator)
// signal "authoritative data changed, reload" so the UI updates without a page
// refresh — reusing the same refs local CRUD writes, never a second source of truth.
const listeners = new Set()

/** Subscribe to "data changed in storage from outside" notifications. Returns an unsubscribe fn. */
export function onDataChanged(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Notify all subscribers that storage changed from outside the composables. */
export function notifyDataChanged() {
  for (const listener of [...listeners]) listener()
}
