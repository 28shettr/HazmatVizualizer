/**
 * Local Bezier path optimizer.
 *
 * Iteratively places control points to minimize a cost that approximates the
 * robot's actual traversal time. The cost combines:
 *
 *   - estimated travel time (path length divided by a speed cap that drops
 *     when the curvature is high, modeling centripetal acceleration limits),
 *   - a small length tiebreaker so two equal-time paths prefer the shorter,
 *   - heavy penalties for crossing/skimming obstacles and leaving the field,
 *   - a soft penalty on sharp local turns to discourage self-intersecting
 *     control-point placements.
 *
 * Optimization is hill-climbing with a cooling step size: each iteration
 * proposes several perturbations around the current control points, keeps
 * the best one if it lowers cost, and shrinks the search radius over time.
 * `optimizePathLive` is an async generator that yields after each improving
 * iteration so the caller can stream results into the UI without blocking.
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
  maxVelocity: number;
  maxAcceleration: number;
}

export interface OptimizerProgress {
  controlPoints: BasePoint[];
  cost: number;
  iteration: number;
  done: boolean;
}

function distance(a: BasePoint, b: BasePoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clampToField(p: BasePoint, min: number, max: number): BasePoint {
  return {
    x: Math.max(min, Math.min(max, p.x)),
    y: Math.max(min, Math.min(max, p.y)),
  };
}

function sampleCurve(points: BasePoint[], count: number): BasePoint[] {
  const out: BasePoint[] = new Array(count + 1);
  for (let i = 0; i <= count; i++) {
    out[i] = getCurvePoint(i / count, points);
  }
  return out;
}

function robotClearance(opts: OptimizerOptions): number {
  // Half-diagonal of the robot footprint plus the user's safety buffer —
  // a circle of this radius around the path centerline must stay clear.
  const halfDiagonal =
    Math.sqrt(
      opts.robotWidth * opts.robotWidth +
        opts.robotHeight * opts.robotHeight,
    ) / 2;
  return halfDiagonal + Math.max(0, opts.safetyMargin || 0);
}

/**
 * Cost function. Lower is better. Hard violations (out of field, inside an
 * obstacle) return very large numbers so the optimizer can never prefer them.
 */
function computeCost(
  start: BasePoint,
  end: BasePoint,
  controlPoints: BasePoint[],
  obstacles: BasePoint[][],
  opts: OptimizerOptions,
): number {
  const all = [start, ...controlPoints, end];
  const samples = sampleCurve(all, SAMPLE_COUNT);
  const margin = robotClearance(opts);
  const maxVel = Math.max(1, opts.maxVelocity);
  // Allowed lateral acceleration. Pedro Pathing settings don't ship one
  // directly, so we treat maxAcceleration as a proxy.
  const maxLatAccel = Math.max(1, opts.maxAcceleration);

  let outOfBoundsPenalty = 0;
  let obstaclePenalty = 0;
  let time = 0;
  let length = 0;
  let sharpTurnPenalty = 0;

  // Field-bounds and obstacle checks happen per sample.
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (
      s.x < opts.fieldMin ||
      s.x > opts.fieldMax ||
      s.y < opts.fieldMin ||
      s.y > opts.fieldMax
    ) {
      const overflow =
        Math.max(0, opts.fieldMin - s.x) +
        Math.max(0, s.x - opts.fieldMax) +
        Math.max(0, opts.fieldMin - s.y) +
        Math.max(0, s.y - opts.fieldMax);
      outOfBoundsPenalty += 1000 + overflow * 200;
    }
    for (const obs of obstacles) {
      if (pointInPolygon([s.x, s.y], obs)) {
        obstaclePenalty += 5000;
      } else {
        const d = minDistanceToPolygon([s.x, s.y], obs);
        if (d < margin) {
          // Quadratic ramp so the optimizer feels gradient near the boundary.
          const overshoot = margin - d;
          obstaclePenalty += overshoot * overshoot * 50 + 5;
        }
      }
    }
  }

  // Time integral: speed at each segment is min(maxVel, sqrt(maxLatAccel/|k|)).
  for (let i = 1; i < samples.length - 1; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    const next = samples[i + 1];
    const vinX = cur.x - prev.x;
    const vinY = cur.y - prev.y;
    const voutX = next.x - cur.x;
    const voutY = next.y - cur.y;
    const segLen = Math.sqrt(vinX * vinX + vinY * vinY);
    length += segLen;
    if (segLen < 1e-4) continue;

    const cross = vinX * voutY - vinY * voutX;
    const dot = vinX * voutX + vinY * voutY;
    const dTheta = Math.atan2(cross, dot); // signed turn angle (radians)
    const kappa = Math.abs(dTheta) / Math.max(segLen, 1e-4);

    const speedFromCurve = kappa > 1e-4
      ? Math.sqrt(maxLatAccel / kappa)
      : maxVel;
    const speed = Math.max(0.5, Math.min(maxVel, speedFromCurve));
    time += segLen / speed;

    // Anything turning more than 90° in a single sample step is almost
    // certainly a control-point placement that makes the curve loop back
    // on itself — push hard against it.
    const absTheta = Math.abs(dTheta);
    if (absTheta > Math.PI / 2) {
      sharpTurnPenalty += (absTheta - Math.PI / 2) * 200;
    }
  }
  // Close out the last segment so total length is accurate.
  const tailSeg = distance(samples[samples.length - 2], samples[samples.length - 1]);
  length += tailSeg;

  // Length term is a tiebreaker so two equal-time options prefer the shorter.
  return time + length * 0.01 + outOfBoundsPenalty + obstaclePenalty + sharpTurnPenalty;
}

function seedControlPoint(start: BasePoint, end: BasePoint): BasePoint {
  return {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
}

/**
 * Streaming optimizer. Yields the best-so-far control points after each
 * iteration that improved on the previous best, so the caller can drive a
 * live UI update.
 */
export async function* optimizePathLive(
  start: BasePoint,
  end: BasePoint,
  initialControlPoints: BasePoint[],
  shapes: Shape[],
  opts: OptimizerOptions,
  abortSignal?: AbortSignal,
): AsyncGenerator<OptimizerProgress> {
  const obstacles = shapes.map((s) => s.vertices);

  // Auto-seed a single control point at the midpoint when the line has none.
  let current: BasePoint[] =
    initialControlPoints.length > 0
      ? initialControlPoints.map((p) => clampToField(p, opts.fieldMin, opts.fieldMax))
      : [seedControlPoint(start, end)];

  let currentCost = computeCost(start, end, current, obstacles, opts);
  console.log("[optimizer] seed", { current, currentCost });
  yield { controlPoints: current, cost: currentCost, iteration: 0, done: false };

  const baseDist = distance(start, end);
  // Start with a search radius that scales with the segment length so short
  // paths don't waste iterations exploring half the field.
  let stepSize = Math.max(8, baseDist * 0.4);
  const minStepSize = 0.05;
  const cooling = 0.96;
  const candidatesPerIteration = 10;
  const maxIterations = 180;

  for (let iter = 1; iter <= maxIterations; iter++) {
    if (abortSignal?.aborted) break;

    let bestCandidate: BasePoint[] | null = null;
    let bestCost = currentCost;

    for (let k = 0; k < candidatesPerIteration; k++) {
      const candidate = current.map((cp) =>
        clampToField(
          {
            x: cp.x + (Math.random() - 0.5) * 2 * stepSize,
            y: cp.y + (Math.random() - 0.5) * 2 * stepSize,
          },
          opts.fieldMin,
          opts.fieldMax,
        ),
      );
      const cost = computeCost(start, end, candidate, obstacles, opts);
      if (cost < bestCost) {
        bestCost = cost;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) {
      current = bestCandidate;
      currentCost = bestCost;
      yield { controlPoints: current, cost: currentCost, iteration: iter, done: false };
    }

    stepSize = Math.max(minStepSize, stepSize * cooling);

    // Yield to the browser so the path repaints and clicks stay responsive.
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  yield {
    controlPoints: current,
    cost: currentCost,
    iteration: maxIterations,
    done: true,
  };
}
