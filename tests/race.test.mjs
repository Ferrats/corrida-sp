import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Test the actual browser-independent production model, without a Phaser mock.
const toURL = source => `data:text/javascript;base64,${Buffer.from(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })).toString('base64')}`;
const trackURL = toURL(readFileSync(new URL('../src/game/track.ts', import.meta.url), 'utf8'));
const track = await import(trackURL);
const source = readFileSync(new URL('../src/game/race.ts', import.meta.url), 'utf8').replaceAll("'./track'", JSON.stringify(trackURL));
const { Race, LapTracker, START, GATES, IDLE, onRoad, crossedGate, formatTime, loadRecord, saveRecord, RECORD_KEY } = await import(toURL(source));
const { CENTERLINE, INNER_EDGE, OUTER_EDGE, TRACK_ID, offset } = track;
const throttle = { ...IDLE, up: true };
function racing() { const r = new Race(); r.start(); r.advance(3000, IDLE); return r; }
function path() { return [...CENTERLINE, CENTERLINE[0]]; }
function gateCross(gate, lateral = 0) {
  const x = gate.center.x - gate.tangent.y * lateral;
  const y = gate.center.y + gate.tangent.x * lateral;
  return [{ x: x - gate.tangent.x * 10, y: y - gate.tangent.y * 10 }, { x: x + gate.tangent.x * 10, y: y + gate.tangent.y * 10 }];
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
  assert.equal(onRoad({ x: 3200, y: 2200 }), false);
});
test('all checkpoint recovery locations are on asphalt', () => {
  for (const g of GATES) assert.equal(onRoad(g.spawn), true);
});
test('track boundaries have no self intersections or crossing edges', () => {
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const intersects = (a, b, c, d) => cross(a, b, c) * cross(a, b, d) < -1e-6 && cross(c, d, a) * cross(c, d, b) < -1e-6;
  for (const polygon of [INNER_EDGE, OUTER_EDGE]) {
    for (let i = 0; i < polygon.length; i++) for (let j = i + 2; j < polygon.length; j++) {
      if (i === 0 && j === polygon.length - 1) continue;
      assert.equal(intersects(polygon[i], polygon[(i + 1) % polygon.length], polygon[j], polygon[(j + 1) % polygon.length]), false);
    }
  }
  for (let i = 0; i < INNER_EDGE.length; i++) for (let j = 0; j < OUTER_EDGE.length; j++) {
    assert.equal(intersects(INNER_EDGE[i], INNER_EDGE[(i + 1) % INNER_EDGE.length], OUTER_EDGE[j], OUTER_EDGE[(j + 1) % OUTER_EDGE.length]), false);
  }
});
test('road width and runoff classification agree along the whole circuit', () => {
  for (let i = 0; i < CENTERLINE.length; i += 5) {
    const sample = CENTERLINE[i];
    for (const side of [-1, 1]) {
      assert.equal(onRoad(offset(sample, side * sample.halfWidth * 0.9)), true, `road ${i}`);
      assert.equal(onRoad(offset(sample, side * (sample.halfWidth + 25))), false, `runoff ${i}`);
    }
  }
});
test('each portal accepts a forward crossing and rejects a reverse crossing', () => {
  for (const gate of GATES) {
    const [a, b] = gateCross(gate);
    assert.equal(crossedGate(a, b, gate), true);
    assert.equal(crossedGate(b, a, gate), false);
  }
});
test('street rules keep records separate from the oval and previous circuit rules', () => {
  assert.ok(RECORD_KEY.includes(TRACK_ID));
  assert.notEqual(RECORD_KEY, 'corrida-sp:oval-v1:three-laps');
  const previousKey = `corrida-sp:${TRACK_ID}:three-laps`;
  assert.notEqual(RECORD_KEY, previousKey);
  assert.equal(loadRecord({ getItem: key => key === previousKey ? '1234' : null }), null);
  assert.equal(loadRecord({ getItem: key => key === 'corrida-sp:oval-v1:three-laps' ? '1234' : null }), null);
});
test('gates enforce direction, range, and crossing rather than overlap', () => {
  const g = GATES[3], [a, b] = gateCross(g);
  assert.equal(crossedGate(a, b, g), true);
  assert.equal(crossedGate(b, a, g), false);
  assert.equal(crossedGate(a, a, g), false);
  assert.equal(crossedGate(...gateCross(g, g.halfWidth + 30), g), false);
});
test('finish without checkpoints cannot award a lap', () => {
  const t = new LapTracker();
  t.update(...gateCross(GATES.at(-1)), 1000);
  assert.equal(t.laps.length, 0); assert.equal(t.nextGate, 0);
});
test('three ordered full laps finish, and later crossings do not add laps', () => {
  const t = new LapTracker(); let now = 0;
  for (let i = 0; i < 3; i++) now = completeLap(t, now);
  assert.equal(t.finished, true); assert.equal(t.laps.length, 3);
  assert.ok(t.laps.every(ms => ms > 0));
  completeLap(t, now); assert.equal(t.laps.length, 3);
});
test('off-road excursions preserve each lap and all elapsed time across three laps', () => {
  const t = new LapTracker(); let now = 0;
  for (let lap = 0; lap < 3; lap++) {
    t.update(START, { x: 1200, y: 800 }, now + 100);
    assert.equal(t.nextGate, 0);
    now = completeLap(t, now + 5000);
    assert.equal(t.laps.length, lap + 1);
  }
  assert.equal(t.finished, true);
  assert.equal(t.laps.reduce((sum, ms) => sum + ms, 0), now);
});
test('off-road shortcuts cannot skip a required portal', () => {
  const t = new LapTracker();
  t.update(...gateCross(GATES[0]), 100);
  t.update(GATES[0].spawn, { x: 1200, y: 800 }, 200);
  t.update(...gateCross(GATES[2]), 300);
  t.update(...gateCross(GATES.at(-1)), 400);
  assert.equal(t.nextGate, 1);
  assert.equal(t.laps.length, 0);
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
  assert.ok(r.speed <= 151); assert.equal(r.drifting, false);
});
test('world boundaries keep position and clear outward velocity', () => {
  const r = racing(); r.x = 24; r.vx = -300; r.speed = 300;
  r.advance(20, IDLE); assert.equal(r.x, 24); assert.equal(r.vx, 0); assert.equal(r.speed, 0);
});
test('recovery keeps time and checkpoint progress and the current lap can finish', () => {
  const r = racing(); r.tracker.nextGate = 2; r.tracker.recovery = GATES[1].spawn; r.elapsedMs = 9000;
  r.recover(); assert.equal(r.x, GATES[1].spawn.x); assert.equal(r.speed, 0);
  assert.equal(r.tracker.nextGate, 2); assert.equal(r.elapsedMs, 9000);
  const points = path();
  for (let i = GATES[1].sampleIndex + 5; i < points.length; i++) {
    r.tracker.update(points[i - 1], points[i], 9000 + i * 20);
  }
  assert.equal(r.tracker.laps.length, 1);
  assert.ok(r.tracker.laps[0] > 9000);
});
test('restart resets all session state', () => {
  const r = racing(); r.advance(200, throttle); r.pause(); r.start();
  assert.equal(r.phase, 'countdown'); assert.equal(r.countdownMs, 3000); assert.equal(r.elapsedMs, 0);
  assert.equal(r.x, START.x); assert.equal(r.speed, 0);
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
test('production physics can drive three clean laps with throttle, steering and braking', () => {
  const r = racing(); const points = path(); let target = 1;
  for (let frame = 0; frame < 180 * 60 && r.phase === 'racing'; frame++) {
    while (Math.hypot(points[target].x - r.x, points[target].y - r.y) < 85) target = (target + 1) % points.length;
    const desired = Math.atan2(points[target].x - r.x, -(points[target].y - r.y));
    const error = Math.atan2(Math.sin(desired - r.angle), Math.cos(desired - r.angle));
    const section = points[(target + 14) % points.length].section;
    const desiredSpeed = [500, 320, 400, 300, 340, 210, 210, 300, 230, 280, 220, 260, 380, 290, 500][section];
    r.advance(1000 / 60, { ...IDLE, up: r.speed < desiredSpeed, down: r.speed > desiredSpeed + 12, left: error < -0.025, right: error > 0.025 });
  }
  assert.equal(r.phase, 'finished', `laps=${r.tracker.laps.length}, gate=${r.tracker.nextGate}`);
  assert.equal(r.tracker.laps.length, 3);
  const time = r.elapsedMs; r.advance(5000, throttle); assert.equal(r.elapsedMs, time);
});
