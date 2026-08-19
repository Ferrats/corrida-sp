import Phaser from 'phaser';

const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 2200;
const LAPS_TO_FINISH = 3;
const MAX_FORWARD_SPEED = 520;
const MAX_REVERSE_SPEED = 180;
const ACCELERATION = 430;
const BRAKING = 620;
const COASTING = 170;
const GRIP = 8.5;
const DRIFT_GRIP = 1.7;
const HUD_RESOLUTION = Math.min(window.devicePixelRatio, 2);
const BARRIER_MARGIN = 34;

type TrackPoint = { x: number; y: number; width: number };
type TrackContact = { distance: number; roadHalfWidth: number };

const TRACK_CONTROLS: TrackPoint[] = [
  { x: 2360, y: 1740, width: 270 },
  { x: 2390, y: 1320, width: 270 },
  { x: 2400, y: 820, width: 260 },
  { x: 2320, y: 430, width: 245 },
  { x: 2050, y: 250, width: 225 },
  { x: 1680, y: 300, width: 215 },
  { x: 1430, y: 500, width: 205 },
  { x: 1490, y: 760, width: 215 },
  { x: 1780, y: 860, width: 245 },
  { x: 2130, y: 920, width: 255 },
  { x: 2280, y: 1140, width: 220 },
  { x: 2140, y: 1380, width: 210 },
  { x: 1810, y: 1480, width: 230 },
  { x: 1510, y: 1320, width: 210 },
  { x: 1210, y: 1130, width: 205 },
  { x: 900, y: 1210, width: 215 },
  { x: 760, y: 1510, width: 200 },
  { x: 900, y: 1810, width: 220 },
  { x: 1230, y: 1940, width: 250 },
  { x: 1530, y: 1810, width: 210 },
  { x: 1680, y: 1530, width: 205 },
  { x: 1870, y: 1350, width: 220 },
  { x: 2070, y: 1510, width: 245 },
  { x: 2260, y: 1680, width: 270 },
];

export class RaceScene extends Phaser.Scene {
  private car!: Phaser.Physics.Arcade.Image;
  private worldLayer!: Phaser.GameObjects.Layer;
  private hudLayer!: Phaser.GameObjects.Layer;
  private hudCamera!: Phaser.Cameras.Scene2D.Camera;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'drift' | 'restart', Phaser.Input.Keyboard.Key>;
  private track: TrackPoint[] = [];
  private checkpointIndices: number[] = [];
  private nextCheckpoint = 1;
  private lap = 1;
  private raceTime = 0;
  private lapTime = 0;
  private bestLap: number | null = null;
  private finished = false;
  private speed = 0;
  private velocity = new Phaser.Math.Vector2();
  private lastSafePosition = new Phaser.Math.Vector2();
  private speedLabel!: Phaser.GameObjects.Text;
  private lapLabel!: Phaser.GameObjects.Text;
  private timerLabel!: Phaser.GameObjects.Text;
  private lapTimerLabel!: Phaser.GameObjects.Text;
  private bestLapLabel!: Phaser.GameObjects.Text;
  private driftLabel!: Phaser.GameObjects.Text;
  private surfaceLabel!: Phaser.GameObjects.Text;
  private finishLabel!: Phaser.GameObjects.Text;

  constructor() {
    super('race');
  }

  create(): void {
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.roundPixels = true;

    this.worldLayer = this.add.layer();
    this.hudLayer = this.add.layer().setDepth(100);
    this.track = this.sampleClosedTrack(TRACK_CONTROLS, 12);
    this.checkpointIndices = Array.from({ length: 8 }, (_, index) =>
      Math.floor((this.track.length * index) / 8),
    );

    this.drawTrack();
    this.createCarTexture();
    this.createCar();
    this.createInput();
    this.createHud();
    this.createCameras();
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.05);

    if (Phaser.Input.Keyboard.JustDown(this.keys.restart)) {
      this.scene.restart();
      return;
    }

    const drifting = this.keys.drift.isDown && Math.abs(this.speed) > 90 && !this.finished;
    const contact = this.getTrackContact(this.car.x, this.car.y);

    if (!this.finished) {
      this.raceTime += dt;
      this.lapTime += dt;
      this.updateThrottle(dt);
      this.updateSteering(dt, drifting);
      this.updateVelocity(dt, drifting);
      this.applySurfaceEffects(contact, dt);
      this.updateCheckpoints();
    } else {
      this.speed = Phaser.Math.Linear(this.speed, 0, Math.min(1, dt * 2.2));
      this.velocity.scale(Math.max(0, 1 - dt * 2.2));
    }

    this.car.setVelocity(this.velocity.x, this.velocity.y);
    this.updateHud(drifting, contact);
  }

  private createCar(): void {
    const start = this.track[0];
    const next = this.track[3];
    const rotation = Phaser.Math.Angle.Between(start.x, start.y, next.x, next.y) + Math.PI / 2;
    this.car = this.physics.add.image(start.x, start.y, 'car');
    this.car.setRotation(rotation).setDepth(10).setCollideWorldBounds(true);
    (this.car.body as Phaser.Physics.Arcade.Body).setSize(30, 54, true);
    this.worldLayer.add(this.car);
    this.lastSafePosition.set(start.x, start.y);
  }

  private createInput(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Teclado não disponível.');
    this.keys = keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      drift: Phaser.Input.Keyboard.KeyCodes.SPACE,
      restart: Phaser.Input.Keyboard.KeyCodes.R,
    }) as typeof this.keys;
  }

  private updateThrottle(dt: number): void {
    if (this.keys.up.isDown) {
      this.speed = Phaser.Math.Clamp(this.speed + ACCELERATION * dt, -MAX_REVERSE_SPEED, MAX_FORWARD_SPEED);
      return;
    }
    if (this.keys.down.isDown) {
      const force = this.speed > 0 ? BRAKING : ACCELERATION * 0.7;
      this.speed = Phaser.Math.Clamp(this.speed - force * dt, -MAX_REVERSE_SPEED, MAX_FORWARD_SPEED);
      return;
    }
    this.speed = Phaser.Math.Linear(this.speed, 0, Math.min(1, (COASTING * dt) / Math.max(Math.abs(this.speed), 1)));
    if (Math.abs(this.speed) < 2) this.speed = 0;
  }

  private updateSteering(dt: number, drifting: boolean): void {
    if (Math.abs(this.speed) < 8) return;
    const direction = Number(this.keys.right.isDown) - Number(this.keys.left.isDown);
    const speedRatio = Phaser.Math.Clamp(Math.abs(this.speed) / MAX_FORWARD_SPEED, 0, 1);
    const turnRate = Phaser.Math.Linear(2.4, 1.45, speedRatio) * (drifting ? 1.32 : 1);
    this.car.rotation += direction * turnRate * (this.speed >= 0 ? 1 : -1) * dt;
  }

  private updateVelocity(dt: number, drifting: boolean): void {
    const forward = new Phaser.Math.Vector2(Math.sin(this.car.rotation), -Math.cos(this.car.rotation));
    const target = forward.scale(this.speed);
    const blend = 1 - Math.exp(-(drifting ? DRIFT_GRIP : GRIP) * dt);
    this.velocity.lerp(target, blend);
    if (this.speed === 0) this.velocity.scale(Math.max(0, 1 - COASTING * dt / 100));
  }

  private applySurfaceEffects(contact: TrackContact, dt: number): void {
    if (contact.distance <= contact.roadHalfWidth - 6) {
      this.lastSafePosition.set(this.car.x, this.car.y);
      return;
    }
    if (contact.distance <= contact.roadHalfWidth + BARRIER_MARGIN) {
      this.speed = Phaser.Math.Clamp(this.speed - 360 * dt * Math.sign(this.speed || 1), -120, 260);
      this.velocity.scale(Math.max(0, 1 - dt * 4));
      return;
    }
    this.car.setPosition(this.lastSafePosition.x, this.lastSafePosition.y);
    this.speed *= -0.22;
    this.velocity.scale(-0.22);
    this.cameras.main.shake(90, 0.004);
  }

  private updateCheckpoints(): void {
    const checkpoint = this.track[this.checkpointIndices[this.nextCheckpoint]];
    const radius = Math.max(90, checkpoint.width * 0.48);
    if (Phaser.Math.Distance.Between(this.car.x, this.car.y, checkpoint.x, checkpoint.y) > radius) return;

    this.nextCheckpoint = (this.nextCheckpoint + 1) % this.checkpointIndices.length;
    if (this.nextCheckpoint !== 1) return;

    const completedLap = this.lapTime;
    this.bestLap = this.bestLap === null ? completedLap : Math.min(this.bestLap, completedLap);
    if (this.lap >= LAPS_TO_FINISH) {
      this.finished = true;
      this.finishLabel.setText(`TIME TRIAL CONCLUÍDO\n${this.formatTime(this.raceTime)}\nR para reiniciar`).setVisible(true);
      return;
    }
    this.lap += 1;
    this.lapTime = 0;
  }

  private drawTrack(): void {
    const graphics = this.add.graphics();
    this.worldLayer.add(graphics);
    graphics.fillStyle(0x315d38).fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.strokeTrack(graphics, 64, 0x15191b);
    this.strokeTrack(graphics, 38, 0xe8e3d5);
    this.strokeTrack(graphics, 20, 0xc8413b);
    this.strokeTrack(graphics, 0, 0x24282a);
    this.drawTrackDetails(graphics);
    this.drawStartLine(graphics);

    const title = this.add.text(1480, 650, 'AUTÓDROMO\nPAULISTANO', {
      align: 'center', color: '#dce8d8', fontFamily: 'system-ui, sans-serif',
      fontSize: '68px', fontStyle: '900',
    }).setOrigin(0.5).setAlpha(0.16);
    this.worldLayer.add(title);
  }

  private strokeTrack(graphics: Phaser.GameObjects.Graphics, extraWidth: number, color: number): void {
    for (let index = 0; index < this.track.length; index += 1) {
      const current = this.track[index];
      const next = this.track[(index + 1) % this.track.length];
      const width = (current.width + next.width) / 2 + extraWidth;
      graphics.lineStyle(width, color, 1).lineBetween(current.x, current.y, next.x, next.y);
      graphics.fillStyle(color, 1).fillCircle(current.x, current.y, width / 2);
    }
  }

  private drawTrackDetails(graphics: Phaser.GameObjects.Graphics): void {
    graphics.lineStyle(5, 0xf1c644, 0.72);
    for (let index = 0; index < this.track.length; index += 12) {
      const current = this.track[index];
      const next = this.track[(index + 6) % this.track.length];
      graphics.lineBetween(current.x, current.y, next.x, next.y);
    }
    graphics.fillStyle(0x6e9b58, 0.7);
    for (let index = 0; index < 24; index += 1) {
      const x = 350 + ((index * 347) % 2300);
      const y = 260 + ((index * 521) % 1650);
      const contact = this.getTrackContact(x, y);
      if (contact.distance > contact.roadHalfWidth + 100) graphics.fillCircle(x, y, 18 + (index % 4) * 5);
    }
  }

  private drawStartLine(graphics: Phaser.GameObjects.Graphics): void {
    const start = this.track[0];
    const next = this.track[3];
    const angle = Phaser.Math.Angle.Between(start.x, start.y, next.x, next.y) + Math.PI / 2;
    const dx = Math.cos(angle) * start.width / 2;
    const dy = Math.sin(angle) * start.width / 2;
    graphics.lineStyle(16, 0xf5f2e8, 1).lineBetween(start.x - dx, start.y - dy, start.x + dx, start.y + dy);
    graphics.lineStyle(5, 0x171a1b, 1).lineBetween(start.x - dx, start.y - dy, start.x + dx, start.y + dy);
  }

  private createCarTexture(): void {
    const car = this.make.graphics({ x: 0, y: 0 });
    car.fillStyle(0xe5484d).fillRoundedRect(5, 2, 34, 62, 8);
    car.fillStyle(0x15191b).fillRoundedRect(9, 17, 26, 23, 5);
    car.fillStyle(0x9ed8ef).fillRoundedRect(12, 19, 20, 9, 3);
    car.fillStyle(0xfff1b8).fillCircle(12, 7, 3).fillCircle(32, 7, 3);
    car.generateTexture('car', 44, 66);
    car.destroy();
  }

  private createHud(): void {
    const textBase: Phaser.Types.GameObjects.Text.TextStyle = {
      color: '#ffffff', fontFamily: 'system-ui, sans-serif', resolution: HUD_RESOLUTION,
    };
    const panel = { backgroundColor: '#101712d9', padding: { x: 11, y: 7 } };
    const title = this.add.text(24, 22, 'CORRIDA SP  ·  TIME TRIAL 0.1', {
      ...textBase, ...panel, fontSize: '17px', fontStyle: '700',
    });
    this.lapLabel = this.add.text(24, 70, 'VOLTA 1/3', {
      ...textBase, ...panel, color: '#f2c94c', fontSize: '25px', fontStyle: '800',
    });
    this.speedLabel = this.add.text(24, 118, '0 km/h', {
      ...textBase, fontFamily: 'ui-monospace, monospace', color: '#f2c94c', fontSize: '28px', fontStyle: '700',
    });
    this.timerLabel = this.add.text(24, 166, 'TOTAL  00:00.000', {
      ...textBase, ...panel, fontFamily: 'ui-monospace, monospace', fontSize: '17px',
    });
    this.lapTimerLabel = this.add.text(24, 205, 'VOLTA  00:00.000', {
      ...textBase, ...panel, fontFamily: 'ui-monospace, monospace', fontSize: '17px',
    });
    this.bestLapLabel = this.add.text(24, 244, 'MELHOR --:--.---', {
      ...textBase, ...panel, fontFamily: 'ui-monospace, monospace', color: '#9ed8ef', fontSize: '16px',
    });
    const controls = this.add.text(24, 292, 'W/S acelerar/frear · A/D esterçar · Espaço drift · R reiniciar', {
      ...textBase, ...panel, color: '#eef2ed', fontSize: '14px',
    });
    this.driftLabel = this.add.text(24, 334, 'DRIFT', {
      ...textBase, backgroundColor: '#f2c94c', color: '#101712', fontSize: '17px', fontStyle: '900',
      padding: { x: 10, y: 5 },
    }).setVisible(false);
    this.surfaceLabel = this.add.text(112, 334, 'FORA DA PISTA', {
      ...textBase, backgroundColor: '#c8413b', fontSize: '17px', fontStyle: '900',
      padding: { x: 10, y: 5 },
    }).setVisible(false);
    this.finishLabel = this.add.text(this.scale.width / 2, this.scale.height / 2, '', {
      ...textBase, align: 'center', backgroundColor: '#101712ee', color: '#f2c94c',
      fontSize: '34px', fontStyle: '900', padding: { x: 30, y: 22 },
    }).setOrigin(0.5).setVisible(false);
    this.hudLayer.add([
      title, this.lapLabel, this.speedLabel, this.timerLabel, this.lapTimerLabel,
      this.bestLapLabel, controls, this.driftLabel, this.surfaceLabel, this.finishLabel,
    ]);
  }

  private createCameras(): void {
    const { width, height } = this.scale;
    this.cameras.main.startFollow(this.car, true, 1, 1);
    this.cameras.main.ignore(this.hudLayer);
    this.hudCamera = this.cameras.add(0, 0, width, height, false, 'hud');
    this.hudCamera.setScroll(0, 0).setZoom(1);
    this.hudCamera.roundPixels = true;
    this.hudCamera.ignore(this.worldLayer);
    this.scale.on(Phaser.Scale.Events.RESIZE, (gameSize: Phaser.Structs.Size) => {
      this.hudCamera.setViewport(0, 0, gameSize.width, gameSize.height);
      this.finishLabel.setPosition(gameSize.width / 2, gameSize.height / 2);
    });
  }

  private updateHud(drifting: boolean, contact: TrackContact): void {
    this.speedLabel.setText(`${Math.round(Math.abs(this.speed) * 0.32)} km/h`);
    this.lapLabel.setText(`VOLTA ${Math.min(this.lap, LAPS_TO_FINISH)}/${LAPS_TO_FINISH}`);
    this.timerLabel.setText(`TOTAL  ${this.formatTime(this.raceTime)}`);
    this.lapTimerLabel.setText(`VOLTA  ${this.formatTime(this.lapTime)}`);
    this.bestLapLabel.setText(`MELHOR ${this.bestLap === null ? '--:--.---' : this.formatTime(this.bestLap)}`);
    this.driftLabel.setVisible(drifting);
    this.surfaceLabel.setVisible(contact.distance > contact.roadHalfWidth);
  }

  private getTrackContact(x: number, y: number): TrackContact {
    let closestDistanceSquared = Number.POSITIVE_INFINITY;
    let roadHalfWidth = this.track[0]?.width / 2 || 100;
    for (let index = 0; index < this.track.length; index += 1) {
      const start = this.track[index];
      const end = this.track[(index + 1) % this.track.length];
      const segmentX = end.x - start.x;
      const segmentY = end.y - start.y;
      const lengthSquared = segmentX * segmentX + segmentY * segmentY;
      const projection = Phaser.Math.Clamp(((x - start.x) * segmentX + (y - start.y) * segmentY) / lengthSquared, 0, 1);
      const closestX = start.x + segmentX * projection;
      const closestY = start.y + segmentY * projection;
      const dx = x - closestX;
      const dy = y - closestY;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < closestDistanceSquared) {
        closestDistanceSquared = distanceSquared;
        roadHalfWidth = Phaser.Math.Linear(start.width, end.width, projection) / 2;
      }
    }
    return { distance: Math.sqrt(closestDistanceSquared), roadHalfWidth };
  }

  private sampleClosedTrack(controls: TrackPoint[], samplesPerSegment: number): TrackPoint[] {
    const samples: TrackPoint[] = [];
    const count = controls.length;
    for (let index = 0; index < count; index += 1) {
      const p0 = controls[(index - 1 + count) % count];
      const p1 = controls[index];
      const p2 = controls[(index + 1) % count];
      const p3 = controls[(index + 2) % count];
      for (let step = 0; step < samplesPerSegment; step += 1) {
        const t = step / samplesPerSegment;
        const t2 = t * t;
        const t3 = t2 * t;
        const interpolate = (a: number, b: number, c: number, d: number) =>
          0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        samples.push({
          x: interpolate(p0.x, p1.x, p2.x, p3.x),
          y: interpolate(p0.y, p1.y, p2.y, p3.y),
          width: Phaser.Math.Linear(p1.width, p2.width, t),
        });
      }
    }
    return samples;
  }

  private formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
  }
}

