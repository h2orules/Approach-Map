import type { AltConstraint } from './procedure'

/** One retained ADS-B sample in an aircraft's tracklog. */
export interface TrackPoint {
  tMs: number
  lat: number
  lon: number
  altFt: number | 'ground'
  gs: number
  track: number
  baroRate: number
}

/** One point along a predicted path, tSec seconds ahead of "now". */
export interface PredPoint {
  lon: number
  lat: number
  tSec: number
  altFt: number
}

export type PredictionMode = 'approach' | 'turn' | 'straight'

export interface PredictedPath {
  hex: string
  mode: PredictionMode
  points: PredPoint[]
}

/** A published hold extracted from a procedure, in true-course terms. */
export interface HoldSpec {
  key: string // `${procId}|${fixId}`
  procId: string
  fixId: string
  fixLat: number
  fixLon: number
  inboundCourseTrue: number
  turnRight: boolean
  legNm: number
  alt: AltConstraint | null
  segment: 'transition' | 'missed'
}

/** AIM 5-3-8 hold entry sectors. */
export type HoldEntryKind = 'direct' | 'teardrop' | 'parallel'

export interface HoldEntryPrediction {
  hex: string
  specKey: string
  entry: HoldEntryKind
  path: [number, number][] // [lon, lat]
  lastQualifiedMs: number
  divergedPolls: number
  crossedFix: boolean
}

export type AlertTier = 'alert' | 'warning' | 'ta' | 'ra'

export type RaSense = 'climb' | 'descend'

/** The single highest-priority alert attached to one aircraft. */
export interface AircraftAlert {
  kind: 'traffic' | 'terrain'
  tier: AlertTier
  raSense?: RaSense
  otherHex?: string
}

/** A projected loss-of-separation between two aircraft at closest approach. */
export interface ConflictPair {
  hexA: string
  hexB: string
  tier: AlertTier
  raSenseA?: RaSense
  raSenseB?: RaSense
  cpaTimeS: number
  cpaNm: number
  cpaDAltFt: number
}
