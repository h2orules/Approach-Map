export function formatAltitude(alt: number | 'ground' | null | undefined): string {
  if (alt === 'ground') return 'GND'
  if (alt == null) return '---'
  if (alt >= 18000) {
    return `FL${Math.round(alt / 100).toString().padStart(3, '0')}`
  }
  return `${Math.round(alt).toLocaleString()}ft`
}

export function formatSpeed(gs: number | null | undefined): string {
  if (gs == null) return '---'
  return `${Math.round(gs)}kt`
}

export function formatVerticalRate(rate: number | null | undefined): string {
  if (rate == null) return '---'
  if (Math.abs(rate) < 100) return 'LVL'
  const sign = rate > 0 ? '+' : ''
  return `${sign}${Math.round(rate / 100) * 100}fpm`
}

export function formatCallsign(raw: string | null | undefined): string {
  return raw?.trim() || '??????'
}

export function formatHeading(track: number | null | undefined): string {
  if (track == null) return '---'
  return `${Math.round(track).toString().padStart(3, '0')}°`
}

export function formatSquawk(squawk: string | null | undefined): string {
  return squawk || '----'
}
