import type { CifpAirportData } from '../types/cifp'
import { parseCifp } from './cifpParse'

// Thin Web Worker shell around the pure `parseCifp` parser (./cifpParse.ts).
// All grouping/enumeration logic lives in that module so it also runs under
// tsx/node in the build scripts (scripts/buildAirportIndex.ts) with
// byte-identical output. This worker only bridges parseCifp's progress
// callback and return value onto the postMessage protocol.

export interface ParseRequest {
  type: 'parse'
  text: string
}

export interface ParseProgress {
  type: 'progress'
  percent: number
  message: string
}

export interface ParseResult {
  type: 'result'
  data: Record<string, CifpAirportData>
}

export interface ParseError {
  type: 'error'
  message: string
}

self.onmessage = function (e: MessageEvent<ParseRequest>) {
  if (e.data.type !== 'parse') return

  try {
    const data = parseCifp(e.data.text, (percent, message) => {
      self.postMessage({ type: 'progress', percent, message } satisfies ParseProgress)
    })
    self.postMessage({ type: 'result', data } satisfies ParseResult)
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) } satisfies ParseError)
  }
}
