// Animate (Phaser) — Parity-first, browser-only for OBS Browser Source

const BASE_URL = 'https://showblam.com/';

function getQueryParam(name) {
  const m = new URLSearchParams(window.location.search).get(name);
  return m || '';
}

function buildEndpoints(my_key) {
  const k = encodeURIComponent(my_key || 'S7V74GMC3Mwww');
  return {
    initialize: `${BASE_URL}animate_init?&my_key=${k}`,
    poll_check_messages: `${BASE_URL}poll_check_messages?my_key=${k}`,
    get_activity_feed: `${BASE_URL}get_activity_feed?my_key=${k}`,
    create_animation: `${BASE_URL}create_animation?my_key=${k}`,
    mark_animation_played: `${BASE_URL}mark_animation_played?my_key=${k}`,
    get_intermission: `${BASE_URL}get_intermission?my_key=${k}`,
    set_rant_as_displayed: `${BASE_URL}set_rant_as_displayed?my_key=${k}`,
    skip_animation: `${BASE_URL}skip_animation?my_key=${k}`,
  };
}

async function safeRequest(url, opts = {}, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { ...opts, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json().catch(() => ({}));
    } catch (e) {
      lastErr = e;
      // retry after cancel-like behavior
    }
  }
  throw lastErr;
}

export default class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');
    this.endpoints = null;
    this.myKey = '';
    this._lastPollMs = 0;
    this._pollIntervalMs = 10_000; // tune to parity
    this._watchdogMs = 25_000; // similar to Godot watchdog
    this._isRequesting = false;
    this._pollTimer = null;

    // UI state
    this.promoLines = [
      'Type !ANIMATE <your_animation_idea> in chat',
      'Use !INVENTORY to see your items',
      'Type !COMMENT to report an issue or suggestion',
      'Use !DOUBLE or !TRIPLE to boost your next game',
    ];
    this.promoIndex = 0;

    // Toolbar state
    this.activeTab = '';
    this.toolbar = null; // container
    this.toolbarOutX = 0;
    this.toolbarInX = 0;
    this.toolbarTween = null;
    this.toolbarAnimating = false;

    // Nodes
    this.lblPromo1 = null;
    this.activateBtn = null;
    this.tabs = { games: null, feature: null, info: null };
    this.tabBaseX = { games: 0, feature: 0, info: 0 };
    this.tabLeftInset = 12;
    this.tabLeftInsets = { games: 0, feature: 0, info: 0 };
    this._guideG = null;
    this.tabTextures = {
      games:   { on: 'tab_games_on',   off: 'tab_games_off' },
      feature: { on: 'tab_feature_on', off: 'tab_feature_off' },
      info:    { on: 'tab_info_on',    off: 'tab_info_off' },
    };
  }

  preload() {
    // Tab images (from assets/Graphics/Elements)
    this.load.image('tab_games_on', 'assets/Graphics/Elements/tab_games_on.png');
    this.load.image('tab_games_off', 'assets/Graphics/Elements/tab_games_off.png');
    this.load.image('tab_feature_on', 'assets/Graphics/Elements/tab_feature_on.png');
    this.load.image('tab_feature_off', 'assets/Graphics/Elements/tab_feature_off.png');
    this.load.image('tab_info_on', 'assets/Graphics/Elements/tab_info_on.png');
    this.load.image('tab_info_off', 'assets/Graphics/Elements/tab_info_off.png');
  }

  create() {
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)');

    // Read key from URL (OBS Browser Source passes it via query param)
    this.myKey = getQueryParam('my_key') || 'S7V74GMC3Mwww';
    this.endpoints = buildEndpoints(this.myKey);

    this._buildUI();
    this._measureTabInsets();
    this._buildToolbar();
    this._drawDebugGuides();
    this._bindGuideToggle();

    // Build/version stamp and quick diagnostics (to verify fresh load)
    this.add.text(8, 36, 'Phaser Animate A4', {
      fontFamily: 'Arial', fontSize: '16px', color: '#00ff88', backgroundColor: '#111', padding: 4
    }).setDepth(1000).setAlpha(0.85);
    console.log('toolbarOutX=', this.toolbarOutX, 'toolbarInX=', this.toolbarInX);
    console.log('tabs=', {
      games: { x: this.tabs.games.x, y: this.tabs.games.y },
      feature: { x: this.tabs.feature.x, y: this.tabs.feature.y },
      info: { x: this.tabs.info.x, y: this.tabs.info.y },
    });
    console.log('tabInsets=', this.tabLeftInsets);

    // Promo rotator
    this.time.addEvent({ delay: 5000, loop: true, callback: () => this._nextPromo() });
  }

  // --- UI ---
  _buildUI() {
    const w = this.scale.width;
    const pad = 16;

    // Promo text
    this.lblPromo1 = this.add.text(pad, pad, 'Ready', {
      fontFamily: 'Arial', fontSize: '22px', color: '#ffffff'
    });

    // Activate button (top-right)
    this.activateBtn = this.add.text(w - 200 - pad, pad, 'Activate Chatbot', {
      fontFamily: 'Arial', fontSize: '22px', color: '#000000', backgroundColor: '#ffd14a', padding: 6
    }).setInteractive({ useHandCursor: true });

    this.activateBtn.on('pointerdown', async () => {
      this._onActivate();
    });
  }

  _nextPromo() {
    this.promoIndex = (this.promoIndex + 1) % this.promoLines.length;
    this.lblPromo1.setText(this.promoLines[this.promoIndex]);
  }

  async _onActivate() {
    try {
      this.lblPromo1.setText('...activating chatbot...');
      this.activateBtn.disableInteractive().setAlpha(0.6);
      await safeRequest(this.endpoints.initialize, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      this._startPolling();
      this.lblPromo1.setText('Activated');
    } catch (e) {
      this.lblPromo1.setText('Activation failed; refresh after starting broadcast');
      this.activateBtn.setInteractive().setAlpha(1);
      // Keep parity with Godot: non-blocking, allow retry
    }
  }

  // --- Toolbar & Tabs ---
  _buildToolbar() {
    // Toolbar panel near bottom-left; align to Godot panel band
    const h = 62;
    const y = 655;

    // Visual panel for toolbar
    const g = this.add.graphics();
    g.fillStyle(0x2b2f3a, 0.9);
    g.fillRoundedRect(0, 0, 320, h, 10);

    const toolW = 320;
    this.toolbarOutX = 16;           // closed (left)
    this.toolbarInX = this.toolbarOutX + 240; // open (slides right)
    this.toolbar = this.add.container(this.toolbarOutX, y, [g]);
    this.toolbar.setDepth(5);

    // Tabs: vertical stack using provided textures
    this.tabs.games = this.add.image(0, 0, this.tabTextures.games.off)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true })
      .setDepth(6);
    this.tabs.feature = this.add.image(0, 0, this.tabTextures.feature.off)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true })
      .setDepth(6);
    this.tabs.info = this.add.image(0, 0, this.tabTextures.info.off)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true })
      .setDepth(6);

    // Approximate Godot positions (720-high canvas): 601, 640, 679
    const baseXGames = 355 - (this.tabLeftInsets.games || this.tabLeftInset || 0);
    const baseXFeature = 355 - (this.tabLeftInsets.feature || this.tabLeftInset || 0);
    const baseXInfo = 355 - (this.tabLeftInsets.info || this.tabLeftInset || 0);
    this.tabs.games.setPosition(baseXGames, 601);
    this.tabs.feature.setPosition(baseXFeature, 640);
    this.tabs.info.setPosition(baseXInfo, 679);

    // Record base X for each tab so we can tween precisely
    this.tabBaseX.games = baseXGames;
    this.tabBaseX.feature = baseXFeature;
    this.tabBaseX.info = baseXInfo;

    // Tab handlers
    this.tabs.games.on('pointerdown', () => this._toggleTab('games'));
    this.tabs.feature.on('pointerdown', () => this._toggleTab('feature'));
    this.tabs.info.on('pointerdown', () => this._toggleTab('info'));

    this._setTabVisuals('');
  }

  _measureTabInsets() {
    const srcKeys = {
      games: this.tabTextures.games.off,
      feature: this.tabTextures.feature.off,
      info: this.tabTextures.info.off,
    };
    const res = { games: 0, feature: 0, info: 0 };
    const threshold = 8;
    const keys = Object.keys(srcKeys);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const key = srcKeys[k];
      const tex = this.textures.get(key);
      if (!tex) { res[k] = 0; continue; }
      const img = tex.getSourceImage && tex.getSourceImage();
      if (!img || !img.width || !img.height) { res[k] = 0; continue; }
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      try {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, w, h).data;
        let found = false;
        let left = 0;
        for (let x = 0; x < w && !found; x++) {
          for (let y = 0; y < h; y++) {
            if (data[(y * w + x) * 4 + 3] > threshold) { left = x; found = true; break; }
          }
        }
        res[k] = found ? left : 0;
      } catch (e) {
        res[k] = 0;
      }
    }
    this.tabLeftInsets = res;
  }

  _drawDebugGuides() {
    const g = this.add.graphics();
    g.setDepth(1000);
    g.lineStyle(2, 0x00ff88, 0.9);
    const cross = (x, y) => {
      g.strokeLineShape(new Phaser.Geom.Line(x - 8, y, x + 8, y));
      g.strokeLineShape(new Phaser.Geom.Line(x, y - 8, x, y + 8));
    };
    cross(355, 601);
    cross(355, 640);
    cross(355, 679);
    g.lineStyle(2, 0x4488ff, 0.85);
    g.strokeRect(this.toolbarOutX, 655, 320, 62);
    g.lineStyle(2, 0xff8844, 0.85);
    g.strokeRect(this.toolbarInX, 655, 320, 62);
    this.time.delayedCall(8000, () => g.destroy());
  }

  _bindGuideToggle() {
    if (!this.input || !this.input.keyboard) return;
    this.input.keyboard.on('keydown-G', () => {
      if (this._guideG) {
        this._guideG.destroy();
        this._guideG = null;
        return;
      }
      const g = this.add.graphics();
      this._guideG = g;
      g.setDepth(1000);
      g.lineStyle(2, 0x00ff88, 0.9);
      const cross = (x, y) => {
        g.strokeLineShape(new Phaser.Geom.Line(x - 8, y, x + 8, y));
        g.strokeLineShape(new Phaser.Geom.Line(x, y - 8, x, y + 8));
      };
      cross(355, 601);
      cross(355, 640);
      cross(355, 679);
      g.lineStyle(2, 0x4488ff, 0.85);
      g.strokeRect(this.toolbarOutX, 655, 320, 62);
      g.lineStyle(2, 0xff8844, 0.85);
      g.strokeRect(this.toolbarInX, 655, 320, 62);
    });
  }

  _getTabNode(tab) {
    if (tab === 'games') return this.tabs.games;
    if (tab === 'feature') return this.tabs.feature;
    if (tab === 'info') return this.tabs.info;
    return null;
  }

  _setTabVisuals(tab) {
    const setState = (key, pressed) => {
      const node = this._getTabNode(key);
      if (!node) return;
      node.setTexture(this.tabTextures[key][pressed ? 'on' : 'off']);
      node.setAlpha(pressed ? 1.0 : 0.95);
      // Clear any stuck pointer state on OBS builds
      node.disableInteractive();
      node.disableInteractive(false);
    };
    setState('games', tab === 'games');
    setState('feature', tab === 'feature');
    setState('info', tab === 'info');

    // Disable other tabs when one is active
    const disableOthers = (active) => {
      const all = ['games', 'feature', 'info'];
      all.forEach((k) => {
        const btn = this._getTabNode(k);
        if (!btn) return;
        const dis = active && k !== tab;
        btn.setAlpha(dis ? 0.6 : (k === tab ? 1.0 : 0.95));
        if (btn.input && btn.input.enabled !== undefined) btn.input.enabled = !dis;
      });
    };
    disableOthers(!!tab);
  }

  _toggleTab(tab) {
    if (this.toolbarAnimating) return;

    if (!this.activeTab) {
      // Open
      this.activeTab = tab;
      this._setTabVisuals(tab);
      this._tweenToolbar(true, '', tab);
      return;
    }

    if (this.activeTab === tab) {
      // Close
      const prev = this.activeTab;
      this.activeTab = '';
      this._setTabVisuals('');
      this._tweenToolbar(false, prev, '');
      return;
    }

    // Switch
    const prev = this.activeTab;
    this.activeTab = tab;
    this._setTabVisuals(tab);
    this._tweenToolbar(true, prev, tab);
  }

  _tweenToolbar(expand, prevTab = '', newTab = '') {
    if (!this.toolbar) return;

    // Kill any ongoing tweens for a clean move
    this.tweens.killTweensOf(this.toolbar);
    const prevBtn = this._getTabNode(prevTab);
    const newBtn = this._getTabNode(newTab);
    if (prevBtn) this.tweens.killTweensOf(prevBtn);
    if (newBtn) this.tweens.killTweensOf(newBtn);

    const toX = expand ? this.toolbarInX : this.toolbarOutX;
    const delta = this.toolbarInX - this.toolbarOutX;
    this.toolbarAnimating = true;

    const tweens = [];
    // Toolbar move
    tweens.push({ targets: this.toolbar, x: toX, duration: 220, ease: 'Quad.easeOut' });

    // Return previous tab to its base X
    if (prevBtn && prevTab && this.tabBaseX[prevTab] !== undefined) {
      tweens.push({ targets: prevBtn, x: this.tabBaseX[prevTab], duration: 220, ease: 'Quad.easeOut' });
    }
    // Slide the new active tab along with the toolbar
    if (newBtn && expand && newTab && this.tabBaseX[newTab] !== undefined) {
      tweens.push({ targets: newBtn, x: this.tabBaseX[newTab] + delta, duration: 220, ease: 'Quad.easeOut' });
    }

    this.toolbarTween = this.tweens.timeline({
      tweens,
      onComplete: () => { this.toolbarAnimating = false; }
    });
  }

  // --- Polling & Watchdog ---
  _startPolling() {
    this._lastPollMs = performance.now();
    if (this._pollTimer) clearInterval(this._pollTimer);

    const tick = async () => {
      if (this._isRequesting) {
        // Watchdog: if it’s been too long, drop and retry
        if (performance.now() - this._lastPollMs > this._watchdogMs + 5000) {
          this._isRequesting = false;
        }
        return;
      }
      try {
        this._isRequesting = true;
        await safeRequest(this.endpoints.poll_check_messages, { method: 'GET' });
        this._lastPollMs = performance.now();
      } catch (e) {
        // Log only; retry next tick
      } finally {
        this._isRequesting = false;
      }
    };

    // Kick immediately, then interval
    tick();
    this._pollTimer = setInterval(tick, this._pollIntervalMs);
  }
}
