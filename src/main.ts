import Phaser from 'phaser';
import './style.css';
import { RaceScene } from './scenes/RaceScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#37653d',
  render: {
    antialias: true,
    roundPixels: false,
    powerPreference: 'high-performance',
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720,
  },
  scene: [RaceScene],
});
