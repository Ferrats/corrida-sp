// Procedural arcade audio: no downloads, loops with gaps, or per-frame nodes.
export type AudioState = { phase: string; speed: number; vx: number; vy: number; angle: number; drifting: boolean; road: boolean; up: boolean; down: boolean };
const clamp = (n: number, min = 0, max = 1): number => Math.max(min, Math.min(max, n));
export function soundMix(s: AudioState) {
  const active = s.phase === 'racing' || s.phase === 'countdown';
  const speed = Math.hypot(s.vx, s.vy);
  const forward = s.vx * Math.sin(s.angle) - s.vy * Math.cos(s.angle);
  const braking = s.phase === 'racing' && ((s.down && !s.up && forward > 20) || (s.up && !s.down && forward < -20));
  const throttle = s.phase === 'racing' && s.up !== s.down && !braking;
  const lateral = Math.abs(s.vx * Math.cos(s.angle) + s.vy * Math.sin(s.angle));
  const slip = s.drifting && s.road && speed > 70 ? clamp((lateral / Math.max(speed, 1) - 0.07) * 1.6) : 0;
  const load = clamp(speed / 520);
  return {
    active, pitch: 42 + 125 * load + (throttle ? 25 : 0),
    engine: active ? 0.10 + load * 0.055 + (throttle ? 0.045 : 0) : 0,
    exhaust: active ? 0.015 + (throttle ? 0.035 : 0) : 0,
    brake: active && braking && s.road ? 0.12 * clamp(speed / 220) : 0,
    skid: active ? slip * 0.16 : 0,
    squealPitch: 850 + slip * 650 + load * 180,
  };
}
const PREFS_KEY = 'corrida-sp:audio-v1';
export type AudioPreferences = { volume: number; muted: boolean };
export function readAudioPreferences(storage?: Pick<Storage, 'getItem'>): AudioPreferences {
  try {
    const p = JSON.parse(storage?.getItem(PREFS_KEY) ?? 'null');
    if (p && typeof p.volume === 'number' && Number.isFinite(p.volume) && typeof p.muted === 'boolean') return { volume: clamp(p.volume), muted: p.muted };
  } catch { /* Storage is optional. */ }
  return { volume: 0.35, muted: false };
}
export class CarAudio {
  preferences: AudioPreferences;
  unavailable = false;
  private context?: AudioContext;
  private master?: GainNode;
  private engineGain?: GainNode;
  private exhaustGain?: GainNode;
  private brakeGain?: GainNode;
  private skidGain?: GainNode;
  private engine?: OscillatorNode;
  private harmonic?: OscillatorNode;
  private squeal?: OscillatorNode;
  private sources: (OscillatorNode | AudioBufferSourceNode)[] = [];
  private enabled = false;
  private disposed = false;
  constructor(private storage?: Pick<Storage, 'getItem' | 'setItem'>, private createContext = () => new AudioContext()) {
    this.preferences = readAudioPreferences(storage);
  }
  private initialize(): void {
    const c = this.context = this.createContext();
    this.master = c.createGain(); this.master.gain.value = 0;
    const compressor = c.createDynamicsCompressor();
    compressor.threshold.value = -16; compressor.ratio.value = 5;
    this.master.connect(compressor); compressor.connect(c.destination);
    const gain = () => { const g = c.createGain(); g.gain.value = 0; g.connect(this.master!); return g; };
    this.engineGain = gain(); this.exhaustGain = gain(); this.brakeGain = gain(); this.skidGain = gain();
    const engineFilter = c.createBiquadFilter(); engineFilter.type = 'lowpass'; engineFilter.frequency.value = 650; engineFilter.Q.value = 0.7;
    engineFilter.connect(this.engineGain);
    const oscillator = (type: OscillatorType, destination: AudioNode) => {
      const o = c.createOscillator(); o.type = type; o.connect(destination); o.start(); this.sources.push(o); return o;
    };
    this.engine = oscillator('sawtooth', engineFilter);
    this.engine.frequency.value = 42;
    const harmonicGain = c.createGain(); harmonicGain.gain.value = 0.3; harmonicGain.connect(engineFilter);
    this.harmonic = oscillator('triangle', harmonicGain);
    this.harmonic.frequency.value = 84;
    // A reusable two-second noise buffer feeds exhaust, brake friction and tires.
    const buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      brown = (brown + white * 0.08) / 1.04;
      data[i] = clamp(white * 0.7 + brown * 0.9, -1, 1);
    }
    const noise = c.createBufferSource(); noise.buffer = buffer; noise.loop = true;
    for (const [frequency, q, destination] of [[160, 0.7, this.exhaustGain], [1700, 0.9, this.brakeGain], [2600, 1.6, this.skidGain]] as const) {
      const filter = c.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = frequency; filter.Q.value = q;
      noise.connect(filter); filter.connect(destination);
    }
    const squealGain = c.createGain(); squealGain.gain.value = 0.22; squealGain.connect(this.skidGain);
    this.squeal = oscillator('triangle', squealGain);
    noise.start(); this.sources.push(noise);
  }
  // Call only from a user gesture: browsers may otherwise block AudioContext.
  async activate(): Promise<void> {
    if (this.disposed || this.unavailable) return;
    this.enabled = true;
    try {
      if (!this.context) this.initialize();
      await this.context!.resume();
      if (!this.enabled || this.disposed) await this.context!.suspend();
    } catch { this.unavailable = true; this.silence(); }
  }
  setPreferences(change: Partial<AudioPreferences>): void {
    this.preferences = { muted: change.muted ?? this.preferences.muted, volume: Number.isFinite(change.volume) ? clamp(change.volume!) : this.preferences.volume };
    try { this.storage?.setItem(PREFS_KEY, JSON.stringify(this.preferences)); } catch { /* Game works without storage. */ }
    this.set(this.master?.gain, this.enabled && !this.preferences.muted ? this.preferences.volume : 0);
  }
  update(state: AudioState): void {
    const mix = soundMix(state);
    if (!mix.active) { if (this.enabled) this.silence(); return; }
    if (!this.context || !this.enabled || this.unavailable) return;
    this.set(this.master?.gain, this.preferences.muted ? 0 : this.preferences.volume);
    this.set(this.engine?.frequency, mix.pitch);
    this.set(this.harmonic?.frequency, mix.pitch * 2.01);
    this.set(this.squeal?.frequency, mix.squealPitch);
    this.set(this.engineGain?.gain, mix.engine);
    this.set(this.exhaustGain?.gain, mix.exhaust);
    this.set(this.brakeGain?.gain, mix.brake);
    this.set(this.skidGain?.gain, mix.skid);
  }
  private set(param: AudioParam | undefined, value: number): void {
    if (!param || !this.context || this.disposed) return;
    param.setTargetAtTime(value, this.context.currentTime, 0.045);
  }
  silence(): void {
    this.enabled = false;
    if (!this.context) return;
    this.master?.gain.cancelScheduledValues(this.context.currentTime);
    this.master?.gain.setValueAtTime(0, this.context.currentTime);
    void this.context.suspend().catch(() => {});
  }
  dispose(): void {
    if (this.disposed) return;
    this.silence(); this.disposed = true;
    for (const source of this.sources) { source.stop(); source.disconnect(); }
    this.sources = [];
    if (this.context) void this.context.close().catch(() => {});
  }
}
