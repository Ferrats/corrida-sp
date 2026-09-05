export const WORLD = { width: 2400, height: 1600 };
export const OUTER = { x: 250, y: 180, width: 1900, height: 1240, radius: 360 };
export const INNER = { x: 610, y: 520, width: 1180, height: 560, radius: 230 };
export type Point = { x: number; y: number };
type RoundedRect = typeof OUTER;
export function inRoundedRect(p: Point, r: RoundedRect): boolean {
  if (p.x < r.x || p.y < r.y || p.x > r.x + r.width || p.y > r.y + r.height) return false;
  const cx = Math.max(r.x + r.radius, Math.min(r.x + r.width - r.radius, p.x));
  const cy = Math.max(r.y + r.radius, Math.min(r.y + r.height - r.radius, p.y));
  return (p.x - cx) ** 2 + (p.y - cy) ** 2 <= r.radius ** 2;
}
export const onRoad = (p: Point): boolean => inRoundedRect(p, OUTER) && !inRoundedRect(p, INNER);
export type Gate = { axis: 'x' | 'y'; value: number; min: number; max: number; direction: 1 | -1; spawn: Point & { angle: number } };
// Clockwise from the bottom straight, with directional segment crossings.
export const GATES: Gate[] = [
  { axis: 'x', value: 800, min: 1080, max: 1420, direction: -1, spawn: { x: 760, y: 1250, angle: -Math.PI / 2 } },
  { axis: 'y', value: 800, min: 250, max: 610, direction: -1, spawn: { x: 430, y: 760, angle: 0 } },
  { axis: 'x', value: 1200, min: 180, max: 520, direction: 1, spawn: { x: 1240, y: 350, angle: Math.PI / 2 } },
  { axis: 'y', value: 800, min: 1790, max: 2150, direction: 1, spawn: { x: 1970, y: 840, angle: Math.PI } },
  { axis: 'x', value: 1200, min: 1080, max: 1420, direction: -1, spawn: { x: 1160, y: 1250, angle: -Math.PI / 2 } },
];
export const START = { x: 1200, y: 1250, angle: -Math.PI / 2 };
export function crossedGate(a: Point, b: Point, g: Gate): boolean {
  const before = (a[g.axis] - g.value) * g.direction;
  const after = (b[g.axis] - g.value) * g.direction;
  if (before >= 0 || after < 0) return false;
  const t = (g.value - a[g.axis]) / (b[g.axis] - a[g.axis]);
  const other = g.axis === 'x' ? 'y' : 'x';
  const cross = a[other] + (b[other] - a[other]) * t;
  return cross >= g.min && cross <= g.max;
}

export class LapTracker {
  nextGate = 0;
  valid = true;
  laps: number[] = [];
  lapStartMs = 0;
  recovery = { ...START };
  update(a: Point, b: Point, timeMs: number): void {
    if (this.finished) return;
    // Called each physics step, not just at checkpoints: shortcuts invalidate a lap.
    if (!onRoad(a) || !onRoad(b)) this.valid = false;
    if (!crossedGate(a, b, GATES[this.nextGate])) return;
    this.recovery = { ...GATES[this.nextGate].spawn };
    this.nextGate++;
    if (this.nextGate === GATES.length) {
      if (this.valid) this.laps.push(timeMs - this.lapStartMs);
      this.lapStartMs = timeMs;
      this.valid = true;
      this.nextGate = 0;
    }
  }
  get finished(): boolean { return this.laps.length === 3; }
}
export type Controls = { up: boolean; down: boolean; left: boolean; right: boolean; drift: boolean };
export const IDLE: Controls = { up: false, down: false, left: false, right: false, drift: false };
export type Phase = 'ready' | 'countdown' | 'racing' | 'paused' | 'finished';
const STEP = 1 / 120;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export class Race {
  phase: Phase = 'ready';
  resumePhase: 'countdown' | 'racing' = 'racing';
  countdownMs = 3000;
  elapsedMs = 0;
  accumulator = 0;
  x = START.x;
  y = START.y;
  previous = { x: START.x, y: START.y };
  angle = START.angle;
  speed = 0;
  vx = 0;
  vy = 0;
  drifting = false;
  tracker = new LapTracker();
  start(): void {
    Object.assign(this, new Race());
    this.phase = 'countdown';
  }
  pause(): void {
    if (this.phase !== 'racing' && this.phase !== 'countdown') return;
    this.resumePhase = this.phase;
    this.phase = 'paused';
  }
  resume(): void { if (this.phase === 'paused') this.phase = this.resumePhase; }
  recover(): void {
    if (this.phase !== 'racing') return;
    const spawn = this.tracker.recovery;
    this.x = spawn.x; this.y = spawn.y; this.angle = spawn.angle;
    this.previous = { x: this.x, y: this.y };
    this.speed = this.vx = this.vy = 0;
    this.drifting = false;
    this.tracker.valid = false;
    this.accumulator = 0;
  }
  advance(deltaMs: number, input: Controls): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    if (this.phase === 'countdown') {
      this.countdownMs = Math.max(0, this.countdownMs - deltaMs);
      if (this.countdownMs === 0) this.phase = 'racing';
      return;
    }
    if (this.phase !== 'racing') return;
    // Bound catch-up work after a stall, but never discard that time from the clock.
    const simulatedMs = Math.min(deltaMs, 250);
    this.elapsedMs += deltaMs - simulatedMs;
    this.accumulator += simulatedMs / 1000;
    while (this.accumulator + 1e-10 >= STEP && this.phase === 'racing') {
      this.elapsedMs += STEP * 1000;
      this.step(STEP, input);
      this.accumulator = Math.max(0, this.accumulator - STEP);
    }
  }
  private step(dt: number, input: Controls): void {
    this.previous.x = this.x; this.previous.y = this.y;
    const road = onRoad(this);
    const maxSpeed = road ? 520 : 150;
    if (input.up !== input.down) {
      const force = input.up ? (this.speed < 0 ? 620 : 430) : -(this.speed > 0 ? 620 : 301);
      // Do not let held throttle counteract the off-road slowdown.
      if (Math.sign(force) !== Math.sign(this.speed) || Math.abs(this.speed) < maxSpeed) {
        this.speed = clamp(this.speed + force * dt, -180, 520);
      }
    } else {
      this.speed = Math.sign(this.speed) * Math.max(0, Math.abs(this.speed) - 170 * dt);
    }
    if (Math.abs(this.speed) > maxSpeed) {
      this.speed = Math.sign(this.speed) * Math.max(maxSpeed, Math.abs(this.speed) - 850 * dt);
    }
    this.drifting = road && input.drift && Math.abs(this.speed) > 90;
    if (Math.abs(this.speed) >= 8) {
      const turn = (2.4 - 0.95 * Math.min(Math.abs(this.speed) / 520, 1)) * (this.drifting ? 1.32 : 1);
      this.angle += (Number(input.right) - Number(input.left)) * turn * Math.sign(this.speed) * dt;
    }
    const blend = 1 - Math.exp(-(road ? (this.drifting ? 1.7 : 8.5) : 4) * dt);
    this.vx += (Math.sin(this.angle) * this.speed - this.vx) * blend;
    this.vy += (-Math.cos(this.angle) * this.speed - this.vy) * blend;
    if (this.speed === 0) { this.vx *= Math.exp(-1.7 * dt); this.vy *= Math.exp(-1.7 * dt); }
    const nx = this.x + this.vx * dt, ny = this.y + this.vy * dt;
    this.x = clamp(nx, 24, WORLD.width - 24);
    this.y = clamp(ny, 24, WORLD.height - 24);
    if (this.x !== nx) { this.vx = 0; this.speed = 0; }
    if (this.y !== ny) { this.vy = 0; this.speed = 0; }
    this.tracker.update(this.previous, this, this.elapsedMs);
    if (this.tracker.finished) { this.phase = 'finished'; this.drifting = false; }
  }
  get renderPosition(): Point {
    const t = clamp(this.accumulator / STEP, 0, 1);
    return { x: this.previous.x + (this.x - this.previous.x) * t, y: this.previous.y + (this.y - this.previous.y) * t };
  }
}
export function formatTime(ms: number): string {
  const value = Math.max(0, Math.floor(ms));
  return `${Math.floor(value / 60000)}:${String(Math.floor(value / 1000) % 60).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`;
}
export const RECORD_KEY = 'corrida-sp:oval-v1:three-laps';
export function loadRecord(storage: Pick<Storage, 'getItem'>): number | null {
  try {
    const raw = storage.getItem(RECORD_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch { return null; }
}
export function saveRecord(storage: Pick<Storage, 'setItem'>, ms: number): boolean {
  if (!Number.isFinite(ms) || ms <= 0) return false;
  try { storage.setItem(RECORD_KEY, String(ms)); return true; } catch { return false; }
}
