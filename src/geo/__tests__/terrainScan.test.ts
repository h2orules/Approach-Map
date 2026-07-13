import { describe, it, expect, vi } from 'vitest'
import { scanTerrain, type TerrainScanOpts } from '../terrainScan'
import type { MvaSector } from '../../utils/aixmMva'
import type { PredictedPath } from '../../types/path'

// A 0.2deg square MVA sector, minAltFt 5000.
const EXTERIOR = [
  [-122.5, 47.0],
  [-122.3, 47.0],
  [-122.3, 47.2],
  [-122.5, 47.2],
  [-122.5, 47.0],
]
// A small hole carved out of the middle of the sector.
const HOLE = [
  [-122.42, 47.08],
  [-122.38, 47.08],
  [-122.38, 47.12],
  [-122.42, 47.12],
  [-122.42, 47.08],
]

const SECTOR: MvaSector = { name: 'SECTOR 1', minAltFt: 5000, polygon: [EXTERIOR] }
const SECTOR_WITH_HOLE: MvaSector = { name: 'SECTOR 1', minAltFt: 5000, polygon: [EXTERIOR, HOLE] }

// Deep inside the exterior ring but outside the hole.
const IN_SECTOR = { lat: 47.02, lon: -122.46 }
// Center of the hole — falls through the MVA sector to DEM.
const IN_HOLE = { lat: 47.1, lon: -122.4 }
// Well outside the sector's bbox entirely.
const OUTSIDE = { lat: 47.1, lon: -121.0 }

const BASE_OPTS: TerrainScanOpts = {
  onApproach: false,
  profileDeviationFt: null,
  airports: [],
  gsKt: 180,
  currentAglFt: 2000,
}

function pathAt(
  point: { lat: number; lon: number },
  altFt: number,
  tSecs: number[] = [30],
): PredictedPath {
  return {
    hex: 'abc123',
    mode: 'straight',
    points: tSecs.map((tSec) => ({ lat: point.lat, lon: point.lon, altFt, tSec })),
  }
}

describe('scanTerrain — MVA sector', () => {
  it('clears the sector minimum with margin -> null', () => {
    const elevAt = vi.fn()
    const result = scanTerrain(pathAt(IN_SECTOR, 5100), [SECTOR], elevAt, BASE_OPTS)
    expect(result).toBeNull()
    expect(elevAt).not.toHaveBeenCalled() // MVA covers this point — DEM never consulted
  })

  it('below the sector minimum -> alert', () => {
    const result = scanTerrain(pathAt(IN_SECTOR, 4500), [SECTOR], vi.fn(), BASE_OPTS)
    expect(result).toBe('alert')
  })

  it('more than TERRAIN_MVA_WARN_BELOW_FT under the sector minimum -> warning', () => {
    // 5000 - 900 = 4100; 4000 is below that.
    const result = scanTerrain(pathAt(IN_SECTOR, 4000), [SECTOR], vi.fn(), BASE_OPTS)
    expect(result).toBe('warning')
  })

  it('a point outside every sector bbox falls back to DEM', () => {
    const elevAt = vi.fn().mockReturnValue(0)
    scanTerrain(pathAt(OUTSIDE, 5100), [SECTOR], elevAt, BASE_OPTS)
    expect(elevAt).toHaveBeenCalledWith(OUTSIDE.lat, OUTSIDE.lon)
  })

  it('a point inside a sector hole falls through to DEM', () => {
    const elevAt = vi.fn().mockReturnValue(0)
    scanTerrain(pathAt(IN_HOLE, 5100), [SECTOR_WITH_HOLE], elevAt, BASE_OPTS)
    expect(elevAt).toHaveBeenCalledWith(IN_HOLE.lat, IN_HOLE.lon)
  })
})

describe('scanTerrain — DEM fallback', () => {
  it('1050 ft clearance -> null', () => {
    const elevAt = vi.fn().mockReturnValue(0)
    const result = scanTerrain(pathAt(OUTSIDE, 1050), [], elevAt, BASE_OPTS)
    expect(result).toBeNull()
  })

  it('950 ft clearance -> alert', () => {
    const elevAt = vi.fn().mockReturnValue(0)
    const result = scanTerrain(pathAt(OUTSIDE, 950), [], elevAt, BASE_OPTS)
    expect(result).toBe('alert')
  })

  it('90 ft clearance -> warning', () => {
    const elevAt = vi.fn().mockReturnValue(0)
    const result = scanTerrain(pathAt(OUTSIDE, 90), [], elevAt, BASE_OPTS)
    expect(result).toBe('warning')
  })

  it('an unresolved (uncached) tile is skipped, not treated as a violation', () => {
    const elevAt = vi.fn().mockReturnValue(undefined)
    const result = scanTerrain(pathAt(OUTSIDE, -500), [], elevAt, BASE_OPTS)
    expect(result).toBeNull()
  })
})

describe('scanTerrain — scan window / suppression', () => {
  it('ignores points within the first TERRAIN_SCAN_SKIP_FIRST_S seconds', () => {
    // Badly violating point, but at tSec 5 (<= the 10s skip window) and no
    // other points in the path.
    const elevAt = vi.fn().mockReturnValue(0)
    const result = scanTerrain(pathAt(OUTSIDE, 1, [5]), [], elevAt, BASE_OPTS)
    expect(result).toBeNull()
    expect(elevAt).not.toHaveBeenCalled()
  })

  it('ignores violations beyond TERRAIN_SCAN_HORIZON_S (t=90 with a 60 s horizon)', () => {
    // Badly violating point, but at tSec 90 — past the short terrain look-ahead.
    // A descending aircraft will typically level off before then; extrapolating
    // baro rate further just projects phantom MVA/terrain penetrations.
    const elevAt = vi.fn().mockReturnValue(0)
    const result = scanTerrain(pathAt(OUTSIDE, 1, [90]), [], elevAt, BASE_OPTS)
    expect(result).toBeNull()
    expect(elevAt).not.toHaveBeenCalled()
  })

  it('suppresses terrain alerts on approach within TERRAIN_ONAPPROACH_TOL_FT of profile, even when a point badly violates', () => {
    const opts: TerrainScanOpts = {
      onApproach: true,
      profileDeviationFt: 100,
      airports: [],
      gsKt: 180,
      currentAglFt: 2000,
    }
    const elevAt = vi.fn().mockReturnValue(0)
    const result = scanTerrain(pathAt(OUTSIDE, -1000, [30]), [], elevAt, opts)
    expect(result).toBeNull()
    expect(elevAt).not.toHaveBeenCalled() // short-circuited before any point is scanned
  })

  it('still alerts on approach once the profile deviation exceeds the tolerance', () => {
    const opts: TerrainScanOpts = {
      onApproach: true,
      profileDeviationFt: 500,
      airports: [],
      gsKt: 180,
      currentAglFt: 2000,
    }
    const elevAt = vi.fn().mockReturnValue(0)
    const result = scanTerrain(pathAt(OUTSIDE, 90, [30]), [], elevAt, opts)
    expect(result).toBe('warning')
  })

  it('excludes a descent into a known airport even with onApproach: false', () => {
    // OUTSIDE at 950 ft (elevAt 0) would DEM-alert, but a known airport sits at
    // the same spot (within TERRAIN_AIRPORT_EXCLUDE_NM, below elev+1500) so the
    // sample is an MSAW-style arrival/departure exclusion — no assignment needed.
    const opts: TerrainScanOpts = {
      onApproach: false,
      profileDeviationFt: null,
      airports: [{ lat: OUTSIDE.lat, lon: OUTSIDE.lon, elevationFt: 0 }],
      gsKt: 180,
      currentAglFt: 2000,
    }
    const elevAt = vi.fn().mockReturnValue(0)
    const result = scanTerrain(pathAt(OUTSIDE, 950), [], elevAt, opts)
    expect(result).toBeNull()
    expect(elevAt).not.toHaveBeenCalled() // excluded before the DEM check
  })

  it('still alerts on the same descent 10 nm from any airport', () => {
    // Airport ~10 nm north of OUTSIDE — outside the 4 nm exclusion volume.
    const opts: TerrainScanOpts = {
      onApproach: false,
      profileDeviationFt: null,
      airports: [{ lat: OUTSIDE.lat + 10 / 60, lon: OUTSIDE.lon, elevationFt: 0 }],
      gsKt: 180,
      currentAglFt: 2000,
    }
    const elevAt = vi.fn().mockReturnValue(0)
    const result = scanTerrain(pathAt(OUTSIDE, 950), [], elevAt, opts)
    expect(result).toBe('alert')
  })

  it('worst tier short-circuits: a warning point wins even if scanned before a later alert-only point', () => {
    const elevAt = vi.fn().mockReturnValue(0)
    const path: PredictedPath = {
      hex: 'abc123',
      mode: 'straight',
      points: [
        { ...OUTSIDE, altFt: 90, tSec: 30 }, // warning
        { ...OUTSIDE, altFt: 950, tSec: 60 }, // alert
      ],
    }
    const result = scanTerrain(path, [], elevAt, BASE_OPTS)
    expect(result).toBe('warning')
  })
})

describe('scanTerrain — TAWS-style landing-configuration inhibit', () => {
  // Violating terrain (90 ft clearance would normally warn) placed OUTSIDE any
  // MVA sector so it falls through to the DEM check.
  it('67 kt at 100 ft AGL over violating terrain -> null (landing/departing at some strip)', () => {
    const opts: TerrainScanOpts = {
      onApproach: false,
      profileDeviationFt: null,
      airports: [],
      gsKt: 67,
      currentAglFt: 100,
    }
    const elevAt = vi.fn().mockReturnValue(0)
    const result = scanTerrain(pathAt(OUTSIDE, 90), [], elevAt, opts)
    expect(result).toBeNull()
  })

  it('same geometry at 140 kt -> still alerts (too fast to be landing config)', () => {
    const opts: TerrainScanOpts = {
      onApproach: false,
      profileDeviationFt: null,
      airports: [],
      gsKt: 140,
      currentAglFt: 100,
    }
    const elevAt = vi.fn().mockReturnValue(0)
    const result = scanTerrain(pathAt(OUTSIDE, 90), [], elevAt, opts)
    expect(result).toBe('warning')
  })

  it('67 kt but currentAglFt null -> still alerts (no false sense of safety on cold DEM tiles)', () => {
    const opts: TerrainScanOpts = {
      onApproach: false,
      profileDeviationFt: null,
      airports: [],
      gsKt: 67,
      currentAglFt: null,
    }
    const elevAt = vi.fn().mockReturnValue(0)
    const result = scanTerrain(pathAt(OUTSIDE, 90), [], elevAt, opts)
    expect(result).toBe('warning')
  })

  it('67 kt at 2000 ft AGL -> still alerts (too high to be landing config)', () => {
    const opts: TerrainScanOpts = {
      onApproach: false,
      profileDeviationFt: null,
      airports: [],
      gsKt: 67,
      currentAglFt: 2000,
    }
    const elevAt = vi.fn().mockReturnValue(0)
    const result = scanTerrain(pathAt(OUTSIDE, 90), [], elevAt, opts)
    expect(result).toBe('warning')
  })
})
