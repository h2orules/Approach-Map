// Injectable IndexedDB seam. `cifpCache.ts` talks to a `KVStore`, not the
// browser's IndexedDB API directly, so tests can swap in `createFakeStore()`
// (an in-memory Map) without touching `indexedDB`/fake-indexeddb setup.
export interface KVStore {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  // Writes all entries in as few transactions as practical. The real
  // implementation batches into ~200-entry transactions so persisting a
  // ~2-3k-airport CIFP parse doesn't open thousands of tiny IDB transactions.
  putMany(entries: Array<[string, unknown]>): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}

const DB_NAME = 'approach-map-cifp'
const DB_VERSION = 1
const STORE_NAME = 'cifp'
const BATCH_SIZE = 200

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

class IndexedDbStore implements KVStore {
  private dbPromise: Promise<IDBDatabase> | null = null

  private getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDb()
    return this.dbPromise
  }

  async get<T>(key: string): Promise<T | undefined> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(key)
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error)
    })
  }

  async put(key: string, value: unknown): Promise<void> {
    return this.putMany([[key, value]])
  }

  async putMany(entries: Array<[string, unknown]>): Promise<void> {
    if (entries.length === 0) return
    const db = await this.getDb()
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE)
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        for (const [key, value] of batch) store.put(value, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    }
  }

  async delete(key: string): Promise<void> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const req = tx.objectStore(STORE_NAME).delete(key)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  }

  async keys(): Promise<string[]> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).getAllKeys()
      req.onsuccess = () => resolve(req.result as string[])
      req.onerror = () => reject(req.error)
    })
  }
}

export function createIndexedDbStore(): KVStore {
  return new IndexedDbStore()
}

/** In-memory fake for tests — no browser IndexedDB required. */
export function createFakeStore(initial?: Record<string, unknown>): KVStore {
  const map = new Map<string, unknown>(Object.entries(initial ?? {}))
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return map.get(key) as T | undefined
    },
    async put(key: string, value: unknown): Promise<void> {
      map.set(key, value)
    },
    async putMany(entries: Array<[string, unknown]>): Promise<void> {
      for (const [key, value] of entries) map.set(key, value)
    },
    async delete(key: string): Promise<void> {
      map.delete(key)
    },
    async keys(): Promise<string[]> {
      return Array.from(map.keys())
    },
  }
}
