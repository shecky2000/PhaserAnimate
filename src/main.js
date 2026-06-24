import MainScene from './scenes/MainScene.js';

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: 'rgba(0,0,0,0)',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720
  },
  scene: [MainScene],
  physics: { default: 'arcade', arcade: { debug: false } },
};

window.addEventListener('load', () => {
  // Creating the game attaches canvas inside #game
  new Phaser.Game(config);
});
