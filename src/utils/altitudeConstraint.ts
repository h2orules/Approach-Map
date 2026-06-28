import type { AltConstraint } from '../types/procedure'

export function parseAltConstraint(raw: string | null | undefined): AltConstraint | null {
  if (!raw) return null
  const s = raw.trim().toUpperCase()

  const aoaMatch = s.match(/AT\s+OR\s+ABOVE\s+(\d+)/)
  if (aoaMatch) return { type: 'AT_OR_ABOVE', low: parseInt(aoaMatch[1]) }

  const aobMatch = s.match(/AT\s+OR\s+BELOW\s+(\d+)/)
  if (aobMatch) return { type: 'AT_OR_BELOW', low: parseInt(aobMatch[1]), high: parseInt(aobMatch[1]) }

  const betweenMatch = s.match(/^(\d+)[- ]+(?:AND\s+)?(\d+)$/)
  if (betweenMatch) {
    const a = parseInt(betweenMatch[1])
    const b = parseInt(betweenMatch[2])
    return { type: 'BETWEEN', low: Math.min(a, b), high: Math.max(a, b) }
  }

  const plainMatch = s.match(/^(\d{3,5})$/)
  if (plainMatch) return { type: 'AT', low: parseInt(plainMatch[1]) }

  return null
}

/** Compact chart-style label, e.g. "5000", "≥5000", "≤4000", "3000–5000". */
export function formatAltConstraint(c: AltConstraint | null): string | null {
  if (!c) return null
  const f = (n: number) => n.toLocaleString('en-US')
  switch (c.type) {
    case 'AT': return f(c.low)
    case 'AT_OR_ABOVE': return `≥${f(c.low)}`
    case 'AT_OR_BELOW': return `≤${f(c.high ?? c.low)}`
    case 'BETWEEN': return `${f(c.low)}–${f(c.high ?? c.low)}`
  }
}

export function resolveAltConstraint(c: AltConstraint | null): number | null {
  if (!c) return null
  switch (c.type) {
    case 'AT': return c.low
    case 'AT_OR_ABOVE': return c.low
    case 'AT_OR_BELOW': return c.high ?? c.low
    case 'BETWEEN': return Math.round((c.low + (c.high ?? c.low)) / 2)
  }
}

export function parseArinc424AltDescriptor(
  descriptor: string,
  alt1Str: string,
  alt2Str: string,
): AltConstraint | null {
  // FAA CIFP stores these altitude fields directly in feet (e.g. "05000").
  const alt1 = parseInt(alt1Str.trim())
  const alt2 = parseInt(alt2Str.trim())
  const valid1 = !isNaN(alt1) && alt1 > 0
  const valid2 = !isNaN(alt2) && alt2 > 0

  if (!valid1) return null

  switch (descriptor.trim()) {
    case '@': return { type: 'AT', low: alt1 }
    case '+': return { type: 'AT_OR_ABOVE', low: alt1 }
    case '-': return { type: 'AT_OR_BELOW', low: alt1, high: alt1 }
    case 'B':
      if (valid2) return { type: 'BETWEEN', low: Math.min(alt1, alt2), high: Math.max(alt1, alt2) }
      return { type: 'AT', low: alt1 }
    default:
      return valid1 ? { type: 'AT', low: alt1 } : null
  }
}
