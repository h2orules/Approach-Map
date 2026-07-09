import { describe, it, expect } from 'vitest'
import { isOverWaypointBudget, isOverProcedureLineBudget } from '../renderBudget'
import { MAX_ONSCREEN_WAYPOINT_SYMBOLS, MAX_RENDERED_PROCEDURE_LINES } from '../../config/constants'

describe('isOverWaypointBudget', () => {
  it('is false at and below the cap', () => {
    expect(isOverWaypointBudget(MAX_ONSCREEN_WAYPOINT_SYMBOLS)).toBe(false)
    expect(isOverWaypointBudget(MAX_ONSCREEN_WAYPOINT_SYMBOLS - 1)).toBe(false)
    expect(isOverWaypointBudget(0)).toBe(false)
  })

  it('is true one past the cap', () => {
    expect(isOverWaypointBudget(MAX_ONSCREEN_WAYPOINT_SYMBOLS + 1)).toBe(true)
  })
})

describe('isOverProcedureLineBudget', () => {
  it('is false at and below the cap', () => {
    expect(isOverProcedureLineBudget(MAX_RENDERED_PROCEDURE_LINES)).toBe(false)
    expect(isOverProcedureLineBudget(MAX_RENDERED_PROCEDURE_LINES - 1)).toBe(false)
    expect(isOverProcedureLineBudget(0)).toBe(false)
  })

  it('is true one past the cap', () => {
    expect(isOverProcedureLineBudget(MAX_RENDERED_PROCEDURE_LINES + 1)).toBe(true)
  })
})
