import { describe, it, expect } from 'vitest'
import { TCAS_SL_TABLE, sensitivityLevelFor } from '../tcasTables'

describe('TCAS_SL_TABLE row values', () => {
  it('SL2 (<1000 AGL): TA 20/0.30/850, no RA', () => {
    const row = TCAS_SL_TABLE[0]
    expect(row.sl).toBe(2)
    expect(row.taTauS).toBe(20)
    expect(row.taDmodNm).toBe(0.3)
    expect(row.taZthrFt).toBe(850)
    expect(row.raTauS).toBeNull()
    expect(row.raDmodNm).toBeNull()
    expect(row.raZthrFt).toBeNull()
    expect(row.alimFt).toBeNull()
  })

  it('SL3 (1000-2350 AGL): TA 25/0.33/850, RA 15/0.20/600, ALIM 300', () => {
    const row = TCAS_SL_TABLE[1]
    expect(row.sl).toBe(3)
    expect(row.taTauS).toBe(25)
    expect(row.taDmodNm).toBe(0.33)
    expect(row.taZthrFt).toBe(850)
    expect(row.raTauS).toBe(15)
    expect(row.raDmodNm).toBe(0.2)
    expect(row.raZthrFt).toBe(600)
    expect(row.alimFt).toBe(300)
  })

  it('SL4 (>2350 AGL, <5000 MSL): TA 30/0.48/850, RA 20/0.35/600, ALIM 300', () => {
    const row = TCAS_SL_TABLE[2]
    expect(row.sl).toBe(4)
    expect(row.taTauS).toBe(30)
    expect(row.taDmodNm).toBe(0.48)
    expect(row.taZthrFt).toBe(850)
    expect(row.raTauS).toBe(20)
    expect(row.raDmodNm).toBe(0.35)
    expect(row.raZthrFt).toBe(600)
    expect(row.alimFt).toBe(300)
  })

  it('SL5 (5000-10000 MSL): TA 40/0.75/850, RA 25/0.55/600, ALIM 350', () => {
    const row = TCAS_SL_TABLE[3]
    expect(row.sl).toBe(5)
    expect(row.taTauS).toBe(40)
    expect(row.taDmodNm).toBe(0.75)
    expect(row.taZthrFt).toBe(850)
    expect(row.raTauS).toBe(25)
    expect(row.raDmodNm).toBe(0.55)
    expect(row.raZthrFt).toBe(600)
    expect(row.alimFt).toBe(350)
  })

  it('SL6 (10000-20000 MSL): TA 45/1.00/850, RA 30/0.80/600, ALIM 400', () => {
    const row = TCAS_SL_TABLE[4]
    expect(row.sl).toBe(6)
    expect(row.taTauS).toBe(45)
    expect(row.taDmodNm).toBe(1.0)
    expect(row.taZthrFt).toBe(850)
    expect(row.raTauS).toBe(30)
    expect(row.raDmodNm).toBe(0.8)
    expect(row.raZthrFt).toBe(600)
    expect(row.alimFt).toBe(400)
  })

  it('SL7 (20000-42000 MSL): TA 48/1.30/850, RA 35/1.10/700, ALIM 600', () => {
    const row = TCAS_SL_TABLE[5]
    expect(row.sl).toBe(7)
    expect(row.taTauS).toBe(48)
    expect(row.taDmodNm).toBe(1.3)
    expect(row.taZthrFt).toBe(850)
    expect(row.raTauS).toBe(35)
    expect(row.raDmodNm).toBe(1.1)
    expect(row.raZthrFt).toBe(700)
    expect(row.alimFt).toBe(600)
  })

  it('SL8 (>42000 MSL): TA 48/1.30/1200, RA 35/1.10/800, ALIM 700', () => {
    const row = TCAS_SL_TABLE[6]
    expect(row.sl).toBe(8)
    expect(row.taTauS).toBe(48)
    expect(row.taDmodNm).toBe(1.3)
    expect(row.taZthrFt).toBe(1200)
    expect(row.raTauS).toBe(35)
    expect(row.raDmodNm).toBe(1.1)
    expect(row.raZthrFt).toBe(800)
    expect(row.alimFt).toBe(700)
  })
})

describe('sensitivityLevelFor band boundaries', () => {
  // AGL boundary: <1000 -> SL2, >=1000 -> SL3. MSL held constant and low so it
  // never confounds the AGL-gated bands.
  it('999 ft AGL -> SL2', () => {
    expect(sensitivityLevelFor(3000, 999).sl).toBe(2)
  })
  it('1000 ft AGL -> SL3', () => {
    expect(sensitivityLevelFor(3000, 1000).sl).toBe(3)
  })

  // AGL boundary: <=2350 -> SL3, >2350 -> falls through to MSL bands.
  it('2350 ft AGL -> SL3', () => {
    expect(sensitivityLevelFor(3000, 2350).sl).toBe(3)
  })
  it('2351 ft AGL (MSL 3000, <5000) -> SL4', () => {
    expect(sensitivityLevelFor(3000, 2351).sl).toBe(4)
  })

  // MSL boundary: <5000 -> SL4, >=5000 -> SL5. AGL held high (>2350) so MSL decides.
  it('4999 ft MSL -> SL4', () => {
    expect(sensitivityLevelFor(4999, 5000).sl).toBe(4)
  })
  it('5000 ft MSL -> SL5', () => {
    expect(sensitivityLevelFor(5000, 5000).sl).toBe(5)
  })

  // MSL boundary: <10000 -> SL5, >=10000 -> SL6.
  it('9999 ft MSL -> SL5', () => {
    expect(sensitivityLevelFor(9999, 5000).sl).toBe(5)
  })
  it('10000 ft MSL -> SL6', () => {
    expect(sensitivityLevelFor(10000, 5000).sl).toBe(6)
  })

  // MSL boundary at 20000: <20000 -> SL6, >=20000 -> SL7.
  it('20000 ft MSL -> SL7', () => {
    expect(sensitivityLevelFor(20000, 5000).sl).toBe(7)
  })
  it('19999 ft MSL -> SL6', () => {
    expect(sensitivityLevelFor(19999, 5000).sl).toBe(6)
  })

  // MSL boundary: <=42000 -> SL7, >42000 -> SL8.
  it('42000 ft MSL -> SL7', () => {
    expect(sensitivityLevelFor(42000, 5000).sl).toBe(7)
  })
  it('42001 ft MSL -> SL8', () => {
    expect(sensitivityLevelFor(42001, 5000).sl).toBe(8)
  })
})
