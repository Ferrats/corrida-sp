import Phaser from 'phaser';
import { Race, WORLD, GATES, formatTime, loadRecord, saveRecord, onRoad } from '../game/race';
import { CENTERLINE, INNER_EDGE, OUTER_EDGE, SECTIONS, offset, TRACK_NAME } from '../game/track';
import type { Controls, Phase } from '../game/race';

export class RaceScene extends Phaser.Scene {
  private race = new Race();
  private car!: Phaser.GameObjects.Image;
  private marker!: Phaser.GameObjects.Graphics;
  private keys!: Record<keyof Controls, Phaser.Input.Keyboard.Key>;
  private arrows!: Phaser.Types.Input.Keyboard.CursorKeys;
  private previousPhase: Phase | null = null;
  private nextGate = -1;
  private record: number | null = null;
  private lastNow = 0;
  private hudAt = 0;
  private abort!: AbortController;
  private ui!: Record<string, HTMLElement>;
  private mapCar!: SVGCircleElement;
  private mapTarget!: SVGCircleElement;

  constructor() { super('race'); }
  create(): void {
    this.race = new Race();
    this.previousPhase = null;
    this.nextGate = -1;
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);
    this.drawTrack();
    this.createCarTexture();
    this.car = this.add.image(this.race.x, this.race.y, 'car').setRotation(this.race.angle).setDepth(10);
    this.marker = this.add.graphics().setDepth(2);
    this.cameras.main.startFollow(this.car, false, 1, 1);
    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Teclado não disponível.');
    this.keys = keyboard.addKeys({ up: 'W', down: 'S', left: 'A', right: 'D', drift: 'SPACE' }) as typeof this.keys;
    this.arrows = keyboard.createCursorKeys();
    this.game.canvas.tabIndex = 0;
    this.game.canvas.setAttribute('aria-label', 'Circuito jogável — WASD ou setas para dirigir');
    this.ui = Object.fromEntries(['panel', 'panel-title', 'panel-copy', 'start', 'resume', 'restart', 'pause', 'recover', 'speed', 'lap', 'clock', 'lap-time', 'checkpoint', 'feedback', 'record', 'countdown', 'results', 'status', 'loading'].map(id => {
      const element = document.getElementById(id);
      if (!element) throw new Error(`Interface ausente: ${id}`);
      return [id, element];
    }));
    try { this.record = loadRecord(window.localStorage); } catch { this.record = null; }
    this.ui.record.textContent = this.record === null ? '—' : formatTime(this.record);
    const map = document.querySelector<SVGSVGElement>('#track-map')!;
    map.setAttribute('viewBox', `0 0 ${WORLD.width} ${WORLD.height}`);
    document.querySelector('#map-path')!.setAttribute('points', [...CENTERLINE, CENTERLINE[0]].map(s => `${s.x},${s.y}`).join(' '));
    this.mapCar = document.querySelector<SVGCircleElement>('#map-car')!;
    this.mapTarget = document.querySelector<SVGCircleElement>('#map-target')!;
    this.abort = new AbortController();
    const options = { signal: this.abort.signal };
    this.ui.start.addEventListener('click', () => this.start(), options);
    this.ui.restart.addEventListener('click', () => this.start(), options);
    this.ui.resume.addEventListener('click', () => this.resume(), options);
    this.ui.pause.addEventListener('click', () => this.pause(), options);
    this.ui.recover.addEventListener('click', () => { this.race.recover(); this.clearKeys(); this.game.canvas.focus(); }, options);
    window.addEventListener('blur', () => this.pause(), options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); }, options);
    window.addEventListener('keydown', event => {
      if (event.repeat) return;
      if (event.code === 'Escape') {
        event.preventDefault();
        if (this.race.phase === 'paused') this.resume(); else this.pause();
      }
      if (event.code === 'KeyR') { this.race.recover(); this.clearKeys(); }
    }, options);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.abort.abort());
    this.lastNow = performance.now();
    this.ui.loading.hidden = true;
    this.syncPanel();
    this.updateHud();
    this.ui.start.focus();
  }
  update(): void {
    const now = performance.now();
    const dt = now - this.lastNow;
    this.lastNow = now;
    this.race.advance(dt, {
      up: this.keys.up.isDown || this.arrows.up.isDown,
      down: this.keys.down.isDown || this.arrows.down.isDown,
      left: this.keys.left.isDown || this.arrows.left.isDown,
      right: this.keys.right.isDown || this.arrows.right.isDown,
      drift: this.keys.drift.isDown,
    });
    const position = this.race.renderPosition;
    this.car.setPosition(position.x, position.y).setRotation(this.race.angle);
    if (this.race.tracker.nextGate !== this.nextGate) this.drawCheckpoint();
    if (this.race.phase !== this.previousPhase) this.syncPanel();
    if (now >= this.hudAt) { this.updateHud(); this.hudAt = now + 50; }
  }
  private clearKeys(): void { this.input.keyboard?.resetKeys(); }
  private start(): void {
    this.clearKeys(); this.race.start(); this.lastNow = performance.now();
    this.nextGate = -1;
    this.syncPanel(); this.updateHud();
    this.game.canvas.focus();
  }
  private pause(): void { this.race.pause(); this.clearKeys(); this.syncPanel(); }
  private resume(): void {
    this.clearKeys(); this.race.resume(); this.lastNow = performance.now(); this.syncPanel(); this.game.canvas.focus();
  }
  private syncPanel(): void {
    const phase = this.race.phase;
    if (phase === this.previousPhase) return;
    this.previousPhase = phase;
    document.getElementById('game-shell')!.dataset.phase = phase;
    this.ui.panel.hidden = phase === 'racing' || phase === 'countdown';
    this.ui.start.hidden = phase !== 'ready';
    this.ui.resume.hidden = phase !== 'paused';
    this.ui.restart.hidden = phase !== 'paused' && phase !== 'finished';
    this.ui.pause.hidden = phase !== 'racing' && phase !== 'countdown';
    this.ui.recover.hidden = phase !== 'racing';
    this.ui.countdown.hidden = phase !== 'countdown';
    this.ui.results.hidden = phase !== 'finished';
    this.ui.status.textContent = { ready: 'Pronto para largar', countdown: 'Preparar para a largada', racing: 'Corrida em andamento', paused: 'Corrida pausada', finished: 'Corrida concluída' }[phase];
    if (phase === 'ready') {
      this.ui['panel-title'].textContent = 'Você contra o relógio.';
      this.ui['panel-copy'].textContent = `${TRACK_NAME}: reta longa, sequência em S e retorno fechado. Complete 3 voltas válidas seguindo os ${GATES.length - 1} portais. Freie antes do S e do retorno. Requer teclado.`;
    } else if (phase === 'paused') {
      this.ui['panel-title'].textContent = 'Uma pausa no percurso.';
      this.ui['panel-copy'].textContent = 'O relógio e o movimento estão congelados. Continue com Esc ou pelo botão abaixo.';
      this.ui.resume.focus();
    } else if (phase === 'finished') {
      const total = this.race.elapsedMs;
      const improved = this.record === null || total < this.record;
      let saved = true;
      if (improved) {
        this.record = total;
        try { saved = saveRecord(window.localStorage, total); } catch { saved = false; }
      }
      this.ui['panel-title'].textContent = improved ? 'Seu novo recorde.' : 'Bandeirada!';
      this.ui['panel-copy'].textContent = `3 voltas válidas em ${formatTime(total)}.${saved ? ' Mais uma tentativa?' : ' Recorde disponível nesta sessão; o navegador bloqueou o salvamento.'}`;
      this.ui.results.replaceChildren(...this.race.tracker.laps.map((ms, i) => {
        const item = document.createElement('li'); item.textContent = `Volta ${i + 1} — ${formatTime(ms)}`; return item;
      }));
      this.ui.record.textContent = formatTime(this.record!);
      this.ui.restart.focus();
    }
  }
  private updateHud(): void {
    const r = this.race;
    this.ui.speed.textContent = String(Math.round(Math.hypot(r.vx, r.vy) * 0.32));
    this.ui.lap.textContent = `${Math.min(r.tracker.laps.length + 1, 3)} / 3`;
    this.ui.clock.textContent = formatTime(r.elapsedMs);
    this.ui['lap-time'].textContent = formatTime(r.phase === 'finished' ? r.tracker.laps[2] : r.elapsedMs - r.tracker.lapStartMs);
    this.ui.checkpoint.textContent = r.tracker.nextGate === GATES.length - 1 ? 'Próximo: chegada' : `Portal ${r.tracker.nextGate + 1}/${GATES.length - 1} · ${GATES[r.tracker.nextGate].name}`;
    this.ui.feedback.textContent = !r.tracker.valid ? (onRoad(r) ? 'Volta inválida · complete o percurso para tentar novamente' : 'Fora da pista: velocidade reduzida · volta inválida') : r.drifting ? 'DRIFT' : 'Siga os portais amarelos • use o mapa para antecipar as curvas';
    this.ui.feedback.classList.toggle('warning', !r.tracker.valid);
    this.ui.countdown.textContent = String(Math.max(1, Math.ceil(r.countdownMs / 1000)));
    this.mapCar.setAttribute('cx', String(r.x));
    this.mapCar.setAttribute('cy', String(r.y));
  }
  private drawCheckpoint(): void {
    this.nextGate = this.race.tracker.nextGate;
    const gate = GATES[this.nextGate];
    this.marker.clear().lineStyle(8, 0xf2c94c, 0.85);
    this.marker.lineBetween(gate.left.x, gate.left.y, gate.right.x, gate.right.y);
    this.mapTarget.setAttribute('cx', String(gate.center.x));
    this.mapTarget.setAttribute('cy', String(gate.center.y));
  }
  private drawTrack(): void {
    const g = this.add.graphics();
    const vectors = (points: { x: number; y: number }[]) => points.map(p => new Phaser.Math.Vector2(p.x, p.y));
    g.fillStyle(0x37653d).fillRect(0, 0, WORLD.width, WORLD.height);
    g.fillStyle(0x24282a).fillPoints(vectors(OUTER_EDGE), true);
    g.fillStyle(0x37653d).fillPoints(vectors(INNER_EDGE), true);
    for (let i = 0; i < CENTERLINE.length; i++) {
      const a = CENTERLINE[i], b = CENTERLINE[(i + 1) % CENTERLINE.length];
      if (!SECTIONS[a.section].kerb) continue;
      // Runoff is outside the road. Red/white curbs stay inside its valid surface.
      const outside = a.dx * b.dy - a.dy * b.dx > 0 ? -1 : 1;
      g.fillStyle(0xa48e65).fillPoints(vectors([
        offset(a, outside * (a.halfWidth + 6)), offset(b, outside * (b.halfWidth + 6)),
        offset(b, outside * (b.halfWidth + 65)), offset(a, outside * (a.halfWidth + 65)),
      ]), true);
      for (const side of [-1, 1]) {
        g.fillStyle(Math.floor(a.distance / 36) % 2 ? 0xe8e3d5 : 0xcc4545).fillPoints(vectors([
          offset(a, side * a.halfWidth), offset(b, side * b.halfWidth),
          offset(b, side * (b.halfWidth - 16)), offset(a, side * (a.halfWidth - 16)),
        ]), true);
      }
    }
    g.lineStyle(3, 0xe8e3d5).strokePoints(vectors(OUTER_EDGE), true).strokePoints(vectors(INNER_EDGE), true);
    const finish = GATES.at(-1)!;
    for (let row = 0; row < 20; row++) for (let col = 0; col < 2; col++) {
      g.fillStyle((row + col) % 2 ? 0x24282a : 0xffffff).fillRect(finish.center.x - 10 + col * 10, finish.center.y - finish.halfWidth + row * finish.halfWidth / 10, 10, finish.halfWidth / 10);
    }
    for (const gate of GATES.slice(0, -1)) {
      this.add.text(gate.center.x, gate.center.y, '↑', { fontSize: '52px', color: '#e8e3d5', fontFamily: 'sans-serif' })
        .setOrigin(0.5).setRotation(Math.atan2(gate.tangent.x, -gate.tangent.y)).setAlpha(0.45);
    }
    // Braking boards use track-relative placement, before the two technical sections.
    for (const [section, label] of [[4, 'S'], [7, 'RETORNO']] as const) {
      const samples = CENTERLINE.filter(s => s.section === section);
      for (const [fraction, number] of [[0.35, 'PREPARE'], [0.72, 'FREIE']] as const) {
        const s = samples[Math.floor(samples.length * fraction)], position = offset(s, -s.halfWidth - 64);
        this.add.text(position.x, position.y, `${number}\n${label}`, { fontFamily: 'system-ui', fontSize: '17px', fontStyle: 'bold', color: '#101712', backgroundColor: '#f2c94c', align: 'center', padding: { x: 7, y: 5 } }).setOrigin(0.5);
      }
    }
    this.add.text(1120, 1160, 'CORRIDA SP', { color: '#dce8d8', fontFamily: 'system-ui, sans-serif', fontSize: '76px', fontStyle: 'bold' }).setOrigin(0.5).setAlpha(0.28);
    this.add.text(1120, 1250, TRACK_NAME.toUpperCase(), { color: '#dce8d8', fontFamily: 'monospace', fontSize: '24px' }).setOrigin(0.5).setAlpha(0.55);
  }
  private createCarTexture(): void {
    if (this.textures.exists('car')) return;
    const g = this.make.graphics({ x: 0, y: 0 });
    g.fillStyle(0xe5484d).fillRoundedRect(5, 2, 34, 62, 8);
    g.fillStyle(0x15191b).fillRoundedRect(9, 17, 26, 23, 5);
    g.fillStyle(0x9ed8ef).fillRoundedRect(12, 19, 20, 9, 3);
    g.fillStyle(0xfff1b8).fillCircle(12, 7, 3).fillCircle(32, 7, 3);
    g.generateTexture('car', 44, 66); g.destroy();
  }
}
