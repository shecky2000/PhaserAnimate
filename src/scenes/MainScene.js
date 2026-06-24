// Animate (Phaser) — v4 — Full Godot-faithful port
// Layout derived from Main.tscn + confirmed design review

const BASE_URL = 'https://showblam.com/';
const POLL_DELAY_MS      = 4500;   // Godot: yield(timer(4.5), "timeout")
const WATCHDOG_MS        = 12000;  // Godot: _poll_watchdog_interval_ms = 12000
const WATCHDOG_STUCK_MS  = 17000;  // Godot: watchdog + 5000 for stuck-request cancel
const PROMO_INTERVAL_MS  = 5000;

// ── Godot scene geometry (ButtonHolder offset = Vector2(1, -655)) ──────────
// All Godot margin_top values are in ButtonHolder space.
// ButtonHolder lives inside PanelContainer which starts at canvas Y=655.
// So canvas_Y = margin_top (ButtonHolder space) + 655 - 655 = margin_top.
// But ButtonHolder itself has position.y = -655, so:
//   canvas_Y = PanelContainer.top + ButtonHolder.y + margin_top
//            = 655 + (-655) + margin_top = margin_top
// i.e. the margin_top values ARE the canvas Y coordinates directly.

// Icon buttons (canvas coords from scene):
//   TextureButton (arrow):     margin_left=3,   margin_top=648, right=73,  bottom=718  → 70×70
//   btn_show_rant (crown):     margin_left=84,  margin_top=648, right=155, bottom=721  → 71×73
//   btn_animate (anim):        margin_left=163, margin_top=647, right=224, bottom=705  → 61×58
//   btn_play_animation (play): margin_left=241, margin_top=645, right=334, bottom=733  → 93×88

// Tab buttons:
//   tab_games:   margin_left=355, margin_top=601, right=432, bottom=641  → 77×40
//   tab_feature: margin_left=355, margin_top=640, right=432, bottom=680  → 77×40
//   tab_info:    margin_left=355, margin_top=679, right=432, bottom=719  → 77×40

// Promo labels (canvas coords):
//   Label "!ANIMATE + your idea":  margin_left=6, margin_top=556, right=361, bottom=613
//   lbl_Promo_1 "TO CREATE ANIM":  margin_left=6, margin_top=592, right=361, bottom=655

// Panel (gold bar area): margin_top=655, bottom=717 → Y=655, H=62 (but lower_third extends below)

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name) || '';
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');

    // ── API ──
    this.endpoints    = null;
    this.myKey        = '';

    // ── Polling state (mirrors Godot) ──
    this._lastPollMs      = 0;
    this._isRequesting    = false;
    this._checkMessagesOk = 0;   // Godot: check_messages_ok — 0=paused, 1=polling
    this._checkIntermissionOk = 0;
    this._activationDone  = false;
    this._pollLoopRunning = false;

    // ── Data queues (mirrors Godot) ──
    this.animationQueue        = [];
    this.animationReadyQueue   = [];
    this.downloadedAnimations  = [];
    this.rantQueue             = [];
    this.submittedAnimationIds = {};
    this.deletedAnimationIds   = {};
    this.seenRantIds           = {};
    this.queuedRantIds         = {};
    this.numRants              = 0;
    this.numAnimations         = 0;
    this._playingAnimationId   = 0;
    this._lastRantRefreshMs    = 0;
    this.curDisplayMode        = 'intermission';
    this.featureMode           = false;

    // ── Promo ──
    this.promoLines = [
      'Type !ANIMATE <your_animation_idea> in chat',
      'Use !INVENTORY to see your items',
      'Type !COMMENT to report an issue or suggestion',
      'Use !DOUBLE or !TRIPLE to boost your next game',
    ];
    this.promoIndex = 0;

    // ── Toolbar / tab state ──
    this.activeTab        = '';
    this.toolbarOutX      = 0;
    this.toolbarInX       = 0;
    this.toolbarAnimating = false;
    this.tabBaseX         = { games: 0, feature: 0, info: 0 };

    // ── UI node refs ──
    this.lblPromo1    = null;
    this.lblPromo2    = null;
    this.arrowBtn     = null;
    this.crownBtn     = null;
    this.animBtn      = null;
    this.playBtn      = null;
    this.tabs         = { games: null, feature: null, info: null };
    this.crownCounter = null;
    this.animCounter  = null;
    this.playCounter  = null;
    this.crownCounterLbl = null;
    this.animCounterLbl  = null;
    this.playCounterLbl  = null;
  }

  // ════════════════════════════════════════════════════════════════════════
  preload() {
    this.load.image('tab_games_on',          'assets/Graphics/Elements/tab_games_on.png');
    this.load.image('tab_games_off',         'assets/Graphics/Elements/tab_games_off.png');
    this.load.image('tab_feature_on',        'assets/Graphics/Elements/tab_feature_on.png');
    this.load.image('tab_feature_off',       'assets/Graphics/Elements/tab_feature_off.png');
    this.load.image('tab_info_on',           'assets/Graphics/Elements/tab_info_on.png');
    this.load.image('tab_info_off',          'assets/Graphics/Elements/tab_info_off.png');
    this.load.image('arrow_btn_off',         'assets/Graphics/Elements/arrow_button_off.png');
    this.load.image('arrow_btn_on',          'assets/Graphics/Elements/arrow_button_on.png');
    this.load.image('crown_btn_off',         'assets/Graphics/Elements/crown_button_off.png');
    this.load.image('crown_btn_on',          'assets/Graphics/Elements/crown_button_on.png');
    this.load.image('anim_btn',              'assets/Graphics/Elements/btn_anim_4.png');
    this.load.image('play_btn',              'assets/Graphics/Elements/play_on.png');
    this.load.image('lower_third',           'assets/Graphics/Elements/lower_third.png');
    this.load.image('feature_circle',        'assets/Graphics/Elements/feature_circle.png');
    this.load.image('prompt_cozy',           'assets/Graphics/Elements/prompt_cozy_3.png');
  }

  // ════════════════════════════════════════════════════════════════════════
  create() {
    // Read key from URL
    this.myKey     = getQueryParam('my_key') || 'S7V74GMC3Mwww';
    this.endpoints = buildEndpoints(this.myKey);

    // Orange background
    this.cameras.main.setBackgroundColor('#E48312');

    // Build UI layers
    this._buildGoldBorders();
    this._buildBottomPanel();

    // Version stamp (dev aid)
    this.add.text(8, 8, 'Phaser Animate v4', {
      fontFamily: 'Arial', fontSize: '13px', color: '#00ff88',
      backgroundColor: '#111111', padding: { x: 4, y: 2 },
    }).setDepth(1000).setAlpha(0.7);

    // Promo rotator
    this.time.addEvent({
      delay: PROMO_INTERVAL_MS,
      loop: true,
      callback: this._nextPromo,
      callbackScope: this,
    });

    // Initial UI state — show arrow button, hide action buttons
    this._updateIntermissionButtons();
  }

  // ════════════════════════════════════════════════════════════════════════
  // update() — Godot _process() watchdog equivalent
  // ════════════════════════════════════════════════════════════════════════
  update() {
    if (this._checkMessagesOk !== 1) return;
    const now = performance.now();
    if (!this._isRequesting && (now - this._lastPollMs > WATCHDOG_MS)) {
      console.log('WATCHDOG: restarting poll_check_messages');
      this._pollCheckMessages();
    } else if (this._isRequesting && (now - this._lastPollMs > WATCHDOG_STUCK_MS)) {
      console.log('WATCHDOG: canceling stuck poll and restarting');
      this._isRequesting = false;
      this._pollCheckMessages();
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // LAYOUT BUILDERS
  // ════════════════════════════════════════════════════════════════════════

  _buildGoldBorders() {
    const W = this.scale.width;
    const H = this.scale.height;
    const g = this.add.graphics().setDepth(1);
    g.fillStyle(0xc8860a, 1);
    g.fillRect(0, 0, W, 5);
    g.fillRect(0, H - 5, W, 5);
  }

  _buildBottomPanel() {
    const W = this.scale.width;   // 1280
    const H = this.scale.height;  // 720

    // ── Gold bar (lower_third.png: 2442×488) ──────────────────────────────
    // Godot Toolbar_image: position=(11.5, 670.5), scale=(0.3, 0.281), flip_v=true
    // Display size: 2442*0.3=733px wide, 488*0.281=137px tall
    // Center at (11.5, 670.5) → left edge = 11.5 - 733/2 = -355 (extends off-screen left)
    // Top edge = 670.5 - 137/2 = 602, bottom = 670.5 + 137/2 = 739 (below canvas)
    // flip_v=true means the image is flipped vertically (decorative curve faces up)
    // In Phaser: use scaleY negative to flip vertically, or flipY=true
    // lower_third display: 733px wide, 137px tall, centered at (11.5, 670.5) in Godot.
    // Godot canvas is also 1280x720, so left edge = 11.5 - 366.5 = -355 (off-screen left).
    // Visible right edge = 11.5 + 366.5 = 378px.
    // The reference screenshot shows the bar extending to ~490px (past the tabs at 432px).
    // We scale the bar wider to cover the full panel: target right edge ~500px.
    // Keep the same height and Y position. Scale X up proportionally.
    // New scaleX: to get right edge at 500px with center at 11.5 → half-width=488.5 → scaleX=488.5*2/2442=0.4
    this.add.image(11.5, 670.5, 'lower_third')
      .setOrigin(0.5, 0.5)
      .setScale(0.4, 0.281)
      .setFlipY(true)
      .setDepth(2);

    // ── Promo text labels ─────────────────────────────────────────────────
    // Godot: Label "!ANIMATE + your idea" margin_top=556, margin_bottom=613
    //        lbl_Promo_1 "TO CREATE ANIMATION" margin_top=592, margin_bottom=655
    // These are absolute canvas Y coords (ButtonHolder offset cancels out).
    this.lblPromo1 = this._makePromoText(
      '!ANIMATE + your idea',
      6, 361, 556, 613,
      '#ffffff', '20px'
    );
    this.lblPromo2 = this._makePromoText(
      'TO CREATE ANIMATION',
      6, 361, 592, 655,
      '#ffe066', '18px'
    );

    // ── Banner background (prompt_cozy_3.png: 617×586) ───────────────────
    // Godot: btn_exit (the arrow button at line 578) has texture=prompt_cozy_3
    // at margin_left=5, margin_top=589, margin_right=60, margin_bottom=629
    // BUT that is the arrow button's background — not the promo panel.
    // The promo panel background is drawn by the Panel node's custom_style (SubResource 20)
    // which is a StyleBoxFlat. We replicate it as a drawn rectangle.
    // Panel: margin_top=655, bottom=717 → Y=655, H=62
    // The promo text sits ABOVE the panel (Y=556-655), so we draw a dark rounded rect
    // covering the label area: X=4, Y=550, W=360, H=108
    const bannerG = this.add.graphics().setDepth(3);
    // Gold border
    bannerG.fillStyle(0xc8860a, 1);
    bannerG.fillRoundedRect(2, 548, 364, 112, 14);
    // Dark blue inner fill
    bannerG.fillStyle(0x1a1f6e, 1);
    bannerG.fillRoundedRect(5, 551, 358, 106, 12);

    // ── Icon buttons ──────────────────────────────────────────────────────
    // Canvas coords from scene (margin values = canvas coords):
    //   arrow:  left=3,   top=648, right=73,  bottom=718  → center (38, 683)
    //   crown:  left=84,  top=648, right=155, bottom=721  → center (119, 684)
    //   anim:   left=163, top=647, right=224, bottom=705  → center (193, 676)
    //   play:   left=241, top=645, right=334, bottom=733  → center (287, 689)

    // Arrow button — activation trigger
    this.arrowBtn = this._makeIconBtn('arrow_btn_off', 319, 313, 3, 648, 73, 718);
    this.arrowBtn.on('pointerdown', () => this._onArrowPressed());

    // Crown button (rant/donations) — hidden until num_rants > 0
    this.crownBtn = this._makeIconBtn('crown_btn_off', 319, 313, 84, 648, 155, 721);
    this.crownBtn.on('pointerdown', () => this._onCrownPressed());
    this.crownBtn.setVisible(false);

    // ANIM button (review animation submissions) — always visible
    this.animBtn = this._makeIconBtn('anim_btn', 245, 236, 163, 647, 224, 705);
    this.animBtn.on('pointerdown', () => this._onAnimPressed());

    // PLAY button (play downloaded animation) — hidden until download available
    this.playBtn = this._makeIconBtn('play_btn', 884, 744, 241, 645, 334, 733);
    this.playBtn.on('pointerdown', () => this._onPlayPressed());
    this.playBtn.setVisible(false);

    // ── Counter badges ────────────────────────────────────────────────────
    // Godot: counter Sprite at position=Vector2(60, 3) relative to button top-left
    //        scale=0.0626649 → feature_circle 383px * 0.0627 ≈ 24px display
    // Button top-left in canvas space = (margin_left+1, margin_top)
    // Counter center = (btn_left + 60, btn_top + 3)
    const BADGE_SCALE = 0.0626649;

    // Crown counter: btn_left=85, btn_top=648 → badge center=(145, 651)
    [this.crownCounter, this.crownCounterLbl] = this._makeCounter(145, 651, BADGE_SCALE);
    this.crownCounter.setVisible(false);
    this.crownCounterLbl.setVisible(false);

    // ANIM counter: btn_left=164, btn_top=647 → badge center=(224, 650)
    [this.animCounter, this.animCounterLbl] = this._makeCounter(224, 650, BADGE_SCALE);

    // PLAY counter: btn_left=242, btn_top=645 → badge center=(302, 648)
    [this.playCounter, this.playCounterLbl] = this._makeCounter(302, 648, BADGE_SCALE);
    this.playCounter.setVisible(false);
    this.playCounterLbl.setVisible(false);

    // ── Tab buttons ───────────────────────────────────────────────────────
    // Canvas coords from scene (same ButtonHolder offset logic):
    //   tab_games:   left=355, top=601, right=432, bottom=641  → 77×40
    //   tab_feature: left=355, top=640, right=432, bottom=680  → 77×40
    //   tab_info:    left=355, top=679, right=432, bottom=719  → 77×40
    // Tab images are 280×144; scale to fit 77×40
    const tabScaleX = 77 / 280;
    const tabScaleY = 40 / 144;
    const tabDefs = [
      { key: 'games',   top: 601 },
      { key: 'feature', top: 640 },
      { key: 'info',    top: 679 },
    ];
    tabDefs.forEach(({ key, top }) => {
      const img = this.add.image(355, top, `tab_${key}_off`)
        .setOrigin(0, 0)
        .setScale(tabScaleX, tabScaleY)
        .setInteractive({ useHandCursor: true })
        .setDepth(6);
      this.tabs[key]    = img;
      this.tabBaseX[key] = 355;
      img.on('pointerdown', () => this._toggleTab(key));
    });

    // Toolbar tween reference point — tabs start at X=355, slide +240 to X=595
    this.toolbarOutX = 355;
    this.toolbarInX  = 355 + 240;
  }

  // ── Helper: make a promo text label ──────────────────────────────────────
  _makePromoText(text, left, right, top, bottom, color, fontSize) {
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    return this.add.text(cx, cy, text, {
      fontFamily: 'Arial Black, Impact, Arial',
      fontSize,
      color,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
      align: 'center',
      wordWrap: { width: right - left },
    }).setOrigin(0.5, 0.5).setDepth(4);
  }

  // ── Helper: make an icon button image, scaled to fit bounding box ─────────
  _makeIconBtn(textureKey, srcW, srcH, left, top, right, bottom) {
    const displayW = right - left;
    const displayH = bottom - top;
    const scale    = Math.min(displayW / srcW, displayH / srcH);
    const cx = left + displayW / 2;
    const cy = top  + displayH / 2;
    return this.add.image(cx, cy, textureKey)
      .setOrigin(0.5, 0.5)
      .setScale(scale)
      .setInteractive({ useHandCursor: true })
      .setDepth(5);
  }

  // ── Helper: make a counter badge (circle + number label) ─────────────────
  _makeCounter(x, y, scale) {
    const circle = this.add.image(x, y, 'feature_circle')
      .setOrigin(0.5, 0.5)
      .setScale(scale)
      .setDepth(7);
    const lbl = this.add.text(x, y, '0', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '13px',
      color: '#d8da70',   // Godot: Color(0.847, 0.855, 0.439) ≈ yellowish
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5, 0.5).setDepth(8);
    return [circle, lbl];
  }

  // ════════════════════════════════════════════════════════════════════════
  // BUTTON HANDLERS
  // ════════════════════════════════════════════════════════════════════════

  _onArrowPressed() {
    // Arrow button = activation trigger (Godot: _on_TextureButton_pressed)
    if (this._activationDone) return;
    this.arrowBtn.setTexture('arrow_btn_on');
    this.arrowBtn.disableInteractive();
    this.lblPromo1.setText('...activating chatbot...');
    this._doInitialize();
  }

  async _doInitialize() {
    try {
      await safeRequest(this.endpoints.initialize, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      this._activationDone = true;
      this._showIntermissionButtons();
    } catch (e) {
      console.error('STARTUP: initialization_failed', e);
      this.lblPromo1.setText('Refresh once you\'ve started the broadcast');
      this.arrowBtn.setTexture('arrow_btn_off');
      this.arrowBtn.setInteractive();
    }
  }

  _onCrownPressed() {
    // Godot: _on_btn_show_rant_pressed → RantViewer._on_btn_show_rant_pressed
    console.log('GET RANT');
    // TODO: implement rant viewer display
  }

  _onAnimPressed() {
    // Godot: _on_btn_animate_pressed
    console.log('ANIMATE: review panel');
    // TODO: implement animation review panel
  }

  _onPlayPressed() {
    // Godot: _on_btn_play_animation_pressed
    if (this.downloadedAnimations.length === 0) {
      console.log('ANIMATION: No downloaded animations to play');
      return;
    }
    console.log('ANIMATION: play next');
    // TODO: implement video player
  }

  // ════════════════════════════════════════════════════════════════════════
  // INTERMISSION BUTTON VISIBILITY (mirrors Godot show_intermission_buttons)
  // ════════════════════════════════════════════════════════════════════════

  _showIntermissionButtons() {
    console.log('STARTUP: show_intermission_buttons');
    this._checkIntermissionOk = 1;
    this._updateIntermissionButtons();
    this._checkMessagesOk = 1;
    this._pollCheckMessages();
  }

  _updateIntermissionButtons() {
    // Arrow: visible only when NOT yet activated AND no action buttons showing
    const hasActions = this.animationQueue.length > 0 || this.numRants > 0;
    if (this.arrowBtn) {
      this.arrowBtn.setVisible(!this._activationDone && !hasActions);
    }

    // ANIM: always visible (host may self-submit)
    if (this.animBtn) this.animBtn.setVisible(true);
    if (this.animCounter && this.animCounterLbl) {
      const count = this.animationQueue.length;
      this.animCounterLbl.setText(String(count));
      // Counter badge visible even at 0 (matches Godot — counter_value always set)
    }

    // CROWN: visible only when num_rants > 0
    if (this.crownBtn) this.crownBtn.setVisible(this.numRants > 0);
    if (this.crownCounter && this.crownCounterLbl) {
      this.crownCounter.setVisible(this.numRants > 0);
      this.crownCounterLbl.setVisible(this.numRants > 0);
      this.crownCounterLbl.setText(String(this.numRants));
    }

    // PLAY: visible only when downloaded_animations.length > 0
    const hasDownloaded = this.downloadedAnimations.length > 0;
    if (this.playBtn) this.playBtn.setVisible(hasDownloaded);
    if (this.playCounter && this.playCounterLbl) {
      this.playCounter.setVisible(hasDownloaded);
      this.playCounterLbl.setVisible(hasDownloaded);
      this.playCounterLbl.setText(String(this.downloadedAnimations.length));
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // POLLING (mirrors Godot poll_check_messages + _on_HTTP_API_poll_check_messages_request_completed)
  // ════════════════════════════════════════════════════════════════════════

  async _pollCheckMessages() {
    // Godot: if is_requesting: return
    if (this._isRequesting) return;
    if (this._checkMessagesOk !== 1) {
      console.log('poll_check_messages: polling paused (spin/swap in progress)');
      return;
    }

    this._lastPollMs   = performance.now();
    this._isRequesting = true;
    console.log('STARTUP: poll_check_messages');

    let data = null;
    try {
      data = await safeRequest(this.endpoints.poll_check_messages, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      console.error('POLL: request failed', e);
    } finally {
      this._isRequesting = false;
      this._lastPollMs   = performance.now();
    }

    if (data) {
      this._processPollData(data);
    }

    // Godot: yield(get_tree().create_timer(4.5), "timeout") then recurse
    if (this._checkMessagesOk === 1) {
      await sleep(POLL_DELAY_MS);
      this._pollCheckMessages();
    }
  }

  _processPollData(data) {
    // ── animation_ready ──
    if (data.animation_ready) {
      for (const item of data.animation_ready) {
        const itId = parseInt(item.id ?? -1);
        if (itId === parseInt(this._playingAnimationId)) continue;
        const alreadyDl = this.downloadedAnimations.some(d => parseInt(d.id ?? -1) === itId);
        const alreadyRq = this.animationReadyQueue.some(r => parseInt(r.id ?? -1) === itId);
        if (!alreadyDl && !alreadyRq) {
          this.animationReadyQueue.push(item);
        }
      }
      this._updatePlayAnimationButton();
    }

    // ── animation_pending ──
    if (data.animation_pending) {
      for (const item of data.animation_pending) {
        const itId = parseInt(item.id ?? -1);
        if (this.submittedAnimationIds[itId]) continue;
        if (this.deletedAnimationIds[itId]) continue;
        const alreadyQueued = this.animationQueue.some(e => parseInt(e.id ?? -1) === itId);
        if (!alreadyQueued) {
          this.animationQueue.push(item);
          this.numAnimations++;
          console.log('POLL: New animation queued, id=', item.id);
        }
      }
      if (this.animCounterLbl) {
        this.animCounterLbl.setText(String(this.animationQueue.length));
      }
      if (!this.featureMode && this.curDisplayMode === 'intermission') {
        this.animBtn.setVisible(true); // always visible
      }
    }

    // ── rant_count_updated / rant_data ──
    const rantItems = data.rant_count_updated ? (data.rant_data || []) : (data.rant_data || []);
    for (const item of rantItems) {
      const rid = parseInt(item.id ?? -1);
      if (rid >= 0 && !this.seenRantIds[rid] && !this.queuedRantIds[rid]) {
        this.rantQueue.push(item);
        this.queuedRantIds[rid] = true;
      }
    }
    if (rantItems.length > 0) {
      this.numRants = this.rantQueue.length;
      this._lastRantRefreshMs = performance.now();
      if (!this.featureMode && this.curDisplayMode === 'intermission') {
        this._updateIntermissionButtons();
      }
    } else if (this.curDisplayMode === 'intermission') {
      // Godot fallback: if no rant_data and in intermission, refresh occasionally
      const now = performance.now();
      if (now - this._lastRantRefreshMs > 2000) {
        this._getIntermissionVariables();
      }
    }

    // Update all button states
    if (!this.featureMode && this.curDisplayMode === 'intermission') {
      this._updateIntermissionButtons();
    }
  }

  _updatePlayAnimationButton() {
    if (this.featureMode || this.curDisplayMode !== 'intermission') {
      if (this.playBtn) this.playBtn.setVisible(false);
      return;
    }
    const hasDownloaded = this.downloadedAnimations.length > 0;
    if (this.playBtn) this.playBtn.setVisible(hasDownloaded);
    if (this.playCounter)    this.playCounter.setVisible(hasDownloaded);
    if (this.playCounterLbl) {
      this.playCounterLbl.setVisible(hasDownloaded);
      this.playCounterLbl.setText(String(this.downloadedAnimations.length));
    }
  }

  async _getIntermissionVariables() {
    console.log('STARTUP: get_intermission_variables');
    try {
      const data = await safeRequest(this.endpoints.get_intermission, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (data) this._processIntermissionData(data);
    } catch (e) {
      console.error('INTERMISSION: request failed', e);
    }
  }

  _processIntermissionData(data) {
    this.animationQueue      = [];
    this.animationReadyQueue = [];
    this.numAnimations       = 0;

    if (data.rant_data) {
      for (const item of data.rant_data) {
        const rid = parseInt(item.id ?? -1);
        if (rid >= 0 && !this.seenRantIds[rid] && !this.queuedRantIds[rid]) {
          this.rantQueue.push(item);
          this.queuedRantIds[rid] = true;
        }
      }
      this.numRants = this.rantQueue.length;
      this._lastRantRefreshMs = performance.now();
    }

    if (data.animation_pending) {
      for (const item of data.animation_pending) {
        const itId = parseInt(item.id ?? -1);
        if (this.submittedAnimationIds[itId]) continue;
        if (this.deletedAnimationIds[itId]) continue;
        const alreadyQueued = this.animationQueue.some(e => parseInt(e.id ?? -1) === itId);
        if (!alreadyQueued) this.animationQueue.push(item);
      }
    }
    if (data.animation_ready) {
      for (const item of data.animation_ready) {
        const exists = this.downloadedAnimations.some(d => parseInt(d.id ?? -1) === parseInt(item.id ?? -1));
        if (!exists) this.animationReadyQueue.push(item);
      }
    }

    if (!this.featureMode && this.curDisplayMode === 'intermission') {
      this._updateIntermissionButtons();
    }
    this._checkMessagesOk = 1;
    this._pollCheckMessages();
  }

  // ════════════════════════════════════════════════════════════════════════
  // TAB TOGGLE & TOOLBAR TWEEN
  // ════════════════════════════════════════════════════════════════════════

  _toggleTab(tab) {
    if (this.toolbarAnimating) return;

    const prev = this.activeTab;
    if (this.activeTab === tab) {
      // Deselect — slide back
      this.activeTab = '';
      this._setTabVisuals('');
      this._tweenToolbar(false, prev, '');
    } else {
      // Select new tab
      this.activeTab = tab;
      this._setTabVisuals(tab);
      this._tweenToolbar(true, prev, tab);
    }
  }

  _setTabVisuals(activeTab) {
    ['games', 'feature', 'info'].forEach((key) => {
      const node = this.tabs[key];
      if (!node) return;
      const isActive = key === activeTab;
      node.setTexture(`tab_${key}_${isActive ? 'on' : 'off'}`);
      // Disabled-look for non-active tabs when one is active (matches Godot disabled=true)
      node.setAlpha(isActive ? 1.0 : (activeTab ? 0.55 : 1.0));
      if (node.input) node.input.enabled = !(activeTab && !isActive);
    });
  }

  _tweenToolbar(expand, prevTab = '', newTab = '') {
    // Kill any running tweens on affected nodes
    const prevBtn = this.tabs[prevTab] || null;
    const newBtn  = this.tabs[newTab]  || null;
    if (prevBtn) this.tweens.killTweensOf(prevBtn);
    if (newBtn)  this.tweens.killTweensOf(newBtn);

    const delta = this.toolbarInX - this.toolbarOutX; // 240

    this.toolbarAnimating = true;

    const tweenDefs = [];

    // Move the selected tab button with the toolbar (+240px when expanding)
    if (newBtn && expand) {
      tweenDefs.push({
        targets: newBtn,
        x: this.tabBaseX[newTab] + delta,
        duration: 220,
        ease: 'Quad.easeOut',
      });
    }

    // Return the previously selected tab button to its base position
    if (prevBtn && prevTab) {
      tweenDefs.push({
        targets: prevBtn,
        x: this.tabBaseX[prevTab],
        duration: 220,
        ease: 'Quad.easeOut',
      });
    }

    if (tweenDefs.length === 0) {
      this.toolbarAnimating = false;
      return;
    }

    // Run all tweens in parallel; mark done when all complete
    let completed = 0;
    tweenDefs.forEach(def => {
      this.tweens.add({
        ...def,
        onComplete: () => {
          completed++;
          if (completed === tweenDefs.length) {
            this.toolbarAnimating = false;
          }
        },
      });
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // PROMO ROTATOR
  // ════════════════════════════════════════════════════════════════════════

  _nextPromo() {
    this.promoIndex = (this.promoIndex + 1) % this.promoLines.length;
    if (this.lblPromo1) this.lblPromo1.setText(this.promoLines[this.promoIndex]);
    // lblPromo2 stays as "TO CREATE ANIMATION" (Godot lbl_Promo_1 default text)
  }
}
