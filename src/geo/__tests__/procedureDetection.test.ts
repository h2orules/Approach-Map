import { describe, it, expect } from 'vitest'
import { detectProceduresInUse } from '../procedureDetection'
import type { Procedure } from '../../types/procedure'
import type { InterpolatedAircraft } from '../../types/aircraft'

// A southbound approach line (north fix → south fix) along a constant longitude.
const southboundApproach: Procedure = {
  id: 'KSEA-APPROACH-I16C',
  icao: 'KSEA',
  name: 'I16C',
  type: 'APPROACH',
  runways: ['16C'],
  waypoints: [
    { id: 'NORTH', lat: 47.5, lon: -122.31, navaidType: 'FIX', altConstraint: null, sequenceNumber: 10 },
    { id: 'SOUTH', lat: 47.4, lon: -122.31, navaidType: 'FIX', altConstraint: null, sequenceNumber: 20 },
  ],
  symbols: [],
  geojson: { type: 'FeatureCollection', features: [] },
  hasGeometry: true,
  color: '#34d399',
}

function aircraft(track: number): InterpolatedAircraft {
  return {
    hex: 'abc123',
    flight: 'TEST1',
    registration: 'N1',
    typeCode: 'B738',
    lat: 47.45,
    lon: -122.31,
    altBaro: 3000,
    altGeom: 3000,
    groundspeed: 180,
    track,
    baroRate: -500,
    squawk: '1200',
    lastPollMs: 0,
    interpLat: 47.45,
    interpLon: -122.31, // on the approach centerline
  }
}

describe('detectProceduresInUse direction matching', () => {
  it('detects an aircraft flying the procedure direction (southbound)', () => {
    const { detected } = detectProceduresInUse([aircraft(180)], [southboundApproach], 47.4, -122.31, 0, 1000, new Map())
    expect(detected['KSEA-APPROACH-I16C']).toBe(true)
  })

  it('rejects an aircraft on the same centerline flying the reciprocal (northbound)', () => {
    const { detected } = detectProceduresInUse([aircraft(0)], [southboundApproach], 47.4, -122.31, 0, 1000, new Map())
    expect(detected['KSEA-APPROACH-I16C']).toBe(false)
  })

  it('rejects an aircraft tracking well off the procedure direction (>90°)', () => {
    // 300° vs the 180° approach course is 120° off — clearly not flying it
    const { detected } = detectProceduresInUse([aircraft(300)], [southboundApproach], 47.4, -122.31, 0, 1000, new Map())
    expect(detected['KSEA-APPROACH-I16C']).toBe(false)
  })
})
