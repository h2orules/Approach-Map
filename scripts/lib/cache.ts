import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Download a URL to bytes, caching the result on disk so repeated build-script
 * runs are fast and offline-friendly. Pass a stable `cacheFile` path (under
 * scripts/.cache/, gitignored). Set `force` to bypass the cache. A list of
 * URLs is tried in order — later entries are mirrors for networks where the
 * primary host is unreachable.
 */
export async function downloadCached(url: string | string[], cacheFile: string, force = false): Promise<Uint8Array> {
  if (!force && existsSync(cacheFile)) {
    return new Uint8Array(readFileSync(cacheFile))
  }
  const urls = Array.isArray(url) ? url : [url]
  let lastErr: unknown
  for (const u of urls) {
    console.log(`Downloading ${u}`)
    try {
      const resp = await fetch(u)
      if (!resp.ok) throw new Error(`Failed to fetch ${u}: ${resp.status} ${resp.statusText}`)
      const bytes = new Uint8Array(await resp.arrayBuffer())
      mkdirSync(dirname(cacheFile), { recursive: true })
      writeFileSync(cacheFile, bytes)
      return bytes
    } catch (err) {
      lastErr = err
      if (u !== urls[urls.length - 1]) console.log(`  failed (${String(err)}), trying mirror…`)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}
