import { describe, it, expect } from 'vitest'
import { parseMvaAixm } from '../aixmMva'

// Minimal inline AIXM 5.1 fixture: three sectors —
//   SECTOR 1: plain quad, coords in the documented (lat, lon) order.
//   SECTOR 2: quad with one interior ring (hole).
//   SECTOR 3: plain quad, coords in swapped (lon, lat) order — exercises the
//             per-pair magnitude heuristic in aixmMva.ts.
const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<aixm:AIXMBasicMessage xmlns:aixm="http://www.aixm.aero/schema/5.1" xmlns:gml="http://www.opengis.net/gml/3.2">
  <aixm:hasMember>
    <aixm:Airspace>
      <aixm:timeSlice>
        <aixm:AirspaceTimeSlice>
          <gml:validTime>1980-01-01T00:00:00</gml:validTime>
          <aixm:name>SECTOR 1</aixm:name>
          <aixm:geometryComponent>
            <aixm:AirspaceGeometryComponent>
              <aixm:theAirspaceVolume>
                <aixm:AirspaceVolume>
                  <aixm:minimumLimit uom="FT">4200</aixm:minimumLimit>
                  <aixm:maximumLimit uom="FT">10000</aixm:maximumLimit>
                  <aixm:horizontalProjection>
                    <aixm:Surface>
                      <gml:patches>
                        <gml:PolygonPatch>
                          <gml:exterior>
                            <gml:LinearRing>
                              <gml:posList>35.0 -106.0 35.5 -106.0 35.5 -105.5 35.0 -105.5 35.0 -106.0</gml:posList>
                            </gml:LinearRing>
                          </gml:exterior>
                        </gml:PolygonPatch>
                      </gml:patches>
                    </aixm:Surface>
                  </aixm:horizontalProjection>
                </aixm:AirspaceVolume>
              </aixm:theAirspaceVolume>
            </aixm:AirspaceGeometryComponent>
          </aixm:geometryComponent>
        </aixm:AirspaceTimeSlice>
      </aixm:timeSlice>
    </aixm:Airspace>
  </aixm:hasMember>
  <aixm:hasMember>
    <aixm:Airspace>
      <aixm:timeSlice>
        <aixm:AirspaceTimeSlice>
          <aixm:name>SECTOR 2</aixm:name>
          <aixm:geometryComponent>
            <aixm:AirspaceGeometryComponent>
              <aixm:theAirspaceVolume>
                <aixm:AirspaceVolume>
                  <aixm:minimumLimit uom="FT">6100</aixm:minimumLimit>
                  <aixm:horizontalProjection>
                    <aixm:Surface>
                      <gml:patches>
                        <gml:PolygonPatch>
                          <gml:exterior>
                            <gml:LinearRing>
                              <gml:posList>36.0 -107.0 37.0 -107.0 37.0 -105.0 36.0 -105.0 36.0 -107.0</gml:posList>
                            </gml:LinearRing>
                          </gml:exterior>
                          <gml:interior>
                            <gml:LinearRing>
                              <gml:posList>36.2 -106.6 36.4 -106.6 36.4 -106.4 36.2 -106.4 36.2 -106.6</gml:posList>
                            </gml:LinearRing>
                          </gml:interior>
                        </gml:PolygonPatch>
                      </gml:patches>
                    </aixm:Surface>
                  </aixm:horizontalProjection>
                </aixm:AirspaceVolume>
              </aixm:theAirspaceVolume>
            </aixm:AirspaceGeometryComponent>
          </aixm:geometryComponent>
        </aixm:AirspaceTimeSlice>
      </aixm:timeSlice>
    </aixm:Airspace>
  </aixm:hasMember>
  <aixm:hasMember>
    <aixm:Airspace>
      <aixm:timeSlice>
        <aixm:AirspaceTimeSlice>
          <aixm:name>SECTOR 3</aixm:name>
          <aixm:geometryComponent>
            <aixm:AirspaceGeometryComponent>
              <aixm:theAirspaceVolume>
                <aixm:AirspaceVolume>
                  <aixm:minimumLimit uom="FT">9800</aixm:minimumLimit>
                  <aixm:horizontalProjection>
                    <aixm:Surface>
                      <gml:patches>
                        <gml:PolygonPatch>
                          <gml:exterior>
                            <gml:LinearRing>
                              <gml:posList>-104.0 34.0 -104.0 34.5 -103.5 34.5 -103.5 34.0 -104.0 34.0</gml:posList>
                            </gml:LinearRing>
                          </gml:exterior>
                        </gml:PolygonPatch>
                      </gml:patches>
                    </aixm:Surface>
                  </aixm:horizontalProjection>
                </aixm:AirspaceVolume>
              </aixm:theAirspaceVolume>
            </aixm:AirspaceGeometryComponent>
          </aixm:geometryComponent>
        </aixm:AirspaceTimeSlice>
      </aixm:timeSlice>
    </aixm:Airspace>
  </aixm:hasMember>
</aixm:AIXMBasicMessage>`

describe('parseMvaAixm', () => {
  it('parses a plain sector: name, minAltFt, and exterior-only polygon', () => {
    const sectors = parseMvaAixm(FIXTURE)
    const s1 = sectors.find((s) => s.name === 'SECTOR 1')
    expect(s1).toBeDefined()
    expect(s1!.minAltFt).toBe(4200)
    expect(s1!.polygon).toHaveLength(1)
    expect(s1!.polygon[0]).toHaveLength(5)
    // (lat, lon) input should be reordered to GeoJSON [lon, lat].
    expect(s1!.polygon[0][0]).toEqual([-106.0, 35.0])
  })

  it('parses a sector with an interior ring as a polygon hole', () => {
    const sectors = parseMvaAixm(FIXTURE)
    const s2 = sectors.find((s) => s.name === 'SECTOR 2')
    expect(s2).toBeDefined()
    expect(s2!.minAltFt).toBe(6100)
    expect(s2!.polygon).toHaveLength(2)
    expect(s2!.polygon[1]).toHaveLength(5)
    expect(s2!.polygon[1][0]).toEqual([-106.6, 36.2])
  })

  it('detects swapped (lon, lat) coordinate order per pair', () => {
    const sectors = parseMvaAixm(FIXTURE)
    const s3 = sectors.find((s) => s.name === 'SECTOR 3')
    expect(s3).toBeDefined()
    expect(s3!.minAltFt).toBe(9800)
    // Input was already (lon, lat) — should pass through unchanged, not flipped.
    expect(s3!.polygon[0][0]).toEqual([-104.0, 34.0])
  })

  it('returns an empty array for XML with no sectors', () => {
    expect(parseMvaAixm('<root></root>')).toEqual([])
  })

  it('skips a time slice missing minimumLimit or geometry', () => {
    const partial = `<aixm:AIXMBasicMessage xmlns:aixm="http://www.aixm.aero/schema/5.1">
      <aixm:hasMember><aixm:Airspace><aixm:timeSlice><aixm:AirspaceTimeSlice>
        <aixm:name>SECTOR X</aixm:name>
      </aixm:AirspaceTimeSlice></aixm:timeSlice></aixm:Airspace></aixm:hasMember>
    </aixm:AIXMBasicMessage>`
    expect(parseMvaAixm(partial)).toEqual([])
  })
})
