export type Point = { x: number; y: number };
export const WORLD = { width: 3400, height: 2350 };
export const TRACK_NAME = 'Circuito SP 01';
export const TRACK_ID = 'sp01-v1';
type Section = { points: [Point, Point, Point, Point]; widths: [number, number]; kerb?: boolean };
const p = (x: number, y: number): Point => ({ x, y });
const curve = (points: Section['points'], a: number, b = a, kerb = false): Section => ({ points, widths: [a, b], kerb });
const line = (a: Point, b: Point, w: number, end = w): Section => curve([
  a, p(a.x + (b.x - a.x) / 3, a.y + (b.y - a.y) / 3),
  p(a.x + 2 * (b.x - a.x) / 3, a.y + 2 * (b.y - a.y) / 3), b,
], w, end);
// Widths are half-widths in world pixels. Adjacent sections share endpoints,
// tangent directions and widths, so neither the surface nor its outline jumps.
export const SECTIONS: Section[] = [
  line(p(1900, 1950), p(750, 1950), 130),
  curve([p(750, 1950), p(400, 1950), p(380, 1700), p(380, 1350)], 130, 120),
  line(p(380, 1350), p(380, 950), 120, 115),
  curve([p(380, 950), p(380, 620), p(480, 420), p(800, 420)], 115, 110),
  line(p(800, 420), p(1450, 420), 110, 95),
  curve([p(1450, 420), p(1640, 420), p(1630, 720), p(1820, 720)], 95, 90, true),
  curve([p(1820, 720), p(2020, 720), p(2010, 420), p(2200, 420)], 90, 95, true),
  line(p(2200, 420), p(2540, 420), 95),
  curve([p(2540, 420), p(2845, 420), p(2845, 880), p(2540, 880)], 95, 95, true),
  line(p(2540, 880), p(2170, 880), 95, 90),
  curve([p(2170, 880), p(2030, 880), p(1940, 970), p(1940, 1120)], 90, 90, true),
  curve([p(1940, 1120), p(1940, 1280), p(2050, 1390), p(2230, 1390)], 90, 110, true),
  line(p(2230, 1390), p(2670, 1390), 110, 120),
  curve([p(2670, 1390), p(3040, 1390), p(3040, 1950), p(2670, 1950)], 120, 130, true),
  line(p(2670, 1950), p(1900, 1950), 130),
];
export type TrackSample = Point & { dx: number; dy: number; halfWidth: number; section: number; distance: number };
function evaluate(section: Section, t: number): Omit<TrackSample, 'section' | 'distance'> {
  const [a, b, c, d] = section.points, u = 1 - t;
  const dx = 3 * u * u * (b.x - a.x) + 6 * u * t * (c.x - b.x) + 3 * t * t * (d.x - c.x);
  const dy = 3 * u * u * (b.y - a.y) + 6 * u * t * (c.y - b.y) + 3 * t * t * (d.y - c.y);
  const length = Math.hypot(dx, dy);
  return {
    x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
    y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y,
    dx: dx / length, dy: dy / length,
    halfWidth: section.widths[0] + (section.widths[1] - section.widths[0]) * t * t * (3 - 2 * t),
  };
}
export const CENTERLINE: TrackSample[] = [];
for (const [index, section] of SECTIONS.entries()) {
  const points = section.points;
  const controlLength = points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.x - points[i].x, point.y - points[i].y), 0);
  const steps = Math.ceil(controlLength / 12);
  for (let i = 0; i < steps; i++) {
    const sample = evaluate(section, i / steps), last = CENTERLINE.at(-1);
    CENTERLINE.push({ ...sample, section: index, distance: last ? last.distance + Math.hypot(sample.x - last.x, sample.y - last.y) : 0 });
  }
}
export const TRACK_LENGTH = CENTERLINE.at(-1)!.distance + Math.hypot(CENTERLINE.at(-1)!.x - CENTERLINE[0].x, CENTERLINE.at(-1)!.y - CENTERLINE[0].y);
export function offset(sample: TrackSample, amount: number): Point {
  return { x: sample.x - sample.dy * amount, y: sample.y + sample.dx * amount };
}
export const INNER_EDGE = CENTERLINE.map(s => offset(s, s.halfWidth));
export const OUTER_EDGE = CENTERLINE.map(s => offset(s, -s.halfWidth));
export function insidePolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
// These exact polygons also draw the asphalt. Curbs are painted inside them;
// runoff and grass outside them never silently count as valid track surface.
export const onRoad = (point: Point): boolean => insidePolygon(point, OUTER_EDGE) && !insidePolygon(point, INNER_EDGE);
export type Gate = {
  center: Point; tangent: Point; left: Point; right: Point; halfWidth: number;
  spawn: Point & { angle: number }; name: string; sampleIndex: number;
};
function gateAt(index: number, name: string): Gate {
  const s = CENTERLINE[index], recovery = CENTERLINE[(index + 4) % CENTERLINE.length];
  return {
    center: { x: s.x, y: s.y }, tangent: { x: s.dx, y: s.dy },
    left: offset(s, s.halfWidth), right: offset(s, -s.halfWidth), halfWidth: s.halfWidth,
    spawn: { x: recovery.x, y: recovery.y, angle: Math.atan2(recovery.dx, -recovery.dy) }, name, sampleIndex: index,
  };
}
function gateIn(section: number, fraction: number, name: string): Gate {
  const first = CENTERLINE.findIndex(s => s.section === section);
  const count = CENTERLINE.filter(s => s.section === section).length;
  return gateAt(first + Math.floor(fraction * (count - 1)), name);
}
export const GATES: Gate[] = [
  gateIn(0, 0.65, 'Reta principal'), gateIn(2, 0.5, 'Curvão'),
  gateIn(4, 0.7, 'Freada do S'), gateIn(5, 0.9, 'S — entrada'), gateIn(6, 0.9, 'S — saída'),
  gateIn(8, 0.55, 'Retorno'), gateIn(9, 0.6, 'Saída do retorno'),
  gateIn(10, 0.8, 'Miolo'), gateIn(12, 0.7, 'Aceleração'), gateIn(13, 0.55, 'Curva sul'),
  gateAt(0, 'Chegada'),
];
export const START = { x: CENTERLINE[0].x, y: CENTERLINE[0].y, angle: Math.atan2(CENTERLINE[0].dx, -CENTERLINE[0].dy) };
export function crossedGate(a: Point, b: Point, gate: Gate): boolean {
  const before = (a.x - gate.center.x) * gate.tangent.x + (a.y - gate.center.y) * gate.tangent.y;
  const after = (b.x - gate.center.x) * gate.tangent.x + (b.y - gate.center.y) * gate.tangent.y;
  if (before >= 0 || after < 0) return false;
  const t = -before / (after - before);
  const x = a.x + (b.x - a.x) * t - gate.center.x;
  const y = a.y + (b.y - a.y) * t - gate.center.y;
  return Math.abs(-gate.tangent.y * x + gate.tangent.x * y) <= gate.halfWidth;
}
