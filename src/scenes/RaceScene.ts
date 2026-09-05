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
const HUD_RESOLUTION = Math.min(window.devicePixelRatio, 2);

export class RaceScene extends Phaser.Scene {
  private car!: Phaser.Physics.Arcade.Image;
  private worldLayer!: Phaser.GameObjects.Layer;
  private hudLayer!: Phaser.GameObjects.Layer;
  private hudCamera!: Phaser.Cameras.Scene2D.Camera;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'drift', Phaser.Input.Keyboard.Key>;
  private speed = 0;
  private velocity = new Phaser.Math.Vector2();
  private speedLabel!: Phaser.GameObjects.Text;
  private driftLabel!: Phaser.GameObjects.Text;
  private controlsLabel!: Phaser.GameObjects.Text;
  private pauseLabel!: Phaser.GameObjects.Text;
  private paused = false;
  private arrows!: Phaser.Types.Input.Keyboard.CursorKeys;
  private targetVelocity = new Phaser.Math.Vector2();

  constructor() {
    super('race');
  }

  create(): void {
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.roundPixels = false;
    this.speed = 0;
    this.velocity.set(0, 0);
    this.paused = false;

    this.worldLayer = this.add.layer();
    this.hudLayer = this.add.layer().setDepth(100);

    this.drawTrack();
    this.createCarTexture();

    this.car = this.physics.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT - 330, 'car');
    this.car.setDepth(10).setCollideWorldBounds(true);
    (this.car.body as Phaser.Physics.Arcade.Body).setSize(30, 54, true);
    this.worldLayer.add(this.car);

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Teclado não disponível.');

    this.keys = keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      drift: Phaser.Input.Keyboard.KeyCodes.SPACE,
    }) as typeof this.keys;
    this.arrows = keyboard.createCursorKeys();
    keyboard.on('keydown-ESC', this.togglePause, this);

    this.createHud();
    this.createCameras();
    this.game.events.on(Phaser.Core.Events.BLUR, this.pauseGame, this);
    this.game.events.on(Phaser.Core.Events.HIDDEN, this.pauseGame, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.BLUR, this.pauseGame, this);
      this.game.events.off(Phaser.Core.Events.HIDDEN, this.pauseGame, this);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.resizeHud, this);
      keyboard.off('keydown-ESC', this.togglePause, this);
    });
  }

  update(_time: number, deltaMs: number): void {
    if (this.paused) return;
    const dt = Math.min(deltaMs / 1000, 0.1);
    const body = this.car.body as Phaser.Physics.Arcade.Body;
    // Arcade resolves the boundary, so discard the matching stored momentum too.
    if ((body.blocked.left && this.velocity.x < 0) || (body.blocked.right && this.velocity.x > 0)) {
      this.velocity.x = 0;
      this.speed = 0;
    }
    if ((body.blocked.up && this.velocity.y < 0) || (body.blocked.down && this.velocity.y > 0)) {
      this.velocity.y = 0;
      this.speed = 0;
    }
    const drifting = this.keys.drift.isDown && Math.abs(this.speed) > 90;

    this.updateThrottle(dt);
    this.updateSteering(dt, drifting);
    this.updateVelocity(dt, drifting);

    this.car.setVelocity(this.velocity.x, this.velocity.y);
    this.speedLabel.setText(`${Math.round(this.velocity.length() * 0.32)} km/h`);
    this.driftLabel.setVisible(drifting);
  }

  private updateThrottle(dt: number): void {
    const up = this.keys.up.isDown || this.arrows.up.isDown;
    const down = this.keys.down.isDown || this.arrows.down.isDown;
    if (up && !down) {
      this.speed = Phaser.Math.Clamp(this.speed + ACCELERATION * dt, -MAX_REVERSE_SPEED, MAX_FORWARD_SPEED);
      return;
    }

    if (down && !up) {
      const force = this.speed > 0 ? BRAKING : ACCELERATION * 0.7;
      this.speed = Phaser.Math.Clamp(this.speed - force * dt, -MAX_REVERSE_SPEED, MAX_FORWARD_SPEED);
      return;
    }

    this.speed = Phaser.Math.Linear(this.speed, 0, Math.min(1, (COASTING * dt) / Math.max(Math.abs(this.speed), 1)));
    if (Math.abs(this.speed) < 2) this.speed = 0;
  }

  private updateSteering(dt: number, drifting: boolean): void {
    if (Math.abs(this.speed) < 8) return;

    const direction = Number(this.keys.right.isDown || this.arrows.right.isDown) - Number(this.keys.left.isDown || this.arrows.left.isDown);
    const speedRatio = Phaser.Math.Clamp(Math.abs(this.speed) / MAX_FORWARD_SPEED, 0, 1);
    const turnRate = Phaser.Math.Linear(2.4, 1.45, speedRatio) * (drifting ? 1.32 : 1);
    const reverseMultiplier = this.speed >= 0 ? 1 : -1;
    this.car.rotation += direction * turnRate * reverseMultiplier * dt;
  }

  private updateVelocity(dt: number, drifting: boolean): void {
    const target = this.targetVelocity.set(Math.sin(this.car.rotation) * this.speed, -Math.cos(this.car.rotation) * this.speed);
    const grip = drifting ? DRIFT_GRIP : GRIP;
    const blend = 1 - Math.exp(-grip * dt);
    this.velocity.lerp(target, blend);

    if (this.speed === 0) {
      this.velocity.scale(Math.exp(-COASTING * dt / 100));
    }
  }

  private drawTrack(): void {
    const graphics = this.add.graphics();
    this.worldLayer.add(graphics);
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

    const trackTitle = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'CORRIDA SP', {
      color: '#dce8d8',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '76px',
      fontStyle: '900',
    }).setOrigin(0.5).setAlpha(0.28);
    this.worldLayer.add(trackTitle);
  }

  private createCarTexture(): void {
    if (this.textures.exists('car')) return;
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
      resolution: HUD_RESOLUTION,
      backgroundColor: '#101712cc',
      padding: { x: 12, y: 8 },
    });

    this.speedLabel = this.add.text(24, 72, '0 km/h', {
      color: '#f2c94c',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '30px',
      fontStyle: '700',
      resolution: HUD_RESOLUTION,
    });

    const controls = this.controlsLabel = this.add.text(24, 116, 'W/↑ acelerar · S/↓ frear/ré · A/D ou ←/→ esterçar · Espaço drift · Esc pausar', {
      color: '#eef2ed',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '15px',
      resolution: HUD_RESOLUTION,
      backgroundColor: '#101712b8',
      padding: { x: 10, y: 7 },
    });

    this.driftLabel = this.add.text(24, 162, 'DRIFT', {
      color: '#101712',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '18px',
      fontStyle: '900',
      resolution: HUD_RESOLUTION,
      backgroundColor: '#f2c94c',
      padding: { x: 10, y: 5 },
    }).setVisible(false);

    this.hudLayer.add([title, this.speedLabel, controls, this.driftLabel]);
    this.pauseLabel = this.add.text(0, 0, 'PAUSADO\nClique para continuar\nou pressione Esc', {
      fontFamily: 'system-ui, sans-serif', fontSize: '22px', color: '#ffffff',
      backgroundColor: '#101712', align: 'center', padding: { x: 18, y: 18 },
      resolution: HUD_RESOLUTION,
    }).setOrigin(0.5).setVisible(false).setInteractive({ useHandCursor: true });
    this.pauseLabel.on('pointerdown', this.togglePause, this);
    this.hudLayer.add(this.pauseLabel);
  }

  private createCameras(): void {
    const { width, height } = this.scale;

    this.cameras.main.startFollow(this.car, false, 1, 1);
    this.cameras.main.ignore(this.hudLayer);

    this.hudCamera = this.cameras.add(0, 0, width, height, false, 'hud');
    this.hudCamera.setScroll(0, 0).setZoom(1);
    this.hudCamera.roundPixels = true;
    this.hudCamera.ignore(this.worldLayer);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.resizeHud, this);
    this.resizeHud();
  }

  private resizeHud(): void {
    const { width, height } = this.scale;
    this.hudCamera.setViewport(0, 0, width, height);
    this.controlsLabel.setWordWrapWidth(Math.max(80, width - 68), true);
    this.driftLabel.setY(this.controlsLabel.y + this.controlsLabel.height + 12);
    this.pauseLabel.setPosition(width / 2, height / 2);
  }

  private pauseGame(): void {
    this.paused = true;
    this.speed = 0;
    this.velocity.set(0, 0);
    this.car.setVelocity(0, 0);
    this.input.keyboard?.resetKeys();
    this.physics.world.pause();
    this.speedLabel.setText('0 km/h');
    this.driftLabel.setVisible(false);
    this.pauseLabel.setVisible(true);
  }

  private togglePause(event?: KeyboardEvent): void {
    if (event?.repeat) return;
    if (!this.paused) {
      this.pauseGame();
      return;
    }
    this.input.keyboard?.resetKeys();
    this.paused = false;
    this.pauseLabel.setVisible(false);
    this.physics.world.resume();
  }
}
