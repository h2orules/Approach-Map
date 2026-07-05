import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

// Mirrors the dev proxy table in vite.config.ts. Each entry maps the
// /api/<service> prefix the SPA calls to its upstream base URL. The adsbx
// entry injects the ADS-B Exchange RapidAPI key from server-side app
// settings — the key must never reach the client bundle.
interface Upstream {
  base: string
  headers?: () => Record<string, string>
}

const UPSTREAMS: Record<string, Upstream> = {
  adsbx: {
    base: 'https://adsbexchange-com1.p.rapidapi.com/v2',
    headers: () => ({
      'X-RapidAPI-Key': process.env.ADSBX_API_KEY ?? '',
      'X-RapidAPI-Host': 'adsbexchange-com1.p.rapidapi.com',
    }),
  },
  aviationapi: { base: 'https://www.aviationapi.com/api/v1' },
  'faa-cifp': { base: 'https://aeronav.faa.gov/Upload_313-d/cifp' },
  adsbdb: { base: 'https://api.adsbdb.com/v0' },
  adsblol: { base: 'https://api.adsb.lol/api/0' },
  datis: { base: 'https://atis.info/api' },
  dtpp: { base: 'https://aeronav.faa.gov/d-tpp' },
  'faa-mva': { base: 'https://aeronav.faa.gov/MVA_Charts/aixm' },
  'faa-airspace': {
    base: 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0',
  },
}

// The largest proxied payloads (CIFP zip ~9MB, d-TPP metafile ~15MB) download
// well inside this; Static Web Apps hard-kills API requests at 45s anyway.
const UPSTREAM_TIMEOUT_MS = 40_000

// Response headers worth passing back to the browser. Everything else
// (transfer/connection/cookie headers) is dropped — fetch has already
// decoded the body, and upstream cookies must not leak through the proxy.
const PASSTHROUGH_HEADERS = ['content-type', 'last-modified', 'etag']

export async function proxy(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const service = request.params.service ?? ''
  const upstream = UPSTREAMS[service]
  if (!upstream) {
    return { status: 404, jsonBody: { error: `Unknown API route: ${service}` } }
  }

  const path = request.params.path ?? ''
  if (path.split('/').some((seg) => seg === '..' || seg === '.')) {
    return { status: 400, jsonBody: { error: 'Invalid path' } }
  }

  const search = new URL(request.url).search
  const target = `${upstream.base}/${path}${search}`

  try {
    // adsb.lol's /routeset is the one POST upstream (batched callsign lookup,
    // JSON body). Forward the method, body, and content type; everything else
    // is a plain GET.
    const reqHeaders = { ...upstream.headers?.() }
    let body: ArrayBuffer | undefined
    if (request.method === 'POST') {
      body = await request.arrayBuffer()
      const contentType = request.headers.get('content-type')
      if (contentType) reqHeaders['Content-Type'] = contentType
    }

    const resp = await fetch(target, {
      method: request.method,
      headers: reqHeaders,
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })

    const respHeaders: Record<string, string> = {}
    for (const name of PASSTHROUGH_HEADERS) {
      const value = resp.headers.get(name)
      if (value) respHeaders[name] = value
    }

    return {
      status: resp.status,
      headers: respHeaders,
      body: Buffer.from(await resp.arrayBuffer()),
    }
  } catch (err) {
    context.error(`Proxy to ${target} failed:`, err)
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    return {
      status: timedOut ? 504 : 502,
      jsonBody: { error: timedOut ? 'Upstream timeout' : 'Upstream fetch failed' },
    }
  }
}

app.http('proxy', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: '{service}/{*path}',
  handler: proxy,
})
