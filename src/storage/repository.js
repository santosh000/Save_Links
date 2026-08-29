// The application's single repository instance (IndexedDB adapter).
//
// The composables depend on the repository contract (src/storage/contract.js),
// never on IndexedDB directly. One shared instance keeps every composition
// root (and the boot sequence in src/main.js) talking to the same connection,
// so state written by one composable is a single database write away from any
// other — no cache-coherency problems between separations of concern.
//
// Swapping the storage backend later = swapping this instance for another
// adapter that satisfies the same contract; the rest of the app stays as is.
import { createIndexedDBRepository } from './indexeddb.js'

export const repository = createIndexedDBRepository()