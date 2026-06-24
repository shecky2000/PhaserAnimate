// Animate (Phaser) — Layout v2 — matches Godot reference screenshot

const BASE_URL = 'https://showblam.com/';

function getQueryParam(name) {
  const m = new URLSearchParams(window.location.search).get(name);
  return m || '';
}

function buildEndpoints(my_key) {
  const k = encodeURIComponent(my_key || 'S7V74GMC3Mwww');
  return {
    initialize:            `${BASE_URL}animate_init?&my_key=${k}`,
    poll_check_messages:   `${BASE_URL}poll_check_messages?my_key=${k}`,
    get_activity_feed:     `${BASE_URL}get_activity_feed?my_key=${k}`,
    create_animation:      `${BASE_URL}create_animation?my_key=${k}`,
    mark_animation_played: `${BASE_URL}mark_animation_played?my_key=${k}`,
    get_intermission:      `${BASE_URL}get_intermission?my_key=${k}`,
    set_rant_as_displayed: `${BASE_URL}set_rant_as_displayed?my_key=${k}`,
    skip_animation:        `${BASE_URL}skip_animation?my_key=${k}`,
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
    this._pollIntervalMs = 10_000;
    this._watchdogMs = 25_000;
    this._isRequesting = false;
    this._pollTimer = null;

    // UI state
    this.promoLines = [
      '!ANIMATE + your idea',
      'Use !INVENTORY to see your items',
      'Type !COMMENT to report an issue',
      'Use !DOUBLE or !TRIPLE to boost',
    ];
    this.promoIndex = 0;

    // Toolbar state
    this.activeTab = '';
    this.toolbar = null;
    this.toolbarOutX = 0;
    this.toolbarInX = 0;
    this.toolbarTween = null;
    this.toolbarAnimating = false;

    // Nodes
    this.lblPromo1 = null;
    this.activateBtn = null;
    this.tabs = { games: null, feature: null, info: null };
    this.tabBaseX = { games: 0, feature: 0, info: 0 };
    this.tabLeftInsets = { games: 0, feature: 0, info: 0 };
    this._guideG = null;
    this.tabTextures = {
      games:   { on: 'tab_games_on',   off: 'tab_games_off' },
      feature: { on: 'tab_feature_on', off: 'tab_feature_off' },
      info:    { on: 'tab_info_on',    off: 'tab_info_off' },
    };
  }

  preload() {
    this.load.image('tab_games_on',    'assets/Graphics/Elements/tab_games_on.png');
    this.load.image('tab_games_off',   'assets/Graphics/Elements/tab_games_off.png');
    this.load.image('tab_feature_on',  'assets/Graphics/Elements/tab_feature_on.png');
    this.load.image('tab_feature_off', 'assets/Graphics/Elements/tab_feature_off.png');
    this.load.image('tab_info_on',     'assets/Graphics/Elements/tab_info_on.png');
    this.load.image('tab_info_off',    'assets/Graphics/Elements/tab_info_off.png');
    this.load.image('arrow_btn',       'assets/Graphics/Elements/arrow_button_off.png');
    this.load.image('crown_btn',       'assets/Graphics/Elements/crown_button_off.png');
    this.load.image('anim_btn',        'assets/Graphics/Elements/btn_anim_4.png');
    this.load.image('play_btn',        'assets/Graphics/Elements/btn_anim_5.png');
    this.load.image('lower_third',     'assets/Graphics/Elements/lower_third.png');
  }

  create() {
    const W = this.scale.width;   // 1280
    const H = this.scale.height;  // 720

    // ── Orange background ──────────────────────────────────────────────────
    this.cameras.main.setBackgroundColor('#E48312');

    // Read key from URL
    this.myKey = getQueryParam('my_key') || 'S7V74GMC3Mwww';
    this.endpoints = buildEndpoints(this.myKey);

    this._buildBottomPanel(W, H);
    this._buildActivateBtn(W);
    this._bindGuideToggle();

    // Build/version stamp
    this.add.text(8, 8, 'Phaser Animate v2', {
      fontFamily: 'Arial', fontSize: '14px', color: '#00ff88',
      backgroundColor: '#111', padding: { x: 4, y: 2 }
    }).setDepth(1000).setAlpha(0.75);

    // Promo rotator
    this.time.addEvent({ delay: 5000, loop: true, callback: () => this._nextPromo() });
  }

  // ── Bottom-left panel ───────────────────────────────────────────────────
  // Reference layout (1280×720):
  //   Gold bar:   x=0, y≈630, w≈490, h≈90  (lower_third scaled)
  //   Banner:     x≈5, y≈610, w≈390, h≈55  (dark blue rounded rect + text)
  //   Icon row:   y≈660 (center), x starting at ~10, spacing ~80px
  //   Tabs stack: x≈405, y≈610 stacked downward, each ~75×38
  _buildBottomPanel(W, H) {
    // ── Gold bar ──
    // lower_third.png is 2442×488; scale to fit ~490px wide, ~90px tall
    const barW = 490;
    const barH = 90;
    const barX = 0;
    const barY = H - barH;   // 630
    const barScaleX = barW / 2442;
    const barScaleY = barH / 488;
    this.add.image(barX, barY, 'lower_third')
      .setOrigin(0, 0)
      .setScale(barScaleX, barScaleY)
      .setDepth(2);

    // ── Dark banner with promo text ──
    // Sits above-left of the gold bar, overlapping slightly
    const bannerX = 5;
    const bannerY = H - barH - 52;  // ~578
    const bannerW = 390;
    const bannerH = 58;

    const bannerG = this.add.graphics().setDepth(3);
    // Outer gold border
    bannerG.fillStyle(0xc8860a, 1);
    bannerG.fillRoundedRect(bannerX - 3, bannerY - 3, bannerW + 6, bannerH + 6, 14);
    // Inner dark blue fill
    bannerG.fillStyle(0x1a1f6e, 1);
    bannerG.fillRoundedRect(bannerX, bannerY, bannerW, bannerH, 12);

    // Promo text — two lines
    this.lblPromo1 = this.add.text(bannerX + bannerW / 2, bannerY + 14, '!ANIMATE + your idea', {
      fontFamily: 'Arial Black, Arial', fontSize: '17px', color: '#ffffff',
      fontStyle: 'bold', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 0).setDepth(4);

    this.lblPromo2 = this.add.text(bannerX + bannerW / 2, bannerY + 34, 'TO CREATE ANIMATION', {
      fontFamily: 'Arial Black, Arial', fontSize: '15px', color: '#ffe066',
      fontStyle: 'bold', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 0).setDepth(4);

    // ── Icon buttons on the gold bar ──
    // Arrow, Crown, ANIM, PLAY — centered vertically on bar, evenly spaced
    // Each scaled to ~70px display size
    const iconSize = 70;
    const iconY = H - barH / 2;  // vertical center of bar ≈ 675
    const iconStartX = 38;
    const iconSpacing = 82;

    const iconConfigs = [
      { key: 'arrow_btn',  srcW: 319 },
      { key: 'crown_btn',  srcW: 319 },
      { key: 'anim_btn',   srcW: 245 },
      { key: 'play_btn',   srcW: 232 },
    ];

    iconConfigs.forEach((cfg, i) => {
      const scale = iconSize / cfg.srcW;
      this.add.image(iconStartX + i * iconSpacing, iconY, cfg.key)
        .setOrigin(0.5, 0.5)
        .setScale(scale)
        .setDepth(5)
        .setInteractive({ useHandCursor: true });
    });

    // ── Tab buttons (GAMES / FEATURES / INFO) ──
    // Stacked vertically to the right of the banner
    // Tab images are 280×144; scale down to ~75×38 (scale ≈ 0.268)
    const tabScale = 0.268;
    const tabDisplayH = 144 * tabScale;  // ≈ 38.6
    const tabX = bannerX + bannerW + 10; // ≈ 405
    const tabStartY = bannerY;           // align top with banner

    const tabKeys = ['games', 'feature', 'info'];
    tabKeys.forEach((key, i) => {
      const ty = tabStartY + i * (tabDisplayH + 2);
      const img = this.add.image(tabX, ty, this.tabTextures[key].off)
        .setOrigin(0, 0)
        .setScale(tabScale)
        .setInteractive({ useHandCursor: true })
        .setDepth(6);
      this.tabs[key] = img;
      this.tabBaseX[key] = tabX;
      img.on('pointerdown', () => this._toggleTab(key));
    });

    // Toolbar container (invisible, used for tween logic)
    this.toolbarOutX = tabX;
    this.toolbarInX  = tabX + 240;
    this.toolbar = this.add.container(this.toolbarOutX, bannerY);
    this.toolbar.setDepth(5);

    this._setTabVisuals('');
  }

  // ── Activate button (top-right, small) ─────────────────────────────────
  _buildActivateBtn(W) {
    const pad = 12;
    this.activateBtn = this.add.text(W - 160 - pad, pad, 'Activate Chatbot', {
      fontFamily: 'Arial', fontSize: '16px', color: '#000000',
      backgroundColor: '#ffd14a', padding: { x: 6, y: 4 }
    }).setInteractive({ useHandCursor: true }).setDepth(10);

    this.activateBtn.on('pointerdown', async () => { this._onActivate(); });
  }

  _nextPromo() {
    this.promoIndex = (this.promoIndex + 1) % this.promoLines.length;
    const line = this.promoLines[this.promoIndex];
    // Alternate between the two text nodes for variety
    this.lblPromo1.setText(line);
    this.lblPromo2.setText('TO CREATE ANIMATION');
  }

  async _onActivate() {
    try {
      this.lblPromo1.setText('...activating...');
      this.activateBtn.disableInteractive().setAlpha(0.6);
      await safeRequest(this.endpoints.initialize, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }
      });
      this._startPolling();
      this.lblPromo1.setText('Activated!');
    } catch (e) {
      this.lblPromo1.setText('Activation failed; retry after broadcast starts');
      this.activateBtn.setInteractive().setAlpha(1);
    }
  }

  // ── Tab toggle & tween ──────────────────────────────────────────────────
  _getTabNode(tab) {
    if (tab === 'games')   return this.tabs.games;
    if (tab === 'feature') return this.tabs.feature;
    if (tab === 'info')    return this.tabs.info;
    return null;
  }

  _setTabVisuals(activeTab) {
    ['games', 'feature', 'info'].forEach((key) => {
      const node = this._getTabNode(key);
      if (!node) return;
      const isActive = key === activeTab;
      node.setTexture(this.tabTextures[key][isActive ? 'on' : 'off']);
      node.setAlpha(isActive ? 1.0 : (activeTab ? 0.6 : 0.95));
      if (node.input) node.input.enabled = !(activeTab && !isActive);
    });
  }

  _toggleTab(tab) {
    if (this.toolbarAnimating) return;

    if (!this.activeTab) {
      this.activeTab = tab;
      this._setTabVisuals(tab);
      this._tweenToolbar(true, '', tab);
      return;
    }
    if (this.activeTab === tab) {
      const prev = this.activeTab;
      this.activeTab = '';
      this._setTabVisuals('');
      this._tweenToolbar(false, prev, '');
      return;
    }
    const prev = this.activeTab;
    this.activeTab = tab;
    this._setTabVisuals(tab);
    this._tweenToolbar(true, prev, tab);
  }

  _tweenToolbar(expand, prevTab = '', newTab = '') {
    if (!this.toolbar) return;
    this.tweens.killTweensOf(this.toolbar);
    const prevBtn = this._getTabNode(prevTab);
    const newBtn  = this._getTabNode(newTab);
    if (prevBtn) this.tweens.killTweensOf(prevBtn);
    if (newBtn)  this.tweens.killTweensOf(newBtn);

    const toX   = expand ? this.toolbarInX : this.toolbarOutX;
    const delta = this.toolbarInX - this.toolbarOutX;
    this.toolbarAnimating = true;

    const tweens = [];
    tweens.push({ targets: this.toolbar, x: toX, duration: 220, ease: 'Quad.easeOut' });

    if (prevBtn && prevTab && this.tabBaseX[prevTab] !== undefined) {
      tweens.push({ targets: prevBtn, x: this.tabBaseX[prevTab], duration: 220, ease: 'Quad.easeOut' });
    }
    if (newBtn && expand && newTab && this.tabBaseX[newTab] !== undefined) {
      tweens.push({ targets: newBtn, x: this.tabBaseX[newTab] + delta, duration: 220, ease: 'Quad.easeOut' });
    }

    this.toolbarTween = this.tweens.timeline({
      tweens,
      onComplete: () => { this.toolbarAnimating = false; }
    });
  }

  // ── Debug guide toggle (G key) ──────────────────────────────────────────
  _bindGuideToggle() {
    if (!this.input || !this.input.keyboard) return;
    this.input.keyboard.on('keydown-G', () => {
      if (this._guideG) { this._guideG.destroy(); this._guideG = null; return; }
      const g = this.add.graphics().setDepth(1000);
      this._guideG = g;
      g.lineStyle(2, 0x00ff88, 0.9);
      const cross = (x, y) => {
        g.strokeLineShape(new Phaser.Geom.Line(x - 8, y, x + 8, y));
        g.strokeLineShape(new Phaser.Geom.Line(x, y - 8, x, y + 8));
      };
      // Mark tab anchor points
      Object.keys(this.tabs).forEach((k) => {
        const n = this.tabs[k];
        if (n) cross(n.x, n.y);
      });
    });
  }

  // ── Polling & Watchdog ──────────────────────────────────────────────────
  _startPolling() {
    this._lastPollMs = performance.now();
    if (this._pollTimer) clearInterval(this._pollTimer);

    const tick = async () => {
      if (this._isRequesting) {
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

    tick();
    this._pollTimer = setInterval(tick, this._pollIntervalMs);
  }
}
