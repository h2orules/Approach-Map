import { MAX_ONSCREEN_WAYPOINT_SYMBOLS, MAX_RENDERED_PROCEDURE_LINES } from '../config/constants'

// Pure budget-threshold checks, extracted out of WaypointMarkers/RenderBudgetHint
// so the degrade/hint decisions are unit-testable without a Mapbox map or DOM.

/**
 * True once the number of on-screen waypoint symbols exceeds the render
 * budget — WaypointMarkers then skips label placement for the overflow and
 * renders icon-only glyphs. Exactly at the cap is still the normal (labeled)
 * path; only strictly past it degrades.
 */
export function isOverWaypointBudget(onScreenCount: number): boolean {
  return onScreenCount > MAX_ONSCREEN_WAYPOINT_SYMBOLS
}

/**
 * True once the number of simultaneously-visible procedure lines exceeds the
 * render budget — AppMap then shows the dismissible RenderBudgetHint. Exactly
 * at the cap does not show the hint; only strictly past it does.
 */
export function isOverProcedureLineBudget(visibleCount: number): boolean {
  return visibleCount > MAX_RENDERED_PROCEDURE_LINES
}
