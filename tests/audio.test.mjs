import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const code = ts.transpile(readFileSync(new URL('../src/game/audio.ts', import.meta.url), 'utf8'), { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 });
const { soundMix, readAudioPreferences, CarAudio } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const base = { phase: 'racing', speed: 200, vx: 0, vy: -200, angle: 0, drifting: false, road: true, up: false, down: false };
test('engine pitch follows speed and throttle raises load', () => {
  assert.ok(soundMix({ ...base, vy: -450 }).pitch > soundMix(base).pitch);
  assert.ok(soundMix({ ...base, up: true }).engine > soundMix(base).engine);
  assert.ok(soundMix({ ...base, up: true }).pitch > soundMix(base).pitch);
});
test('friction plays when slowing forward or reverse motion, not when engaging reverse at rest', () => {
  assert.ok(soundMix({ ...base, down: true }).brake > 0);
  assert.ok(soundMix({ ...base, vy: 200, up: true }).brake > 0);
  assert.equal(soundMix({ ...base, vy: 0, down: true }).brake, 0);
  assert.equal(soundMix({ ...base, down: true, road: false }).brake, 0);
  assert.equal(soundMix({ ...base, down: true, up: true }).brake, 0);
});
test('drift squeal requires actual lateral slip on asphalt', () => {
  assert.equal(soundMix({ ...base, drifting: true }).skid, 0);
  assert.ok(soundMix({ ...base, drifting: true, vx: 150 }).skid > 0);
  assert.equal(soundMix({ ...base, drifting: true, vx: 150, road: false }).skid, 0);
  assert.equal(soundMix({ ...base, drifting: true, vx: 20, vy: -20 }).skid, 0);
});
test('ready, paused and finished phases have no sound', () => {
  for (const phase of ['ready', 'paused', 'finished']) {
    const m = soundMix({ ...base, phase, drifting: true, vx: 150, down: true });
    assert.equal(m.active, false); assert.equal(m.engine + m.exhaust + m.brake + m.skid, 0);
  }
});
test('preferences tolerate corrupt, missing, and blocked storage', () => {
  for (const s of [undefined, { getItem: () => '{' }, { getItem: () => '{"volume":"100","muted":false}' }, { getItem() { throw Error(); } }]) assert.deepEqual(readAudioPreferences(s), { volume: 0.35, muted: false });
  assert.deepEqual(readAudioPreferences({ getItem: () => '{"volume":5,"muted":true}' }), { volume: 1, muted: true });
});
function fakeContext() {
  const nodes = []; const param = () => ({ value: 0, setTargetAtTime(v) { this.value = v; }, setValueAtTime(v) { this.value = v; }, cancelScheduledValues() {} });
  const node = () => { const n = { gain: param(), frequency: param(), Q: param(), threshold: param(), ratio: param(), connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; } }; nodes.push(n); return n; };
  return { nodes, currentTime: 0, sampleRate: 8000, state: 'suspended', destination: {}, createGain: node, createDynamicsCompressor: node, createOscillator: node, createBiquadFilter: node, createBufferSource: node,
    createBuffer: (_, n) => ({ getChannelData: () => new Float32Array(n) }),
    async resume() { this.state = 'running'; }, async suspend() { this.state = 'suspended'; }, async close() { this.state = 'closed'; } };
}
test('one lazy context and fixed nodes across many updates and restarts', async () => {
  const c = fakeContext(); let created = 0;
  const a = new CarAudio(undefined, () => { created++; return c; });
  a.update(base); assert.equal(created, 0);
  await a.activate(); const count = c.nodes.length;
  for (let i = 0; i < 2000; i++) a.update(base);
  assert.equal(c.nodes.length, count);
  a.silence(); assert.equal(c.state, 'suspended'); assert.equal(c.nodes[0].gain.value, 0);
  await a.activate(); assert.equal(created, 1); assert.equal(c.state, 'running');
  a.dispose(); a.dispose(); assert.equal(c.state, 'closed');
  assert.ok(c.nodes.filter(n => n.started).every(n => n.stopped));
});
test('mute and volume update the master without altering the physics', async () => {
  const c = fakeContext(); let saved;
  const a = new CarAudio({ getItem: () => null, setItem: (_, v) => { saved = JSON.parse(v); } }, () => c);
  await a.activate(); a.update(base);
  a.setPreferences({ muted: true }); assert.equal(c.nodes[0].gain.value, 0);
  a.setPreferences({ muted: false, volume: 0.6 }); assert.equal(c.nodes[0].gain.value, 0.6);
  assert.deepEqual(saved, { muted: false, volume: 0.6 });
  a.setPreferences({ volume: 0 }); assert.equal(c.nodes[0].gain.value, 0);
  a.dispose();
});
test('a late resume cannot turn audio on after focus loss', async () => {
  const c = fakeContext(); let resolve;
  c.resume = () => new Promise(r => { resolve = () => { c.state = 'running'; r(); }; });
  const a = new CarAudio(undefined, () => c); const pending = a.activate();
  a.silence(); resolve(); await pending;
  assert.equal(c.state, 'suspended'); assert.equal(c.nodes[0].gain.value, 0); a.dispose();
});
test('unsupported or rejected audio does not reject into the game', async () => {
  const missing = new CarAudio(undefined, () => { throw Error('unsupported'); }); await missing.activate(); assert.equal(missing.unavailable, true);
  const c = fakeContext(); c.resume = async () => { throw Error('blocked'); };
  const rejected = new CarAudio(undefined, () => c); await rejected.activate(); assert.equal(rejected.unavailable, true); assert.equal(c.nodes[0].gain.value, 0); rejected.dispose();
});
