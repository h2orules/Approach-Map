import { create } from 'zustand'
import type { AdsbAircraft, InterpolatedAircraft } from '../types/aircraft'
import { STALE_AIRCRAFT_THRESHOLD_S } from '../config/constants'

interface AircraftStore {
  aircraftMap: Map<string, InterpolatedAircraft>
  lastPollMs: number
  /** Bumped only when the aircraft *set* changes (poll), not on interpolation. */
  revision: number

  updateFromPoll: (raw: AdsbAircraft[], pollTimeMs: number) => void
  updateInterpolated: (hex: string, lat: number, lon: number) => void
  setRouteData: (hex: string, origin: string, destination: string) => void
  getAll: () => InterpolatedAircraft[]
}

function mapRawToInterpolated(
  raw: AdsbAircraft,
  pollMs: number,
  prev: InterpolatedAircraft | undefined,
): InterpolatedAircraft {
  const lat = raw.lat ?? prev?.lat ?? 0
  const lon = raw.lon ?? prev?.lon ?? 0
  return {
    hex: raw.hex,
    flight: raw.flight?.trim() || raw.hex,
    registration: raw.r || '',
    typeCode: raw.t || '',
    lat,
    lon,
    altBaro: raw.alt_baro ?? prev?.altBaro ?? 'ground',
    altGeom: raw.alt_geom ?? prev?.altGeom ?? null,
    groundspeed: raw.gs ?? prev?.groundspeed ?? 0,
    track: raw.track ?? prev?.track ?? 0,
    baroRate: raw.baro_rate ?? prev?.baroRate ?? 0,
    squawk: raw.squawk || '----',
    lastPollMs: pollMs,
    interpLat: lat,
    interpLon: lon,
    // Preserve previously resolved route; ADS-B Exchange supplies from/to on some aircraft
    origin: raw.from?.trim() || prev?.origin,
    destination: raw.to?.trim() || prev?.destination,
  }
}

export const useAircraftStore = create<AircraftStore>((set, get) => ({
  aircraftMap: new Map(),
  lastPollMs: 0,
  revision: 0,

  updateFromPoll: (raw, pollTimeMs) =>
    set((s) => {
      const next = new Map(s.aircraftMap)

      for (const ac of raw) {
        if (!ac.lat || !ac.lon) continue
        if ((ac.seen_pos ?? 0) > STALE_AIRCRAFT_THRESHOLD_S) continue
        const prev = next.get(ac.hex)
        next.set(ac.hex, mapRawToInterpolated(ac, pollTimeMs, prev))
      }

      // Prune aircraft not seen in this poll that are very stale
      for (const [hex, ac] of next) {
        if (pollTimeMs - ac.lastPollMs > STALE_AIRCRAFT_THRESHOLD_S * 1000) {
          next.delete(hex)
        }
      }

      return { aircraftMap: next, lastPollMs: pollTimeMs, revision: s.revision + 1 }
    }),

  updateInterpolated: (hex, lat, lon) =>
    set((s) => {
      const ac = s.aircraftMap.get(hex)
      if (!ac) return s
      const next = new Map(s.aircraftMap)
      next.set(hex, { ...ac, interpLat: lat, interpLon: lon })
      return { aircraftMap: next }
    }),

  setRouteData: (hex, origin, destination) =>
    set((s) => {
      const ac = s.aircraftMap.get(hex)
      if (!ac || (ac.origin && ac.destination)) return s
      const next = new Map(s.aircraftMap)
      next.set(hex, { ...ac, origin: ac.origin || origin, destination: ac.destination || destination })
      return { aircraftMap: next }
    }),

  getAll: () => Array.from(get().aircraftMap.values()),
}))
