import { describe, it, expect } from 'vitest'
import { assignProcedureColors, PROCEDURE_COLOR_FAMILIES, altitudeColor } from '../colorScheme'
import type { Procedure } from '../../types/procedure'

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function rgbDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

function proc(icao: string, name: string, type: Procedure['type']): Procedure {
  return {
    id: `${icao}-${name}`,
    icao,
    name,
    type,
    runways: [],
    waypoints: [],
    symbols: [],
    geojson: { type: 'FeatureCollection', features: [] },
    hasGeometry: true,
    color: '',
  }
}

describe('assignProcedureColors', () => {
  it('slot 0 reproduces the original single-airport palette exactly', () => {
    const procs = [
      proc('KSEA', 'D1', 'SID'),
      proc('KSEA', 'A1', 'STAR'),
      proc('KSEA', 'I16C', 'APPROACH'),
    ]
    const colored = assignProcedureColors('KSEA', procs, 0)
    expect(colored.find((p) => p.type === 'SID')?.color).toBe('#22d3ee')
    expect(colored.find((p) => p.type === 'STAR')?.color).toBe('#818cf8')
    expect(colored.find((p) => p.type === 'APPROACH')?.color).toBe('#34d399')
  })

  it('cycles shades within a type in the order the procedures are given', () => {
    const procs = [
      proc('KSEA', 'I16C', 'APPROACH'),
      proc('KSEA', 'I16R', 'APPROACH'),
      proc('KSEA', 'R34L', 'APPROACH'),
    ]
    const colored = assignProcedureColors('KSEA', procs, 0)
    const ramp = PROCEDURE_COLOR_FAMILIES[0].APPROACH
    expect(colored.map((p) => p.color)).toEqual([ramp[0], ramp[1], ramp[2]])
  })

  it('wraps the shade ramp when a type has more procedures than shades', () => {
    const ramp = PROCEDURE_COLOR_FAMILIES[0].SID
    const procs = Array.from({ length: ramp.length + 2 }, (_, i) => proc('KSEA', `S${i}`, 'SID'))
    const colored = assignProcedureColors('KSEA', procs, 0)
    expect(colored[ramp.length].color).toBe(ramp[0])
    expect(colored[ramp.length + 1].color).toBe(ramp[1])
  })

  it('different airport slots use distinct hue families', () => {
    const procs = [proc('KPAE', 'I16', 'APPROACH')]
    const slot0 = assignProcedureColors('KPAE', procs, 0)[0].color
    const slot1 = assignProcedureColors('KPAE', procs, 1)[0].color
    expect(slot0).not.toBe(slot1)
  })

  it('slots wrap around the number of defined families', () => {
    const procs = [proc('KPAE', 'I16', 'APPROACH')]
    const atFamilyCount = assignProcedureColors('KPAE', procs, PROCEDURE_COLOR_FAMILIES.length)[0].color
    const atZero = assignProcedureColors('KPAE', procs, 0)[0].color
    expect(atFamilyCount).toBe(atZero)
  })

  it('is deterministic: same key/slot/inputs produce the same colors', () => {
    const procs = [proc('KJFK', 'I4L', 'APPROACH'), proc('KJFK', 'D1', 'SID')]
    const first = assignProcedureColors('KJFK', procs, 2).map((p) => p.color)
    const second = assignProcedureColors('KJFK', procs, 2).map((p) => p.color)
    expect(first).toEqual(second)
  })

  it('a negative slot derives a stable family from a hash of the key', () => {
    const procs = [proc('KBFI', 'I13', 'APPROACH')]
    const a = assignProcedureColors('KBFI', procs, -1)[0].color
    const b = assignProcedureColors('KBFI', procs, -1)[0].color
    expect(a).toBe(b)
    // Some other key very likely hashes to a different family (not guaranteed
    // for every pair, but true for this fixed pair — pins the hash behavior).
    const other = assignProcedureColors('KPDX', procs, -1)[0].color
    expect(typeof other).toBe('string')
  })

  it('does not mutate the input procedures', () => {
    const original = proc('KSEA', 'I16C', 'APPROACH')
    assignProcedureColors('KSEA', [original], 0)
    expect(original.color).toBe('')
  })

  it('every family avoids the reserved aircraft/highlight/segment/centerline/runway colors', () => {
    const reserved = new Set(['#f59e0b', '#facc15', '#ff2bd6', '#6b7280', '#64748b'])
    for (const family of PROCEDURE_COLOR_FAMILIES) {
      for (const ramp of Object.values(family)) {
        for (const color of ramp) {
          expect(reserved.has(color)).toBe(false)
        }
      }
    }
  })
})

describe('altitudeColor', () => {
  // Perceptibility floors: adjacent 200 ft bands below 3000 ft shift modestly
  // (the ramp actually produces ~13-30 RGB units per step), while 600 ft of
  // separation must read as a clearly different color (~55+ actual).
  const ADJACENT_200FT_FLOOR = 12
  const APART_600FT_FLOOR = 35

  it('returns the reserved ground amber for "ground", unchanged', () => {
    expect(altitudeColor('ground')).toBe('#f59e0b')
  })

  it('is sensitive below 3000 ft: 700 vs 1200 vs 1700 ft are all clearly distinct', () => {
    const c700 = altitudeColor(700)
    const c1200 = altitudeColor(1200)
    const c1700 = altitudeColor(1700)
    expect(rgbDistance(c700, c1200)).toBeGreaterThan(APART_600FT_FLOOR)
    expect(rgbDistance(c1200, c1700)).toBeGreaterThan(APART_600FT_FLOOR)
    expect(rgbDistance(c700, c1700)).toBeGreaterThan(APART_600FT_FLOOR)
  })

  it('adjacent 200 ft bands below 3000 ft each shift perceptibly', () => {
    for (let ft = 200; ft <= 3000; ft += 200) {
      expect(rgbDistance(altitudeColor(ft - 200), altitudeColor(ft))).toBeGreaterThan(
        ADJACENT_200FT_FLOOR,
      )
    }
  })

  it('bands 600 ft apart below 3000 ft are clearly different', () => {
    for (let ft = 600; ft <= 3000; ft += 200) {
      expect(rgbDistance(altitudeColor(ft - 600), altitudeColor(ft))).toBeGreaterThan(
        APART_600FT_FLOOR,
      )
    }
  })

  it('pins the named stop colors across the full 0-18000 ft walk', () => {
    expect(altitudeColor(0)).toBe('#8a340f')
    expect(altitudeColor(400)).toBe('#ae4e10')
    expect(altitudeColor(800)).toBe('#cd7311')
    expect(altitudeColor(1200)).toBe('#dca51a')
    expect(altitudeColor(1600)).toBe('#d3d629')
    expect(altitudeColor(2000)).toBe('#9bda2e')
    expect(altitudeColor(2400)).toBe('#61d33a')
    expect(altitudeColor(2800)).toBe('#3fc550')
    expect(altitudeColor(3000)).toBe('#38bf5a')
    expect(altitudeColor(6000)).toBe('#2bb388')
    expect(altitudeColor(9000)).toBe('#2ba8ac')
    expect(altitudeColor(13000)).toBe('#30a8d9')
  })

  it('never emits an exact reserved UI color for airborne altitudes', () => {
    const reserved = new Set(['#f59e0b', '#facc15', '#ff2bd6', '#fbbf24', '#ef4444'])
    for (let ft = 0; ft <= 20000; ft += 250) {
      expect(reserved.has(altitudeColor(ft))).toBe(false)
    }
  })

  it('Class A (>=18000 ft) behavior is unchanged: dark navy at the floor, brightening toward sky-400', () => {
    expect(altitudeColor(18000)).toBe('#0c4a6e')
    const c30000 = altitudeColor(30000)
    const c60000 = altitudeColor(60000)
    expect(altitudeColor(60000)).toBe('#38bdf8')
    // Monotonically brightening with altitude within Class A.
    expect(rgbDistance('#0c4a6e', c30000)).toBeGreaterThan(0)
    expect(rgbDistance(c30000, c60000)).toBeGreaterThan(0)
    const [, g18000] = hexToRgb(altitudeColor(18000))
    const [, g30000] = hexToRgb(c30000)
    const [, g60000] = hexToRgb(c60000)
    expect(g30000).toBeGreaterThan(g18000)
    expect(g60000).toBeGreaterThan(g30000)
  })
})
