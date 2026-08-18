import Phaser from 'phaser';

const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1600;
const MAX_FORWARD_SPEED = 520;
const MAX_REVERSE_SPEED = 180;
const ACCELERATION = 430;
const BRAKING = 620;
const COASTING = 170;
const GRIP = 8.5;
const DRIFT_GRIP = 1.7;

export class RaceScene extends Phaser.Scene {
  private car!: Phaser.Physics.Arcade.Image;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'drift', Phaser.Input.Keyboard.Key>;
  private speed = 0;
  private velocity = new Phaser.Math.Vector2();
  private speedLabel!: Phaser.GameObjects.Text;
  private driftLabel!: Phaser.GameObjects.Text;

  constructor() {
    super('race');
  }

  create(): void {
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    this.drawTrack();
    this.createCarTexture();

    this.car = this.physics.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT - 330, 'car');
    this.car.setDepth(10).setCollideWorldBounds(true);
    (this.car.body as Phaser.Physics.Arcade.Body).setSize(30, 54, true);

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Teclado não disponível.');

    this.keys = keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      drift: Phaser.Input.Keyboard.KeyCodes.SPACE,
    }) as typeof this.keys;

    this.cameras.main.startFollow(this.car, true, 0.09, 0.09);
    this.cameras.main.setZoom(1.05);
    this.createHud();
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.05);
    const drifting = this.keys.drift.isDown && Math.abs(this.speed) > 90;

    this.updateThrottle(dt);
    this.updateSteering(dt, drifting);
    this.updateVelocity(dt, drifting);

    this.car.setVelocity(this.velocity.x, this.velocity.y);
    this.speedLabel.setText(`${Math.round(Math.abs(this.speed) * 0.32)} km/h`);
    this.driftLabel.setVisible(drifting);
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
    const reverseMultiplier = this.speed >= 0 ? 1 : -1;
    this.car.rotation += direction * turnRate * reverseMultiplier * dt;
  }

  private updateVelocity(dt: number, drifting: boolean): void {
    const forward = new Phaser.Math.Vector2(Math.sin(this.car.rotation), -Math.cos(this.car.rotation));
    const target = forward.scale(this.speed);
    const grip = drifting ? DRIFT_GRIP : GRIP;
    const blend = 1 - Math.exp(-grip * dt);
    this.velocity.lerp(target, blend);

    if (this.speed === 0) {
      this.velocity.scale(Math.max(0, 1 - COASTING * dt / 100));
    }
  }

  private drawTrack(): void {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x37653d).fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    graphics.fillStyle(0x24282a).fillRoundedRect(250, 180, 1900, 1240, 360);
    graphics.fillStyle(0x37653d).fillRoundedRect(610, 520, 1180, 560, 230);

    graphics.lineStyle(18, 0xe8e3d5, 1);
    graphics.strokeRoundedRect(275, 205, 1850, 1190, 335);
    graphics.strokeRoundedRect(585, 495, 1230, 610, 255);

    graphics.lineStyle(7, 0xf2c94c, 0.9);
    graphics.strokeRoundedRect(430, 350, 1540, 900, 290);

    graphics.fillStyle(0xf3f1e8);
    for (let row = 0; row < 6; row += 1) {
      for (let column = 0; column < 2; column += 1) {
        if ((row + column) % 2 === 0) {
          graphics.fillRect(WORLD_WIDTH / 2 - 55 + column * 55, WORLD_HEIGHT - 430 + row * 18, 55, 18);
        }
      }
    }

    this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'CORRIDA SP', {
      color: '#dce8d8',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '76px',
      fontStyle: '900',
    }).setOrigin(0.5).setAlpha(0.28);
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
    const title = this.add.text(24, 22, 'CORRIDA SP  ·  v0.0.1', {
      color: '#ffffff',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '18px',
      fontStyle: '700',
      backgroundColor: '#101712cc',
      padding: { x: 12, y: 8 },
    }).setScrollFactor(0).setDepth(100);

    this.speedLabel = this.add.text(24, 72, '0 km/h', {
      color: '#f2c94c',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '30px',
      fontStyle: '700',
    }).setScrollFactor(0).setDepth(100);

    this.add.text(24, 116, 'W acelerar  ·  S frear/ré  ·  A/D esterçar  ·  Espaço drift', {
      color: '#eef2ed',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '15px',
      backgroundColor: '#101712b8',
      padding: { x: 10, y: 7 },
    }).setScrollFactor(0).setDepth(100);

    this.driftLabel = this.add.text(24, 162, 'DRIFT', {
      color: '#101712',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '18px',
      fontStyle: '900',
      backgroundColor: '#f2c94c',
      padding: { x: 10, y: 5 },
    }).setScrollFactor(0).setDepth(100).setVisible(false);

    title.setInteractive({ useHandCursor: false });
  }
}
