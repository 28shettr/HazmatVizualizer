import type { Point, Line, Shape, Settings } from "../types";
import { getRandomColor } from "../utils";

/**
 * Default robot dimensions
 */
export const DEFAULT_ROBOT_WIDTH = 16;
export const DEFAULT_ROBOT_HEIGHT = 16;

/**
 * Default canvas drawing settings
 */
export const POINT_RADIUS = 1.15;
export const LINE_WIDTH = 0.57;
export const FIELD_SIZE = 141.5;
export const FIELD_HALF = FIELD_SIZE / 2;
export const FIELD_MIN = -FIELD_HALF;
export const FIELD_MAX = FIELD_HALF;

/**
 * Available field maps
 */
export const AVAILABLE_FIELD_MAPS = [
  { value: "decode.webp", label: "DECODE Field (2025-2026)" },
  { value: "intothedeep.webp", label: "Into The Deep Field (2024-2025)" },
  { value: "centerstage.webp", label: "Centerstage (2023-2024)" },
  { value: "custom", label: "Custom Field (Upload)" },
];

/**
 * Default settings
 */
export const DEFAULT_SETTINGS: Settings = {
  xVelocity: 75,
  yVelocity: 65,
  aVelocity: Math.PI,
  kFriction: 0.1,
  rWidth: DEFAULT_ROBOT_WIDTH,
  rHeight: DEFAULT_ROBOT_HEIGHT,
  safetyMargin: 1,
  maxVelocity: 40,
  maxAcceleration: 30,
  maxDeceleration: 30,
  fieldMap: "decode.webp",
  // Resolved at runtime against import.meta.env.BASE_URL by consumers.
  robotImage: `${import.meta.env.BASE_URL}robot.png`,
  theme: "auto",
  showGhostPaths: false,
  showOnionLayers: false,
  onionLayerSpacing: 3, // inches between each robot body trace
  onionColor: "#dc2626",
  onionNextPointOnly: false,
  showHeadingArrow: false,
  headingArrowLength: 50,
  headingArrowColor: "#ffffff",
  headingArrowThickness: 2,
  pathOpacity: 1,
};

/**
 * Get default starting point
 */
export function getDefaultStartPoint(): Point {
  return {
    x: -14.75,
    y: -62.75,
    heading: "linear",
    startDeg: 90,
    endDeg: 180,
    locked: false,
  };
}

/**
 * Get default initial path lines
 */
export function getDefaultLines(): Line[] {
  return [
    {
      id: `line-${Math.random().toString(36).slice(2)}`,
      name: "Path 1",
      endPoint: { x: -14.75, y: -34.75, heading: "linear", startDeg: 90, endDeg: 180 },
      controlPoints: [],
      color: "#ffc516",
      locked: false,
      waitBeforeMs: 0,
      waitAfterMs: 0,
      waitBeforeName: "",
      waitAfterName: "",
    },
  ];
}

/**
 * Get default shapes (field obstacles)
 */
export function getDefaultShapes(): Shape[] {
  return [
    {
      id: "triangle-1",
      name: "Red Goal",
      vertices: [
        { x: 70.75, y: -0.75 },
        { x: 70.75, y: 70.75 },
        { x: 49.25, y: 70.75 },
        { x: 67.25, y: 48.25 },
        { x: 67.25, y: -0.75 },
      ],
      color: "#dc2626",
      fillColor: "#ff6b6b",
    },
    {
      id: "triangle-2",
      name: "Blue Goal",
      vertices: [
        { x: -64.75, y: 48.25 },
        { x: -45.75, y: 70.75 },
        { x: -70.75, y: 70.75 },
        { x: -70.75, y: -0.75 },
        { x: -64.75, y: -0.75 },
      ],
      color: "#2563eb",
      fillColor: "#60a5fa",
    },
  ];
}
