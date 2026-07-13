import { describe, it, expect, beforeEach } from 'vitest'
import { recordPoll, getTrack, getRecent, _reset } from '../trackLog'
import type { InterpolatedAircraft } from '../../types/aircraft'
import { TRACKLOG_MAX_POINTS } from '../../config/constants'

function aircraft(over: Partial<InterpolatedAircraft> = {}): InterpolatedAircraft {
  const lat = over.lat ?? 47.45
  const lon = over.lon ?? -122.31
  return {
    hex: 'abc123',
    flight: 'TEST1',
    registration: 'N1',
    typeCode: 'B738',
    lat,
    lon,
    altBaro: 3000,
    altGeom: 3000,
    groundspeed: 180,
    track: 180,
    baroRate: -500,
    squawk: '1200',
    lastPollMs: 0,
    interpLat: lat,
    interpLon: lon,
    ...over,
  }
}

function mapOf(...acs: InterpolatedAircraft[]): Map<string, InterpolatedAircraft> {
  const m = new Map<string, InterpolatedAircraft>()
  for (const ac of acs) m.set(ac.hex, ac)
  return m
}

beforeEach(() => {
  _reset()
})

describe('trackLog', () => {
  it('records a point per poll and returns them chronologically', () => {
    for (let i = 0; i < 5; i++) {
      const ac = aircraft({ lastPollMs: i * 5000, lat: 47 + i * 0.01 })
      recordPoll(mapOf(ac), ac.lastPollMs)
    }
    const track = getTrack('abc123')
    expect(track).toHaveLength(5)
    expect(track.map((p) => p.tMs)).toEqual([0, 5000, 10000, 15000, 20000])
    expect(track[0].lat).toBeCloseTo(47)
    expect(track[4].lat).toBeCloseTo(47.04)
  })

  it('wraps the ring at capacity, dropping the oldest and staying chronological', () => {
    const total = TRACKLOG_MAX_POINTS + 5
    for (let i = 0; i < total; i++) {
      const ac = aircraft({ lastPollMs: i * 5000 })
      recordPoll(mapOf(ac), ac.lastPollMs)
    }
    const track = getTrack('abc123')
    expect(track).toHaveLength(TRACKLOG_MAX_POINTS)
    // Oldest 5 points (tMs 0..20000) should have been dropped.
    expect(track[0].tMs).toBe(5 * 5000)
    expect(track[track.length - 1].tMs).toBe((total - 1) * 5000)
    // Verify strictly increasing (chronological order preserved through wrap).
    for (let i = 1; i < track.length; i++) {
      expect(track[i].tMs).toBeGreaterThan(track[i - 1].tMs)
    }
  })

  it('dedupes same lastPollMs seen twice into a single point', () => {
    const ac1 = aircraft({ lastPollMs: 1000 })
    recordPoll(mapOf(ac1), 1000)
    // Same poll round carried forward again with identical lastPollMs (stale carry-forward).
    const ac2 = aircraft({ lastPollMs: 1000, lat: 48 })
    recordPoll(mapOf(ac2), 1000)

    const track = getTrack('abc123')
    expect(track).toHaveLength(1)
    expect(track[0].tMs).toBe(1000)
  })

  it('tracks multiple hexes independently', () => {
    const a = aircraft({ hex: 'aaa111', lastPollMs: 1000 })
    const b = aircraft({ hex: 'bbb222', lastPollMs: 1000, lat: 40 })
    recordPoll(mapOf(a, b), 1000)

    const a2 = aircraft({ hex: 'aaa111', lastPollMs: 2000 })
    recordPoll(mapOf(a2, b), 2000) // b carries forward same lastPollMs, should not append

    expect(getTrack('aaa111')).toHaveLength(2)
    expect(getTrack('bbb222')).toHaveLength(1)
  })

  it('prunes a ring when its hex vanishes from the aircraft map', () => {
    const a = aircraft({ hex: 'aaa111', lastPollMs: 1000 })
    recordPoll(mapOf(a), 1000)
    expect(getTrack('aaa111')).toHaveLength(1)

    // Next poll round: aaa111 is gone.
    recordPoll(new Map(), 2000)
    expect(getTrack('aaa111')).toEqual([])
  })

  it('getRecent returns the last n points, chronological', () => {
    for (let i = 0; i < 10; i++) {
      const ac = aircraft({ lastPollMs: i * 1000 })
      recordPoll(mapOf(ac), ac.lastPollMs)
    }
    const recent = getRecent('abc123', 3)
    expect(recent.map((p) => p.tMs)).toEqual([7000, 8000, 9000])
  })

  it('getRecent on an unknown hex returns an empty array', () => {
    expect(getRecent('nope', 5)).toEqual([])
  })

  it('passes through a "ground" altFt', () => {
    const ac = aircraft({ lastPollMs: 1000, altBaro: 'ground' })
    recordPoll(mapOf(ac), 1000)
    const track = getTrack('abc123')
    expect(track[0].altFt).toBe('ground')
  })
})
