/**
 * Local Bezier path optimizer.
 *
 * Given a start and end point plus a set of obstacle polygons, finds the
 * Bezier control points that produce the shortest path which stays outside
 * every obstacle by at least the robot's safety margin.
 *
 * Strategy (fast → robust):
 *   1. Try a straight line (zero control points). If clear, that's optimal.
 *   2. Sweep a single control point along the perpendicular bisector and a
 *      few "along-line" anchor positions; pick the clear option with the
 *      shortest sampled arc length.
 *   3. If no single control point works, search a 2-control-point grid where
 *      each point is perpendicular-offset from its anchor (1/3 and 2/3 along
 *      the start→end line).
 *
 * Length is measured by sampling the curve; collision uses `pointInPolygon`
 * plus `minDistanceToPolygon` from the existing geometry helpers, with the
 * robot's half-diagonal inflating the obstacle.
 */

import type { BasePoint, Shape } from "../types";
import { getCurvePoint } from "./math";
import { pointInPolygon, minDistanceToPolygon } from "./geometry";

const SAMPLE_COUNT = 60;

export interface OptimizerOptions {
  fieldMin: number;
  fieldMax: number;
  robotWidth: number;
  robotHeight: number;
  safetyMargin: number;
}

export interface OptimizerResult {
  controlPoints: BasePoint[];
  pathLength: number;
  clear: boolean;
}

function distance(a: BasePoint, b: BasePoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function sampledArcLength(points: BasePoint[]): number {
  let length = 0;
  let prev = getCurvePoint(0, points);
  for (let i = 1; i <= SAMPLE_COUNT; i++) {
    const p = getCurvePoint(i / SAMPLE_COUNT, points);
    length += distance(prev, p);
    prev = p;
  }
  return length;
}

function isPathClear(
  points: BasePoint[],
  obstacles: BasePoint[][],
  margin: number,
): boolean {
  if (obstacles.length === 0) return true;
  for (let i = 0; i <= SAMPLE_COUNT; i++) {
    const p = getCurvePoint(i / SAMPLE_COUNT, points);
    const coords = [p.x, p.y];
    for (const obs of obstacles) {
      if (pointInPolygon(coords, obs)) return false;
      if (minDistanceToPolygon(coords, obs) < margin) return false;
    }
  }
  return true;
}

function clampToField(p: BasePoint, min: number, max: number): BasePoint {
  return {
    x: Math.max(min, Math.min(max, p.x)),
    y: Math.max(min, Math.min(max, p.y)),
  };
}

function perpendicularUnit(from: BasePoint, to: BasePoint): BasePoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: -dy / len, y: dx / len };
}

function searchSingleControlPoint(
  start: BasePoint,
  end: BasePoint,
  obstacles: BasePoint[][],
  margin: number,
  fieldMin: number,
  fieldMax: number,
): { cp: BasePoint; length: number } | null {
  const perp = perpendicularUnit(start, end);
  const direct = distance(start, end);
  // Search anchors along the start→end line plus perpendicular offsets on
  // each side. Coarse step keeps this well under a second for typical fields.
  const anchorRatios = [0.3, 0.4, 0.5, 0.6, 0.7];
  const maxOffset = Math.max(40, direct);
  const offsetStep = 2;

  let best: { cp: BasePoint; length: number } | null = null;

  for (const t of anchorRatios) {
    const anchor: BasePoint = {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    };
    for (let offset = -maxOffset; offset <= maxOffset; offset += offsetStep) {
      const candidate = clampToField(
        { x: anchor.x + perp.x * offset, y: anchor.y + perp.y * offset },
        fieldMin,
        fieldMax,
      );
      const curve = [start, candidate, end];
      if (!isPathClear(curve, obstacles, margin)) continue;
      const len = sampledArcLength(curve);
      if (!best || len < best.length) {
        best = { cp: candidate, length: len };
      }
    }
  }
  return best;
}

function searchTwoControlPoints(
  start: BasePoint,
  end: BasePoint,
  obstacles: BasePoint[][],
  margin: number,
  fieldMin: number,
  fieldMax: number,
): { cps: BasePoint[]; length: number } | null {
  const perp = perpendicularUnit(start, end);
  const direct = distance(start, end);
  const maxOffset = Math.max(40, direct);
  const offsetStep = 8; // coarser — 2D search

  const anchor1: BasePoint = {
    x: start.x + (end.x - start.x) / 3,
    y: start.y + (end.y - start.y) / 3,
  };
  const anchor2: BasePoint = {
    x: start.x + (2 * (end.x - start.x)) / 3,
    y: start.y + (2 * (end.y - start.y)) / 3,
  };

  let best: { cps: BasePoint[]; length: number } | null = null;

  for (let o1 = -maxOffset; o1 <= maxOffset; o1 += offsetStep) {
    const cp1 = clampToField(
      { x: anchor1.x + perp.x * o1, y: anchor1.y + perp.y * o1 },
      fieldMin,
      fieldMax,
    );
    for (let o2 = -maxOffset; o2 <= maxOffset; o2 += offsetStep) {
      const cp2 = clampToField(
        { x: anchor2.x + perp.x * o2, y: anchor2.y + perp.y * o2 },
        fieldMin,
        fieldMax,
      );
      const curve = [start, cp1, cp2, end];
      if (!isPathClear(curve, obstacles, margin)) continue;
      const len = sampledArcLength(curve);
      if (!best || len < best.length) {
        best = { cps: [cp1, cp2], length: len };
      }
    }
  }
  return best;
}

export function optimizePath(
  start: BasePoint,
  end: BasePoint,
  shapes: Shape[],
  options: OptimizerOptions,
): OptimizerResult {
  const obstacles = shapes.map((s) => s.vertices);
  // Effective margin: half the robot's diagonal so any orientation of the
  // body stays out of the obstacle, plus the user's safety buffer.
  const halfDiagonal =
    Math.sqrt(
      options.robotWidth * options.robotWidth +
        options.robotHeight * options.robotHeight,
    ) / 2;
  const margin = halfDiagonal + Math.max(0, options.safetyMargin || 0);

  const straight = [start, end];
  if (isPathClear(straight, obstacles, margin)) {
    return {
      controlPoints: [],
      pathLength: distance(start, end),
      clear: true,
    };
  }

  const single = searchSingleControlPoint(
    start,
    end,
    obstacles,
    margin,
    options.fieldMin,
    options.fieldMax,
  );
  if (single) {
    return {
      controlPoints: [single.cp],
      pathLength: single.length,
      clear: true,
    };
  }

  const double = searchTwoControlPoints(
    start,
    end,
    obstacles,
    margin,
    options.fieldMin,
    options.fieldMax,
  );
  if (double) {
    return {
      controlPoints: double.cps,
      pathLength: double.length,
      clear: true,
    };
  }

  // Nothing clear — return straight line and let the caller surface the
  // failure. Better than silently inventing a bad path.
  return {
    controlPoints: [],
    pathLength: distance(start, end),
    clear: false,
  };
}
