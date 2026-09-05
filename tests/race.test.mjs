import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Test the actual browser-independent production model, without a Phaser mock.
const source = readFileSync(new URL('../src/game/race.ts', import.meta.url), 'utf8');
const code = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
const { Race, LapTracker, START, GATES, IDLE, onRoad, crossedGate, formatTime, loadRecord, saveRecord } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const throttle = { ...IDLE, up: true };
function racing() { const r = new Race(); r.start(); r.advance(3000, IDLE); return r; }
function path() {
  const points = [{ x: 1160, y: 1250 }];
  const line = (x, y) => {
    const a = points.at(-1), n = Math.ceil(Math.hypot(x - a.x, y - a.y) / 10);
    for (let i = 1; i <= n; i++) points.push({ x: a.x + (x - a.x) * i / n, y: a.y + (y - a.y) * i / n });
  };
  const arc = (cx, cy, from, to) => {
    for (let i = 1; i <= 50; i++) { const t = from + (to - from) * i / 50; points.push({ x: cx + 290 * Math.cos(t), y: cy + 290 * Math.sin(t) }); }
  };
  line(720, 1250); arc(720, 960, Math.PI / 2, Math.PI);
  line(430, 640); arc(720, 640, Math.PI, 1.5 * Math.PI);
  line(1680, 350); arc(1680, 640, 1.5 * Math.PI, 2 * Math.PI);
  line(1970, 960); arc(1680, 960, 0, Math.PI / 2);
  line(1160, 1250);
  return points;
}
function completeLap(tracker, startTime = 0) {
  const points = path();
  for (let i = 1; i < points.length; i++) tracker.update(points[i - 1], points[i], startTime + i * 20);
  return startTime + (points.length - 1) * 20;
}
test('spawn and the entire centerline lie on asphalt', () => {
  assert.equal(onRoad(START), true);
  for (const p of path()) assert.equal(onRoad(p), true, JSON.stringify(p));
  assert.equal(onRoad({ x: 1200, y: 800 }), false);
  assert.equal(onRoad({ x: 250, y: 180 }), false);
  assert.equal(onRoad({ x: 2300, y: 800 }), false);
});
test('all checkpoint recovery locations are on asphalt', () => {
  for (const g of GATES) assert.equal(onRoad(g.spawn), true);
});
test('gates enforce direction, range, and crossing rather than overlap', () => {
  const g = GATES[0], a = { x: 810, y: 1250 }, b = { x: 790, y: 1250 };
  assert.equal(crossedGate(a, b, g), true);
  assert.equal(crossedGate(b, a, g), false);
  assert.equal(crossedGate(a, a, g), false);
  assert.equal(crossedGate({ x: 810, y: 900 }, { x: 790, y: 900 }, g), false);
});
test('finish without checkpoints cannot award a lap', () => {
  const t = new LapTracker();
  t.update({ x: 1210, y: 1250 }, { x: 1190, y: 1250 }, 1000);
  assert.equal(t.laps.length, 0); assert.equal(t.nextGate, 0);
});
test('three ordered full laps finish, and later crossings do not add laps', () => {
  const t = new LapTracker(); let now = 0;
  for (let i = 0; i < 3; i++) now = completeLap(t, now);
  assert.equal(t.finished, true); assert.equal(t.laps.length, 3);
  assert.ok(t.laps.every(ms => ms > 0));
  completeLap(t, now); assert.equal(t.laps.length, 3);
});
test('grass invalidates the attempt; completing the route rearms a clean lap', () => {
  const t = new LapTracker();
  t.update(START, { x: 1200, y: 800 }, 100);
  assert.equal(t.valid, false);
  const now = completeLap(t, 100);
  assert.equal(t.laps.length, 0); assert.equal(t.valid, true);
  completeLap(t, now); assert.equal(t.laps.length, 1);
});
test('countdown locks motion and pause freezes the countdown', () => {
  const r = new Race(); r.start(); r.advance(1000, throttle);
  assert.equal(r.x, START.x); assert.equal(r.elapsedMs, 0);
  r.pause(); r.advance(9000, throttle); assert.equal(r.countdownMs, 2000);
  r.resume(); r.advance(2000, throttle); assert.equal(r.phase, 'racing');
});
test('pause preserves velocity, position, and time; resume continues them', () => {
  const r = racing(); for (let i = 0; i < 20; i++) r.advance(16, throttle);
  const saved = [r.x, r.y, r.speed, r.vx, r.vy, r.elapsedMs];
  r.pause(); r.pause(); r.advance(30000, IDLE);
  assert.deepEqual([r.x, r.y, r.speed, r.vx, r.vy, r.elapsedMs], saved);
  r.resume(); r.advance(16, IDLE); assert.ok(r.elapsedMs > saved[5]); assert.ok(r.x < saved[0]);
});
test('motion including steering is consistent at 30, 60 and 144 fps', () => {
  const values = [];
  for (const fps of [30, 60, 144]) {
    const r = racing();
    for (let i = 0; i < fps; i++) r.advance(1000 / fps, { ...throttle, right: true });
    values.push([r.x, r.y, r.angle, r.vx, r.vy, r.elapsedMs]);
  }
  for (const v of values.slice(1)) v.forEach((n, i) => assert.ok(Math.abs(n - values[0][i]) < 1e-6));
});
test('opposite inputs coast and reverse steering reverses', () => {
  const r = racing(); r.speed = 100; r.advance(20, { ...throttle, down: true }); assert.ok(r.speed < 100);
  r.speed = -100; const angle = r.angle; r.advance(20, { ...IDLE, right: true }); assert.ok(r.angle < angle);
});
test('grass reduces speed and disables drift', () => {
  const r = racing(); r.x = 1200; r.y = 800; r.speed = 520; r.angle = 0;
  for (let i = 0; i < 30; i++) r.advance(1000 / 60, { ...throttle, drift: true });
  assert.ok(r.speed <= 151); assert.equal(r.drifting, false); assert.equal(r.tracker.valid, false);
});
test('world boundaries keep position and clear outward velocity', () => {
  const r = racing(); r.x = 24; r.vx = -300; r.speed = 300;
  r.advance(20, IDLE); assert.equal(r.x, 24); assert.equal(r.vx, 0); assert.equal(r.speed, 0);
});
test('recovery keeps time and checkpoint progress but invalidates lap', () => {
  const r = racing(); r.tracker.nextGate = 2; r.tracker.recovery = GATES[1].spawn; r.elapsedMs = 9000;
  r.recover(); assert.equal(r.x, GATES[1].spawn.x); assert.equal(r.speed, 0);
  assert.equal(r.tracker.nextGate, 2); assert.equal(r.tracker.valid, false); assert.equal(r.elapsedMs, 9000);
});
test('restart resets all session state', () => {
  const r = racing(); r.advance(200, throttle); r.tracker.valid = false; r.pause(); r.start();
  assert.equal(r.phase, 'countdown'); assert.equal(r.countdownMs, 3000); assert.equal(r.elapsedMs, 0);
  assert.equal(r.x, START.x); assert.equal(r.speed, 0); assert.equal(r.tracker.valid, true);
});
test('long frame counts elapsed time but limits physics catch-up', () => {
  const r = racing(); r.advance(5000, throttle);
  assert.ok(Math.abs(r.elapsedMs - 5000) < 0.001); assert.ok(START.x - r.x < 30);
  r.advance(NaN, IDLE); assert.ok(Number.isFinite(r.x));
});
test('record storage rejects invalid values and gracefully handles blocked storage', () => {
  for (const value of [null, '', 'NaN', '-1', 'Infinity', '0']) assert.equal(loadRecord({ getItem: () => value }), null);
  assert.equal(loadRecord({ getItem: () => '12345' }), 12345);
  assert.equal(loadRecord({ getItem() { throw Error('blocked'); } }), null);
  assert.equal(saveRecord({ setItem() { throw Error('blocked'); } }, 1234), false);
  assert.equal(saveRecord({ setItem() {} }, NaN), false);
  let stored; assert.equal(saveRecord({ setItem(k, v) { stored = v; } }, 1234), true); assert.equal(stored, '1234');
});
test('time formatting includes minutes and milliseconds', () => {
  assert.equal(formatTime(61005), '1:01.005'); assert.equal(formatTime(0), '0:00.000');
});
test('production physics can drive three clean laps using steering and throttle only', () => {
  const r = racing(); const points = path(); let target = 1;
  for (let frame = 0; frame < 180 * 60 && r.phase === 'racing'; frame++) {
    while (Math.hypot(points[target].x - r.x, points[target].y - r.y) < 85) target = (target + 1) % points.length;
    const desired = Math.atan2(points[target].x - r.x, -(points[target].y - r.y));
    const error = Math.atan2(Math.sin(desired - r.angle), Math.cos(desired - r.angle));
    r.advance(1000 / 60, { ...IDLE, up: r.speed < 290, left: error < -0.025, right: error > 0.025 });
  }
  assert.equal(r.phase, 'finished', `laps=${r.tracker.laps.length}, gate=${r.tracker.nextGate}, valid=${r.tracker.valid}`);
  assert.equal(r.tracker.laps.length, 3);
  const time = r.elapsedMs; r.advance(5000, throttle); assert.equal(r.elapsedMs, time);
});
