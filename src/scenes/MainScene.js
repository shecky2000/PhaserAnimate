// MainScene.js — Phaser port of Godot Animate
// Layout derived from Main.tscn + confirmed design review
// v5: Full panel implementation (RantViewer, PromptFeature, VideoPlayer stub)

const BASE_URL = 'https://showblam.com/';
const POLL_DELAY_MS      = 4500;   // Godot: yield(timer(4.5), "timeout")
const WATCHDOG_MS        = 12000;  // Godot: _poll_watchdog_interval_ms = 12000
const WATCHDOG_STUCK_MS  = 17000;  // Godot: watchdog + 5000 for stuck-request cancel
const PROMO_INTERVAL_MS  = 10000;  // Godot: _promo_timer.wait_time = 10.0

// ── Godot scene geometry ──────────────────────────────────────────────────────
// ButtonHolder: position=Vector2(1,-655) inside PanelContainer at canvas Y=655
// So canvas_Y = margin_top directly (offsets cancel).
//
// Icon buttons (canvas coords):
//   arrow:  left=3,   top=648, right=73,  bottom=718  → 70×70, center=(38,683)
//   crown:  left=84,  top=648, right=155, bottom=721  → 71×73, center=(119,684)
//   anim:   left=163, top=647, right=224, bottom=705  → 61×58, center=(193,676)
//   play:   left=241, top=645, right=334, bottom=733  → 93×88, center=(287,689)
//
// Tab buttons:
//   tab_games:   left=355, top=601, right=432, bottom=641  → 77×40
//   tab_feature: left=355, top=640, right=432, bottom=680  → 77×40
//   tab_info:    left=355, top=679, right=432, bottom=719  → 77×40
//
// Promo labels (canvas coords):
//   "!ANIMATE + your idea":  left=6, top=556, right=361, bottom=613
//   lbl_Promo_1:             left=6, top=592, right=361, bottom=655
//
// Global exit button (little_x.png): left=5, top=589, right=60, bottom=629
//
// RantViewer (Node2D): position=(38, 800) → bounces to (38, 425)
//   background (bk_rant.png): center=(603+38, 118+425)=(641,543), scale=(1.017,0.851)
//   lbl_rant_text:  left=590+38=628, top=21+425=446, right=1229+38=1267, bottom=185+425=610
//   lbl_rant_response_text: left=908+38=946, top=-146+425=279, right=1229+38=1267, bottom=-19+425=406
//   lbl_Promo_1 "THANK YOU!": left=38+38=76, top=-11+425=414, right=253+38=291, bottom=26+425=451
//   AuthorPic: position=(-389+38, 437+425)=(-351, 862) — off-screen left, not used in Phaser layout
//   btn_exit (little_x): left=-35+38=3, top=-29+425=396, right=20+38=58, bottom=11+425=436
//
// PromptFeature (Node2D): position=(0,25), visible=false
//   SubjectCozy (prompt_cozy_3.png): position=(522,266+25)=(522,291), scale=(0.85,0.85)
//   SubjectText (TextEdit): left=368, top=175+25=200, right=685, bottom=380+25=405
//   lbl_subject: left=371, top=100+25=125, right=682, bottom=144+25=169
//   btn_exit (little_x): left=7, top=530+25=555, right=62, bottom=570+25=595
//   SubjectSubmit: left=420, top=401+25=426, right=627, bottom=437+25=462
//   picOutline (topic_user_square): position=(126,102+25)=(126,127), scale=(0.475,0.475)
//   ProfilePic (TextureRect): left=61, top=35+25=60, right=94, bottom=68+25=93
//   lbl_submitted_by: left=393, top=449+25=474, right=653, bottom=480+25=505
//   lbl_author_name: left=298, top=447+25=472, right=752, bottom=516+25=541
//   btn_left: left=297, top=233+25=258, right=351, bottom=287+25=312, scale=(0.75,0.75)
//   btn_right: left=710, top=233+25=258, right=764, bottom=287+25=312, scale=(0.75,0.75)
//   btn_delete_prompt: left=282, top=327+25=352, right=349, bottom=394+25=419
//   Rejected: position=(127,100+25)=(127,125), scale=(0.5,0.5)
//
// VideoPlayer (Node2D): position=(470,208), scale=(2,2) — all children ×2
//   bk_vid (bk_queue_callout): pos=(81.5×2+470, 56×2+208)=(633,320), scale=(0.289×2,0.373×2)
//   vid (VideoPlayer): left=470, top=208, right=470+161×2=792, bottom=208+108×2=424
//   border: pos=(80×2+470,57.5×2+208)=(630,323), scale=(0.603×2,0.602×2)
//   lbl_prompt: left=-31×2+470=408, top=96×2+208=400, right=187×2+470=844, bottom=191×2+208=590
//   btn_exit: left=-217.5×2+470=35, top=175×2+208=558, right=-162.5×2+470=145, bottom=215×2+208=638, scale=(0.5,0.5)
//   btn_replay: left=44×2+470=558, top=-6×2+208=196, right=114×2+470=698, bottom=9×2+208=226

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

// Load an image URL and return an HTMLImageElement (for Phaser texture creation)
function loadImageUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load: ' + url));
    img.src = url;
  });
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
    this._checkMessagesOk = 0;   // 0=paused, 1=polling
    this._checkIntermissionOk = 0;
    this._activationDone  = false;

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
    this._isDownloading        = false;
    this._videoEl              = null;
    this._currentBlobUrl       = null;
    this._currentServerUrl     = null;
    this._lastRantRefreshMs    = 0;
    this.curDisplayMode        = 'intermission';
    this.featureMode           = false;
    this.featureReviewMode     = 'animation';
    this.animationOnDisplay    = 0;

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
    this.toolbarAnimating = false;
    this.tabBaseX         = { games: 0, feature: 0, info: 0 };
    this.toolbarImg       = null;
    this.toolbarBaseX     = 0;

    // ── UI node refs — intermission bar ──
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

    // ── Global exit button ──
    this.globalExitBtn = null;

    // ── RantViewer state ──
    this.rantViewerContainer = null;
    this.rantViewerMode      = 'hidden';  // 'hidden' | 'display'
    this.rantLblText         = null;
    this.rantLblResponse     = null;
    this.rantLblThankYou     = null;
    this.rantProfilePic      = null;
    this.rantAuthorName      = null;

    // ── PromptFeature state ──
    this.promptContainer     = null;
    this.promptSubjectText   = null;   // HTML textarea element
    this.promptLblSubject    = null;
    this.promptLblAuthor     = null;
    this.promptLblSubmittedBy = null;
    this.promptProfilePic    = null;
    this.promptSubmitBtn     = null;
    this.promptDeleteBtn     = null;
    this.promptBtnLeft       = null;
    this.promptBtnRight      = null;
    this.promptRejectedImg   = null;

    // ── VideoPlayer state ──
    this.videoContainer      = null;
    this.videoLblPrompt      = null;
    this.videoProfilePic     = null;
    this.videoAuthorName     = null;
    this.videoBtnReplay      = null;
    this.videoBtnExit        = null;
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
    this.load.image('play_btn',             'assets/Graphics/Elements/play_on.png');
    this.load.image('lower_third',           'assets/Graphics/Elements/lower_third.png');
    this.load.image('feature_circle',        'assets/Graphics/Elements/feature_circle.png');
    this.load.image('prompt_cozy',           'assets/Graphics/Elements/prompt_cozy_3.png');
    this.load.image('little_x',             'assets/Graphics/Elements/little_x.png');
    this.load.image('bk_rant',              'assets/Graphics/Backgrounds/bk_rant.png');
    this.load.image('bk_queue_callout',     'assets/Graphics/Backgrounds/bk_queue_callout.png');
    this.load.image('border_video',         'assets/Graphics/Backgrounds/border_video.png');
    this.load.image('topic_user_square',    'assets/Graphics/Elements/topic_user_square.png');
    this.load.image('btn_left_on',          'assets/Graphics/Elements/btn_left.png');
    this.load.image('btn_left_off',         'assets/Graphics/Elements/btn_left_off.png');
    this.load.image('btn_right_on',         'assets/Graphics/Elements/btn_right.png');
    this.load.image('btn_right_off',        'assets/Graphics/Elements/btn_right_off.png');
    this.load.image('submit_btn_on',        'assets/Graphics/Elements/submit_button_on.png');
    this.load.image('submit_btn_off',       'assets/Graphics/Elements/submit_button_off.png');
    this.load.image('btn_delete_on',        'assets/Graphics/Elements/btn_delete_prompt_on.png');
    this.load.image('btn_delete_off',       'assets/Graphics/Elements/btn_delete_prompt_off.png');
    this.load.image('rejected_img',         'assets/Graphics/Elements/rejected_01.png');
    this.load.image('btn_repeat_on',        'assets/Graphics/Elements/btn_repeat_on.png');
    this.load.image('btn_repeat_off',       'assets/Graphics/Elements/btn_repeat_off.png');
    this.load.image('reel_overlay',         'assets/Graphics/Elements/reel_overlay.png');
  }

  // ════════════════════════════════════════════════════════════════════════
  create() {
    this.myKey     = getQueryParam('my_key') || 'S7V74GMC3Mwww';
    this.endpoints = buildEndpoints(this.myKey);

    // Orange background
    this.cameras.main.setBackgroundColor('#E48312');

    // Build layers bottom-up (depth order)
    this._buildGoldBorders();
    this._buildBottomPanel();
    this._buildGlobalExitBtn();
    this._buildRantViewer();
    this._buildPromptFeature();
    this._buildVideoPlayer();

    // Release keys that Phaser captures by default so the DOM textarea receives them
    // (OBS CEF + Interact mode needs these to reach native inputs)
    this.input.keyboard.removeCapture(
      'BACKSPACE,DELETE,UP,DOWN,LEFT,RIGHT,HOME,END,TAB'
    );

    // Version stamp
    this.add.text(8, 8, 'Phaser Animate v5', {
      fontFamily: 'Arial', fontSize: '13px', color: '#00ff88',
      backgroundColor: '#111111', padding: { x: 4, y: 2 },
    }).setDepth(1000).setAlpha(0.7);

    // Promo rotator (10s, matches Godot)
    this.time.addEvent({
      delay: PROMO_INTERVAL_MS,
      loop: true,
      callback: this._nextPromo,
      callbackScope: this,
    });

    // Initial UI state
    this._updateIntermissionButtons();
  }

  // ════════════════════════════════════════════════════════════════════════
  // update() — Godot _process() watchdog
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
    // ── Gold bar (lower_third.png: 2442×488) ─────────────────────────────
    // Godot: position=(11.5,670.5), scale=(0.3,0.281), flip_v=true
    // We widen scaleX to 0.4 so the bar's right edge reaches ~500px (past tabs)
    this.toolbarImg = this.add.image(11.5, 670.5, 'lower_third')
      .setOrigin(0.5, 0.5)
      .setScale(0.4, 0.281)
      .setFlipY(true)
      .setDepth(2);
    this.toolbarBaseX = 11.5;

    // ── Promo labels ──────────────────────────────────────────────────────
    this.lblPromo1 = this._makePromoText('!ANIMATE + your idea',  6, 361, 556, 613, '#ffffff', '20px');
    this.lblPromo2 = this._makePromoText('TO CREATE ANIMATION',   6, 361, 592, 655, '#ffe066', '18px');

    // ── Banner background ─────────────────────────────────────────────────
    const bannerG = this.add.graphics().setDepth(3);
    bannerG.fillStyle(0xc8860a, 1);
    bannerG.fillRoundedRect(2, 548, 364, 112, 14);
    bannerG.fillStyle(0x1a1f6e, 1);
    bannerG.fillRoundedRect(5, 551, 358, 106, 12);

    // ── Icon buttons ──────────────────────────────────────────────────────
    this.arrowBtn = this._makeIconBtn('arrow_btn_off', 319, 313, 3, 648, 73, 718);
    this.arrowBtn.on('pointerdown', () => this._onArrowPressed());

    this.crownBtn = this._makeIconBtn('crown_btn_off', 319, 313, 84, 648, 155, 721);
    this.crownBtn.on('pointerdown', () => this._onCrownPressed());
    this.crownBtn.setVisible(false);

    this.animBtn = this._makeIconBtn('anim_btn', 245, 236, 163, 647, 224, 705);
    this.animBtn.on('pointerdown', () => this._onAnimPressed());

    this.playBtn = this._makeIconBtn('play_btn', 884, 744, 241, 645, 334, 733);
    this.playBtn.on('pointerdown', () => this._onPlayPressed());
    this.playBtn.setVisible(false);

    // ── Counter badges ────────────────────────────────────────────────────
    const BADGE_SCALE = 0.0626649;
    [this.crownCounter, this.crownCounterLbl] = this._makeCounter(145, 651, BADGE_SCALE);
    this.crownCounter.setVisible(false);
    this.crownCounterLbl.setVisible(false);

    [this.animCounter, this.animCounterLbl] = this._makeCounter(224, 650, BADGE_SCALE);

    [this.playCounter, this.playCounterLbl] = this._makeCounter(302, 648, BADGE_SCALE);
    this.playCounter.setVisible(false);
    this.playCounterLbl.setVisible(false);

    // ── Tab buttons ───────────────────────────────────────────────────────
    const BAR_RIGHT_EDGE = Math.round(11.5 + (2442 * 0.4 / 2));  // ~500
    const TAB_W = 77;
    const TAB_H = 40;
    const TAB_LEFT = BAR_RIGHT_EDGE - TAB_W;
    const tabScaleX = TAB_W / 280;
    const tabScaleY = TAB_H / 144;
    const tabDefs = [
      { key: 'games',   top: 601 },
      { key: 'feature', top: 640 },
      { key: 'info',    top: 679 },
    ];
    tabDefs.forEach(({ key, top }) => {
      const img = this.add.image(TAB_LEFT, top, `tab_${key}_on`)
        .setOrigin(0, 0)
        .setScale(tabScaleX, tabScaleY)
        .setInteractive({ useHandCursor: true })
        .setDepth(6);
      this.tabs[key]     = img;
      this.tabBaseX[key] = TAB_LEFT;
      img.on('pointerdown', () => this._toggleTab(key));
    });

    this.toolbarOutX = TAB_LEFT;
    this.toolbarInX  = TAB_LEFT + 240;
  }

  // ── Global exit button (little_x.png) ────────────────────────────────────
  // Godot: left=5, top=589, right=60, bottom=629 — hidden until a panel is open
  _buildGlobalExitBtn() {
    this.globalExitBtn = this._makeIconBtn('little_x', 100, 100, 5, 589, 60, 629);
    this.globalExitBtn.setDepth(50).setVisible(false);
    this.globalExitBtn.on('pointerdown', () => this._onBtnExitPressed());
  }

  // ════════════════════════════════════════════════════════════════════════
  // RANT VIEWER PANEL
  // Godot RantViewer: Node2D at position=(38,800), bounces to (38,425)
  // ════════════════════════════════════════════════════════════════════════
  _buildRantViewer() {
    // Container group — starts off-screen below
    this.rantViewerContainer = this.add.container(38, 800).setDepth(20).setVisible(false);

    // Background (bk_rant.png) — Godot: center=(603,118), scale=(1.017,0.851)
    // bk_rant dimensions unknown; use a drawn background as fallback
    const bkRant = this.add.image(603, 118, 'bk_rant')
      .setOrigin(0.5, 0.5)
      .setScale(1.017, 0.851);
    this.rantViewerContainer.add(bkRant);

    // "THANK YOU!" label — Godot: left=38, top=-11, right=253, bottom=26 (relative to RantViewer)
    this.rantLblThankYou = this.add.text(145, 7, 'THANK YOU!', {
      fontFamily: 'Arial Black, Impact, Arial',
      fontSize: '28px',
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
      align: 'center',
    }).setOrigin(0.5, 0.5);
    this.rantViewerContainer.add(this.rantLblThankYou);

    // Rant text — Godot: left=590, top=21, right=1229, bottom=185
    this.rantLblText = this.add.text(909, 103, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '22px',
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
      align: 'center',
      wordWrap: { width: 639 },
    }).setOrigin(0.5, 0.5);
    this.rantViewerContainer.add(this.rantLblText);

    // Rant response text — Godot: left=908, top=-146, right=1229, bottom=-19
    this.rantLblResponse = this.add.text(1068, -82, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '18px',
      color: '#0e0114',
      align: 'right',
      wordWrap: { width: 321 },
    }).setOrigin(0.5, 0.5);
    this.rantViewerContainer.add(this.rantLblResponse);

    // Author name label (inside AuthorPic area) — Godot AuthorPic at (-389,437)
    // AuthorPic/lbl_author_name2: left=152, top=-92 → canvas (-389+152, 437-92)=(-237, 345)
    this.rantAuthorName = this.add.text(-237, 345, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '15px',
      color: '#ffffff',
      stroke: '#3b1042',
      strokeThickness: 2,
    }).setOrigin(0, 0.5);
    this.rantViewerContainer.add(this.rantAuthorName);

    // Profile pic placeholder (TextureRect at AuthorPic/TextureRect: left=114, top=-102 → (-389+114, 437-102)=(-275,335))
    this.rantProfilePic = this.add.image(-275, 335, 'little_x')
      .setOrigin(0, 0)
      .setDisplaySize(32, 32)
      .setVisible(false);
    this.rantViewerContainer.add(this.rantProfilePic);

    // Exit button — Godot: left=-35, top=-29, right=20, bottom=11
    const rantExitBtn = this._makeIconBtnInContainer('little_x', 100, 100, -35, -29, 20, 11);
    rantExitBtn.on('pointerdown', () => this._onRantExitPressed());
    this.rantViewerContainer.add(rantExitBtn);
  }

  // ════════════════════════════════════════════════════════════════════════
  // PROMPT FEATURE PANEL (Animation Review)
  // Godot PromptFeature: Node2D at position=(0,25), visible=false
  // ════════════════════════════════════════════════════════════════════════
  _buildPromptFeature() {
    this.promptContainer = this.add.container(0, 25).setDepth(20).setVisible(false);

    // Background (prompt_cozy_3.png: 617×586) — Godot: position=(522,266), scale=(0.85,0.85)
    const cozy = this.add.image(522, 266, 'prompt_cozy')
      .setOrigin(0.5, 0.5)
      .setScale(0.85, 0.85);
    this.promptContainer.add(cozy);

    // Subject label — Godot: left=371, top=100, right=682, bottom=144
    this.promptLblSubject = this.add.text(526, 122, 'Create new subject for animation', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '18px',
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
      align: 'center',
      wordWrap: { width: 311 },
    }).setOrigin(0.5, 0.5);
    this.promptContainer.add(this.promptLblSubject);

    // Profile pic outline (topic_user_square.png) — Godot: position=(126,102), scale=(0.475,0.475)
    const picOutline = this.add.image(126, 102, 'topic_user_square')
      .setOrigin(0.5, 0.5)
      .setScale(0.475, 0.475);
    this.promptContainer.add(picOutline);

    // Profile pic (TextureRect) — Godot: left=61, top=35, right=94, bottom=68 → 33×33
    this.promptProfilePic = this.add.image(77, 51, 'little_x')
      .setOrigin(0, 0)
      .setDisplaySize(33, 33)
      .setVisible(false);
    this.promptContainer.add(this.promptProfilePic);

    // "submitted by" label — Godot: left=393, top=449, right=653, bottom=480
    this.promptLblSubmittedBy = this.add.text(523, 464, 'submitted by', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      color: '#cccccc',
      align: 'center',
    }).setOrigin(0.5, 0.5);
    this.promptContainer.add(this.promptLblSubmittedBy);

    // Author name — Godot: left=298, top=447, right=752, bottom=516
    this.promptLblAuthor = this.add.text(525, 481, '', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '20px',
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
      align: 'center',
      wordWrap: { width: 454 },
    }).setOrigin(0.5, 0.5);
    this.promptContainer.add(this.promptLblAuthor);

    // Rejected stamp — Godot: position=(127,100), scale=(0.5,0.5), hidden
    this.promptRejectedImg = this.add.image(127, 100, 'rejected_img')
      .setOrigin(0.5, 0.5)
      .setScale(0.5, 0.5)
      .setVisible(false);
    this.promptContainer.add(this.promptRejectedImg);

    // Left nav button — Godot: left=297, top=233, right=351, bottom=287, scale=(0.75,0.75)
    this.promptBtnLeft = this._makeIconBtnInContainer('btn_left_on', 100, 100, 297, 233, 351, 287);
    this.promptBtnLeft.on('pointerdown', () => this._onPromptNav('left'));
    this.promptContainer.add(this.promptBtnLeft);

    // Right nav button — Godot: left=710, top=233, right=764, bottom=287, scale=(0.75,0.75)
    this.promptBtnRight = this._makeIconBtnInContainer('btn_right_on', 100, 100, 710, 233, 764, 287);
    this.promptBtnRight.on('pointerdown', () => this._onPromptNav('right'));
    this.promptContainer.add(this.promptBtnRight);

    // Delete button — Godot: left=282, top=327, right=349, bottom=394
    this.promptDeleteBtn = this._makeIconBtnInContainer('btn_delete_on', 100, 100, 282, 327, 349, 394);
    this.promptDeleteBtn.on('pointerdown', () => this._onDeletePrompt());
    this.promptDeleteBtn.setVisible(false);
    this.promptContainer.add(this.promptDeleteBtn);

    // Submit button — Godot: left=420, top=401, right=627, bottom=437
    this.promptSubmitBtn = this._makeIconBtnInContainer('submit_btn_on', 100, 100, 420, 401, 627, 437);
    this.promptSubmitBtn.on('pointerdown', () => this._onSubjectSubmit());
    this.promptContainer.add(this.promptSubmitBtn);

    // Exit button (little_x) — Godot: left=7, top=530, right=62, bottom=570
    const promptExitBtn = this._makeIconBtnInContainer('little_x', 100, 100, 7, 530, 62, 570);
    promptExitBtn.on('pointerdown', () => this._onBtnExitPressed());
    this.promptContainer.add(promptExitBtn);

    // Subject text input — use DOM textarea overlaid on canvas
    this._buildPromptTextArea();
  }

  _buildPromptTextArea() {
    // Godot SubjectText: left=368, top=175, right=685, bottom=380 (in PromptFeature space, +25 for container)
    // Canvas coords: left=368, top=200, right=685, bottom=405
    const el = document.createElement('textarea');
    el.id = 'prompt-subject-text';
    el.style.cssText = `
      position: absolute;
      left: 368px; top: ${200 + 25}px;
      width: ${685 - 368}px; height: ${380 - 175}px;
      font-size: 18px; font-family: Arial, sans-serif;
      background: rgba(20,20,60,0.85); color: #ffffff;
      border: 2px solid #c8860a; border-radius: 6px;
      padding: 6px; resize: none; z-index: 100;
      display: none;
    `;
    el.addEventListener('input', () => this._onSubjectTextChanged());
    document.body.appendChild(el);
    this.promptSubjectText = el;
  }

  // ════════════════════════════════════════════════════════════════════════
  // VIDEO PLAYER PANEL (stub — no video playback this sprint)
  // Godot VideoPlayer: Node2D at position=(470,208), scale=(2,2)
  // ════════════════════════════════════════════════════════════════════════
  _buildVideoPlayer() {
    this.videoContainer = this.add.container(0, 0).setDepth(20).setVisible(false);

    // Background (bk_queue_callout.png) — Godot: pos=(81.5,56)*2+offset=(470,208)=(633,320), scale=(0.289,0.373)*2
    const bkVid = this.add.image(633, 320, 'bk_queue_callout')
      .setOrigin(0.5, 0.5)
      .setScale(0.578, 0.746);
    this.videoContainer.add(bkVid);

    // Border (border_video.png) — Godot: pos=(80,57.5)*2+offset=(630,323), scale=(0.603,0.602)*2
    const border = this.add.image(630, 323, 'border_video')
      .setOrigin(0.5, 0.5)
      .setScale(1.206, 1.204);
    this.videoContainer.add(border);

    // Reel overlay (reel_overlay.png) — decorative
    if (this.textures.exists('reel_overlay')) {
      const reel = this.add.image(630, 323, 'reel_overlay')
        .setOrigin(0.5, 0.5)
        .setScale(1.2, 1.2);
      this.videoContainer.add(reel);
    }

    // Prompt text — Godot: left=-31*2+470=408, top=96*2+208=400, right=187*2+470=844, bottom=191*2+208=590
    this.videoLblPrompt = this.add.text(626, 495, '', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '20px',
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
      align: 'center',
      wordWrap: { width: 436 },
    }).setOrigin(0.5, 0.5);
    this.videoContainer.add(this.videoLblPrompt);

    // Author name
    this.videoAuthorName = this.add.text(626, 570, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '16px',
      color: '#ffffff',
      align: 'center',
    }).setOrigin(0.5, 0.5);
    this.videoContainer.add(this.videoAuthorName);

    // Profile pic placeholder
    this.videoProfilePic = this.add.image(470, 360, 'little_x')
      .setOrigin(0.5, 0.5)
      .setDisplaySize(64, 64)
      .setVisible(false);
    this.videoContainer.add(this.videoProfilePic);

    // Replay button — Godot: left=44*2+470=558, top=-6*2+208=196, right=114*2+470=698, bottom=9*2+208=226
    this.videoBtnReplay = this._makeIconBtnInContainer('btn_repeat_on', 100, 100, 558, 196, 698, 226);
    this.videoBtnReplay.on('pointerdown', () => this._onBtnReplay());
    this.videoBtnReplay.setVisible(false);
    this.videoContainer.add(this.videoBtnReplay);

    // Exit button — Godot: left=-217.5*2+470=35, top=175*2+208=558, right=-162.5*2+470=145, bottom=215*2+208=638, scale=(0.5,0.5)
    this.videoBtnExit = this._makeIconBtnInContainer('little_x', 100, 100, 35, 558, 145, 638);
    this.videoBtnExit.on('pointerdown', () => this._onBtnExitPressed());
    this.videoBtnExit.setVisible(false);
    this.videoContainer.add(this.videoBtnExit);

    // "VIDEO STUB" placeholder text
    this.add.text(630, 315, '[VIDEO PLAYER\nCOMING NEXT SPRINT]', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '22px',
      color: '#ffff00',
      align: 'center',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5, 0.5).setDepth(21).setVisible(false);
    // Store ref to show/hide with container
    this._videoStubText = this.children.list[this.children.list.length - 1];
  }

  // ════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════════════════════════════════

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

  // Like _makeIconBtn but returns a plain image (no depth set) for use inside containers
  _makeIconBtnInContainer(textureKey, srcW, srcH, left, top, right, bottom) {
    const displayW = right - left;
    const displayH = bottom - top;
    const scale    = Math.min(displayW / srcW, displayH / srcH);
    const cx = left + displayW / 2;
    const cy = top  + displayH / 2;
    return this.add.image(cx, cy, textureKey)
      .setOrigin(0.5, 0.5)
      .setScale(scale)
      .setInteractive({ useHandCursor: true });
  }

  _makeCounter(x, y, scale) {
    const circle = this.add.image(x, y, 'feature_circle')
      .setOrigin(0.5, 0.5)
      .setScale(scale)
      .setDepth(7);
    const lbl = this.add.text(x, y, '0', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '13px',
      color: '#d8da70',
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
      this.lblPromo1.setText("Refresh once you've started the broadcast");
      this.arrowBtn.setTexture('arrow_btn_off');
      this.arrowBtn.setInteractive();
    }
  }

  // ── CROWN (Rant Viewer) ──────────────────────────────────────────────────
  _onCrownPressed() {
    console.log('GET RANT');
    this._getNextRant();
  }

  _getNextRant() {
    this.curDisplayMode = 'rant';
    this.featureMode    = true;
    this._hideFeatureButtons();

    if (this.rantQueue.length > 0) {
      const nextRant = this.rantQueue.shift();
      this.numRants = Math.max(this.numRants - 1, 0);
      if (this.crownCounterLbl) this.crownCounterLbl.setText(String(this.numRants));

      const rantId           = parseInt(nextRant.id ?? 0);
      const rantText         = String(nextRant.rant_text ?? '');
      const rantResponseText = String(nextRant.rant_response_text ?? '');
      const authorName       = String(nextRant.local_screen_name ?? '');
      const picUrl           = String(nextRant.pic ?? '');

      this.seenRantIds[rantId] = true;
      delete this.queuedRantIds[rantId];

      if (this.rantLblText)     this.rantLblText.setText(`"${rantText}"`);
      if (this.rantLblResponse) this.rantLblResponse.setText(rantResponseText);
      if (this.rantAuthorName)  this.rantAuthorName.setText(authorName);

      this._loadRantProfilePic(picUrl);

      // POST set_rant_as_displayed
      const url = this.endpoints.set_rant_as_displayed + `&rant_id=${rantId}`;
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store' })
        .catch(e => console.error('set_rant_as_displayed failed', e));
    } else {
      if (this.crownBtn) this.crownBtn.setVisible(false);
    }

    // Show RantViewer — bounce in from Y=800 to Y=425
    if (this.rantViewerContainer) {
      this.rantViewerContainer.setVisible(true);
      this.rantViewerContainer.setPosition(38, 800);
      this.rantViewerMode = 'display';
      this.tweens.add({
        targets: this.rantViewerContainer,
        y: 425,
        duration: 500,
        ease: 'Bounce.easeOut',
      });
    }
    if (this.globalExitBtn) this.globalExitBtn.setVisible(true);
  }

  _onRantExitPressed() {
    // Godot: bounce_rant_viewer_out then call _on_btn_exit_pressed
    if (this.rantViewerMode === 'display') {
      this.rantViewerMode = 'hidden';
      if (this.rantLblResponse) this.rantLblResponse.setText('');
      this.tweens.add({
        targets: this.rantViewerContainer,
        y: 800,
        duration: 500,
        ease: 'Bounce.easeOut',
        onComplete: () => {
          if (this.rantViewerContainer) this.rantViewerContainer.setVisible(false);
        },
      });
    }
    this._onBtnExitPressed();
  }

  async _loadRantProfilePic(imageUrl) {
    const url = (imageUrl && imageUrl.length > 10) ? imageUrl : 'https://showblam.com/images/default1.png';
    try {
      const img = await loadImageUrl(url);
      const key = `rant_pic_${Date.now()}`;
      this.textures.addImage(key, img);
      if (this.rantProfilePic) {
        this.rantProfilePic.setTexture(key).setDisplaySize(32, 32).setVisible(true);
      }
    } catch (e) {
      console.error('RANT: Failed to load profile pic', e);
    }
  }

  // ── ANIM (Prompt Feature) ─────────────────────────────────────────────────
  _onAnimPressed() {
    console.log('ANIMATE: review panel');
    this._hideFeatureButtons();
    this.featureReviewMode = 'animation';
    this.curDisplayMode    = 'animation';
    this.animationOnDisplay = 0;
    this.featureMode       = true;
    this._checkIntermissionOk = 0;

    if (this.promptContainer) this.promptContainer.setVisible(true);
    if (this.promptSubjectText) this.promptSubjectText.style.display = 'block';
    if (this.globalExitBtn) this.globalExitBtn.setVisible(true);

    // Nav buttons: disabled if only 1 item
    const hasMultiple = this.animationQueue.length > 1;
    if (this.promptBtnLeft)  { this.promptBtnLeft.setAlpha(hasMultiple ? 1 : 0.4);  this.promptBtnLeft.input.enabled  = hasMultiple; }
    if (this.promptBtnRight) { this.promptBtnRight.setAlpha(hasMultiple ? 1 : 0.4); this.promptBtnRight.input.enabled = hasMultiple; }

    this._displayNextAnimation();
    if (this.promptSubmitBtn) this.promptSubmitBtn.setAlpha(1).setInteractive();
  }

  _displayNextAnimation() {
    if (this.animationQueue.length > 0) {
      if (this.animationOnDisplay >= this.animationQueue.length) this.animationOnDisplay = this.animationQueue.length - 1;
      if (this.animationOnDisplay < 0) this.animationOnDisplay = 0;
      const anim = this.animationQueue[this.animationOnDisplay];
      if (this.promptSubjectText) this.promptSubjectText.value = String(anim.animation_prompt ?? '');
      if (this.promptLblSubject)  this.promptLblSubject.setText('Animation request from ' + String(anim.local_screen_name ?? ''));
      if (this.promptLblAuthor)   this.promptLblAuthor.setText(String(anim.local_screen_name ?? ''));
      if (this.promptLblSubmittedBy) this.promptLblSubmittedBy.setText('submitted by');
      if (this.promptDeleteBtn)   this.promptDeleteBtn.setVisible(true);
      this._loadPromptProfilePic(String(anim.profile_pic_url ?? ''));
      const errMsg = String(anim.error_message ?? '');
      if (errMsg.length > 0) {
        if (this.promptLblSubject) this.promptLblSubject.setText('Rejected — edit and resubmit');
        if (this.promptRejectedImg) this.promptRejectedImg.setVisible(true);
      } else {
        if (this.promptRejectedImg) this.promptRejectedImg.setVisible(false);
      }
    } else {
      if (this.promptLblSubject)  this.promptLblSubject.setText('No animation requests');
      if (this.promptLblAuthor)   this.promptLblAuthor.setText('');
      if (this.promptLblSubmittedBy) this.promptLblSubmittedBy.setText('');
      if (this.promptProfilePic)  this.promptProfilePic.setVisible(false);
      if (this.promptDeleteBtn)   this.promptDeleteBtn.setVisible(false);
      if (this.promptBtnLeft)     this.promptBtnLeft.input.enabled = false;
      if (this.promptBtnRight)    this.promptBtnRight.input.enabled = false;
    }
  }

  _onPromptNav(direction) {
    if (this.animationQueue.length === 0) return;
    if (direction === 'right') {
      this.animationOnDisplay = (this.animationOnDisplay + 1) % this.animationQueue.length;
    } else {
      this.animationOnDisplay = (this.animationOnDisplay - 1 + this.animationQueue.length) % this.animationQueue.length;
    }
    this._displayNextAnimation();
  }

  _onSubjectTextChanged() {
    const text = this.promptSubjectText ? this.promptSubjectText.value : '';
    if (this.promptLblSubmittedBy) {
      this.promptLblSubmittedBy.setText(text.length > 10 ? '' : 'ENTER AT LEAST 10 CHARACTERS');
    }
    if (this.promptSubmitBtn) {
      const enabled = text.length > 10;
      this.promptSubmitBtn.setAlpha(enabled ? 1 : 0.4);
      if (enabled) this.promptSubmitBtn.setInteractive(); else this.promptSubmitBtn.disableInteractive();
    }
  }

  async _onSubjectSubmit() {
    const submittedText = this.promptSubjectText ? this.promptSubjectText.value : '';
    if (this.promptSubmitBtn) this.promptSubmitBtn.disableInteractive();
    if (this.promptSubjectText) this.promptSubjectText.value = '';

    if (this.animationQueue.length > 0) {
      const current = this.animationQueue[this.animationOnDisplay];
      this.submittedAnimationIds[parseInt(current.id ?? -1)] = true;
      this.animationQueue.splice(this.animationOnDisplay, 1);
      if (this.animCounterLbl) this.animCounterLbl.setText(String(this.animationQueue.length));

      // POST create_animation — always pass filetype=mp4 for Phaser (skips OGV conversion)
      const url = this.endpoints.create_animation
        + `&animation_prompt=${encodeURIComponent(submittedText)}`
        + `&animation_queue_id=${encodeURIComponent(current.id ?? '')}`
        + `&filetype=mp4`;
      try {
        await safeRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        console.log('SUBMIT: animation submitted');
      } catch (e) {
        console.error('SUBMIT: create_animation failed', e);
      }

      // Adjust index after removal
      if (this.animationOnDisplay >= this.animationQueue.length && this.animationQueue.length > 0) {
        this.animationOnDisplay = this.animationQueue.length - 1;
      }
    }

    const hasMultiple = this.animationQueue.length > 1;
    if (this.promptBtnLeft)  { this.promptBtnLeft.input.enabled  = hasMultiple; this.promptBtnLeft.setAlpha(hasMultiple ? 1 : 0.4); }
    if (this.promptBtnRight) { this.promptBtnRight.input.enabled = hasMultiple; this.promptBtnRight.setAlpha(hasMultiple ? 1 : 0.4); }
    this._displayNextAnimation();
    if (this.promptSubmitBtn) this.promptSubmitBtn.setInteractive().setAlpha(1);
  }

  async _onDeletePrompt() {
    if (this.animationQueue.length === 0) return;
    const current = this.animationQueue[this.animationOnDisplay];
    const animId  = parseInt(current.id ?? -1);
    this.deletedAnimationIds[animId] = true;
    this.animationQueue.splice(this.animationOnDisplay, 1);
    if (this.animCounterLbl) this.animCounterLbl.setText(String(this.animationQueue.length));
    if (this.promptDeleteBtn) this.promptDeleteBtn.setVisible(false);

    // POST skip_animation — parameter is animation_id (not animation_queue_id)
    const url = this.endpoints.skip_animation + `&animation_id=${animId}`;
    try {
      await safeRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      console.error('DELETE: skip_animation failed', e);
    }

    if (this.animationOnDisplay >= this.animationQueue.length && this.animationQueue.length > 0) {
      this.animationOnDisplay = this.animationQueue.length - 1;
    }
    this._displayNextAnimation();
  }

  async _loadPromptProfilePic(imageUrl) {
    const url = (imageUrl && imageUrl.length > 10) ? imageUrl : null;
    if (!url) { if (this.promptProfilePic) this.promptProfilePic.setVisible(false); return; }
    try {
      const img = await loadImageUrl(url);
      const key = `prompt_pic_${Date.now()}`;
      this.textures.addImage(key, img);
      if (this.promptProfilePic) {
        this.promptProfilePic.setTexture(key).setDisplaySize(33, 33).setVisible(true);
      }
    } catch (e) {
      console.error('PROMPT: Failed to load profile pic', e);
    }
  }

  // ── PLAY (Video Player) ───────────────────────────────────────────────────
  _onPlayPressed() {
    if (this.downloadedAnimations.length === 0) {
      console.log('ANIMATION: No downloaded animations to play');
      return;
    }
    this.curDisplayMode = 'animation';
    this.featureMode    = true;
    this._hideFeatureButtons();
    this._checkIntermissionOk = 0;

    if (this.videoContainer) this.videoContainer.setVisible(true);
    if (this._videoStubText) this._videoStubText.setVisible(true);
    if (this.videoBtnExit)   this.videoBtnExit.setVisible(false);
    if (this.videoBtnReplay) this.videoBtnReplay.setVisible(false);
    if (this.globalExitBtn)  this.globalExitBtn.setVisible(true);

    this._playNextAnimation();
  }

  // ── DOWNLOAD (Blob pre-fetch, mirrors Godot download step) ─────────────────
  async _downloadNextAnimation() {
    // Only download one at a time; skip if already downloading or queue empty
    if (this._isDownloading || this.animationReadyQueue.length === 0) return;
    this._isDownloading = true;

    const item = this.animationReadyQueue.shift();
    const videoUrl = item.ogv_url; // ogv_url contains MP4 URL when filetype=mp4 was used
    console.log('DOWNLOAD: fetching animation id=' + item.id + ' url=' + videoUrl);

    try {
      const resp = await fetch(videoUrl, { cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const blob    = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      this.downloadedAnimations.push({ ...item, blobUrl, serverUrl: videoUrl });
      console.log('DOWNLOAD: ready id=' + item.id);
      this._updatePlayAnimationButton();
    } catch (e) {
      console.error('DOWNLOAD: failed for id=' + item.id, e);
      // Re-queue on failure so it can be retried next poll cycle
      this.animationReadyQueue.unshift(item);
    } finally {
      this._isDownloading = false;
      // Download next in queue if any
      if (this.animationReadyQueue.length > 0) this._downloadNextAnimation();
    }
  }

  _playNextAnimation() {
    if (this.downloadedAnimations.length === 0) return false;
    const anim = this.downloadedAnimations.shift();
    this._playingAnimationId = anim.id;
    this._currentBlobUrl     = anim.blobUrl;

    if (this.videoLblPrompt)  this.videoLblPrompt.setText(String(anim.animation_prompt ?? ''));
    if (this.videoAuthorName) this.videoAuthorName.setText(String(anim.local_screen_name ?? ''));
    this._loadVideoProfilePic(String(anim.profile_pic_url ?? ''));

    this._startVideoPlayback(anim.blobUrl);
    return true;
  }

  _startVideoPlayback(blobUrl) {
    // Remove any existing video element
    this._removeVideoElement();

    // Get the Phaser canvas position/size to overlay the video correctly
    const canvas  = this.sys.game.canvas;
    const canvasRect = canvas.getBoundingClientRect();

    const vid = document.createElement('video');
    vid.id             = 'phaser-anim-video';
    vid.src            = blobUrl;
    vid.autoplay       = true;
    vid.playsInline    = true;
    vid.style.position = 'fixed';
    vid.style.left     = canvasRect.left + 'px';
    vid.style.top      = canvasRect.top  + 'px';
    vid.style.width    = canvasRect.width  + 'px';
    vid.style.height   = canvasRect.height + 'px';
    vid.style.zIndex   = '100';
    vid.style.objectFit = 'contain';
    vid.style.background = 'transparent';
    vid.addEventListener('ended', () => this._onVidFinished());
    vid.addEventListener('error', (e) => {
      console.error('ANIMATION: video error', e);
      this._onVidFinished();
    });
    document.body.appendChild(vid);
    this._videoEl = vid;
    console.log('ANIMATION: playing id=' + this._playingAnimationId);
  }

  _removeVideoElement() {
    if (this._videoEl) {
      this._videoEl.pause();
      this._videoEl.src = '';
      if (this._videoEl.parentNode) this._videoEl.parentNode.removeChild(this._videoEl);
      this._videoEl = null;
    }
  }

  _onVidFinished() {
    console.log('ANIMATION: playback finished, marking as played, id=' + this._playingAnimationId);

    // Remove the video element
    this._removeVideoElement();

    // Revoke the Blob URL to free memory
    if (this._currentBlobUrl) {
      URL.revokeObjectURL(this._currentBlobUrl);
      // Keep reference for replay — don't null it yet until exit
    }

    // Mark as played on server
    const url = this.endpoints.mark_animation_played + `&animation_id=${this._playingAnimationId}`;
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store' })
      .catch(e => console.error('mark_animation_played failed', e));

    if (this.videoBtnExit)   this.videoBtnExit.setVisible(false);
    if (this.videoBtnReplay) this.videoBtnReplay.setVisible(true);
    this._updatePlayAnimationButton();
    if (this.globalExitBtn)  this.globalExitBtn.setVisible(true);
  }

  _onBtnReplay() {
    if (this.videoBtnReplay) this.videoBtnReplay.setVisible(false);
    if (this.videoBtnExit)   this.videoBtnExit.setVisible(false);
    // Replay: re-fetch from server URL (blob was revoked after first play)
    if (this._currentServerUrl) {
      console.log('ANIMATION: replay — re-fetching from server');
      fetch(this._currentServerUrl, { cache: 'no-store' })
        .then(r => r.blob())
        .then(blob => {
          const blobUrl = URL.createObjectURL(blob);
          this._currentBlobUrl = blobUrl;
          this._startVideoPlayback(blobUrl);
        })
        .catch(e => console.error('REPLAY: re-fetch failed', e));
    }
    if (this.globalExitBtn)  this.globalExitBtn.setVisible(true);
  }

  async _loadVideoProfilePic(imageUrl) {
    const url = (imageUrl && imageUrl.length > 10) ? imageUrl : 'https://showblam.com/images/default1.png';
    try {
      const img = await loadImageUrl(url);
      const key = `vid_pic_${Date.now()}`;
      this.textures.addImage(key, img);
      if (this.videoProfilePic) {
        this.videoProfilePic.setTexture(key).setDisplaySize(64, 64).setVisible(true);
      }
    } catch (e) {
      console.error('VIDEO: Failed to load profile pic', e);
    }
  }

  // ── GLOBAL EXIT ───────────────────────────────────────────────────────────
  // Godot _on_btn_exit_pressed: closes all panels, returns to intermission
  _onBtnExitPressed() {
    // Close VideoPlayer
    if (this.videoContainer)  this.videoContainer.setVisible(false);
    if (this._videoStubText)  this._videoStubText.setVisible(false);
    if (this.videoBtnExit)    this.videoBtnExit.setVisible(false);

    // Close PromptFeature
    if (this.promptContainer)   this.promptContainer.setVisible(false);
    if (this.promptSubjectText) { this.promptSubjectText.style.display = 'none'; this.promptSubjectText.value = ''; }
    if (this.promptSubmitBtn)   this.promptSubmitBtn.disableInteractive();

    // Close RantViewer (bounce out if visible)
    if (this.rantViewerMode === 'display') {
      this.rantViewerMode = 'hidden';
      if (this.rantLblResponse) this.rantLblResponse.setText('');
      this.tweens.add({
        targets: this.rantViewerContainer,
        y: 800,
        duration: 500,
        ease: 'Bounce.easeOut',
        onComplete: () => { if (this.rantViewerContainer) this.rantViewerContainer.setVisible(false); },
      });
    }

    // Clean up any active video element
    this._removeVideoElement();
    if (this._currentBlobUrl) { URL.revokeObjectURL(this._currentBlobUrl); this._currentBlobUrl = null; }
    this._currentServerUrl = null;

    // Hide global exit button
    if (this.globalExitBtn) this.globalExitBtn.setVisible(false);

    // Restore intermission state (Godot: show_intermission_buttons)
    this.featureMode          = false;
    this._checkIntermissionOk = 1;
    this._checkMessagesOk     = 1;
    this.curDisplayMode       = 'intermission';
    this._showIntermissionButtons();
    this._updatePlayAnimationButton();
  }

  // ── HIDE FEATURE BUTTONS (Godot hide_feature_buttons) ────────────────────
  _hideFeatureButtons() {
    if (this.animBtn)  this.animBtn.setVisible(false);
    if (this.animCounter)    this.animCounter.setVisible(false);
    if (this.animCounterLbl) this.animCounterLbl.setVisible(false);
    if (this.playBtn)  this.playBtn.setVisible(false);
    if (this.playCounter)    this.playCounter.setVisible(false);
    if (this.playCounterLbl) this.playCounterLbl.setVisible(false);
    if (this.arrowBtn) this.arrowBtn.setVisible(false);
    if (this.crownBtn) this.crownBtn.setVisible(false);
    if (this.crownCounter)    this.crownCounter.setVisible(false);
    if (this.crownCounterLbl) this.crownCounterLbl.setVisible(false);
  }

  // ════════════════════════════════════════════════════════════════════════
  // INTERMISSION BUTTON VISIBILITY
  // ════════════════════════════════════════════════════════════════════════

  _showIntermissionButtons() {
    console.log('STARTUP: show_intermission_buttons');
    this._checkIntermissionOk = 1;
    this._updateIntermissionButtons();
    if (!this._activationDone) return;
    this._checkMessagesOk = 1;
    this._pollCheckMessages();
  }

  _updateIntermissionButtons() {
    // Arrow: visible only before activation
    if (this.arrowBtn) this.arrowBtn.setVisible(!this._activationDone);

    // ANIM: always visible (host may self-submit); counter only when count > 0
    if (this.animBtn) this.animBtn.setVisible(true);
    const animCount = this.animationQueue.length;
    if (this.animCounter)    this.animCounter.setVisible(animCount > 0);
    if (this.animCounterLbl) { this.animCounterLbl.setVisible(animCount > 0); this.animCounterLbl.setText(String(animCount)); }

    // CROWN: visible only when num_rants > 0; counter mirrors button
    const crownVisible = this.numRants > 0;
    if (this.crownBtn) this.crownBtn.setVisible(crownVisible);
    if (this.crownCounter)    this.crownCounter.setVisible(crownVisible);
    if (this.crownCounterLbl) { this.crownCounterLbl.setVisible(crownVisible); this.crownCounterLbl.setText(String(this.numRants)); }

    // PLAY: visible only when downloaded_animations.length > 0; counter mirrors button
    const hasDownloaded = this.downloadedAnimations.length > 0;
    if (this.playBtn) this.playBtn.setVisible(hasDownloaded);
    if (this.playCounter)    this.playCounter.setVisible(hasDownloaded);
    if (this.playCounterLbl) { this.playCounterLbl.setVisible(hasDownloaded); this.playCounterLbl.setText(String(this.downloadedAnimations.length)); }
  }

  // ════════════════════════════════════════════════════════════════════════
  // POLLING
  // ════════════════════════════════════════════════════════════════════════

  async _pollCheckMessages() {
    if (this._isRequesting) return;
    if (this._checkMessagesOk !== 1) {
      console.log('poll_check_messages: polling paused');
      return;
    }

    this._lastPollMs   = performance.now();
    this._isRequesting = true;
    console.log('POLL: poll_check_messages');

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

    if (data) this._processPollData(data);

    if (this._checkMessagesOk === 1) {
      await sleep(POLL_DELAY_MS);
      this._pollCheckMessages();
    }
  }

  _processPollData(data) {
    // animation_ready
    if (data.animation_ready) {
      for (const item of data.animation_ready) {
        const itId = parseInt(item.id ?? -1);
        if (itId === parseInt(this._playingAnimationId)) continue;
        const alreadyDl = this.downloadedAnimations.some(d => parseInt(d.id ?? -1) === itId);
        const alreadyRq = this.animationReadyQueue.some(r => parseInt(r.id ?? -1) === itId);
        if (!alreadyDl && !alreadyRq) this.animationReadyQueue.push(item);
      }
      // Trigger download for any newly queued ready items
      this._downloadNextAnimation();
      this._updatePlayAnimationButton();
    }

    // animation_pending
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
      const animCount = this.animationQueue.length;
      if (this.animCounter)    this.animCounter.setVisible(animCount > 0 && this.animBtn && this.animBtn.visible);
      if (this.animCounterLbl) { this.animCounterLbl.setVisible(animCount > 0 && this.animBtn && this.animBtn.visible); this.animCounterLbl.setText(String(animCount)); }
    }

    // rant_data
    const rantItems = data.rant_data || [];
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
    } else if (this.curDisplayMode === 'intermission') {
      const now = performance.now();
      if (now - this._lastRantRefreshMs > 2000) this._getIntermissionVariables();
    }

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
    if (this.playCounterLbl) { this.playCounterLbl.setVisible(hasDownloaded); this.playCounterLbl.setText(String(this.downloadedAnimations.length)); }
  }

  async _getIntermissionVariables() {
    console.log('POLL: get_intermission_variables');
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
      this.activeTab = '';
      this._setTabVisuals('');
      this._tweenToolbar(false, prev, '');
    } else {
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
      node.setAlpha(isActive ? 1.0 : (activeTab ? 0.55 : 1.0));
      if (node.input) node.input.enabled = !(activeTab && !isActive);
    });
  }

  _tweenToolbar(expand, prevTab = '', newTab = '') {
    this.toolbarAnimating = true;
    const SLIDE = 240;
    const DURATION = 220;

    // Kill any running tweens on toolbar/tabs
    this.tweens.killTweensOf(this.toolbarImg);
    ['games', 'feature', 'info'].forEach(k => { if (this.tabs[k]) this.tweens.killTweensOf(this.tabs[k]); });

    // Slide gold bar
    const barTargetX = expand ? this.toolbarBaseX + SLIDE : this.toolbarBaseX;
    this.tweens.add({
      targets: this.toolbarImg,
      x: barTargetX,
      duration: DURATION,
      ease: 'Quad.easeOut',
    });

    // Slide previous tab back to base
    if (prevTab && this.tabs[prevTab]) {
      this.tweens.add({
        targets: this.tabs[prevTab],
        x: this.tabBaseX[prevTab],
        duration: DURATION,
        ease: 'Quad.easeOut',
      });
    }

    // Slide new tab forward (expand) or retract back to base (collapse)
    if (newTab && expand && this.tabs[newTab]) {
      this.tweens.add({
        targets: this.tabs[newTab],
        x: this.tabBaseX[newTab] + SLIDE,
        duration: DURATION,
        ease: 'Quad.easeOut',
        onComplete: () => { this.toolbarAnimating = false; },
      });
    } else {
      // On collapse: after retraction completes, restore all tabs to full active appearance
      this.time.delayedCall(DURATION, () => {
        this.toolbarAnimating = false;
        if (!this.activeTab) {
          ['games', 'feature', 'info'].forEach((key) => {
            const node = this.tabs[key];
            if (!node) return;
            node.setTexture(`tab_${key}_on`);
            node.setAlpha(1.0);
            if (node.input) node.input.enabled = true;
          });
        }
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // PROMO ROTATOR
  // ════════════════════════════════════════════════════════════════════════

  _nextPromo() {
    if (this.curDisplayMode !== 'intermission') return;
    this.promoIndex = (this.promoIndex + 1) % this.promoLines.length;
    if (this.lblPromo1) this.lblPromo1.setText(this.promoLines[this.promoIndex]);
  }
}
