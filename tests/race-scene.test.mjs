import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Run scene behavior without a GPU; rendering is checked separately in-browser.
class Vector2 {
  constructor(x = 0, y = 0) { this.set(x, y); }
  set(x, y) { this.x = x; this.y = y; return this; }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; return this; }
  scale(n) { this.x *= n; this.y *= n; return this; }
  length() { return Math.hypot(this.x, this.y); }
}
const source = readFileSync(new URL('../src/scenes/RaceScene.ts', import.meta.url), 'utf8');
const code = ts.transpile(source.replace("import Phaser from 'phaser';", '').replace('export class', 'class'), { target: ts.ScriptTarget.ES2022 });
const RaceScene = vm.runInNewContext(code + '\nRaceScene;', {
  window: { devicePixelRatio: 1 },
  Phaser: { Scene: class {}, Math: { Vector2, Clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)), Linear: (a, b, t) => a + (b - a) * t } },
});
function scene() {
  const s = new RaceScene();
  s.keys = Object.fromEntries(['up', 'down', 'left', 'right', 'drift'].map(k => [k, { isDown: false }]));
  s.arrows = Object.fromEntries(['up', 'down', 'left', 'right'].map(k => [k, { isDown: false }]));
  s.car = { rotation: 0, body: { blocked: {} }, setVelocity(x, y) { this.vx = x; this.vy = y; } };
  s.speedLabel = { setText(text) { this.text = text; } };
  s.driftLabel = s.pauseLabel = { setVisible() {} };
  s.input = { keyboard: { resetKeys() { for (const key of [...Object.values(s.keys), ...Object.values(s.arrows)]) key.isDown = false; } } };
  s.physics = { world: { pause() {}, resume() {} } };
  return s;
}
test('opposing throttle inputs coast instead of accelerating', () => {
  const s = scene(); s.speed = 200; s.keys.up.isDown = s.arrows.down.isDown = true;
  s.update(0, 16); assert.ok(s.speed < 200 && s.speed > 0);
});
test('arrows steer and steering reverses in reverse gear', () => {
  const s = scene(); s.arrows.right.isDown = true; s.speed = 100;
  s.update(0, 16); assert.ok(s.car.rotation > 0);
  s.car.rotation = 0; s.speed = -100; s.update(0, 16); assert.ok(s.car.rotation < 0);
});
test('boundary contact clears outward momentum', () => {
  const s = scene(); s.velocity.set(-300, 0); s.speed = 300; s.car.body.blocked.left = true;
  s.update(0, 16); assert.equal(s.car.vx, 0); assert.equal(s.speed, 0);
});
test('pause clears held keys and movement until an explicit resume', () => {
  const s = scene(); s.keys.up.isDown = true; s.speed = 300; s.velocity.set(0, -300);
  s.pauseGame(); s.update(0, 1000);
  assert.equal(s.speed, 0); assert.equal(s.car.vy, 0); assert.equal(s.keys.up.isDown, false);
  s.togglePause({ repeat: true }); assert.equal(s.paused, true);
  s.togglePause(); assert.equal(s.paused, false);
});
test('acceleration reaches the same speed at 30, 60 and 144 fps', () => {
  for (const fps of [30, 60, 144]) {
    const s = scene(); s.keys.up.isDown = true;
    for (let i = 0; i < fps; i++) s.update(0, 1000 / fps);
    assert.ok(Math.abs(s.speed - 430) < 0.001);
  }
});
