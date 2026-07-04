import { describe, it, expect } from 'vitest'
import { reduceMetafile } from '../dtppMetafile'

// Small fixture in the shape documented in dtppMetafile.ts: two airports, a
// mix of IAP and non-IAP (STAR/MIN) records. vitest runs under jsdom
// (vitest.config.ts), so DOMParser is available without any polyfill.
const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<digital_tpp cycle="2606" from_edate="0901Z 06/11/26" to_edate="0901Z 07/09/26">
  <state_code ID="WA">
    <state_name>WASHINGTON</state_name>
    <city_name ID="SEATTLE">
      <airport_name ID="SEATTLE-TACOMA INTL" icao_ident="KSEA">
        <military>N</military>
        <faa_ident>SEA</faa_ident>
        <icao_ident>KSEA</icao_ident>
        <record>
          <chartseq>10100</chartseq>
          <chart_code>MIN</chart_code>
          <chart_name>ALTERNATE MINIMUMS</chart_name>
          <amdt_num>5</amdt_num>
          <amdt_date>01/23/25</amdt_date>
        </record>
        <record>
          <chartseq>10200</chartseq>
          <chart_code>IAP</chart_code>
          <chart_name>ILS OR LOC RWY 16C</chart_name>
          <amdt_num>12</amdt_num>
          <amdt_date>03/06/25</amdt_date>
        </record>
        <record>
          <chartseq>10300</chartseq>
          <chart_code>IAP</chart_code>
          <chart_name>RNAV (GPS) Y RWY 16C</chart_name>
          <amdt_num>3</amdt_num>
          <amdt_date>05/01/25</amdt_date>
        </record>
        <record>
          <chartseq>10400</chartseq>
          <chart_code>STAR</chart_code>
          <chart_name>CHINS TWO</chart_name>
          <amdt_num>1</amdt_num>
          <amdt_date>01/23/25</amdt_date>
        </record>
      </airport_name>
    </city_name>
  </state_code>
  <state_code ID="OR">
    <state_name>OREGON</state_name>
    <city_name ID="PORTLAND">
      <airport_name ID="PORTLAND INTL" icao_ident="KPDX">
        <military>N</military>
        <faa_ident>PDX</faa_ident>
        <icao_ident>KPDX</icao_ident>
        <record>
          <chartseq>20100</chartseq>
          <chart_code>IAP</chart_code>
          <chart_name>ILS OR LOC RWY 10R</chart_name>
          <amdt_num>7</amdt_num>
          <amdt_date>02/20/25</amdt_date>
        </record>
      </airport_name>
    </city_name>
  </state_code>
</digital_tpp>
`

function parseFixture(): Document {
  return new DOMParser().parseFromString(FIXTURE_XML, 'text/xml')
}

describe('reduceMetafile', () => {
  it('keys results by ICAO ident', () => {
    const result = reduceMetafile(parseFixture())
    expect(Object.keys(result).sort()).toEqual(['KPDX', 'KSEA'])
  })

  it('includes only IAP (approach chart) records, excluding MIN/STAR', () => {
    const result = reduceMetafile(parseFixture())
    expect(result.KSEA).toHaveLength(2)
    expect(result.KSEA.map((c) => c.chartName)).toEqual([
      'ILS OR LOC RWY 16C',
      'RNAV (GPS) Y RWY 16C',
    ])
  })

  it('captures amdt and amdtDate for each IAP record', () => {
    const result = reduceMetafile(parseFixture())
    expect(result.KSEA[0]).toEqual({
      chartName: 'ILS OR LOC RWY 16C',
      amdt: '12',
      amdtDate: '03/06/25',
    })
  })

  it('handles a second airport independently', () => {
    const result = reduceMetafile(parseFixture())
    expect(result.KPDX).toEqual([
      { chartName: 'ILS OR LOC RWY 10R', amdt: '7', amdtDate: '02/20/25' },
    ])
  })

  it('returns an empty object for a document with no airport_name elements', () => {
    const doc = new DOMParser().parseFromString('<digital_tpp></digital_tpp>', 'text/xml')
    expect(reduceMetafile(doc)).toEqual({})
  })
})
