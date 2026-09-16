/**
 * 跨次元大亂鬥 3D (Dimension Clash Online 3D) - 主應用協調器
 * (Separated Quests & Shop Views, Dedicated Non-conflicting Controls, Cooldown Timers & 3D Solid Collision)
 */

class App3D {
  constructor() {
    this.sceneManager = null;
    this.cameraController = null;
    this.activeTab = "roster";

    this.teamSize = 3;
    this.aiDifficulty = "medium"; // "easy", "medium", "hard"
    this.shopFilterSeries = "all";
    this.p1Team = window.saveSystem.user.selectedTeam || ["goku_kid", "cap_america", "gm_rgm79"];
    this.p2Team = ["spiderman_classic", "krillin", "rx78_2"];
    this.pickingSlotIndex = 0;
    this.pickingForTeam = 1;
    this.shopFilterSeries = "all";
    this.rosterFilterSeries = "all";

    this.keys = {};
    this.joystick = { active: false, startX: 0, startY: 0, moveX: 0, moveY: 0 };
    this.lastFrameTime = performance.now();
    this.isRunning = true;
  }

  init() {
    const container = document.getElementById("battle3DContainer");
    if (container) {
      try {
        this.sceneManager = new Arena3DScene(container);
        this.sceneManager.init();

        if (this.sceneManager.renderer && this.sceneManager.renderer.domElement) {
          this.cameraController = new CameraController3D(
            this.sceneManager.camera,
            this.sceneManager.renderer.domElement
          );
        }

        if (window.matchEngine3D && this.sceneManager.scene) {
          window.matchEngine3D.init(this.sceneManager.scene);
        }
      } catch (err) {
        console.error("Notice: 3D scene initialization error, fallback to safe UI state:", err);
      }
    }

    // 初始化 P2P 聯機庫
    if (window.p2pNetwork) {
      window.p2pNetwork.init();
    }

    this.bindEvents();
    this.setupKeyboard();
    this.setupTouchControls();
    this.initGoogleIdentityServices();
    this.renderAllViews();
    this.updateUserStatusBar();

    // 預先加載並準備好 3D 戰鬥對局
    this.startSelectedBattle("kof");

    if (!window.saveSystem.user.isLoggedIn) {
      this.openGoogleLoginModal();
    } else {
      this.switchTab("roster");
    }

    // ── 每 5 分鐘自動同步與存檔 ──
    setInterval(() => {
      this.autoSync("5 分鐘定時自動同步");
    }, 5 * 60 * 1000);

    requestAnimationFrame((t) => this.gameLoop(t));
  }

  // ─── 每次更換出場角色時，動態更新觸控動作按鈕標籤 ───
  updateActionButtonsForFighter(charData) {
    if (!charData) return;
    const cfg = charData.attackConfig;
    const flightBtn = document.getElementById("touchBtnFlight");
    if (flightBtn) {
      flightBtn.style.display = charData.canFly ? "inline-flex" : "none";
      const lbl = flightBtn.querySelector(".label");
      if (lbl) lbl.textContent = "飛行[F]";
    }

    const setBtnLabel = (id, label) => {
      const btn = document.getElementById(id);
      if (btn) {
        const lbl = btn.querySelector(".label");
        if (lbl) lbl.textContent = label;
      }
    };

    if (cfg) {
      if (cfg.light) setBtnLabel("touchBtnAtk", `普攻[J]`);
      if (cfg.heavy) setBtnLabel("touchBtnHeavy", `破防[K]`);
      if (cfg.grab) setBtnLabel("touchBtnGrab", `抓技[O]`);
      if (charData.skills && charData.skills.skill1) setBtnLabel("touchBtnSkill1", `技1[U]`);
      if (charData.skills && charData.skills.skill2) setBtnLabel("touchBtnSkill2", `技2[I]`);
      if (charData.skills && charData.skills.ult) setBtnLabel("touchBtnUlt", `奧義[L]`);
    }
  }

  // ─── 調整隊伍長度以符合 1v1 ~ 5v5 賽制 ───
  adjustTeamSize() {
    const defaultAvailable = window.saveSystem.user.unlockedCharacters || ["goku_kid", "cap_america", "gm_rgm79"];
    while (this.p1Team.length < this.teamSize) {
      const nextChar = defaultAvailable.find(id => !this.p1Team.includes(id)) || defaultAvailable[0] || "goku_kid";
      this.p1Team.push(nextChar);
    }
    if (this.p1Team.length > this.teamSize) {
      this.p1Team = this.p1Team.slice(0, this.teamSize);
    }

    // 電腦對手陣容依難度隨機抽角 (Difficulty-Based Random Drafting)
    this.draftComputerTeam(this.aiDifficulty, this.teamSize);
  }

  // ─── 🤖 依遊戲難度動態隨機抽角 (Difficulty-Based Dynamic Drafting) ───
  draftComputerTeam(difficulty = this.aiDifficulty, count = this.teamSize) {
    if (!window.CHARACTERS_DATA || window.CHARACTERS_DATA.length === 0) return;

    let pool = [];
    if (difficulty === "easy") {
      // 🟢 簡單難度：隨機抽選 凡品(白階 1)、優秀(綠階 2)、稀有(藍階 3) 初階英雄
      pool = window.CHARACTERS_DATA.filter(c => c.rarity <= 3);
      if (pool.length < count) pool = window.CHARACTERS_DATA.filter(c => c.rarity <= 4);
    } else if (difficulty === "hard") {
      // 🔴 困難難度：隨機抽選 傳奇(金階 6)、神話(紅階 7)、幻界(彩階 8)、創世/概念(9階) 頂級魔王神祇
      pool = window.CHARACTERS_DATA.filter(c => c.rarity >= 6);
      if (pool.length < count) pool = window.CHARACTERS_DATA.filter(c => c.rarity >= 5);
    } else {
      // 🟡 中等難度：隨機抽選 稀有(藍階 3)、特級(紫階 4)、史詩(粉階 5)、傳奇(金階 6) 全明星陣容
      pool = window.CHARACTERS_DATA.filter(c => c.rarity >= 3 && c.rarity <= 6);
      if (pool.length < count) pool = window.CHARACTERS_DATA;
    }

    // 隨機亂序洗牌 (Fisher-Yates Shuffle)
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    this.p2Team = [];
    for (let c of shuffled) {
      if (!this.p2Team.includes(c.id)) {
        this.p2Team.push(c.id);
      }
      if (this.p2Team.length >= count) break;
    }

    // 若依然不足，從全英雄庫補齊
    if (this.p2Team.length < count) {
      const allShuffled = [...window.CHARACTERS_DATA].sort(() => 0.5 - Math.random());
      for (let c of allShuffled) {
        if (!this.p2Team.includes(c.id)) {
          this.p2Team.push(c.id);
        }
        if (this.p2Team.length >= count) break;
      }
    }

    this.renderTeamSelectors();
  }

  // ─── 更新頂部狀態列 (含頭像與暱稱) ───
  updateUserStatusBar() {
    const goldElem = document.getElementById("userGoldDisplay");
    const trophyElem = document.getElementById("userTrophyDisplay");
    const nameElem = document.getElementById("userNicknameDisplay");
    const avatarImg = document.getElementById("userAvatarImg");

    if (goldElem) goldElem.textContent = window.saveSystem.user.gold.toLocaleString();
    if (trophyElem) trophyElem.textContent = window.saveSystem.user.trophies.toLocaleString();
    if (nameElem) nameElem.textContent = window.saveSystem.user.nickname;
    if (avatarImg) {
      avatarImg.src = window.saveSystem.user.avatar || ("https://api.dicebear.com/7.x/bottts/svg?seed=" + encodeURIComponent(window.saveSystem.user.nickname));
    }
  }

  // ─── 🔄 手動立即更新 ───
  manualSync() {
    const spinIcon = document.getElementById("syncSpinIcon");
    if (spinIcon) spinIcon.classList.add("spinning");

    window.saveSystem.save();
    this.updateUserStatusBar();
    this.renderAllViews();

    if (this.sceneManager) {
      this.sceneManager.onWindowResize();
    }

    setTimeout(() => {
      if (spinIcon) spinIcon.classList.remove("spinning");
      alert("✅ 遊戲資料已成功立即手動同步並更新！");
    }, 600);
  }

  // ─── 🔄 事件完成與定時自動同步 ───
  autoSync(source = "事件自動同步") {
    window.saveSystem.save();
    this.updateUserStatusBar();
    console.log(`[AutoSync] ${source} 完成: ${new Date().toLocaleTimeString()}`);
  }

  // ─── 👤 玩家個人檔案與頭像選擇彈窗 ───
  openProfileModal() {
    const modal = document.getElementById("userProfileModal");
    const container = document.getElementById("userProfileContent");
    if (!modal || !container) return;

    const u = window.saveSystem.user;
    const avatarOptions = [
      { id: "robot", name: "次元機體", url: "https://api.dicebear.com/7.x/bottts/svg?seed=GundamMecha" },
      { id: "saiyan", name: "超級賽亞人", url: "https://api.dicebear.com/7.x/adventurer/svg?seed=SaiyanGoku" },
      { id: "hero", name: "漫威英雄", url: "https://api.dicebear.com/7.x/adventurer/svg?seed=IronHero" },
      { id: "titan", name: "宇宙泰坦", url: "https://api.dicebear.com/7.x/bottts/svg?seed=ThanosTitan" },
      { id: "warrior", name: "神話戰士", url: "https://api.dicebear.com/7.x/adventurer/svg?seed=DimensionClash" }
    ];

    container.innerHTML = `
      <div style="text-align: center; margin-bottom: 16px;">
        <img src="${u.avatar || avatarOptions[0].url}" style="width: 72px; height: 72px; border-radius: 50%; border: 3px solid #38bdf8; background: #0f172a; margin-bottom: 8px;">
        <h2 style="font-size: 20px; font-weight: 900; color: #f8fafc;">${u.nickname}</h2>
        <div style="font-size: 12px; color: #94a3b8;">${u.email} ｜ UID: ${u.uid}</div>
      </div>

      <h4 style="font-size: 13px; font-weight: 800; color: #38bdf8; margin-bottom: 8px;">選擇個人頭像：</h4>
      <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 16px;">
        ${avatarOptions.map(av => `
          <div style="border: 2px solid ${u.avatar === av.url ? '#38bdf8' : 'rgba(255,255,255,0.1)'}; border-radius: 10px; padding: 4px; text-align: center; cursor: pointer; background: rgba(30,41,59,0.7);" onclick="window.app.changeUserAvatar('${av.url}')">
            <img src="${av.url}" style="width: 40px; height: 40px; border-radius: 50%;">
            <div style="font-size: 10px; color: #cbd5e1; margin-top: 2px;">${av.name}</div>
          </div>
        `).join("")}
      </div>

      <div style="background: rgba(30, 41, 59, 0.7); border-radius: 10px; padding: 12px; margin-bottom: 16px; font-size: 12px; line-height: 1.8;">
        <div>🏆 天梯排位：<b>${u.trophies} 獎盃</b> (勝 ${u.pvpWins} / 敗 ${u.pvpLosses})</div>
        <div>💰 總金幣：<b>${u.gold.toLocaleString()}</b> ｜ 🗼 魔王塔通關：<b>第 ${u.bossRushMaxFloor} 層</b></div>
        <div>💎 感應骨架結晶：<b>${u.psychoCrystals} 顆</b> ｜ ⚔️ 總傷害：<b>${u.totalDamage.toLocaleString()} 點</b></div>
      </div>

      <div style="margin-bottom: 16px;">
        <button class="google-oauth-btn" style="padding: 10px 16px; font-size: 13px; width: 100%; justify-content: center;" onclick="window.app.logoutUser()">
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
            <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
            <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
            <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
          </svg>
          <span>切換 / 重新授權 Google 帳戶 (星門登入)</span>
        </button>
      </div>

      <div style="display: flex; gap: 8px;">
        <button class="btn-primary" style="flex: 1; justify-content: center; font-size: 13px; padding: 10px;" onclick="window.app.manualSync()">
          <i class="fa-solid fa-rotate"></i> 立即手動同步
        </button>
        <button class="btn-secondary" style="font-size: 13px; padding: 10px 14px;" onclick="window.app.logoutUser()">
          <i class="fa-solid fa-right-from-bracket"></i> 登出
        </button>
      </div>
    `;

    modal.classList.add("active");
  }

  changeUserAvatar(avatarUrl) {
    window.saveSystem.setAvatar(avatarUrl);
    this.updateUserStatusBar();
    this.openProfileModal();
  }

  logoutUser() {
    window.saveSystem.logout();
    this.closeModal();
    this.openGoogleLoginModal();
  }

  initGoogleIdentityServices() {
    if (typeof window !== "undefined" && window.google && window.google.accounts && window.google.accounts.id) {
      try {
        window.google.accounts.id.initialize({
          client_id: "354178229864-democlientidforantigravityclash.apps.googleusercontent.com",
          callback: (response) => this.handleGoogleCredentialResponse(response)
        });
      } catch (err) {
        console.warn("GIS initialization notice:", err);
      }
    }
  }

  handleGoogleCredentialResponse(response) {
    try {
      const jwt = response.credential;
      const base64Url = jwt.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      const payload = JSON.parse(jsonPayload);
      this.performGoogleLogin(payload.email, payload.name, payload.picture, payload.sub);
    } catch (e) {
      console.warn("JWT Decode fallback", e);
      this.performGoogleLogin("google.player@gmail.com", "Google 次元戰神");
    }
  }

  // ─── 🌌 跨次元量子神經網絡・Google 帳號星門授權儀 (Original Quantum Google Auth Modal) ───
  openGoogleLoginModal() {
    const modal = document.getElementById("googleLoginModal");
    if (!modal) return;

    const recents = window.saveSystem.getRecentGoogleAccounts();
    const currentUser = window.saveSystem.user;

    modal.innerHTML = `
      <div class="quantum-google-card">
        <!-- 旋轉 Google 四色光環 (Google Colors Rainbow Hologram Ring) -->
        <div class="google-stargate-ring">
          <div class="google-stargate-inner">
            <i class="fa-brands fa-google" style="background: linear-gradient(135deg, #4285f4, #ea4335, #fbbc05, #34a853); -webkit-background-clip: text; -webkit-text-fill-color: transparent;"></i>
          </div>
        </div>

        <h2 style="font-size: 22px; font-weight: 900; color: #f8fafc; margin-bottom: 4px; letter-spacing: 0.5px;">
          跨次元量子神經網絡
        </h2>
        <p style="font-size: 13px; color: #94a3b8; margin-bottom: 16px;">
          連結 Google 帳戶 ⇄ 即時同步 100 位跨次元英雄、天梯階級與雲端存檔
        </p>

        <!-- 官方 Google 一鍵快速授權按鈕 (GIS Button Slot / Official Google OAuth) -->
        <div style="margin-bottom: 16px;">
          <div id="googleGisBtnSlot"></div>
          <button class="google-oauth-btn" id="instantGoogleAuthBtn" onclick="window.app.triggerOneTapGoogleAuth()">
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
              <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
            </svg>
            <span>使用 Google 帳戶一鍵快速授權登入</span>
          </button>
        </div>

        ${recents.length > 0 ? `
          <div style="text-align: left; margin-bottom: 14px;">
            <div style="font-size: 11px; font-weight: 800; color: #64748b; margin-bottom: 6px; text-transform: uppercase;">
              <i class="fa-solid fa-clock-rotate-left"></i> 最近授權的 Google 帳戶
            </div>
            ${recents.slice(0, 2).map(acc => `
              <div class="google-account-chip" onclick="window.app.performGoogleLogin('${acc.email}', '${acc.nickname}', '${acc.avatar}', '${acc.uid}')">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <img src="${acc.avatar}" style="width: 32px; height: 32px; border-radius: 50%; border: 1.5px solid #4285f4; background: #0f172a;">
                  <div>
                    <div style="font-size: 13px; font-weight: 800; color: #f8fafc;">${acc.nickname}</div>
                    <div style="font-size: 11px; color: #94a3b8;">${acc.email}</div>
                  </div>
                </div>
                <div style="font-size: 11px; font-weight: 800; color: #facc15;">
                  🏆 ${acc.trophies || 1000}
                </div>
              </div>
            `).join("")}
          </div>
        ` : ''}

        <!-- 帳號詳細自訂與手動綁定 -->
        <div style="background: rgba(30, 41, 59, 0.5); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px; margin-bottom: 16px; text-align: left;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-size: 11px; font-weight: 800; color: #38bdf8;"><i class="fa-solid fa-sliders"></i> 自訂 Google 帳號與戰神暱稱</span>
            <span class="cloud-sync-badge"><i class="fa-solid fa-shield-halved"></i> 量子加密防護</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 10px;">
            <div>
              <label style="font-size: 11px; color: #cbd5e1;">Google 信箱 (Gmail)：</label>
              <input type="email" id="googleCustomEmailInput" value="${currentUser.email || 'dimension.hero@gmail.com'}" placeholder="例如: yourname@gmail.com" style="width: 100%; background: #0f172a; border: 1px solid rgba(66, 133, 244, 0.3); color: #f8fafc; padding: 8px 12px; border-radius: 8px; font-size: 13px; margin-top: 3px; outline: none;">
            </div>
            <div>
              <label style="font-size: 11px; color: #cbd5e1;">遊戲暱稱 (Gamer Tag)：</label>
              <input type="text" id="googleCustomNickInput" value="${currentUser.nickname || '次元戰神'}" placeholder="請輸入您的自訂戰神暱稱" style="width: 100%; background: #0f172a; border: 1px solid rgba(66, 133, 244, 0.3); color: #f8fafc; padding: 8px 12px; border-radius: 8px; font-size: 13px; margin-top: 3px; outline: none;">
            </div>
          </div>
        </div>

        <!-- 🎁 登入特典提示 -->
        <div style="display: flex; justify-content: space-around; background: rgba(16, 185, 129, 0.1); border: 1px dashed rgba(16, 185, 129, 0.4); border-radius: 10px; padding: 8px 10px; margin-bottom: 16px; font-size: 11px; color: #6ee7b7;">
          <span>🎁 +1,500 金幣</span>
          <span>⚡ 3 位初始英雄</span>
          <span>☁️ Google 雲端存檔</span>
        </div>

        <button class="btn-primary" style="width: 100%; justify-content: center; padding: 12px; font-size: 15px; font-weight: 900; background: linear-gradient(135deg, #4285f4, #1d4ed8); box-shadow: 0 0 20px rgba(66,133,244,0.4);" onclick="window.app.submitCustomGoogleLogin()">
          <i class="fa-solid fa-arrow-right-to-bracket"></i> 進入 3D 次元大亂鬥世界
        </button>
      </div>
    `;

    modal.classList.add("active");

    // 嘗試渲染 Google 官方登入按鈕
    if (window.google && window.google.accounts && window.google.accounts.id) {
      try {
        const btnContainer = document.getElementById("googleGisBtnSlot");
        if (btnContainer) {
          window.google.accounts.id.renderButton(btnContainer, {
            theme: "filled_blue",
            size: "large",
            shape: "pill",
            width: "380",
            text: "signin_with"
          });
        }
      } catch (err) {}
    }
  }

  triggerOneTapGoogleAuth() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      try {
        window.google.accounts.id.prompt((notification) => {
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            const emailInput = document.getElementById("googleCustomEmailInput");
            const nickInput = document.getElementById("googleCustomNickInput");
            const email = emailInput ? emailInput.value : "dimension.hero@gmail.com";
            const nick = nickInput ? nickInput.value : "次元戰神";
            this.performGoogleLogin(email, nick);
          }
        });
        return;
      } catch (e) {}
    }

    const emailInput = document.getElementById("googleCustomEmailInput");
    const nickInput = document.getElementById("googleCustomNickInput");
    const email = emailInput ? emailInput.value : "dimension.hero@gmail.com";
    const nick = nickInput ? nickInput.value : "次元戰神";
    this.performGoogleLogin(email, nick);
  }

  submitCustomGoogleLogin() {
    const emailInput = document.getElementById("googleCustomEmailInput");
    const nickInput = document.getElementById("googleCustomNickInput");
    const email = emailInput ? emailInput.value : "player@gmail.com";
    const nick = nickInput ? nickInput.value : "次元戰神";
    this.performGoogleLogin(email, nick);
  }

  performGoogleLogin(email, nickname, avatar = "", googleUid = "") {
    const cleanNick = (nickname || email.split("@")[0] || "次元戰神").trim();
    const cleanAvatar = avatar || ("https://api.dicebear.com/7.x/bottts/svg?seed=" + encodeURIComponent(cleanNick));

    window.saveSystem.loginWithGoogle(email, cleanNick, cleanAvatar, googleUid);
    this.updateUserStatusBar();
    this.closeModal();
    this.switchTab("roster");

    if (window.soundEngine) {
      window.soundEngine.playVictory();
    }
  }

  // ─── 🎁 每日獎勵補給彈窗 ───
  openDailyRewardModal() {
    const modal = document.getElementById("dailyRewardModal");
    const container = document.getElementById("dailyRewardContent");
    if (!modal || !container) return;

    const u = window.saveSystem.user;
    const rewards = [
      { day: 1, gold: 500, desc: "初入戰場禮包" },
      { day: 2, gold: 800, desc: "雙倍晶石補給" },
      { day: 3, gold: 1200, desc: "高級能源電池" },
      { day: 4, gold: 1600, desc: "戰術核芯配件" },
      { day: 5, gold: 2000, desc: "特級招募補貼" },
      { day: 6, gold: 3000, desc: "黃金戰士寶箱" },
      { day: 7, gold: 5000, desc: "★ 史詩英雄神威禮包" }
    ];

    const currentStreak = u.loginStreak || 1;
    const canClaim = window.saveSystem.canClaimDaily();

    container.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 20px;">
        ${rewards.map(r => {
          const isToday = r.day === ((currentStreak - 1) % 7 + 1);
          const isPast = r.day < ((currentStreak - 1) % 7 + 1);
          return `
            <div style="background: rgba(30, 41, 59, 0.8); border: 2px solid ${isToday ? '#facc15' : (isPast ? '#10b981' : 'rgba(255,255,255,0.1)')}; border-radius: 10px; padding: 12px; text-align: center;">
              <div style="font-size: 11px; font-weight: 800; color: ${isToday ? '#facc15' : '#94a3b8'};">第 ${r.day} 天</div>
              <div style="font-size: 24px; margin: 4px 0;">${r.day === 7 ? '👑' : '🎁'}</div>
              <div style="font-size: 13px; font-weight: 800; color: #f8fafc;">+${r.gold.toLocaleString()}</div>
              <div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">${r.desc}</div>
              <div style="font-size: 10px; font-weight: 800; margin-top: 6px; color: ${isPast ? '#10b981' : (isToday ? (canClaim ? '#facc15' : '#64748b') : '#64748b')};">
                ${isPast ? '✅ 已領取' : (isToday ? (canClaim ? '可領取' : '今日已領') : '鎖定中')}
              </div>
            </div>
          `;
        }).join("")}
      </div>

      <div style="text-align: center;">
        <button class="btn-primary" style="padding: 12px 36px; font-size: 16px; font-weight: 900; justify-content: center; ${canClaim ? 'background: linear-gradient(135deg, #10b981, #059669);' : 'opacity: 0.6;'}" onclick="window.app.claimDailyReward()" ${canClaim ? '' : 'disabled'}>
          <i class="fa-solid fa-gift"></i> ${canClaim ? '立即領取今日獎勵' : '今日已完成簽到，明天再來！'}
        </button>
      </div>
    `;

    modal.classList.add("active");
  }

  claimDailyReward() {
    const res = window.saveSystem.claimDailyReward();
    if (res.success) {
      if (window.soundEngine) window.soundEngine.playVictory();
      this.updateUserStatusBar();
      this.openDailyRewardModal();
      this.autoSync("領取每日簽到獎勵");
      alert(`🎉 成功領取每日簽到獎勵 +${res.gold.toLocaleString()} 金幣！連續登入 ${res.streak} 天！`);
    } else {
      alert(res.reason || "今日已經領取過每日獎勵囉！");
    }
  }

  switchTab(tabId) {
    this.activeTab = tabId;
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tab === tabId);
    });
    document.querySelectorAll(".view-section").forEach(sec => {
      sec.classList.toggle("active", sec.id === `view_${tabId}`);
    });

    if (tabId === "battle") {
      if (!window.matchEngine3D.p1Current || window.matchEngine3D.matchState === "standby") {
        this.startSelectedBattle("kof");
      }
      if (this.sceneManager) {
        this.sceneManager.onWindowResize();
      }
      setTimeout(() => {
        if (this.sceneManager) {
          this.sceneManager.onWindowResize();
        }
      }, 50);
      setTimeout(() => {
        if (this.sceneManager) {
          this.sceneManager.onWindowResize();
        }
      }, 200);
    }

    if (tabId === "roster") this.renderRosterView();
    if (tabId === "quests") this.renderQuestsView();
    if (tabId === "shop") this.renderShopView();
    if (tabId === "boss_rush") this.renderBossRushView();
  }

  bindEvents() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => this.switchTab(btn.dataset.tab));
    });

    const startBattleBtn = document.getElementById("startBattleBtn");
    if (startBattleBtn) {
      startBattleBtn.addEventListener("click", () => this.startSelectedBattle("kof"));
    }

    // 手動立即更新按鈕
    const manualSyncBtn = document.getElementById("manualSyncBtn");
    if (manualSyncBtn) {
      manualSyncBtn.addEventListener("click", () => this.manualSync());
    }

    // 頭像徽章點擊
    const userAvatarBadge = document.getElementById("userAvatarBadge");
    if (userAvatarBadge) {
      userAvatarBadge.addEventListener("click", () => this.openProfileModal());
    }

    const dailyRewardBtn = document.getElementById("dailyRewardBtn");
    if (dailyRewardBtn) {
      dailyRewardBtn.addEventListener("click", () => this.openDailyRewardModal());
    }

    const googleSubmitBtn = document.getElementById("confirmGoogleLoginBtn");
    if (googleSubmitBtn) {
      googleSubmitBtn.addEventListener("click", () => {
        const email = document.getElementById("googleEmailInput").value || "player@gmail.com";
        const nick = document.getElementById("googleNickInput").value || "次元格鬥大師";
        this.performGoogleLogin(email, nick);
      });
    }

    const cameraBtn = document.getElementById("cameraViewBtn");
    if (cameraBtn) {
      cameraBtn.addEventListener("click", () => {
        if (this.cameraController) {
          this.cameraController.cycleViewMode();
          cameraBtn.innerHTML = `<i class="fa-solid fa-video"></i> ${this.cameraController.getViewModeLabel()}`;
        }
      });
    }

    // 1v1 ~ 5v5 賽制切換
    document.querySelectorAll(".team-size-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".team-size-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.teamSize = parseInt(btn.dataset.size);
        this.adjustTeamSize();
        this.renderTeamSelectors();
        this.renderRosterView();
        this.autoSync(`變更為 ${this.teamSize}v${this.teamSize} 賽制`);
      });
    });

    // 🤖 AI 難度分級選擇切換 (簡單 / 中等 / 困難) -> 自動隨機重抽符合該難度階級的電腦陣容
    document.querySelectorAll(".diff-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".diff-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.aiDifficulty = btn.dataset.diff;
        const hint = document.getElementById("difficultyRewardHint");
        if (hint) {
          if (this.aiDifficulty === "easy") {
            hint.innerHTML = `<b style="color:#22c55e;">[簡單]</b>：AI 隨機抽取白~藍階(T1~T3)英雄 ｜ 勝場 +400 金幣 / +15 獎盃`;
          } else if (this.aiDifficulty === "hard") {
            hint.innerHTML = `<b style="color:#ef4444;">[困難]</b>：AI 隨機抽取金~創世階(T6~T9)魔王神祇 ｜ 勝場 +1,800 金幣 / +75 獎盃 / 掉落感應結晶！`;
          } else {
            hint.innerHTML = `<b style="color:#eab308;">[中等]</b>：AI 隨機抽取藍~金階(T3~T6)全明星陣容 ｜ 勝場 +800 金幣 / +35 獎盃`;
          }
        }
        if (window.fighterAI3D) {
          window.fighterAI3D.setDifficulty(this.aiDifficulty);
        }
        // 即時依所選難度重抽電腦陣容
        this.draftComputerTeam(this.aiDifficulty, this.teamSize);
        this.autoSync(`調整 AI 難度為 ${this.aiDifficulty} 並重新隨機抽角`);
      });
    });

    // 商店系列篩選按鈕
    document.querySelectorAll(".shop-filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".shop-filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.shopFilterSeries = btn.dataset.series;
        this.renderShopView();
      });
    });

    // 角色名冊系列篩選按鈕
    document.querySelectorAll(".roster-filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".roster-filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.rosterFilterSeries = btn.dataset.series;
        this.renderRosterView();
      });
    });

    const muteBtn = document.getElementById("muteToggleBtn");
    if (muteBtn) {
      muteBtn.addEventListener("click", () => {
        const muted = window.soundEngine.toggleMute();
        muteBtn.innerHTML = muted ? `<i class="fa-solid fa-volume-xmark"></i> 靜音` : `<i class="fa-solid fa-volume-high"></i> 音效`;
      });
    }

    document.querySelectorAll(".modal-close-btn").forEach(btn => {
      btn.addEventListener("click", () => this.closeModal());
    });
  }

  // ─── 專屬獨立動作按鍵設定 (各動作獨立按鍵，絕不重疊衝突，全功能覆蓋) ───
  setupKeyboard() {
    window.addEventListener("keydown", (e) => {
      const isInput = e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable);
      const key = e.key.toLowerCase();
      const code = e.code;

      // 阻止遊戲快捷鍵引發網頁滾動或跳轉 (Space, 方向鍵, Tab 等)
      if (!isInput && ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(code)) {
        e.preventDefault();
      }

      if (e.repeat) return;
      this.keys[key] = true;
      this.keys[code] = true;

      // ── 🌐 全域功能快捷鍵 (免切換，隨時可用) ──
      if (!isInput) {
        // 1~7 數字鍵直接切換主功能分頁
        if (key === "1" || code === "Digit1") { this.switchTab("roster"); return; }
        if (key === "2" || code === "Digit2") { this.switchTab("battle"); return; }
        if (key === "3" || code === "Digit3") { this.switchTab("ranked"); return; }
        if (key === "4" || code === "Digit4") { this.switchTab("boss_rush"); return; }
        if (key === "5" || code === "Digit5") { this.switchTab("quests"); return; }
        if (key === "6" || code === "Digit6") { this.switchTab("shop"); return; }
        if (key === "7" || code === "Digit7") { this.switchTab("guide"); return; }

        // Escape 鍵關閉所有開啟中彈窗
        if (key === "escape" || code === "Escape") {
          this.closeModal();
          return;
        }

        // M 鍵切換音效靜音
        if (key === "m") {
          if (window.soundEngine) {
            const muted = window.soundEngine.toggleMute();
            const muteBtn = document.getElementById("muteToggleBtn");
            if (muteBtn) {
              muteBtn.innerHTML = muted ? `<i class="fa-solid fa-volume-xmark"></i> 靜音` : `<i class="fa-solid fa-volume-high"></i> 音效`;
            }
          }
          return;
        }

        // R 鍵手動同步存檔 (非 Ctrl+R 刷新)
        if (key === "r" && !e.ctrlKey && !e.metaKey && this.activeTab !== "battle") {
          this.manualSync();
          return;
        }

        // V / C 鍵切換 3D 相機視角 (第三人稱身後 / 第一人稱 / 上方俯瞰)
        if (key === "v" || (key === "c" && this.activeTab !== "battle")) {
          if (this.cameraController) {
            this.cameraController.cycleViewMode();
            const cameraBtn = document.getElementById("cameraViewBtn");
            if (cameraBtn) {
              cameraBtn.innerHTML = `<i class="fa-solid fa-video"></i> ${this.cameraController.getViewModeLabel()}`;
            }
          }
          return;
        }
      }

      // ── ⚔️ 3D 戰鬥即時操作響應 ──
      if (window.matchEngine3D) {
        const mState = window.matchEngine3D.matchState;

        // 若處於準備狀態或換人等待，按 Enter、Space 或任一戰鬥按鍵自動啟動對決
        const isActionKey = ["enter", "space", "w", "a", "s", "d", "j", "k", "u", "i", "l", "o", "f", "g", "h", "b", "q", "e", "z", "x", "shift"].includes(key) || ["Space", "ShiftLeft", "ShiftRight"].includes(code);

        if (isActionKey && (mState === "pre_match" || mState === "standby" || mState === "waiting_spawn_p1" || mState === "waiting_spawn_p2")) {
          window.matchEngine3D.confirmStartMatch();
          return;
        }

        if (key === "enter" || code === "Enter" || code === "NumpadEnter") {
          window.matchEngine3D.confirmStartMatch();
          return;
        }
      }

      const p1 = window.matchEngine3D ? window.matchEngine3D.p1Current : null;
      if (!p1 || window.matchEngine3D.matchState !== "fighting") return;
      const p2 = window.matchEngine3D.p2Current;

      // 1. 飛行起飛 / 降落 [F]
      if (key === "f") {
        p1.toggleFlight();
      }

      // 2. 視角切換 [V] 或 [C]
      if (key === "v" || key === "c") {
        if (this.cameraController) {
          this.cameraController.cycleViewMode();
          const cameraBtn = document.getElementById("cameraViewBtn");
          if (cameraBtn) {
            cameraBtn.innerHTML = `<i class="fa-solid fa-video"></i> ${this.cameraController.getViewModeLabel()}`;
          }
        }
      }

      // 3. 3D 跳躍 / 二段跳 [Space]
      if (code === "Space") {
        p1.jump();
      }

      // 4. 閃避翻滾 [Shift] / [Z] (CD 1.2s)
      if (key === "shift" || code === "ShiftLeft" || code === "ShiftRight" || key === "z") {
        p1.dodge();
      }

      // 5. 獨立格擋防禦 [G] 或 [H] (不佔用 S 鍵，避免後退衝突)
      if (key === "g" || key === "h") {
        p1.guard(true);
      }

      // 6. 輕擊普通攻擊 [J] (無 CD 磁性追擊連招)
      if (key === "j") {
        p1.lightAttack(p2);
      }

      // 7. 蓄力破防重擊 [K] 或 [X] (CD 2.5s)
      if (key === "k" || key === "x") {
        p1.startHeavyCharge();
        setTimeout(() => {
          if (p1 && p1.isCharging) p1.releaseHeavyCharge(p2);
        }, 700);
      }

      // 8. 摔投抓技 [O] 或 [T] (CD 3.5s)
      if (key === "o" || key === "t") {
        p1.grab(p2);
      }

      // 9. 戰術小招 1 [U] (CD 6~10s)
      if (key === "u") {
        p1.useSkill1(p2);
      }

      // 10. 戰術小招 2 [I] (CD 8~14s)
      if (key === "i") {
        p1.useSkill2(p2);
      }

      // 11. 終極奧義大招 [L] (CD 20s + 100% 怒氣)
      if (key === "l") {
        p1.useUlt(p2);
      }

      // 12. 援護出擊 [Q] 或 [E] 或 [Y] (CD 20s)
      if (key === "q" || key === "e" || key === "y") {
        window.matchEngine3D.callAssist();
      }

      // 13. 極限爆氣脫身 [B] (CD 12s + 50% 怒氣)
      if (key === "b") {
        p1.useBurst(p2);
      }
    });

    window.addEventListener("keyup", (e) => {
      const key = e.key.toLowerCase();
      const code = e.code;
      this.keys[key] = false;
      this.keys[code] = false;

      const p1 = window.matchEngine3D ? window.matchEngine3D.p1Current : null;
      const p2 = window.matchEngine3D ? window.matchEngine3D.p2Current : null;

      if (p1) {
        // 放開 G / H 鍵停止格擋
        if (key === "g" || key === "h") {
          p1.guard(false);
        }
        // 放開 K / X 鍵立即釋放蓄力破防重擊
        if ((key === "k" || key === "x") && p1.isCharging) {
          p1.releaseHeavyCharge(p2);
        }
      }
    });
  }

  setupTouchControls() {
    const joystickArea = document.getElementById("virtualJoystickArea");
    const joystickKnob = document.getElementById("virtualJoystickKnob");

    if (joystickArea && joystickKnob) {
      const handleJoystick = (clientX, clientY) => {
        const rect = joystickArea.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        let dx = clientX - centerX;
        let dy = clientY - centerY;
        const maxDist = 35;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > maxDist) {
          dx = (dx / dist) * maxDist;
          dy = (dy / dist) * maxDist;
        }

        joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
        this.joystick.moveX = dx / maxDist;
        this.joystick.moveY = dy / maxDist;
      };

      joystickArea.addEventListener("touchstart", (e) => {
        this.joystick.active = true;
        handleJoystick(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: false });

      window.addEventListener("touchmove", (e) => {
        if (!this.joystick.active) return;
        handleJoystick(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: false });

      window.addEventListener("touchend", () => {
        this.joystick.active = false;
        this.joystick.moveX = 0;
        this.joystick.moveY = 0;
        joystickKnob.style.transform = "translate(0px, 0px)";
      });
    }

    const bindTouch = (id, onDown, onUp) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener("touchstart", (e) => { e.preventDefault(); if (onDown) onDown(); });
      btn.addEventListener("touchend", (e) => { e.preventDefault(); if (onUp) onUp(); });
      btn.addEventListener("mousedown", (e) => { e.preventDefault(); if (onDown) onDown(); });
      btn.addEventListener("mouseup", (e) => { e.preventDefault(); if (onUp) onUp(); });
    };

    const p1 = () => window.matchEngine3D.p1Current;
    const p2 = () => window.matchEngine3D.p2Current;

    bindTouch("touchBtnFlight", () => { if (p1()) p1().toggleFlight(); });
    bindTouch("touchBtnJump", () => { if (p1()) p1().jump(); });
    bindTouch("touchBtnRoll", () => { if (p1()) p1().dodge(); });
    bindTouch("touchBtnGuard", () => { if (p1()) p1().guard(true); }, () => { if (p1()) p1().guard(false); });
    bindTouch("touchBtnAtk", () => { if (p1()) p1().lightAttack(p2()); });
    bindTouch("touchBtnHeavy", () => { if (p1()) { p1().startHeavyCharge(); setTimeout(() => p1().releaseHeavyCharge(p2()), 700); } });
    bindTouch("touchBtnGrab", () => { if (p1()) p1().grab(p2()); });
    bindTouch("touchBtnSkill1", () => { if (p1()) p1().useSkill1(p2()); });
    bindTouch("touchBtnSkill2", () => { if (p1()) p1().useSkill2(p2()); });
    bindTouch("touchBtnUlt", () => { if (p1()) p1().useUlt(p2()); });
    bindTouch("touchBtnBurst", () => { if (p1()) p1().useBurst(p2()); });
    bindTouch("touchBtnAssist", () => { window.matchEngine3D.callAssist(); });
  }

  startSelectedBattle(mode = "kof", customP2Roster = null, isRanked = false, bossFloor = 0) {
    const p1RosterData = this.p1Team.map(id => {
      const base = window.CHARACTERS_DATA.find(c => c.id === id) || window.CHARACTERS_DATA[0];
      return Object.assign({}, base, {
        userLevel: window.saveSystem.user.characterLevels[id] || 1,
        equippedGear: []
      });
    });

    const p2RosterData = (customP2Roster || this.p2Team).map(id => {
      const base = window.CHARACTERS_DATA.find(c => c.id === id) || window.CHARACTERS_DATA[0];
      return Object.assign({}, base, {
        userLevel: isRanked ? 100 : (base.rarity * 10),
        equippedGear: []
      });
    });

    const appliedDifficulty = mode === "kof" ? this.aiDifficulty : "medium";
    window.matchEngine3D.startMatch(p1RosterData, p2RosterData, mode, isRanked, bossFloor, appliedDifficulty);

    if (this.cameraController && window.matchEngine3D.p1Current) {
      this.cameraController.target = window.matchEngine3D.p1Current.model.group;
      this.cameraController.opponent = window.matchEngine3D.p2Current.model.group;
    }

    window.matchEngine3D.onMatchEnd = (result) => {
      this.handleMatchResult(result);
    };

    this.switchTab("battle");
    if (this.sceneManager) {
      this.sceneManager.onWindowResize();
    }
    setTimeout(() => {
      if (this.sceneManager) {
        this.sceneManager.onWindowResize();
      }
    }, 50);
  }

  // ─── 🏆 戰鬥勝負結算彈窗 ───
  handleMatchResult(result) {
    const isWin = result.winner === "player";
    const isBossRush = result.mode === "boss_rush";

    window.saveSystem.addGold(result.gold);
    if (result.crystalReward > 0) {
      window.saveSystem.addPsychoCrystals(result.crystalReward);
    }

    window.saveSystem.recordMatchResult(
      isWin,
      3500,
      result.mode === "ranked" || result.mode === "p2p",
      isBossRush,
      result.bossFloor,
      result.isSweep1v5
    );
    this.updateUserStatusBar();
    this.autoSync("戰鬥結算");

    this.showMatchSettlementModal(result);
  }

  showMatchSettlementModal(result) {
    const modal = document.getElementById("matchSettlementModal");
    const container = document.getElementById("settlementCardContent");
    if (!modal || !container) return;

    const isWin = result.winner === "player";
    container.className = `modal-content settlement-card ${isWin ? 'victory-theme' : 'defeat-theme'}`;

    const sweepNotice = result.isSweep1v5 ? `<div style="color: #facc15; font-weight: 900; font-size: 14px; margin: 8px 0; padding: 6px 12px; background: rgba(250, 204, 21, 0.15); border: 1px solid #facc15; border-radius: 8px;">👑【神級成就達成】首發先鋒 1 穿 5 完封大滿貫！額外 +5,000 金幣 + 2 顆結晶！</div>` : (result.isSweep ? `<div style="color: #38bdf8; font-weight: 800; font-size: 13px; margin: 8px 0; padding: 6px 12px; background: rgba(56, 189, 248, 0.15); border: 1px solid #38bdf8; border-radius: 8px;">🔥【完封連勝】達成零傷亡全員生還！</div>` : '');

    const diffLabel = result.difficulty === "easy" ? "🟢 簡單模式 (Easy)" : (result.difficulty === "hard" ? "🔴 困難極限模式 (Hard)" : "🟡 中等標準模式 (Normal)");

    const gradeColor = result.matchGrade === "SSS" ? "#facc15" : (result.matchGrade === "SS" ? "#38bdf8" : (result.matchGrade === "S" ? "#10b981" : "#a855f7"));

    container.innerHTML = `
      <div style="position: relative; text-align: center; margin-bottom: 12px;">
        <div style="display: inline-flex; align-items: center; justify-content: center; width: 72px; height: 72px; border-radius: 50%; background: linear-gradient(135deg, ${gradeColor}33, #0f172a); border: 3px solid ${gradeColor}; box-shadow: 0 0 25px ${gradeColor}66; margin-bottom: 6px;">
          <span style="font-size: 32px; font-weight: 900; color: ${gradeColor}; font-family: Impact, sans-serif;">${result.matchGrade || (isWin ? 'S' : 'A')}</span>
        </div>
        <h2 style="font-size: 28px; font-weight: 900; color: ${isWin ? '#10b981' : '#ef4444'}; text-shadow: 0 0 20px ${isWin ? 'rgba(16,185,129,0.6)' : 'rgba(239,68,68,0.6)'};">
          ${isWin ? '戰鬥勝利！(VICTORY)' : '對決結束 (DEFEATED)'}
        </h2>
        <div style="font-size: 13px; font-weight: 700; color: #facc15; margin-top: 2px;">
          ${result.casualtyTitle || (isWin ? '恭喜獲得本次跨次元對決勝利！' : '全體出賽英雄已力竭倒下')}
        </div>
      </div>

      ${sweepNotice}

      <!-- 戰績與傷亡數據盒 (Casualty & Lore Breakdown) -->
      <div class="settlement-stat-box" style="display: flex; flex-direction: column; gap: 8px; background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 14px; text-align: left; font-size: 13px;">
        <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 6px;">
          <span style="color: #94a3b8;">🎮 對戰賽制與難度：</span>
          <b style="color: #38bdf8;">${result.mode === 'boss_rush' ? `魔王挑戰塔第 ${result.bossFloor} 層` : (result.mode === 'ranked' ? '天梯公平排位' : diffLabel)}</b>
        </div>
        <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 6px;">
          <span style="color: #94a3b8;">👥 我方戰損與生還：</span>
          <b style="color: ${result.p1Deaths === 0 ? '#10b981' : '#f87171'};">
            ${result.p1Deaths === 0 ? '🌟 全員無傷生還 (0 陣亡)' : `💀 陣亡 ${result.p1Deaths || 0} 位 ｜ 生還 ${result.p1Survived || 0} 位`}
          </b>
        </div>
        <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 6px;">
          <span style="color: #94a3b8;">⚔️ 殲滅敵方英雄數：</span>
          <b style="color: #facc15;">${result.p2Defeated || 1} / ${result.p2TeamTotal || 3} 位 (全數擊潰)</b>
        </div>

        <!-- 🎁 豐厚獎品清單 (Rich Rewards Bundle) -->
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px dashed rgba(16, 185, 129, 0.4); border-radius: 8px; padding: 10px; margin-top: 4px;">
          <div style="font-size: 12px; font-weight: 800; color: #34d399; margin-bottom: 6px;"><i class="fa-solid fa-gift"></i> 結算獲得豐富戰利品明細：</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 13px;">
            <div>💰 獲得金幣：<b style="color: #facc15;">+${result.gold.toLocaleString()}</b></div>
            <div>🏆 獲得獎盃：<b style="color: ${result.trophiesDelta > 0 ? '#34d399' : '#f87171'};">${result.trophiesDelta > 0 ? `+${result.trophiesDelta}` : result.trophiesDelta}</b></div>
            ${result.crystalReward > 0 ? `<div style="color: #f472b6;">💎 感應結晶：<b style="color: #f472b6;">+${result.crystalReward} 顆！</b></div>` : ''}
            <div>📦 補給箱：<b style="color: #38bdf8;">+${result.gearCrates || 1} 個</b></div>
          </div>
        </div>
      </div>

      <div style="display: flex; gap: 10px; margin-top: 16px;">
        <button class="btn-primary" style="flex: 1; font-size: 15px; font-weight: 900; padding: 12px; justify-content: center; background: linear-gradient(135deg, #10b981, #059669); box-shadow: 0 0 20px rgba(16, 185, 129, 0.5);" onclick="window.app.startSelectedBattle('kof')">
          <i class="fa-solid fa-play"></i> 再戰一場
        </button>
        <button class="btn-secondary" style="font-size: 14px; font-weight: 800; padding: 12px 18px; justify-content: center;" onclick="window.app.restartToRoster()">
          <i class="fa-solid fa-house"></i> 回名冊
        </button>
      </div>
    `;

    modal.classList.add("active");
  }

  // ─── 🔄 重新開始回到初始角色頁面 ───
  restartToRoster() {
    this.closeModal();
    if (window.matchEngine3D) {
      window.matchEngine3D.matchState = "standby";
      if (window.matchEngine3D.p1Current) window.matchEngine3D.p1Current.destroy();
      if (window.matchEngine3D.p2Current) window.matchEngine3D.p2Current.destroy();
    }
    this.switchTab("roster");
    this.renderAllViews();
    this.updateUserStatusBar();
    this.autoSync("戰鬥結束重置回到首頁");
  }

  // ─── 🌐 跨裝置 P2P 房間 ───
  createP2PRoom() {
    const banner = document.getElementById("p2pStatusBanner");
    if (banner) banner.textContent = "⏳ 正在初始化 WebRTC P2P 房間...";

    window.p2pNetwork.createRoom((code) => {
      if (banner) {
        banner.innerHTML = `
          <div style="background: rgba(16, 185, 129, 0.2); border: 1px solid #10b981; padding: 10px; border-radius: 8px; margin-top: 8px;">
            🏠 <b>房間建立成功！</b><br>
            房間碼：<b style="font-size: 18px; color: #facc15; letter-spacing: 2px;">${code}</b><br>
            <span style="font-size: 11px; color: #cbd5e1;">請在另一台電腦或手機輸入此 6 位數房間碼並點擊「加入房間」！</span>
          </div>
        `;
      }

      window.p2pNetwork.onConnected = () => {
        if (banner) banner.innerHTML = `<span style="color: #34d399;">✅ 雙方裝置已連線！正在啟動 3D 即時對決...</span>`;
        window.p2pNetwork.send({ type: "ROSTER_INFO", team: this.p1Team });
      };

      window.p2pNetwork.onMessageReceived = (data) => {
        if (data.type === "ROSTER_INFO") {
          this.startSelectedBattle("p2p", data.team, true);
        }
      };
    });
  }

  joinP2PRoom() {
    const input = document.getElementById("p2pRoomInput");
    const code = input ? input.value.trim() : "";
    const banner = document.getElementById("p2pStatusBanner");

    if (!code) {
      alert("請先輸入 6 位數房間碼！");
      return;
    }

    if (banner) banner.textContent = `⏳ 正在連接至房間【${code}】...`;

    window.p2pNetwork.joinRoom(code, (ok) => {
      if (ok) {
        if (banner) banner.innerHTML = `<span style="color: #34d399;">✅ 成功加入房間！正在加載雙方 3D 機台...</span>`;
        window.p2pNetwork.onConnected = () => {
          window.p2pNetwork.send({ type: "ROSTER_INFO", team: this.p1Team });
        };
        window.p2pNetwork.onMessageReceived = (data) => {
          if (data.type === "ROSTER_INFO") {
            this.startSelectedBattle("p2p", data.team, true);
          }
        };
      } else {
        if (banner) banner.innerHTML = `<span style="color: #ef4444;">❌ 連接房間失敗，請確認房間碼是否正確！</span>`;
      }
    });
  }

  getCanonHeroAvatarSVG(c) {
    if (!c) return '';
    const cid = c.id;
    const series = c.series;
    const theme = c.themeColor || '#38bdf8';

    let innerSVG = '';

    // 1. GUNDAM SERIES (🤖)
    if (series === 'gundam') {
      if (cid.includes('sazabi')) {
        innerSVG = `
          <polygon points="30,85 70,85 82,45 50,22 18,45" fill="#b91c1c" stroke="#7f1d1d" stroke-width="2"/>
          <line x1="50" y1="22" x2="50" y2="8" stroke="#facc15" stroke-width="3"/>
          <rect x="35" y="52" width="30" height="12" rx="2" fill="#0f172a"/>
          <circle cx="50" cy="58" r="4.5" fill="#22c55e" filter="drop-shadow(0 0 4px #22c55e)"/>
          <polygon points="45,68 55,68 53,78 47,78" fill="#facc15"/>
        `;
      } else if (cid.includes('barbatos')) {
        innerSVG = `
          <polygon points="28,85 72,85 80,45 50,25 20,45" fill="#f8fafc" stroke="#0f172a" stroke-width="2"/>
          <polygon points="50,30 18,12 28,30 50,38" fill="#facc15"/>
          <polygon points="50,30 82,12 72,30 50,38" fill="#facc15"/>
          <polygon points="36,58 48,58 44,64 36,64" fill="#ef4444"/>
          <polygon points="52,58 64,58 64,64 56,64" fill="#ef4444"/>
          <polygon points="44,70 56,70 54,80 46,80" fill="#dc2626"/>
        `;
      } else if (cid.includes('banshee')) {
        innerSVG = `
          <polygon points="30,85 70,85 80,45 50,25 20,45" fill="#1e1b4b" stroke="#0f172a" stroke-width="2"/>
          <polygon points="50,32 10,8 25,28 50,38" fill="#facc15"/>
          <polygon points="50,32 90,8 75,28 50,38" fill="#facc15"/>
          <polygon points="36,60 48,60 46,65 37,65" fill="#ef4444"/>
          <polygon points="52,60 64,60 63,65 54,65" fill="#ef4444"/>
          <polygon points="45,72 55,72 53,82 47,82" fill="#facc15"/>
        `;
      } else {
        // Standard Gundams (RX-78, Strike Freedom, Nu, Wing, Exia, etc.)
        const vFinCol = cid.includes('strike_freedom') ? '#facc15' : '#facc15';
        const eyeCol = cid.includes('exia') ? '#38bdf8' : '#22c55e';
        innerSVG = `
          <polygon points="30,85 70,85 80,45 50,25 20,45" fill="#f8fafc" stroke="#0f172a" stroke-width="2"/>
          <polygon points="40,55 60,55 65,70 35,70" fill="#1e293b"/>
          <polygon points="36,60 48,60 46,65 37,65" fill="${eyeCol}"/>
          <polygon points="52,60 64,60 63,65 54,65" fill="${eyeCol}"/>
          <polygon points="45,72 55,72 53,82 47,82" fill="#ef4444"/>
          <polygon points="50,32 12,8 24,28 50,38" fill="${vFinCol}" stroke="#ca8a04" stroke-width="1"/>
          <polygon points="50,32 88,8 76,28 50,38" fill="${vFinCol}" stroke="#ca8a04" stroke-width="1"/>
          <polygon points="50,26 44,38 56,38" fill="#ef4444"/>
        `;
      }
    }
    // 2. DRAGON BALL SERIES (⚡)
    else if (series === 'dragonball') {
      if (cid.includes('whis')) {
        innerSVG = `
          <ellipse cx="50" cy="20" rx="32" ry="6" fill="none" stroke="#38bdf8" stroke-width="3"/>
          <polygon points="32,45 68,45 62,80 50,88 38,80" fill="#a5f3fc"/>
          <polygon points="35,15 65,15 72,45 28,45" fill="#f8fafc"/>
          <circle cx="42" cy="60" r="2.5" fill="#0284c7"/>
          <circle cx="58" cy="60" r="2.5" fill="#0284c7"/>
          <polygon points="20,95 50,78 80,95 50,105" fill="#0f766e"/>
        `;
      } else if (cid.includes('beerus')) {
        innerSVG = `
          <polygon points="25,40 15,5 38,30" fill="#a855f7" stroke="#7e22ce" stroke-width="1.5"/>
          <polygon points="75,40 85,5 62,30" fill="#a855f7" stroke="#7e22ce" stroke-width="1.5"/>
          <polygon points="34,35 66,35 60,78 50,86 40,78" fill="#c084fc"/>
          <polygon points="38,54 46,58 40,62" fill="#facc15"/>
          <polygon points="62,54 54,58 60,62" fill="#facc15"/>
          <polygon points="20,95 50,78 80,95 50,105" fill="#0284c7"/>
        `;
      } else if (cid.includes('piccolo')) {
        const isOrange = cid.includes('orange');
        innerSVG = `
          <polygon points="32,40 68,40 62,80 50,88 38,80" fill="${isOrange ? '#f97316' : '#22c55e'}"/>
          <line x1="38" y1="35" x2="25" y2="15" stroke="${isOrange ? '#f97316' : '#22c55e'}" stroke-width="3"/>
          <line x1="62" y1="35" x2="75" y2="15" stroke="${isOrange ? '#f97316' : '#22c55e'}" stroke-width="3"/>
          <polygon points="36,54 46,58 38,60" fill="#0f172a"/>
          <polygon points="64,54 54,58 62,60" fill="#0f172a"/>
          <polygon points="20,95 50,78 80,95 50,105" fill="#7e22ce"/>
        `;
      } else if (cid.includes('trunks')) {
        innerSVG = `
          <polygon points="50,15 30,25 18,35 25,60 75,60 82,35 70,25" fill="#c084fc" stroke="#9333ea" stroke-width="1.5"/>
          <polygon points="32,46 68,46 62,80 50,88 38,80" fill="#fed7aa"/>
          <circle cx="42" cy="62" r="2.5" fill="#0284c7"/>
          <circle cx="58" cy="62" r="2.5" fill="#0284c7"/>
          <polygon points="20,95 50,78 80,95 50,105" fill="#4338ca"/>
        `;
      } else {
        // Goku, Vegeta, Gohan, Broly, etc.
        let hairCol = '#0f172a';
        if (cid.includes('ssj3') || cid === 'goku_ssj1' || cid.includes('gotenks') || cid.includes('broly')) hairCol = '#facc15';
        else if (cid.includes('blue')) hairCol = '#0284c7';
        else if (cid.includes('rose')) hairCol = '#ec4899';
        else if (cid.includes('beast') || cid.includes('ultra_instinct')) hairCol = '#e2e8f0';
        else if (cid.includes('ultra_ego')) hairCol = '#9333ea';

        const isVegeta = cid.includes('vegeta');
        innerSVG = `
          <polygon points="50,6 35,28 18,15 22,40 6,32 15,60 30,55 35,75 50,90 65,75 70,55 85,60 94,32 78,40 82,15 65,28" fill="${hairCol}" stroke="#0f172a" stroke-width="2"/>
          <polygon points="32,45 68,45 62,78 50,88 38,78" fill="#fed7aa" stroke="#0f172a" stroke-width="1.5"/>
          <polygon points="36,56 46,60 38,62" fill="#0f172a"/>
          <polygon points="64,56 54,60 62,62" fill="#0f172a"/>
          <line x1="44" y1="74" x2="56" y2="74" stroke="#0f172a" stroke-width="1.5"/>
          <polygon points="20,95 50,78 80,95 50,105" fill="${isVegeta ? '#1e3a8a' : '#ea580c'}"/>
          <polygon points="40,90 50,80 60,90" fill="#1e3a8a"/>
        `;
      }
    }
    // 3. MARVEL HEROES (🦸)
    else if (series === 'marvel') {
      if (cid.includes('spiderman')) {
        const isSymbiote = cid.includes('symbiote');
        const isMiles = cid.includes('miles');
        const is2099 = cid.includes('2099');
        const maskColor = isSymbiote ? '#0f172a' : (isMiles ? '#18181b' : (is2099 ? '#1e3a8a' : '#dc2626'));
        const webColor = isMiles ? '#dc2626' : '#000000';
        innerSVG = `
          <ellipse cx="50" cy="52" rx="30" ry="34" fill="${maskColor}" stroke="#000" stroke-width="2"/>
          <line x1="50" y1="18" x2="50" y2="86" stroke="${webColor}" stroke-width="1.2" opacity="0.6"/>
          <line x1="20" y1="52" x2="80" y2="52" stroke="${webColor}" stroke-width="1.2" opacity="0.6"/>
          <line x1="26" y1="30" x2="74" y2="74" stroke="${webColor}" stroke-width="1.2" opacity="0.6"/>
          <line x1="26" y1="74" x2="74" y2="30" stroke="${webColor}" stroke-width="1.2" opacity="0.6"/>
          <polygon points="26,46 45,56 36,64 24,54" fill="${is2099 ? '#ef4444' : '#fff'}" stroke="#000" stroke-width="2.5"/>
          <polygon points="74,46 55,56 64,64 76,54" fill="${is2099 ? '#ef4444' : '#fff'}" stroke="#000" stroke-width="2.5"/>
        `;
      } else if (cid.includes('ironman')) {
        const isHulkbuster = cid.includes('hulkbuster');
        innerSVG = `
          <polygon points="${isHulkbuster ? '16,25 84,25 88,75 50,92 12,75' : '24,30 76,30 84,70 50,90 16,70'}" fill="#dc2626" stroke="#7f1d1d" stroke-width="2"/>
          <polygon points="30,42 70,42 76,75 50,86 24,75" fill="#facc15" stroke="#ca8a04" stroke-width="1.5"/>
          <rect x="34" y="54" width="12" height="4" rx="1" fill="#38bdf8"/>
          <rect x="54" y="54" width="12" height="4" rx="1" fill="#38bdf8"/>
          <line x1="40" y1="74" x2="60" y2="74" stroke="#78350f" stroke-width="1.5"/>
        `;
      } else if (cid.includes('deadpool')) {
        innerSVG = `
          <ellipse cx="50" cy="52" rx="28" ry="32" fill="#dc2626" stroke="#991b1b" stroke-width="2"/>
          <ellipse cx="38" cy="52" rx="12" ry="16" fill="#0f172a"/>
          <ellipse cx="62" cy="52" rx="12" ry="16" fill="#0f172a"/>
          <ellipse cx="38" cy="52" rx="4" ry="5" fill="#ffffff"/>
          <ellipse cx="62" cy="52" rx="4" ry="5" fill="#ffffff"/>
        `;
      } else if (cid.includes('loki')) {
        innerSVG = `
          <polygon points="20,10 32,38 68,38 80,10 60,30 40,30" fill="#facc15" stroke="#ca8a04" stroke-width="1.5"/>
          <polygon points="32,40 68,40 62,78 50,86 38,78" fill="#fed7aa"/>
          <circle cx="42" cy="58" r="2.5" fill="#15803d"/>
          <circle cx="58" cy="58" r="2.5" fill="#15803d"/>
          <polygon points="20,95 50,78 80,95 50,105" fill="#15803d"/>
        `;
      } else if (cid.includes('thanos')) {
        innerSVG = `
          <polygon points="22,30 78,30 82,65 50,88 18,65" fill="#facc15" stroke="#ca8a04" stroke-width="2"/>
          <polygon points="32,45 68,45 62,82 50,90 38,82" fill="#a855f7"/>
          <line x1="45" y1="76" x2="45" y2="86" stroke="#581c87" stroke-width="1.5"/>
          <line x1="50" y1="76" x2="50" y2="88" stroke="#581c87" stroke-width="1.5"/>
          <line x1="55" y1="76" x2="55" y2="86" stroke="#581c87" stroke-width="1.5"/>
        `;
      } else if (cid.includes('black_panther')) {
        innerSVG = `
          <polygon points="25,25 18,10 35,22 65,22 82,10 75,25 80,65 50,88 20,65" fill="#0f172a" stroke="#475569" stroke-width="2"/>
          <polygon points="36,52 46,55 38,58" fill="#e2e8f0"/>
          <polygon points="64,52 54,55 62,58" fill="#e2e8f0"/>
          <line x1="30" y1="80" x2="70" y2="80" stroke="#9333ea" stroke-width="2"/>
        `;
      } else {
        // Captain America, Thor, Wolverine, Doctor Strange, etc.
        innerSVG = `
          <ellipse cx="50" cy="52" rx="28" ry="32" fill="#1d4ed8" stroke="#1e40af" stroke-width="2"/>
          <ellipse cx="50" cy="62" rx="20" ry="18" fill="#fed7aa"/>
          <text x="50" y="38" font-size="18" font-weight="900" font-family="sans-serif" fill="#fff" text-anchor="middle">A</text>
          <ellipse cx="42" cy="58" rx="3" ry="2" fill="#0f172a"/>
          <ellipse cx="58" cy="58" rx="3" ry="2" fill="#0f172a"/>
          <path d="M 30,68 Q 50,88 70,68" stroke="#78350f" stroke-width="3" fill="none"/>
        `;
      }
    }
    // 4. ANIME & GAMING HEROES (⚔️ / 🎮)
    else {
      if (cid.includes('sasuke')) {
        innerSVG = `
          <polygon points="50,10 28,25 15,20 22,45 10,50 20,70 80,70 90,50 78,45 85,20 72,25" fill="#0f172a" stroke="#000" stroke-width="1.5"/>
          <polygon points="32,48 68,48 62,80 50,88 38,80" fill="#fed7aa"/>
          <circle cx="42" cy="62" r="3" fill="#ef4444"/>
          <circle cx="58" cy="62" r="3" fill="#a855f7"/>
          <polygon points="20,95 50,78 80,95 50,105" fill="#312e81"/>
        `;
      } else if (cid.includes('tanjiro')) {
        innerSVG = `
          <polygon points="30,22 70,22 78,48 22,48" fill="#991b1b"/>
          <polygon points="32,45 68,45 62,80 50,88 38,80" fill="#fed7aa"/>
          <polygon points="38,48 44,46 42,54 36,52" fill="#dc2626"/>
          <rect x="24" y="66" width="6" height="12" fill="#16a34a" stroke="#000"/>
          <rect x="70" y="66" width="6" height="12" fill="#16a34a" stroke="#000"/>
          <circle cx="42" cy="62" r="2.5" fill="#7f1d1d"/>
          <circle cx="58" cy="62" r="2.5" fill="#7f1d1d"/>
        `;
      } else if (cid.includes('sukuna')) {
        innerSVG = `
          <polygon points="50,12 30,25 16,35 24,55 76,55 84,35 70,25" fill="#f472b6" stroke="#db2777" stroke-width="1.5"/>
          <polygon points="32,48 68,48 62,80 50,88 38,80" fill="#fed7aa"/>
          <line x1="50" y1="50" x2="50" y2="60" stroke="#0f172a" stroke-width="2"/>
          <line x1="36" y1="70" x2="42" y2="72" stroke="#0f172a" stroke-width="1.5"/>
          <line x1="64" y1="70" x2="58" y2="72" stroke="#0f172a" stroke-width="1.5"/>
          <circle cx="42" cy="60" r="2.5" fill="#dc2626"/>
          <circle cx="58" cy="60" r="2.5" fill="#dc2626"/>
          <line x1="38" y1="66" x2="44" y2="66" stroke="#dc2626" stroke-width="1.2"/>
          <line x1="56" y1="66" x2="62" y2="66" stroke="#dc2626" stroke-width="1.2"/>
        `;
      } else if (cid.includes('ichigo')) {
        innerSVG = `
          <polygon points="50,8 30,22 14,25 22,48 10,55 24,70 76,70 90,55 78,48 86,25 70,22" fill="#ea580c" stroke="#c2410c" stroke-width="1.5"/>
          <polygon points="32,48 68,48 62,80 50,88 38,80" fill="#fed7aa"/>
          <polygon points="38,58 46,58 42,63" fill="#854d0e"/>
          <polygon points="54,58 62,58 58,63" fill="#854d0e"/>
          <polygon points="20,95 50,78 80,95 50,105" fill="#0f172a"/>
        `;
      } else if (cid.includes('sora')) {
        innerSVG = `
          <polygon points="50,10 25,20 12,30 20,52 80,52 88,30 75,20" fill="#78350f" stroke="#451a03" stroke-width="1.5"/>
          <polygon points="32,48 68,48 62,80 50,88 38,80" fill="#fed7aa"/>
          <circle cx="42" cy="62" r="3" fill="#0284c7"/>
          <circle cx="58" cy="62" r="3" fill="#0284c7"/>
          <polygon points="46,88 54,88 50,84" fill="#facc15"/>
        `;
      } else if (cid.includes('nier_2b') || cid.includes('gojo')) {
        innerSVG = `
          <polygon points="50,12 30,25 20,40 80,40 70,25" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2"/>
          <rect x="22" y="44" width="56" height="18" rx="3" fill="#0f172a"/>
          <polygon points="34,62 66,62 60,82 50,88 40,82" fill="#fed7aa"/>
          <circle cx="42" cy="80" r="1" fill="#0f172a"/>
        `;
      } else if (cid.includes('cloud')) {
        innerSVG = `
          <polygon points="50,10 30,22 14,25 22,48 10,55 24,70 76,70 90,55 78,48 86,25 70,22" fill="#facc15" stroke="#ca8a04" stroke-width="1.5"/>
          <polygon points="32,48 68,48 62,80 50,88 38,80" fill="#fed7aa"/>
          <polygon points="38,58 46,58 42,63" fill="#0284c7"/>
          <polygon points="54,58 62,58 58,63" fill="#0284c7"/>
          <polygon points="15,85 45,75 45,100 15,100" fill="#94a3b8" stroke="#475569" stroke-width="1.5"/>
          <polygon points="40,80 85,80 85,100 40,100" fill="#312e81"/>
        `;
      } else if (cid.includes('sephiroth')) {
        innerSVG = `
          <polygon points="50,12 25,25 15,65 18,95 32,80 34,48 66,48 68,80 82,95 85,65 75,25" fill="#e2e8f0" stroke="#94a3b8" stroke-width="1.5"/>
          <polygon points="34,48 66,48 60,80 50,88 40,80" fill="#fed7aa"/>
          <polygon points="40,58 48,58 44,62" fill="#10b981"/>
          <polygon points="52,58 60,58 56,62" fill="#10b981"/>
          <polygon points="10,80 35,75 35,100 10,100" fill="#94a3b8"/>
          <polygon points="65,75 90,80 90,100 65,100" fill="#94a3b8"/>
        `;
      } else if (cid.includes('kratos')) {
        innerSVG = `
          <ellipse cx="50" cy="50" rx="28" ry="32" fill="#d1d5db" stroke="#9ca3af" stroke-width="1.5"/>
          <path d="M 50,20 Q 32,35 34,60 Q 35,80 25,95" stroke="#dc2626" stroke-width="5" fill="none"/>
          <polygon points="38,52 46,54 40,58" fill="#0f172a"/>
          <polygon points="54,54 62,52 60,58" fill="#0f172a"/>
          <polygon points="30,68 70,68 62,94 50,98 38,94" fill="#1e1b4b"/>
        `;
      } else if (cid.includes('master_chief') || cid.includes('doom_slayer')) {
        const isDoom = cid.includes('doom');
        innerSVG = `
          <polygon points="26,30 74,30 82,65 50,88 18,65" fill="${isDoom ? '#15803d' : '#3f6212'}" stroke="#14532d" stroke-width="2"/>
          <polygon points="30,42 70,42 75,64 50,76 25,64" fill="#f59e0b"/>
          <line x1="30" y1="52" x2="70" y2="52" stroke="#78350f" stroke-width="1.5"/>
        `;
      } else if (cid.includes('link')) {
        innerSVG = `
          <polygon points="50,10 15,30 30,55 70,55 85,30" fill="#15803d" stroke="#166534" stroke-width="2"/>
          <polygon points="25,50 75,50 82,68 18,68" fill="#facc15"/>
          <polygon points="32,56 68,56 62,80 50,88 38,80" fill="#fed7aa"/>
          <circle cx="42" cy="68" r="2.5" fill="#0284c7"/>
          <circle cx="58" cy="68" r="2.5" fill="#0284c7"/>
        `;
      } else if (cid.includes('naruto')) {
        innerSVG = `
          <polygon points="50,10 32,25 15,20 22,42 10,48 20,68 80,68 90,48 78,42 85,20 68,25" fill="#facc15" stroke="#ca8a04" stroke-width="1.5"/>
          <rect x="25" y="42" width="50" height="15" rx="3" fill="#1e3a8a"/>
          <rect x="35" y="44" width="30" height="11" rx="2" fill="#94a3b8" stroke="#475569" stroke-width="1"/>
          <circle cx="50" cy="49" r="3" fill="none" stroke="#0f172a" stroke-width="1.2"/>
          <polygon points="30,57 70,57 64,82 50,90 36,82" fill="#fed7aa"/>
          <line x1="32" y1="68" x2="40" y2="70" stroke="#0f172a" stroke-width="1.2"/>
          <line x1="32" y1="73" x2="40" y2="74" stroke="#0f172a" stroke-width="1.2"/>
          <line x1="68" y1="68" x2="60" y2="70" stroke="#0f172a" stroke-width="1.2"/>
          <line x1="68" y1="73" x2="60" y2="74" stroke="#0f172a" stroke-width="1.2"/>
          <circle cx="42" cy="65" r="2.5" fill="#0284c7"/>
          <circle cx="58" cy="65" r="2.5" fill="#0284c7"/>
        `;
      } else if (cid.includes('luffy')) {
        innerSVG = `
          <ellipse cx="50" cy="35" rx="42" ry="16" fill="#facc15" stroke="#ca8a04" stroke-width="2"/>
          <path d="M 26,34 Q 50,15 74,34" fill="#eab308"/>
          <path d="M 26,35 Q 50,22 74,35" stroke="#dc2626" stroke-width="4" fill="none"/>
          <polygon points="30,42 70,42 76,55 24,55" fill="#0f172a"/>
          <polygon points="32,46 68,46 62,80 50,88 38,80" fill="#fed7aa"/>
          <circle cx="42" cy="60" r="3" fill="#0f172a"/>
          <circle cx="58" cy="60" r="3" fill="#0f172a"/>
          <path d="M 38,66 L 42,70" stroke="#0f172a" stroke-width="1.5"/>
        `;
      } else if (cid.includes('zoro')) {
        innerSVG = `
          <polygon points="30,25 70,25 78,50 22,50" fill="#16a34a" stroke="#15803d" stroke-width="2"/>
          <polygon points="32,45 68,45 62,80 50,88 38,80" fill="#fed7aa"/>
          <line x1="40" y1="52" x2="44" y2="66" stroke="#0f172a" stroke-width="1.5"/>
          <polygon points="56,58 64,58 60,63" fill="#0f172a"/>
          <circle cx="28" cy="68" r="2" fill="#facc15"/>
          <circle cx="28" cy="73" r="2" fill="#facc15"/>
          <circle cx="28" cy="78" r="2" fill="#facc15"/>
        `;
      } else if (cid.includes('saitama')) {
        innerSVG = `
          <ellipse cx="50" cy="50" rx="26" ry="30" fill="#fed7aa" stroke="#fcd34d" stroke-width="2"/>
          <line x1="32" y1="44" x2="44" y2="46" stroke="#0f172a" stroke-width="2.5"/>
          <line x1="68" y1="44" x2="56" y2="46" stroke="#0f172a" stroke-width="2.5"/>
          <ellipse cx="40" cy="52" rx="3" ry="2" fill="#0f172a"/>
          <ellipse cx="60" cy="52" rx="3" ry="2" fill="#0f172a"/>
          <polygon points="20,95 50,78 80,95 50,105" fill="#eab308"/>
          <polygon points="12,85 30,82 25,100" fill="#ffffff"/>
          <polygon points="88,85 70,82 75,100" fill="#ffffff"/>
        `;
      } else if (cid.includes('genos')) {
        innerSVG = `
          <polygon points="50,10 32,22 18,25 25,48 15,55 26,70 74,70 85,55 75,48 82,25 68,22" fill="#facc15" stroke="#ca8a04" stroke-width="1.5"/>
          <polygon points="32,48 68,48 62,80 50,88 38,80" fill="#fed7aa"/>
          <rect x="36" y="56" width="10" height="7" fill="#09090b"/>
          <circle cx="41" cy="59" r="2" fill="#facc15"/>
          <rect x="54" y="56" width="10" height="7" fill="#09090b"/>
          <circle cx="59" cy="59" r="2" fill="#facc15"/>
          <polygon points="20,95 50,78 80,95 50,105" fill="#334155"/>
        `;
      } else if (cid.includes('levi')) {
        innerSVG = `
          <polygon points="30,25 70,25 78,55 68,60 32,60 22,55" fill="#0f172a"/>
          <polygon points="32,48 68,48 62,80 50,88 38,80" fill="#fed7aa"/>
          <line x1="36" y1="58" x2="46" y2="60" stroke="#0f172a" stroke-width="2"/>
          <line x1="64" y1="58" x2="54" y2="60" stroke="#0f172a" stroke-width="2"/>
          <circle cx="42" cy="64" r="2" fill="#0f172a"/>
          <circle cx="58" cy="64" r="2" fill="#0f172a"/>
          <polygon points="44,82 56,82 50,92" fill="#ffffff"/>
          <polygon points="20,95 50,78 80,95 50,105" fill="#15803d"/>
        `;
      } else if (cid.includes('eren')) {
        innerSVG = `
          <polygon points="50,12 25,25 15,65 18,95 32,80 34,48 66,48 68,80 82,95 85,65 75,25" fill="#451a03" stroke="#270e02" stroke-width="1.5"/>
          <polygon points="34,48 66,48 60,80 50,88 40,80" fill="#fed7aa"/>
          <circle cx="42" cy="60" r="3" fill="#22c55e"/>
          <circle cx="58" cy="60" r="3" fill="#22c55e"/>
          <line x1="38" y1="74" x2="62" y2="74" stroke="#dc2626" stroke-width="1.5"/>
        `;
      } else if (cid.includes('dante') || cid.includes('vergil')) {
        const isDante = cid.includes('dante');
        innerSVG = `
          <polygon points="50,10 30,22 18,25 25,48 15,55 26,70 74,70 85,55 75,48 82,25 68,22" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>
          <polygon points="32,48 68,48 62,80 50,88 38,80" fill="#fed7aa"/>
          <circle cx="42" cy="60" r="2.5" fill="#0284c7"/>
          <circle cx="58" cy="60" r="2.5" fill="#0284c7"/>
          <polygon points="20,95 50,78 80,95 50,105" fill="${isDante ? '#dc2626' : '#1e3a8a'}"/>
        `;
      } else if (cid.includes('megaman') || cid.includes('zero')) {
        const isZero = cid.includes('zero');
        innerSVG = `
          <polygon points="24,25 76,25 84,65 50,88 16,65" fill="${isZero ? '#dc2626' : '#0284c7'}" stroke="#0369a1" stroke-width="2"/>
          <circle cx="50" cy="35" r="5" fill="${isZero ? '#22c55e' : '#38bdf8'}"/>
          <polygon points="32,48 68,48 62,80 50,88 38,80" fill="#fed7aa"/>
          <circle cx="42" cy="62" r="2.5" fill="#0284c7"/>
          <circle cx="58" cy="62" r="2.5" fill="#0284c7"/>
        `;
      } else {
        innerSVG = `
          <polygon points="50,12 30,24 16,35 24,55 76,55 84,35 70,24" fill="${theme}" stroke="#0f172a" stroke-width="1.5"/>
          <polygon points="32,46 68,46 62,80 50,88 38,80" fill="#fed7aa"/>
          <circle cx="42" cy="62" r="2.5" fill="#0f172a"/>
          <circle cx="58" cy="62" r="2.5" fill="#0f172a"/>
          <polygon points="20,95 50,78 80,95 50,105" fill="${theme}"/>
        `;
      }
    }

    return `
      <svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="display: block; width: 100%; height: 100%;">
        ${innerSVG}
      </svg>
    `;
  }

  getHeroAvatarHTML(c, size = 64) {
    if (!c) return '';
    const seriesEmoji = c.series === 'gundam' ? '🤖' : (c.series === 'dragonball' ? '⚡' : (c.series === 'marvel' ? '🦸' : (c.series === 'anime' ? '⚔️' : '🎮')));
    const svgContent = this.getCanonHeroAvatarSVG(c);

    return `
      <div class="card-avatar-wrapper" style="width: ${size}px; height: ${size}px; position: relative; border-radius: 12px; overflow: hidden; background: linear-gradient(135deg, ${c.themeColor}33, #0f172a); border: 2px solid ${c.themeColor}; box-shadow: 0 4px 12px rgba(0,0,0,0.5); flex-shrink: 0;">
        ${svgContent}
        <span style="position: absolute; bottom: 2px; right: 2px; font-size: ${Math.max(10, Math.round(size * 0.26))}px; background: rgba(15,23,42,0.85); border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 1px 3px; line-height: 1;">${seriesEmoji}</span>
      </div>
    `;
  }

  renderTeamSelectors() {
    const p1Container = document.getElementById("p1TeamSlots");
    const p2Container = document.getElementById("p2TeamSlots");
    if (!p1Container || !p2Container) return;

    p1Container.innerHTML = this.p1Team.map((charId, idx) => {
      const char = window.CHARACTERS_DATA.find(c => c.id === charId) || window.CHARACTERS_DATA[0];
      const lvl = window.saveSystem.user.characterLevels[charId] || 1;
      return `
        <div class="team-slot-card" onclick="window.app.openHeroPicker(${idx}, 1)" style="display: flex; gap: 10px; align-items: center;">
          ${this.getHeroAvatarHTML(char, 46)}
          <div>
            <div class="slot-badge">${idx + 1} 號位 ${idx === 0 ? '(首發)' : ''}</div>
            <div class="slot-char-name" style="color: ${char.themeColor}">${char.name}</div>
            <div class="slot-char-lvl">Lv.${lvl}</div>
          </div>
        </div>
      `;
    }).join("");

    const diffTag = this.aiDifficulty === "easy" ? "🟢 簡單池 (T1~T3)" : (this.aiDifficulty === "hard" ? "🔴 困難神祇 (T6~T9)" : "🟡 中等全明星 (T3~T6)");
    const p2Header = document.getElementById("p2TeamHeaderTitle");
    if (p2Header) {
      p2Header.innerHTML = `🔴 電腦對手陣容 <span style="font-size: 11px; font-weight: 700; color: #facc15;">(${diffTag})</span>`;
    }

    p2Container.innerHTML = this.p2Team.map((charId, idx) => {
      const char = window.CHARACTERS_DATA.find(c => c.id === charId) || window.CHARACTERS_DATA[0];
      const rInfo = window.RARITY_TIERS[char.rarity] || { name: `${char.rarity}階`, color: "#38bdf8" };
      return `
        <div class="team-slot-card" onclick="window.app.openHeroPicker(${idx}, 2)" style="display: flex; gap: 10px; align-items: center;">
          ${this.getHeroAvatarHTML(char, 46)}
          <div>
            <div class="slot-badge">${idx + 1} 號位 <span style="color:${rInfo.color}; font-size:10px;">[${rInfo.label || rInfo.name}]</span></div>
            <div class="slot-char-name" style="color: ${char.themeColor}">${char.name}</div>
            <div class="slot-char-lvl">${char.seriesName} · Lv.${char.rarity * 10}</div>
          </div>
        </div>
      `;
    }).join("");
  }

  openHeroPicker(slotIdx, teamNum) {
    this.pickingSlotIndex = slotIdx;
    this.pickingForTeam = teamNum;
    const modal = document.getElementById("heroPickerModal");
    const grid = document.getElementById("pickerHeroGrid");
    if (!modal || !grid) return;

    const list = teamNum === 1
      ? window.CHARACTERS_DATA.filter(c => window.saveSystem.user.unlockedCharacters.includes(c.id))
      : window.CHARACTERS_DATA;

    grid.innerHTML = list.map(c => `
      <div class="picker-card" onclick="window.app.selectHeroForSlot('${c.id}')" style="display: flex; gap: 10px; align-items: center;">
        ${this.getHeroAvatarHTML(c, 44)}
        <div>
          <div style="font-weight: 800; color: ${c.themeColor}">${c.name}</div>
          <div style="font-size: 11px; color: #94a3b8">${c.seriesName} · ${c.role}</div>
        </div>
      </div>
    `).join("");

    modal.classList.add("active");
  }

  selectHeroForSlot(charId) {
    if (this.pickingForTeam === 1) {
      this.p1Team[this.pickingSlotIndex] = charId;
      window.saveSystem.setTeam(this.p1Team);
    } else {
      this.p2Team[this.pickingSlotIndex] = charId;
    }
    this.closeModal();
    this.renderTeamSelectors();
    this.renderRosterView();
    this.autoSync("更換出場英雄");
  }

  setHeroToTeamSlot(charId, slotIndex = 0) {
    if (slotIndex < this.p1Team.length) {
      this.p1Team[slotIndex] = charId;
    } else if (this.p1Team.length < 5) {
      this.p1Team.push(charId);
    }
    window.saveSystem.setTeam(this.p1Team);
    this.renderTeamSelectors();
    this.renderRosterView();
    this.autoSync("指派出場號位");
    const char = window.CHARACTERS_DATA.find(c => c.id === charId) || { name: charId };
    alert(`✅ 已將【${char.name}】指派為第 ${slotIndex + 1} 號位出場！`);
  }

  closeModal() {
    document.querySelectorAll(".modal-backdrop").forEach(m => m.classList.remove("active"));
  }

  renderRosterView() {
    const grid = document.getElementById("rosterGrid");
    const currentTeamBanner = document.getElementById("rosterTeamBanner");

    if (currentTeamBanner) {
      currentTeamBanner.innerHTML = `
        <div style="background: rgba(15, 23, 42, 0.9); border: 1px solid #38bdf8; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div>
              <h3 style="font-size: 16px; font-weight: 900; color: #38bdf8;">⚔️ 當前出賽陣容 (${this.p1Team.length} 隻參賽英雄)</h3>
              <p style="font-size: 12px; color: #94a3b8;">點擊下方角色卡片上的號位按鈕 [ 1 ]、[ 2 ]、[ 3 ] 即可自由指派出場順序！(1 代表首發，已選過則不顯示亮色)</p>
            </div>
            <button class="btn-primary" style="font-size: 15px; padding: 10px 22px;" onclick="window.app.startSelectedBattle('kof')">
              <i class="fa-solid fa-play"></i> ⚔️ 開始遊戲 [前往 3D 戰鬥]
            </button>
          </div>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            ${this.p1Team.map((id, idx) => {
              const char = window.CHARACTERS_DATA.find(c => c.id === id) || window.CHARACTERS_DATA[0];
              const lvl = window.saveSystem.user.characterLevels[id] || 1;
              return `
                <div style="background: rgba(30, 41, 59, 0.9); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 8px 12px; min-width: 140px; display: flex; gap: 10px; align-items: center;">
                  ${this.getHeroAvatarHTML(char, 44)}
                  <div>
                    <div style="font-size: 11px; font-weight: 800; color: #facc15;">${idx + 1} 號位 ${idx === 0 ? '(首發)' : ''}</div>
                    <div style="font-weight: 800; color: ${char.themeColor}; font-size: 14px;">${char.name}</div>
                    <div style="font-size: 11px; color: #94a3b8;">Lv.${lvl} / 100 ${char.canFly ? '✈️ 飛行' : ''}</div>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }

    if (!grid) return;

    let rosterList = window.CHARACTERS_DATA;
    if (this.rosterFilterSeries && this.rosterFilterSeries !== "all") {
      rosterList = rosterList.filter(c => c.series === this.rosterFilterSeries);
    }

    grid.innerHTML = rosterList.map(c => {
      const isUnlocked = window.saveSystem.user.unlockedCharacters.includes(c.id);
      const lvl = window.saveSystem.user.characterLevels[c.id] || 1;
      const rarity = window.RARITY_TIERS[c.rarity];

      const slotButtons = [];
      if (isUnlocked) {
        for (let s = 0; s < this.teamSize; s++) {
          const slotNum = s + 1;
          const isThisCharInThisSlot = (this.p1Team[s] === c.id);
          const isSlotTakenBySomeoneElse = (this.p1Team[s] && this.p1Team[s] !== c.id);

          if (isThisCharInThisSlot) {
            slotButtons.push(`
              <button class="slot-num-btn active-slot" onclick="window.app.setHeroToTeamSlot('${c.id}', ${s})" title="已指派為第 ${slotNum} 號位出場">
                ✅ ${slotNum}
              </button>
            `);
          } else if (isSlotTakenBySomeoneElse) {
            slotButtons.push(`
              <button class="slot-num-btn taken-slot" onclick="window.app.setHeroToTeamSlot('${c.id}', ${s})" title="第 ${slotNum} 號位已選，點擊可替換">
                ${slotNum}
              </button>
            `);
          } else {
            slotButtons.push(`
              <button class="slot-num-btn available-slot" onclick="window.app.setHeroToTeamSlot('${c.id}', ${s})" title="指派為第 ${slotNum} 號位出場">
                +${slotNum}
              </button>
            `);
          }
        }
      }

      return `
        <div class="character-card ${isUnlocked ? '' : 'locked'}" style="border-top: 3px solid ${rarity.color}">
          <div class="rarity-ribbon" style="background: ${rarity.bg}; color: ${rarity.border}">${rarity.label}</div>
          <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 8px;">
            ${this.getHeroAvatarHTML(c, 62)}
            <div>
              <div class="card-char-name" style="color: ${c.themeColor}">${c.name}</div>
              <div class="card-char-title" style="margin-bottom: 0;">${c.seriesName} · ${c.role} ${c.canFly ? '✈️' : ''}</div>
            </div>
          </div>
          <div class="card-stats-row">
            <span>${isUnlocked ? `Lv.${lvl} / 100` : '🔒 未解鎖'}</span>
            <span style="color: ${c.themeColor}">ATK ${Math.round(c.baseAtk * (1 + (lvl - 1) * 0.02))}</span>
          </div>

          <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 6px;">
            ${isUnlocked ? `
              <div style="display: flex; gap: 4px; align-items: center;">
                <span style="font-size: 11px; color: #94a3b8; font-weight: 700; margin-right: 2px;">出場:</span>
                ${slotButtons.join("")}
              </div>
            ` : ''}
            <button class="btn-secondary" style="font-size: 11px; padding: 5px; width: 100%; justify-content: center;" onclick="window.app.openCharacterDetail('${c.id}')">
              🔍 詳情 / 升級
            </button>
          </div>
        </div>
      `;
    }).join("");
  }

  openCharacterDetail(charId) {
    const char = window.CHARACTERS_DATA.find(c => c.id === charId);
    if (!char) return;
    const modal = document.getElementById("charDetailModal");
    const container = document.getElementById("charDetailContent");
    if (!modal || !container) return;

    const isUnlocked = window.saveSystem.user.unlockedCharacters.includes(char.id);
    const lvl = window.saveSystem.user.characterLevels[char.id] || 1;
    const upgradeCost = Math.round(200 * Math.pow(lvl, 1.4));
    const rarity = window.RARITY_TIERS[char.rarity];
    const cfg = char.attackConfig;

    container.innerHTML = `
      <div style="display: flex; gap: 20px; align-items: center; margin-bottom: 16px;">
        ${this.getHeroAvatarHTML(char, 76)}
        <div>
          <h2 style="font-size: 24px; font-weight: 900; color: ${char.themeColor}">${char.name}</h2>
          <div style="color: #94a3b8; font-size: 13px;">${char.seriesName} · ${char.title} · <span style="color: ${rarity.color}">${rarity.name}</span> · ${char.canFly ? '<b style="color:#38bdf8;">✈️ 支援飛行升空</b>' : '地面戰鬥型'}</div>
        </div>
      </div>

      <div style="background: rgba(30, 41, 59, 0.6); padding: 14px; border-radius: 10px; margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; font-weight: 800; margin-bottom: 6px;">
          <span>3D 角色等級：Lv.${lvl} / 100</span>
          <span>屬性倍率：${(1 + (lvl - 1) * 0.02).toFixed(2)}x</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; font-size: 13px;">
          <div>❤️ 生命：<b>${Math.round(char.baseHp * (1 + (lvl - 1) * 0.02))}</b></div>
          <div>⚔️ 攻擊：<b>${Math.round(char.baseAtk * (1 + (lvl - 1) * 0.02))}</b></div>
          <div>🛡️ 防禦：<b>${char.baseDef}</b></div>
        </div>
      </div>

      <h4 style="font-size: 15px; margin-bottom: 8px; color: #38bdf8;">🎮 專屬 3D 招式設定</h4>
      <div style="display: flex; flex-direction: column; gap: 8px; font-size: 12px; margin-bottom: 16px;">
        ${char.canFly ? `<div style="background: rgba(56, 189, 248, 0.15); border: 1px solid #38bdf8; padding: 8px 12px; border-radius: 6px; color:#38bdf8;"><b>[F] 飛行起飛</b>：${cfg.flight.name} (升空懸浮，可空中全向作戰)</div>` : ''}
        <div style="background: rgba(15, 23, 42, 0.8); padding: 8px 12px; border-radius: 6px;"><b>[G] 獨立格擋</b>：減免 80% 傷害，消耗格擋條</div>
        <div style="background: rgba(15, 23, 42, 0.8); padding: 8px 12px; border-radius: 6px;"><b>[J] 普攻連擊</b>：${cfg.light.name}</div>
        <div style="background: rgba(15, 23, 42, 0.8); padding: 8px 12px; border-radius: 6px;"><b>[K] 破防重擊</b>：${cfg.heavy.name} (CD 2.5s)</div>
        <div style="background: rgba(15, 23, 42, 0.8); padding: 8px 12px; border-radius: 6px;"><b>[O] 近身抓技</b>：${cfg.grab.name} (CD 3.5s)</div>
        <div style="background: rgba(15, 23, 42, 0.8); padding: 8px 12px; border-radius: 6px;"><b>[U] 小招 1【${char.skills.skill1.name}】</b> (CD ${char.skills.skill1.cd}s)：${char.skills.skill1.desc}</div>
        <div style="background: rgba(15, 23, 42, 0.8); padding: 8px 12px; border-radius: 6px;"><b>[I] 小招 2【${char.skills.skill2.name}】</b> (CD ${char.skills.skill2.cd}s)：${char.skills.skill2.desc}</div>
        <div style="background: rgba(15, 23, 42, 0.8); padding: 8px 12px; border-radius: 6px; border-left: 3px solid #facc15;"><b>[L] 奧義大招【${char.skills.ult.name}】</b> (CD ${char.skills.ult.cd}s + 100% 怒氣)：${char.skills.ult.desc}</div>
      </div>

      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        ${isUnlocked ? `
          <button class="btn-primary" onclick="window.app.upgradeCurrentHero('${char.id}')">
            🔼 升級角色 (消耗 ${upgradeCost.toLocaleString()} 金幣)
          </button>
        ` : `
          <div style="color: #ef4444; font-weight: 700;">解鎖條件：${char.unlockCondition}</div>
        `}
      </div>
    `;

    modal.classList.add("active");
  }

  upgradeCurrentHero(charId) {
    const res = window.saveSystem.upgradeCharacter(charId);
    if (res.success) {
      if (window.soundEngine) window.soundEngine.playLevelUp();
      this.updateUserStatusBar();
      this.openCharacterDetail(charId);
      this.renderRosterView();
      this.autoSync("升級角色等級");
    } else {
      alert(res.reason);
    }
  }

  // ─── 📜 5. 獨立任務與成就挑戰視圖 (Quests View) ───
  renderQuestsView() {
    const genesisList = document.getElementById("genesisChallengesList");
    const achList = document.getElementById("achievementsMilestoneList");
    if (!genesisList || !achList) return;

    // 1. 六大創世神級挑戰
    const genesisHeroes = window.CHARACTERS_DATA.filter(c => c.rarity === 9);
    genesisList.innerHTML = genesisHeroes.map(g => {
      const isUnlocked = window.saveSystem.user.unlockedCharacters.includes(g.id);
      const progress = window.saveSystem.getGenesisProgress(g.id);

      return `
        <div style="background: rgba(15, 23, 42, 0.95); border: 1px solid ${isUnlocked ? '#4ade80' : '#fb7185'}; border-radius: 12px; padding: 16px; margin-bottom: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="font-weight: 900; color: #fb7185; font-size: 16px;">★ 創世級【${g.name}】</div>
            <div style="font-size: 12px; font-weight: 800; color: ${isUnlocked ? '#4ade80' : (progress.achieved ? '#facc15' : '#f43f5e')}">
              ${isUnlocked ? '👑 已登頂解鎖' : (progress.achieved ? '⚡ 目標已達成！可領取' : '🔒 挑戰進行中')}
            </div>
          </div>
          <div style="font-size: 12px; color: #cbd5e1; margin-top: 6px;"><b>目標要求：</b>${progress.desc}</div>
          <div style="font-size: 12px; color: #38bdf8; margin-top: 4px;"><b>目前真實進度：</b>${progress.progressText}</div>

          <div style="background: rgba(0,0,0,0.5); height: 8px; border-radius: 4px; overflow: hidden; margin-top: 8px;">
            <div style="background: ${isUnlocked ? '#4ade80' : '#fb7185'}; height: 100%; width: ${isUnlocked ? 100 : progress.percent}%;"></div>
          </div>

          ${!isUnlocked ? `
            <button class="btn-primary" style="margin-top: 10px; font-size: 12px; padding: 6px 16px; background: ${progress.achieved ? 'linear-gradient(135deg, #f59e0b, #eab308)' : 'rgba(51, 65, 85, 0.8)'}" onclick="window.app.tryGenesisUnlock('${g.id}')">
              ${progress.achieved ? '🎁 達成目標！立即解鎖角色' : '🔒 驗證並解鎖 (未達標無法領取)'}
            </button>
          ` : ''}
        </div>
      `;
    }).join("");

    // 2. 里程碑成就列表
    const achievements = window.ACHIEVEMENTS_DATA ? window.ACHIEVEMENTS_DATA.filter(a => !a.id.startsWith("ach_genesis")) : [];
    achList.innerHTML = achievements.map(ach => {
      const prog = window.saveSystem.getAchievementProgress(ach);
      return `
        <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid ${prog.claimed ? 'rgba(255,255,255,0.1)' : (prog.achieved ? '#38bdf8' : 'rgba(255,255,255,0.15)')}; border-radius: 10px; padding: 14px; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-weight: 800; font-size: 14px; color: #f8fafc;">${ach.title}</span>
              <span style="font-size: 11px; font-weight: 800; color: #facc15;">+${ach.rewardGold.toLocaleString()} 金幣</span>
            </div>
            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 8px;">${ach.desc}</div>
            <div style="background: rgba(0,0,0,0.4); height: 6px; border-radius: 3px; overflow: hidden; margin-bottom: 8px;">
              <div style="background: ${prog.claimed ? '#64748b' : '#38bdf8'}; height: 100%; width: ${prog.percent}%;"></div>
            </div>
          </div>

          <div>
            ${prog.claimed ? `
              <div style="font-size: 11px; color: #64748b; font-weight: 700; text-align: right;">✅ 已領取獎勵</div>
            ` : (prog.achieved ? `
              <button class="btn-primary" style="width: 100%; font-size: 12px; padding: 6px 12px; justify-content: center; background: linear-gradient(135deg, #10b981, #059669);" onclick="window.app.claimQuestAchievement('${ach.id}')">
                🎁 領取 +${ach.rewardGold} 金幣
              </button>
            ` : `
              <div style="font-size: 11px; color: #94a3b8; text-align: right;">進度: ${prog.current.toLocaleString()} / ${prog.target.toLocaleString()} (${prog.percent}%)</div>
            `)}
          </div>
        </div>
      `;
    }).join("");
  }

  claimQuestAchievement(achId) {
    const res = window.saveSystem.claimAchievement(achId);
    if (res.success) {
      if (window.soundEngine) window.soundEngine.playLevelUp();
      this.updateUserStatusBar();
      this.renderQuestsView();
      this.autoSync("領取成就獎勵");
      alert(`🎉 恭喜成功領取成就獎勵 +${res.rewardGold.toLocaleString()} 金幣！`);
    } else {
      alert(res.reason);
    }
  }

  // ─── 🛒 6. 純淨英雄招募商店 (Shop View) ───
  renderShopView() {
    const grid = document.getElementById("shopHeroGrid");
    if (!grid) return;

    let purchasable = window.CHARACTERS_DATA.filter(c => !c.isFree && !c.isNonPurchasable);
    if (this.shopFilterSeries !== "all") {
      purchasable = purchasable.filter(c => c.series === this.shopFilterSeries);
    }

    const getIcon = (s) => s === 'gundam' ? '🤖' : (s === 'dragonball' ? '⚡' : (s === 'marvel' ? '🦸' : (s === 'anime' ? '⚔️' : '🎮')));

    grid.innerHTML = purchasable.map(c => {
      const isOwned = window.saveSystem.user.unlockedCharacters.includes(c.id);
      const rarity = window.RARITY_TIERS[c.rarity];
      return `
        <div class="character-card" style="border-top: 3px solid ${rarity.color}">
          <div class="rarity-ribbon" style="background: ${rarity.bg}; color: ${rarity.border}">${rarity.label}</div>
          <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 8px;">
            ${this.getHeroAvatarHTML(c, 62)}
            <div>
              <div class="card-char-name" style="color: ${c.themeColor}">${c.name}</div>
              <div class="card-char-title" style="margin-bottom: 0;">${c.seriesName} · ${c.role} ${c.canFly ? '✈️' : ''}</div>
            </div>
          </div>
          <div style="margin-top: 12px;">
            ${isOwned ? `<div style="color: #4ade80; font-weight: 800; font-size: 12px; text-align: center; padding: 6px;">✅ 英雄已招募</div>` : `
              <button class="btn-primary" style="width: 100%; font-size: 12px; padding: 8px 10px; justify-content: center;" onclick="window.app.buyHero('${c.id}', ${c.cost})">
                💰 招募 (${c.cost.toLocaleString()} 金幣)
              </button>
            `}
          </div>
        </div>
      `;
    }).join("");
  }

  buyHero(charId, cost) {
    if (window.saveSystem.spendGold(cost)) {
      window.saveSystem.unlockCharacter(charId);
      if (window.soundEngine) window.soundEngine.playLevelUp();
      this.updateUserStatusBar();
      this.renderShopView();
      this.renderRosterView();
      this.autoSync("招募英雄");
      alert(`🎉 恭喜招募成功！`);
    } else {
      alert(`金幣不足！招募需要 ${cost.toLocaleString()} 金幣`);
    }
  }

  tryGenesisUnlock(charId) {
    const res = window.saveSystem.tryStrictGenesisUnlock(charId);
    if (res.success) {
      if (window.soundEngine) window.soundEngine.playVictory();
      this.renderQuestsView();
      this.renderRosterView();
      this.autoSync("解鎖創世英雄");
      alert(`👑 恭喜達成極限神級成就！創世級【${charId}】已成功降臨！`);
    } else {
      alert(res.reason);
    }
  }

  renderBossRushView() {
    const list = document.getElementById("bossRushFloorList");
    if (!list) return;

    list.innerHTML = window.BOSS_RUSH_FLOORS.map(f => `
      <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 14px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-weight: 800; font-size: 15px; color: #38bdf8;">${f.name} (Lv.${f.level}) 🔒 固定挑戰難度</div>
          <div style="font-size: 12px; color: #cbd5e1; margin-top: 2px;">${f.affix}</div>
          <div style="font-size: 11px; color: #facc15; margin-top: 2px;">💰 通關獎勵：${f.rewardGold} 金幣 ｜ 💎 掉落感應骨架結晶</div>
        </div>
        <button class="btn-primary" style="font-size: 12px; padding: 8px 16px;" onclick="window.app.startBossRushFloor(${f.floor})">
          ⚔️ 挑戰第 ${f.floor} 層 3D 魔王
        </button>
      </div>
    `).join("");
  }

  startBossRushFloor(floorNum) {
    const floorData = window.BOSS_RUSH_FLOORS.find(f => f.floor === floorNum);
    if (!floorData) return;
    this.startSelectedBattle("boss_rush", floorData.bosses, false, floorNum);
  }

  renderAllViews() {
    this.renderTeamSelectors();
    this.renderRosterView();
    this.renderQuestsView();
    this.renderShopView();
    this.renderBossRushView();
  }

  gameLoop(currentTime) {
    const dt = Math.min(0.1, (currentTime - this.lastFrameTime) / 1000);
    this.lastFrameTime = currentTime;

    if (window.matchEngine3D && window.matchEngine3D.p1Current && window.matchEngine3D.matchState === "fighting") {
      const p1 = window.matchEngine3D.p1Current;
      let moveX = 0;
      let moveZ = 0;

      if (this.keys["w"] || this.keys["arrowup"]) moveZ -= 1;
      if (this.keys["s"] || this.keys["arrowdown"]) moveZ += 1;
      if (this.keys["a"] || this.keys["arrowleft"]) moveX -= 1;
      if (this.keys["d"] || this.keys["arrowright"]) moveX += 1;

      if (this.joystick.active) {
        moveX = this.joystick.moveX;
        moveZ = this.joystick.moveY;
      }

      const camYaw = this.cameraController ? this.cameraController.yaw : 0;
      p1.move3D(moveX, moveZ, camYaw);
    }

    if (window.matchEngine3D && window.matchEngine3D.p2Current && window.fighterAI3D && window.matchEngine3D.matchState === "fighting") {
      window.fighterAI3D.update(dt, window.matchEngine3D.p2Current, window.matchEngine3D.p1Current);
    }

    if (window.matchEngine3D) {
      window.matchEngine3D.update(dt);
    }

    if (this.cameraController) {
      if (window.matchEngine3D.p1Current && window.matchEngine3D.p1Current.model) {
        this.cameraController.target = window.matchEngine3D.p1Current.model.group;
      }
      if (window.matchEngine3D.p2Current && window.matchEngine3D.p2Current.model) {
        this.cameraController.opponent = window.matchEngine3D.p2Current.model.group;
      }
      this.cameraController.update(dt);
    }

    if (this.sceneManager) {
      this.sceneManager.render();
    }

    this.updateHUD();

    if (this.isRunning) {
      requestAnimationFrame((t) => this.gameLoop(t));
    }
  }

  // ─── 即時更新戰鬥 HUD 與各招式 CD 冷卻狀態 ───
  updateHUD() {
    const p1 = window.matchEngine3D ? window.matchEngine3D.p1Current : null;
    const p2 = window.matchEngine3D ? window.matchEngine3D.p2Current : null;

    if (p1) {
      const p1HpFill = document.getElementById("p1HpFill");
      const p1RageFill = document.getElementById("p1RageFill");
      const p1Name = document.getElementById("p1NameDisplay");
      const p1Lvl = document.getElementById("p1LvlDisplay");

      if (p1HpFill) p1HpFill.style.width = `${Math.max(0, (p1.hp / p1.maxHp) * 100)}%`;
      if (p1RageFill) p1RageFill.style.width = `${p1.rage}%`;
      if (p1Name) p1Name.textContent = p1.charData.name + (p1.isFlying ? ' [✈️飛行中]' : '');
      if (p1Lvl) p1Lvl.textContent = `Lv.${p1.level}`;

      // 更新觸控按鈕上的 CD 冷卻秒數顯示
      const updateBtnCD = (btnId, cd, label) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const labelElem = btn.querySelector(".label");
        if (cd > 0) {
          btn.style.opacity = "0.5";
          if (labelElem) labelElem.textContent = `${label} (${cd.toFixed(1)}s)`;
        } else {
          btn.style.opacity = "1";
          if (labelElem) labelElem.textContent = label;
        }
      };

      updateBtnCD("touchBtnSkill1", p1.skill1Cd, "技1[U]");
      updateBtnCD("touchBtnSkill2", p1.skill2Cd, "技2[I]");
      updateBtnCD("touchBtnUlt", p1.ultCd, p1.rage >= 100 ? "奧義[L]" : `奧義(${Math.round(p1.rage)}%)`);
      updateBtnCD("touchBtnHeavy", p1.heavyCd, "破防[K]");
      updateBtnCD("touchBtnGrab", p1.grabCd, "抓技[O]");
      updateBtnCD("touchBtnRoll", p1.dodgeCd, "閃避[Shift]");
      updateBtnCD("touchBtnBurst", p1.burstCd, p1.rage >= 50 ? "爆發[B]" : "爆發");
      updateBtnCD("touchBtnAssist", window.matchEngine3D.assistCooldown, "援護[Q]");
    }

    if (p2) {
      const p2HpFill = document.getElementById("p2HpFill");
      const p2RageFill = document.getElementById("p2RageFill");
      const p2Name = document.getElementById("p2NameDisplay");
      const p2Lvl = document.getElementById("p2LvlDisplay");

      if (p2HpFill) p2HpFill.style.width = `${Math.max(0, (p2.hp / p2.maxHp) * 100)}%`;
      if (p2RageFill) p2RageFill.style.width = `${p2.rage}%`;
      if (p2Name) p2Name.textContent = p2.charData.name;
      if (p2Lvl) p2Lvl.textContent = `Lv.${p2.level}`;
    }
  }
}

if (typeof window !== "undefined") {
  window.App3D = App3D;
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", () => {
      window.app = new App3D();
      window.app.init();
    });
  } else {
    window.app = new App3D();
    window.app.init();
  }
}
