/**
 * 《奶蛙跳一跳》 - 核心游戏主引擎 (Game Engine)
 * 集成 Three.js 场景渲染、相机平滑追踪、输入控制、物理抛物线、判定反馈与完整 UI 交互
 */
class NaiwaGame {
    constructor() {
        this.container = document.getElementById('canvas-container');
        
        // 游戏状态: 'LOADING' | 'MENU' | 'READY' | 'CHARGING' | 'JUMPING' | 'LANDED' | 'FALLING' | 'GAMEOVER' | 'PAUSED'
        this.state = 'LOADING';

        // 核心数值与统计
        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.perfectCount = 0;
        this.jumpCount = 0;
        this.highScore = 0;

        // 蓄力参数
        this.chargeStartTime = 0;
        this.maxChargeTime = 1.45; // 达到 100% 的时间 (秒)
        this.minJumpDistance = 2.4;
        this.maxJumpDistance = 10.8;
        this.currentChargeRatio = 0;

        // 渲染与计时
        this.clock = new THREE.Clock();
        this.quality = 'medium';

        // 相机控制参数
        this.cameraOffset = new THREE.Vector3(4.5, 6.2, 5.8);
        this.cameraLookTarget = new THREE.Vector3(0, 0, -2);
        this.cameraShakeTime = 0;
        this.cameraShakeIntensity = 0;

        // 本地存储初始化
        this._loadStorage();

        // 模块初始化
        this._initThree();
        this._createEnvironment();
        this.particles = new ParticleSystem(this.scene);
        this.platforms = new PlatformManager(this.scene);
        this.player = new NaiwaPlayer(this.scene);

        // 多人对战与网络系统
        this.mode = 'SOLO'; // 'SOLO' | 'BATTLE'
        this.network = window.networkManager;
        this.rival = new NaiwaRival(this.scene);
        this.battleRoomId = null;
        this.battleSeed = null;
        this.opponent = null;
        this.battleSyncTimer = null;
        this.matchmakingTimer = null;
        this.matchmakingSeconds = 0;
        this.battleCountdownTimer = null;

        // 干扰项系统 (飞鸟 / 烈焰火鸟) 与地狱模式
        this.obstacles = new ObstacleManager(this.scene);
        this.isHellMode = false;
        this.hellModeTriggered = false;
        this.seenMessages = new Set();
        this.selectedAvatar = 'frog-green';
        this.chatToastTimer = null;

        // UI 与事件绑定
        this._initUI();
        this._bindEvents();

        // 启动模型智能加载
        this._loadModel();

        // 启动游戏渲染循环
        this.animate = this.animate.bind(this);
        requestAnimationFrame(this.animate);
    }

    _loadStorage() {
        try {
            this.highScore = parseInt(localStorage.getItem('naiwa_highscore') || '0', 10);
            this.allTimeMaxCombo = parseInt(localStorage.getItem('naiwa_maxcombo') || '0', 10);
            this.allTimePerfects = parseInt(localStorage.getItem('naiwa_perfects') || '0', 10);
            const savedQuality = localStorage.getItem('naiwa_quality');
            if (savedQuality) this.quality = savedQuality;
        } catch (e) {
            this.highScore = 0;
        }
    }

    _saveStorage() {
        try {
            if (this.score > this.highScore) {
                this.highScore = this.score;
                localStorage.setItem('naiwa_highscore', this.highScore.toString());
            }
            if (this.combo > this.allTimeMaxCombo) {
                this.allTimeMaxCombo = this.combo;
                localStorage.setItem('naiwa_maxcombo', this.allTimeMaxCombo.toString());
            }
            this.allTimePerfects += this.perfectCount;
            localStorage.setItem('naiwa_perfects', this.allTimePerfects.toString());
            localStorage.setItem('naiwa_quality', this.quality);
        } catch (e) {}
    }

    _initThree() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        // 1. 场景与柔和环境雾 (雾气颜色与地平线晨曦白雾完全一致，消灭生硬切线)
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xbfe6f8);
        this.scene.fog = new THREE.FogExp2(0xeef7fd, 0.016);

        // 2. 相机
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 350);
        this.camera.position.set(4.5, 6.2, 5.8);
        this.camera.lookAt(0, 0, -2);

        // 3. 渲染器
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(width, height);
        this._applyQualitySettings();
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.15;
        this.container.appendChild(this.renderer.domElement);

        // 4. 灯光系统 (柔和明亮、奶油色光影，防止过曝)
        this.hemiLight = new THREE.HemisphereLight(0xffffff, 0xffdcb8, 0.70);
        this.scene.add(this.hemiLight);

        this.sunLight = new THREE.DirectionalLight(0xfff6ea, 1.15);
        this.sunLight.position.set(9, 18, 7);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.width = 2048;
        this.sunLight.shadow.mapSize.height = 2048;
        this.sunLight.shadow.camera.near = 0.5;
        this.sunLight.shadow.camera.far = 60;
        const d = 16;
        this.sunLight.shadow.camera.left = -d;
        this.sunLight.shadow.camera.right = d;
        this.sunLight.shadow.camera.top = d;
        this.sunLight.shadow.camera.bottom = -d;
        this.sunLight.shadow.bias = -0.0005;
        this.scene.add(this.sunLight);

        // 补光 (柔化暗部)
        this.fillLight = new THREE.DirectionalLight(0xd1ebff, 0.35);
        this.fillLight.position.set(-8, 10, -6);
        this.scene.add(this.fillLight);

        // 5. 天空穹顶 (球体全景渐变，消灭死板的单色背景与雾气色差)
        this._createSkyDome();
    }

    _createSkyTexture(isHell = false) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, 512);

        if (isHell) {
            // 地狱模式：血月深空到熔岩火海的赤红渐变
            grad.addColorStop(0.00, '#1c0303');
            grad.addColorStop(0.35, '#450909');
            grad.addColorStop(0.65, '#851515');
            grad.addColorStop(0.85, '#d63412');
            grad.addColorStop(1.00, '#380606');
        } else {
            // 普通清新模式：高阶马卡龙晴空蓝天与温润晨曦白雾
            grad.addColorStop(0.00, '#4ea7f2'); // 顶空蔚蓝澄澈
            grad.addColorStop(0.28, '#78c2f8'); // 高中天柔和天蓝
            grad.addColorStop(0.58, '#a6dcf8'); // 渐变浅海盐蓝
            grad.addColorStop(0.78, '#d4eefc'); // 晨光微熹
            grad.addColorStop(0.92, '#eef7fd'); // 地平线温润白雾 (与 fog 完全一致)
            grad.addColorStop(1.00, '#d8eefb'); // 地平线下方浅蓝托底
        }

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 512);

        const tex = new THREE.CanvasTexture(canvas);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        return tex;
    }

    _createSkyDome() {
        const skyGeo = new THREE.SphereGeometry(260, 32, 24);
        this.skyNormalTex = this._createSkyTexture(false);
        this.skyHellTex = this._createSkyTexture(true);

        this.skyMat = new THREE.MeshBasicMaterial({
            map: this.skyNormalTex,
            side: THREE.BackSide,
            depthWrite: false,
            fog: false
        });
        this.skyDome = new THREE.Mesh(skyGeo, this.skyMat);
        this.skyDome.position.set(0, 0, 0);
        this.scene.add(this.skyDome);
    }

    _applyQualitySettings() {
        let maxDpr = 1.5;
        if (this.quality === 'low') {
            maxDpr = 1.0;
            if (this.sunLight) this.sunLight.shadow.mapSize.set(1024, 1024);
        } else if (this.quality === 'medium') {
            maxDpr = 1.5;
            if (this.sunLight) this.sunLight.shadow.mapSize.set(2048, 2048);
        } else if (this.quality === 'high') {
            maxDpr = 2.0;
            if (this.sunLight) this.sunLight.shadow.mapSize.set(2048, 2048);
        }
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
        if (this.particles) this.particles.setQuality(this.quality);
    }

    _createEnvironment() {
        this.clouds = [];

        // 飘逸低多边形蓬松卡通云朵
        const cloudGeo = new THREE.DodecahedronGeometry(1.2, 1);
        const cloudMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.90
        });

        for (let i = 0; i < 18; i++) {
            const cloudGroup = new THREE.Group();
            const puffCount = 3 + Math.floor(Math.random() * 3);
            for (let j = 0; j < puffCount; j++) {
                const puff = new THREE.Mesh(cloudGeo, cloudMat);
                puff.position.set(
                    (j - puffCount / 2) * 1.2 + (Math.random() - 0.5) * 0.4,
                    (Math.random() - 0.5) * 0.5,
                    (Math.random() - 0.5) * 0.6
                );
                const s = 0.8 + Math.random() * 0.7;
                puff.scale.set(s * 1.4, s, s);
                cloudGroup.add(puff);
            }

            const x = (Math.random() - 0.5) * 60;
            const y = 3 + Math.random() * 9;
            const z = 15 - Math.random() * 85;
            cloudGroup.position.set(x, y, z);
            cloudGroup.userData = {
                speed: 0.4 + Math.random() * 0.8,
                startX: x,
                resetX: 36
            };

            this.scene.add(cloudGroup);
            this.clouds.push(cloudGroup);
        }

        // 远景柔和起伏草丘 (Low-Poly 地平线装饰)
        this.hills = [];
        const hillMat = new THREE.MeshStandardMaterial({
            color: 0xbedfb2,
            roughness: 0.95,
            flatShading: true
        });

        for (let i = 0; i < 9; i++) {
            const hillGeo = new THREE.ConeGeometry(9 + Math.random() * 7, 10 + Math.random() * 6, 6);
            const hill = new THREE.Mesh(hillGeo, hillMat);
            const hx = (Math.random() > 0.5 ? 1 : -1) * (20 + Math.random() * 26);
            const hy = -5.0;
            const hz = -15 - Math.random() * 75;
            hill.position.set(hx, hy, hz);
            hill.scale.y = 0.65;
            this.scene.add(hill);
            this.hills.push(hill);
        }

        // 底部柔和梦幻白云海 (普通模式下温柔托底，消灭生硬黑底)
        this.cloudSea = new THREE.Group();
        this.cloudSea.position.set(0, -4.8, 0);

        const cloudPuffGeo = new THREE.DodecahedronGeometry(2.4, 1);
        const cloudPuffMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.92
        });

        for (let i = 0; i < 22; i++) {
            const puff = new THREE.Mesh(cloudPuffGeo, cloudPuffMat);
            const px = (Math.random() - 0.5) * 80;
            const py = (Math.random() - 0.5) * 1.2;
            const pz = (Math.random() - 0.5) * 95;
            const s = 1.0 + Math.random() * 1.4;
            puff.position.set(px, py, pz);
            puff.scale.set(s * 1.5, s * 0.7, s * 1.5);
            this.cloudSea.add(puff);
        }

        // 云海柔和雾层底板
        const mistGeo = new THREE.PlaneGeometry(260, 260);
        mistGeo.rotateX(-Math.PI / 2);
        const mistMat = new THREE.MeshBasicMaterial({
            color: 0xf5fbff,
            transparent: true,
            opacity: 0.80,
            depthWrite: false
        });
        const mistPlane = new THREE.Mesh(mistGeo, mistMat);
        mistPlane.position.y = -0.5;
        this.cloudSea.add(mistPlane);

        this.scene.add(this.cloudSea);

        // 熔岩海平面 (普通模式下绝对隐藏！仅在地狱模式激活时才升腾显现)
        const lavaGeo = new THREE.PlaneGeometry(240, 240);
        lavaGeo.rotateX(-Math.PI / 2);
        this.lavaMat = new THREE.MeshStandardMaterial({
            color: 0x180404,
            roughness: 0.8,
            metalness: 0.1,
            emissive: 0x000000
        });
        this.lavaSea = new THREE.Mesh(lavaGeo, this.lavaMat);
        this.lavaSea.position.set(0, -6.0, 0);
        this.lavaSea.visible = false; // 普通模式下隐藏
        this.scene.add(this.lavaSea);
    }

    _loadModel() {
        const loadingBar = document.getElementById('loading-bar-inner');
        const loadingText = document.getElementById('loading-text');

        const loader = new ModelLoader(
            (progress, text) => {
                if (loadingBar) loadingBar.style.width = `${Math.round(progress * 100)}%`;
                if (loadingText) loadingText.textContent = text;
            },
            (modelScene) => {
                this.player.setModel(modelScene);
                this._onModelLoaded();
            },
            (err) => {
                console.error('模型加载异常:', err);
                // 展示安全策略指引弹窗
                document.getElementById('loading-screen').classList.add('hidden');
                document.getElementById('cors-modal').classList.remove('hidden');
            }
        );

        this.loader = loader;
        loader.load();
    }

    _onModelLoaded() {
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.classList.add('fade-out');
            setTimeout(() => loadingScreen.classList.add('hidden'), 500);
        }

        // 初始化幽灵对手 3D 模型
        if (this.rival && this.player.model) {
            this.rival.initFromPlayerModel(this.player.model);
        }

        // 初始化用户身份鉴权与昵称
        if (this.network) {
            this.network.initAuth().then(user => {
                const nameEl = document.getElementById('menu-user-name');
                if (nameEl && user) nameEl.textContent = user.name;
                const avatarEl = document.getElementById('menu-user-avatar');
                if (avatarEl && user) {
                    const avatarMap = { 'frog-green': '🐸', 'frog-gold': '👑', 'frog-purple': '🟣', 'frog-red': '🔥', 'frog-blue': '🌊', 'frog-ninja': '🥷' };
                    avatarEl.textContent = avatarMap[user.avatar] || '🐸';
                }
            });
        }

        // 准备初始平台与菜单待机
        this.platforms.reset();
        this.player.resetTo(this.platforms.getCurrentPlatform().center, this.platforms.getNextPlatform().center);

        this.state = 'MENU';
        window.soundManager.playMenuBgm();
        document.getElementById('main-menu').classList.remove('hidden');
        document.getElementById('in-game-hud').classList.add('hidden');
        this._updateHUD();
    }

    _initUI() {
        // 绑定按钮事件
        document.getElementById('btn-start').onclick = () => this.startGame();
        const mpBtn = document.getElementById('btn-multiplayer');
        if (mpBtn) mpBtn.onclick = () => this.startMatchmaking();
        const lbBtn = document.getElementById('btn-leaderboard');
        if (lbBtn) lbBtn.onclick = () => this.showLeaderboardModal();

        document.getElementById('btn-records').onclick = () => this.showRecordsModal();
        document.getElementById('btn-settings').onclick = () => this.showSettingsModal();
        
        document.getElementById('btn-pause').onclick = () => this.togglePause();
        document.getElementById('btn-resume').onclick = () => this.togglePause();
        document.getElementById('btn-restart-pause').onclick = () => this.restartGame();
        document.getElementById('btn-menu-pause').onclick = () => this.returnToMenu();

        document.getElementById('btn-gameover-replay').onclick = () => this.startGame();
        document.getElementById('btn-gameover-menu').onclick = () => this.returnToMenu();

        // 对战结算按钮
        const rematchBtn = document.getElementById('btn-battle-rematch');
        if (rematchBtn) rematchBtn.onclick = () => this.startMatchmaking();
        const bHomeBtn = document.getElementById('btn-battle-home');
        if (bHomeBtn) bHomeBtn.onclick = () => this.returnToMenu();

        // 匹配取消
        const cancelMatchBtn = document.getElementById('btn-cancel-match');
        if (cancelMatchBtn) cancelMatchBtn.onclick = () => this.cancelMatchmaking();

        // 玩家名片与改名交互
        const profileBadge = document.getElementById('user-profile-badge');
        if (profileBadge) profileBadge.onclick = () => this.showProfileModal();
        const saveNameBtn = document.getElementById('btn-save-profile-name');
        if (saveNameBtn) saveNameBtn.onclick = () => this.saveProfileData();

        const nameInput = document.getElementById('input-player-name');
        if (nameInput) {
            nameInput.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.saveProfileData();
                }
            };
        }

        const openProfileFromSettings = document.getElementById('btn-settings-open-profile');
        if (openProfileFromSettings) {
            openProfileFromSettings.onclick = () => {
                document.getElementById('settings-modal').classList.add('hidden');
                this.showProfileModal();
            };
        }

        const openProfileFromRecords = document.getElementById('btn-records-open-profile');
        if (openProfileFromRecords) {
            openProfileFromRecords.onclick = () => {
                document.getElementById('records-modal').classList.add('hidden');
                this.showProfileModal();
            };
        }

        // 局内对决快捷互动抽屉
        const chatToggleBtn = document.getElementById('btn-duel-chat-toggle');
        const chatDrawer = document.getElementById('duel-chat-drawer');
        const closeChatBtn = document.getElementById('btn-close-duel-chat');
        if (chatToggleBtn && chatDrawer) {
            chatToggleBtn.onclick = (e) => {
                e.stopPropagation();
                window.soundManager.playClick();
                chatDrawer.classList.toggle('hidden');
            };
        }
        if (closeChatBtn && chatDrawer) {
            closeChatBtn.onclick = (e) => {
                e.stopPropagation();
                chatDrawer.classList.add('hidden');
            };
        }

        // 局内预设短语喊话
        document.querySelectorAll('.quick-phrase-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                window.soundManager.playClick();
                const phrase = btn.getAttribute('data-msg');
                this.sendDuelChatMessage(phrase);
            };
        });

        // 自定义聊天输入与发送
        const sendChatBtn = document.getElementById('btn-send-duel-chat');
        const chatInput = document.getElementById('input-duel-chat');
        if (sendChatBtn && chatInput) {
            sendChatBtn.onclick = (e) => {
                e.stopPropagation();
                this.sendDuelChatMessage(chatInput.value);
                chatInput.value = '';
            };
            chatInput.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.stopPropagation();
                    this.sendDuelChatMessage(chatInput.value);
                    chatInput.value = '';
                }
            };
        }

        // 投降按钮与二次确认
        const surrenderBtn = document.getElementById('btn-duel-surrender');
        if (surrenderBtn) surrenderBtn.onclick = () => this.promptSurrender();
        const confirmSurrBtn = document.getElementById('btn-confirm-surrender');
        if (confirmSurrBtn) confirmSurrBtn.onclick = () => this.confirmSurrender();
        const cancelSurrBtn = document.getElementById('btn-cancel-surrender');
        if (cancelSurrBtn) {
            cancelSurrBtn.onclick = () => {
                const modal = document.getElementById('surrender-confirm-modal');
                if (modal) modal.classList.add('hidden');
            };
        }

        // 头像选择器
        document.querySelectorAll('.avatar-pick-btn').forEach(btn => {
            btn.onclick = () => {
                window.soundManager.playClick();
                this.selectedAvatar = btn.getAttribute('data-avatar');
                this._updateAvatarPickerUI();
            };
        });

        // 弹窗关闭
        document.querySelectorAll('.modal-close-btn').forEach(btn => {
            btn.onclick = (e) => {
                window.soundManager.playClick();
                const modal = e.target.closest('.modal-overlay');
                if (modal) modal.classList.add('hidden');
            };
        });

        // 音量与设置
        const bgmToggle = document.getElementById('setting-bgm-toggle');
        const sfxToggle = document.getElementById('setting-sfx-toggle');
        const soundToggle = document.getElementById('setting-sound-toggle');
        const soundSlider = document.getElementById('setting-sound-slider');
        const qualitySelect = document.getElementById('setting-quality');

        if (bgmToggle) {
            bgmToggle.checked = window.soundManager.bgmEnabled;
            bgmToggle.onchange = () => {
                window.soundManager.playClick();
                window.soundManager.setBgmEnabled(bgmToggle.checked);
            };
        }
        if (sfxToggle) {
            sfxToggle.checked = window.soundManager.sfxEnabled;
            sfxToggle.onchange = () => {
                window.soundManager.playClick();
                window.soundManager.setSfxEnabled(sfxToggle.checked);
            };
        }
        if (soundToggle) {
            soundToggle.checked = window.soundManager.enabled;
            soundToggle.onchange = () => {
                window.soundManager.playClick();
                window.soundManager.setEnabled(soundToggle.checked);
            };
        }
        if (soundSlider) {
            soundSlider.value = Math.round(window.soundManager.masterVolume * 100);
            soundSlider.oninput = () => window.soundManager.setMasterVolume(soundSlider.value / 100);
        }
        if (qualitySelect) {
            qualitySelect.value = this.quality;
            qualitySelect.onchange = () => {
                this.quality = qualitySelect.value;
                this._applyQualitySettings();
                this._saveStorage();
            };
        }

        // 本地运行指引弹窗的文件上传支持
        const fileInput = document.getElementById('manual-file-input');
        if (fileInput) {
            fileInput.onchange = (e) => {
                if (e.target.files && e.target.files[0]) {
                    document.getElementById('cors-modal').classList.add('hidden');
                    document.getElementById('loading-screen').classList.remove('hidden');
                    this.loader.handleFile(e.target.files[0]);
                }
            };
        }

        // 设备自适应控制提示
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const hintEl = document.getElementById('hud-control-hint');
        if (hintEl) {
            hintEl.innerHTML = isMobile ? '长按屏幕蓄力，松开起跳' : '按住鼠标左键或 <kbd>Space</kbd> 蓄力，松开起跳';
        }
    }

    _bindEvents() {
        window.addEventListener('resize', () => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(w, h);
        });

        // 统一交互触发音效引擎就绪
        const unlockAudio = () => {
            window.soundManager.resume();
            window.removeEventListener('click', unlockAudio);
            window.removeEventListener('touchstart', unlockAudio);
            window.removeEventListener('keydown', unlockAudio);
        };
        window.addEventListener('click', unlockAudio);
        window.addEventListener('touchstart', unlockAudio);
        window.addEventListener('keydown', unlockAudio);

        // 键盘控制
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                if (this.state === 'READY') {
                    e.preventDefault();
                    this.startCharging();
                }
            } else if (e.code === 'KeyR') {
                if (this.state === 'READY' || this.state === 'GAMEOVER') {
                    this.startGame();
                }
            } else if (e.code === 'Escape' || e.code === 'KeyP') {
                if (this.state === 'READY' || this.state === 'CHARGING' || this.state === 'PAUSED') {
                    this.togglePause();
                }
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space' && this.state === 'CHARGING') {
                e.preventDefault();
                this.releaseJump();
            }
        });

        // 鼠标与触摸输入 (在容器画布上)
        const onDown = (e) => {
            if (this.state !== 'READY') return;
            // 忽略点击在 HUD 按钮上的操作
            if (e.target && e.target.closest && e.target.closest('button, .hud-btn, .modal-card')) return;
            this.startCharging();
        };

        const onUp = (e) => {
            if (this.state === 'CHARGING') {
                this.releaseJump();
            }
        };

        window.addEventListener('mousedown', onDown);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchstart', (e) => {
            if (e.target && e.target.closest && e.target.closest('button, .hud-btn, .modal-card')) return;
            onDown(e);
        }, { passive: true });
        window.addEventListener('touchend', onUp, { passive: true });

        // 拖拽文件到窗口直接加载
        window.addEventListener('dragover', (e) => e.preventDefault());
        window.addEventListener('drop', (e) => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                const file = e.dataTransfer.files[0];
                document.getElementById('cors-modal').classList.add('hidden');
                document.getElementById('loading-screen').classList.remove('hidden');
                this.loader.handleFile(file);
            }
        });
    }

    startGame() {
        window.soundManager.playClick();
        window.soundManager.onGameStartFadeBgm(2.0); // 核心规则：点击开始游戏后 2 秒平滑淡出，随后转入游戏内循环背景音乐
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('game-over-modal').classList.add('hidden');
        document.getElementById('pause-modal').classList.add('hidden');
        document.getElementById('battle-result-modal').classList.add('hidden');
        document.getElementById('in-game-hud').classList.remove('hidden');

        // 重置地狱模式与飞鸟干扰项
        this.disableHellMode();
        if (this.cloudSea) {
            this.cloudSea.position.set(0, -4.8, 0);
            this.cloudSea.visible = true;
        }
        if (this.lavaSea) {
            this.lavaSea.position.set(0, -6.0, 0);
            this.lavaSea.visible = false;
        }
        if (this.obstacles) this.obstacles.reset();
        this.seenMessages = new Set();

        const drawer = document.getElementById('duel-chat-drawer');
        if (drawer) drawer.classList.add('hidden');
        const toast = document.getElementById('duel-chat-toast');
        if (toast) toast.classList.add('hidden');
        const hellAlert = document.getElementById('hell-mode-alert');
        if (hellAlert) hellAlert.classList.add('hidden');

        if (this.mode === 'BATTLE') {
            document.getElementById('battle-hud').classList.remove('hidden');
        } else {
            document.getElementById('battle-hud').classList.add('hidden');
            if (this.rival) this.rival.setVisible(false);
        }

        this.score = 0;
        this.combo = 0;
        this.perfectCount = 0;
        this.jumpCount = 0;

        if (this.network) {
            this.network.resetLogs();
        }

        this.platforms.reset(this.mode === 'BATTLE' ? this.battleSeed : null);
        const curPlatform = this.platforms.getCurrentPlatform();
        const nextPlatform = this.platforms.getNextPlatform();

        this.player.resetTo(curPlatform.center, nextPlatform.center);
        if (this.mode === 'BATTLE' && this.rival) {
            this.rival.resetTo(curPlatform.center, nextPlatform.center);
            this.rival.setVisible(true);
            if (this.opponent) {
                this.rival.setOpponentName(this.opponent.name, 0);
            }
        }

        this.particles.clear();

        this.camera.position.set(
            curPlatform.center.x + this.cameraOffset.x,
            curPlatform.center.y + this.cameraOffset.y,
            curPlatform.center.z + this.cameraOffset.z
        );

        this.state = 'READY';
        this._updateHUD();

        if (this.mode === 'BATTLE') {
            this._startBattleSync();
        }
    }

    startCharging() {
        if (this.state !== 'READY') return;
        this.state = 'CHARGING';
        this.chargeStartTime = performance.now();
        this.currentChargeRatio = 0;

        this.player.startCharging();
        window.soundManager.startCharge();

        document.getElementById('charge-meter-container').classList.remove('hidden');
        this._updateChargeUI(0);
    }

    releaseJump() {
        if (this.state !== 'CHARGING') return;
        this.state = 'JUMPING';

        const elapsed = (performance.now() - this.chargeStartTime) / 1000;
        let ratio = Math.min(1.0, elapsed / this.maxChargeTime);
        // 地狱模式：采用波动后的随机蓄力比例
        if (this.isHellMode && this.currentChargeRatio !== undefined) {
            ratio = this.currentChargeRatio;
        }
        this.currentChargeRatio = ratio;
        this.lastJumpRatio = ratio;

        window.soundManager.playJump(ratio);
        document.getElementById('charge-meter-container').classList.add('hidden');

        // 计算跳跃向量：朝着下一个平台中心的方向起跳
        const curPlatform = this.platforms.getCurrentPlatform();
        const nextPlatform = this.platforms.getNextPlatform();

        const dir = new THREE.Vector3().subVectors(nextPlatform.center, curPlatform.center);
        dir.y = 0;
        dir.normalize();

        // 跳跃距离由蓄力比例决定
        const jumpDistance = this.minJumpDistance + ratio * (this.maxJumpDistance - this.minJumpDistance);
        this.lastJumpDist = jumpDistance;
        const jumpVec = dir.clone().multiplyScalar(jumpDistance);

        // 抛物线高度与持续时长
        const arcHeight = 1.8 + ratio * 1.4;
        const duration = 0.5 + ratio * 0.32;

        // 起跳烟尘粒子
        this.particles.emitJumpDust(this.player.getWorldPosition());

        this.player.launch(jumpVec, arcHeight, duration);
        this.jumpCount++;
    }

    _onFrogHitByBird(bird, knockDir) {
        if (this.state !== 'JUMPING') return;
        this.state = 'FALLING';
        window.soundManager.playFall();
        this.particles.emitBirdHitFeathers(bird.group.position, this.isHellMode);
        this.player.triggerHitKnockback(knockDir);
        this._triggerCameraShake(0.38, 0.22);
        this._showFloatingFeedback('💥 奶蛙被飞鸟撞飞！', 'good');

        setTimeout(() => {
            this._onGameOver();
        }, 950);
    }

    _onJumpFinished() {
        const landingPos = this.player.getWorldPosition();
        const evalResult = this.platforms.evaluateLanding(landingPos);

        if (evalResult.grade === 'fall') {
            // 踏空掉落
            this.state = 'FALLING';
            window.soundManager.playFall();
            this.particles.emitFallSweat(landingPos);
            
            // 计算掉落翻滚方向
            const nextCenter = this.platforms.getNextPlatform().center;
            const missDir = new THREE.Vector3().subVectors(landingPos, nextCenter).normalize();
            this.player.triggerFall(missDir);

            // 掉落 0.95 秒后显示 Game Over 结算弹窗
            setTimeout(() => {
                this._onGameOver();
            }, 950);
        } else {
            // 成功着陆
            this.state = 'LANDED';
            this.player.onLanded(landingPos);
            this.particles.emitLandDust(landingPos, 1.0 + (this.combo > 2 ? 0.3 : 0));

            // 分数计算与评级反馈
            this._handleSuccessfulLanding(evalResult, landingPos);

            // 推进到下一个平台
            setTimeout(() => {
                if (this.state === 'LANDED') {
                    this.platforms.advance();
                    const newTarget = this.platforms.getNextPlatform();
                    this.player.lookAtTarget(newTarget.center);
                    this.state = 'READY';
                }
            }, 450);
        }
    }

    _handleSuccessfulLanding(result, landingPos) {
        let earnedPoints = 10; // 基础成功分
        let feedbackText = '';
        let feedbackClass = '';

        if (result.grade === 'perfect') {
            this.combo++;
            if (this.combo > this.maxCombo) this.maxCombo = this.combo;
            this.perfectCount++;

            // 连续 Perfect 叠加 Combo 加成分数
            const comboBonus = (this.combo - 1) * 10;
            earnedPoints += 20 + comboBonus;
            
            feedbackText = this.combo > 1 ? `PERFECT ×${this.combo}! +${earnedPoints}` : `PERFECT! +${earnedPoints}`;
            feedbackClass = 'perfect';

            // 触发音效与粒子
            window.soundManager.playLand('perfect', this.combo);
            this.particles.emitPerfectSparkles(landingPos, this.combo);
            this._triggerCameraShake(0.18, 0.12);
        } else if (result.grade === 'great') {
            this.combo = Math.max(0, this.combo); // 保持或清零
            earnedPoints += 10;
            feedbackText = `GREAT! +${earnedPoints}`;
            feedbackClass = 'great';
            window.soundManager.playLand('great');
            this._triggerCameraShake(0.1, 0.06);
        } else if (result.grade === 'good') {
            this.combo = 0;
            earnedPoints += 5;
            feedbackText = `GOOD +${earnedPoints}`;
            feedbackClass = 'good';
            window.soundManager.playLand('good');
        } else {
            this.combo = 0;
            feedbackText = `LANDED +${earnedPoints}`;
            feedbackClass = 'normal';
            window.soundManager.playLand('normal');
        }

        if (result.bonus > 0) {
            earnedPoints += result.bonus;
            feedbackText += ` (黄金奖励 +${result.bonus})`;
        }

        this.score += earnedPoints;

        // 动作链反作弊遥测记录 (dt, ratio, jumpDist, grade, points)
        if (this.network) {
            this.network.recordStepLog({
                dt: this.lastJumpRatio ? (0.5 + this.lastJumpRatio * 0.32) : 0.6,
                chargeRatio: this.currentChargeRatio || 0.5,
                jumpDist: this.lastJumpDist || 4.0,
                grade: result.grade,
                points: earnedPoints
            });
        }

        this._showFloatingFeedback(feedbackText, feedbackClass);
        this._updateHUD();
    }

    _triggerCameraShake(duration, intensity) {
        this.cameraShakeTime = duration;
        this.cameraShakeIntensity = intensity;
    }

    _showFloatingFeedback(text, gradeClass) {
        const container = document.getElementById('floating-feedback-container');
        if (!container) return;

        const el = document.createElement('div');
        el.className = `floating-feedback-item ${gradeClass}`;
        el.textContent = text;
        container.appendChild(el);

        setTimeout(() => {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 900);
    }

    _onGameOver() {
        this.state = 'GAMEOVER';
        window.soundManager.playGameOver();
        this._saveStorage();

        // 1v1 对战模式下坠落处理
        if (this.mode === 'BATTLE') {
            this._onBattleOver('opponent');
            return;
        }

        // 单人模式：向全球实时排行榜安全上报成绩
        if (this.network && this.score > 0) {
            this.network.submitScore(this.score, this.maxCombo, this.perfectCount).then(res => {
                if (res && res.verified) {
                    console.log('[Leaderboard] Score verified and ranked:', res.rank);
                } else if (res && res.cheatDetected) {
                    console.warn('[Anti-Cheat] Submission rejected:', res.reason);
                }
            }).catch(e => console.warn('[Leaderboard] Submit error:', e));
        }

        document.getElementById('in-game-hud').classList.add('hidden');
        const modal = document.getElementById('game-over-modal');
        modal.classList.remove('hidden');

        document.getElementById('final-score-val').textContent = this.score;
        document.getElementById('best-score-val').textContent = this.highScore;
        document.getElementById('perfect-count-val').textContent = this.perfectCount;
        document.getElementById('max-combo-val').textContent = this.maxCombo;

        const newRecordBadge = document.getElementById('new-record-badge');
        if (newRecordBadge) {
            newRecordBadge.style.display = (this.score >= this.highScore && this.score > 0) ? 'inline-block' : 'none';
        }
    }

    togglePause() {
        if (this.state === 'PAUSED') {
            this.state = this.prevState || 'READY';
            document.getElementById('pause-modal').classList.add('hidden');
            window.soundManager.resumeGameBgm();
            this.clock.getDelta(); // 防止恢复时巨大时间跳跃
        } else if (this.state === 'READY' || this.state === 'CHARGING') {
            this.prevState = this.state;
            this.state = 'PAUSED';
            window.soundManager.stopCharge();
            window.soundManager.pauseGameBgm();
            document.getElementById('charge-meter-container').classList.add('hidden');
            document.getElementById('pause-modal').classList.remove('hidden');
        }
    }

    restartGame() {
        document.getElementById('pause-modal').classList.add('hidden');
        this.startGame();
    }

    returnToMenu() {
        window.soundManager.playClick();
        window.soundManager.stopCharge();
        window.soundManager.returnToMenu(); // 切回主菜单背景音乐
        this._stopBattleSync();
        this.cancelMatchmaking();
        this.disableHellMode();
        if (this.cloudSea) {
            this.cloudSea.position.set(0, -4.8, 0);
            this.cloudSea.visible = true;
        }
        if (this.lavaSea) {
            this.lavaSea.position.set(0, -6.0, 0);
            this.lavaSea.visible = false;
        }
        if (this.obstacles) this.obstacles.clear();

        document.getElementById('pause-modal').classList.add('hidden');
        document.getElementById('game-over-modal').classList.add('hidden');
        document.getElementById('records-modal').classList.add('hidden');
        document.getElementById('settings-modal').classList.add('hidden');
        document.getElementById('matchmaking-modal').classList.add('hidden');
        document.getElementById('match-found-modal').classList.add('hidden');
        document.getElementById('battle-result-modal').classList.add('hidden');
        document.getElementById('leaderboard-modal').classList.add('hidden');
        document.getElementById('profile-modal').classList.add('hidden');
        const surrModal = document.getElementById('surrender-confirm-modal');
        if (surrModal) surrModal.classList.add('hidden');
        const chatDrawer = document.getElementById('duel-chat-drawer');
        if (chatDrawer) chatDrawer.classList.add('hidden');
        const chatToast = document.getElementById('duel-chat-toast');
        if (chatToast) chatToast.classList.add('hidden');
        const hellAlert = document.getElementById('hell-mode-alert');
        if (hellAlert) hellAlert.classList.add('hidden');

        document.getElementById('in-game-hud').classList.add('hidden');
        document.getElementById('battle-hud').classList.add('hidden');
        document.getElementById('charge-meter-container').classList.add('hidden');
        document.getElementById('main-menu').classList.remove('hidden');

        this.mode = 'SOLO';
        this.battleRoomId = null;
        this.battleSeed = null;
        this.opponent = null;
        if (this.rival) this.rival.setVisible(false);

        this.platforms.reset();
        this.player.resetTo(this.platforms.getCurrentPlatform().center, this.platforms.getNextPlatform().center);
        this.state = 'MENU';
    }

    /* ==========================================================
     *  多人 1v1 匹配与对战同步控制
     * ========================================================== */

    async startMatchmaking() {
        window.soundManager.playClick();
        if (!this.network) return;

        if (!this.network.token) {
            await this.network.initAuth();
        }

        this.mode = 'BATTLE';
        this.matchmakingSeconds = 0;
        const modal = document.getElementById('matchmaking-modal');
        const statusText = document.getElementById('matchmaking-status-text');
        if (modal) modal.classList.remove('hidden');
        if (statusText) statusText.textContent = '正在连通全球对战大厅 (0s)...';

        if (this.matchmakingTimer) clearInterval(this.matchmakingTimer);
        this.matchmakingTimer = setInterval(() => {
            this.matchmakingSeconds++;
            if (statusText) {
                statusText.textContent = `正在全网搜寻天梯匹配对手 (${this.matchmakingSeconds}s)...`;
            }
        }, 1000);

        try {
            const startRes = await this.network.startMatch();
            if (startRes && startRes.status === 'matched') {
                this._onMatchFound(startRes);
            } else {
                this._pollMatchmaking();
            }
        } catch (e) {
            console.warn('[Matchmaking] Start error:', e);
            if (statusText) statusText.textContent = '对战大厅响应超时，正在重试...';
            this._pollMatchmaking();
        }
    }

    _pollMatchmaking() {
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = setInterval(async () => {
            if (this.mode !== 'BATTLE' || !this.network) {
                clearInterval(this.pollTimer);
                return;
            }
            try {
                const res = await this.network.pollMatch();
                if (res && res.status === 'matched') {
                    clearInterval(this.pollTimer);
                    this._onMatchFound(res);
                }
            } catch (e) {
                console.warn('[Matchmaking] Poll error:', e);
            }
        }, 800);
    }

    cancelMatchmaking() {
        window.soundManager.playClick();
        if (this.matchmakingTimer) {
            clearInterval(this.matchmakingTimer);
            this.matchmakingTimer = null;
        }
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        const modal = document.getElementById('matchmaking-modal');
        if (modal) modal.classList.add('hidden');
        if (this.network) {
            this.network.cancelMatch().catch(() => {});
        }
        this.mode = 'SOLO';
    }

    _onMatchFound(matchData) {
        if (this.matchmakingTimer) {
            clearInterval(this.matchmakingTimer);
            this.matchmakingTimer = null;
        }
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }

        const matchModal = document.getElementById('matchmaking-modal');
        if (matchModal) matchModal.classList.add('hidden');

        this.battleRoomId = matchData.roomId;
        this.battleSeed = matchData.seed;
        this.opponent = matchData.opponent;
        this.opponentScore = 0;

        const vsModal = document.getElementById('match-found-modal');
        const vsMyName = document.getElementById('vs-my-name');
        const vsOppName = document.getElementById('vs-opp-name');
        const vsCountdown = document.getElementById('vs-countdown-display');

        if (vsMyName && this.network.user) vsMyName.textContent = this.network.user.name;
        if (vsOppName && matchData.opponent) vsOppName.textContent = matchData.opponent.name;
        if (vsModal) vsModal.classList.remove('hidden');

        window.soundManager.playLand('perfect', 2);

        let countdown = 3;
        if (vsCountdown) vsCountdown.textContent = countdown.toString();
        if (this.battleCountdownTimer) clearInterval(this.battleCountdownTimer);
        this.battleCountdownTimer = setInterval(() => {
            countdown--;
            if (vsCountdown) vsCountdown.textContent = countdown.toString();
            if (countdown <= 0) {
                clearInterval(this.battleCountdownTimer);
                this.battleCountdownTimer = null;
                if (vsModal) vsModal.classList.add('hidden');

                const myHudName = document.getElementById('battle-my-name');
                const oppHudName = document.getElementById('battle-opp-name');
                if (myHudName && this.network.user) myHudName.textContent = this.network.user.name;
                if (oppHudName && this.opponent) oppHudName.textContent = this.opponent.name;

                this.startGame();
            }
        }, 800);
    }

    _startBattleSync() {
        this._stopBattleSync();
        this.battleSyncTimer = setInterval(async () => {
            if (this.state === 'GAMEOVER' || this.mode !== 'BATTLE' || !this.battleRoomId || !this.network) {
                return;
            }

            const pPos = this.player.getWorldPosition();
            const telemetry = {
                x: pPos.x,
                y: pPos.y,
                z: pPos.z,
                state: this.state,
                score: this.score,
                progress: this.platforms.currentIndex
            };

            const myScoreEl = document.getElementById('battle-my-score');
            const myStepEl = document.getElementById('battle-my-step');
            if (myScoreEl) myScoreEl.textContent = this.score.toString();
            if (myStepEl) myStepEl.textContent = `台阶 ${this.platforms.currentIndex}`;

            try {
                const res = await this.network.syncBattle(this.battleRoomId, telemetry);
                if (!res) return;

                // 1. 投降认输或房间终结检查
                if (res.roomStatus === 'FINISHED' || (res.room && res.room.status === 'finished')) {
                    const isMe = (res.winner === this.network.user?.id || (res.room && res.room.winner === this.network.user?.id));
                    const surrenderText = res.surrenderedBy ? (isMe ? '对手主动投降！' : '我方已投降认输') : null;
                    this._onBattleOver(isMe ? 'me' : 'opponent', surrenderText);
                    return;
                }

                if (res.surrenderedBy) {
                    const isMe = (res.surrenderedBy !== this.network.user?.id);
                    this._onBattleOver(isMe ? 'me' : 'opponent', isMe ? '对手主动投降！' : '我方已投降认输');
                    return;
                }

                // 2. 难分高下 (双方得分持续闯关超 1500) 自动触发地狱模式
                if (res.isHellMode || (this.score >= 1500 && this.opponentScore >= 1500)) {
                    if (!this.isHellMode) {
                        this.enableHellMode();
                    }
                }

                // 3. 局内互动聊天消息处理
                if (res.messages && Array.isArray(res.messages)) {
                    for (const msg of res.messages) {
                        if (!this.seenMessages.has(msg.id)) {
                            this.seenMessages.add(msg.id);
                            this._onReceiveDuelChat(msg);
                        }
                    }
                }

                if (res.opponent) {
                    const opp = res.opponent;
                    this.opponentScore = opp.score || 0;
                    if (this.rival) {
                        this.rival.syncTelemetry(opp);
                    }

                    const oppScoreEl = document.getElementById('battle-opp-score');
                    const oppStepEl = document.getElementById('battle-opp-step');
                    if (oppScoreEl) oppScoreEl.textContent = this.opponentScore.toString();
                    if (oppStepEl) oppStepEl.textContent = `台阶 ${opp.step !== undefined ? opp.step : (opp.progress || 0)}`;

                    const leadEl = document.getElementById('battle-lead-text');
                    if (leadEl) {
                        if (this.score > this.opponentScore) {
                            leadEl.textContent = `领先 +${this.score - this.opponentScore}`;
                            leadEl.style.color = '#10B981';
                        } else if (this.score < this.opponentScore) {
                            leadEl.textContent = `落后 -${this.opponentScore - this.score}`;
                            leadEl.style.color = '#EF4444';
                        } else {
                            leadEl.textContent = '齐头并进';
                            leadEl.style.color = 'var(--text-muted)';
                        }
                    }

                    // 4. 实时赛道双雄进度映射
                    const oppStep = opp.step !== undefined ? opp.step : (opp.progress || 0);
                    this._updateRaceTrack(this.platforms.currentIndex, oppStep);

                    if ((opp.state === 'FALLING' || opp.state === 'GAMEOVER') &&
                        (this.state === 'READY' || this.state === 'CHARGING' || this.state === 'JUMPING' || this.state === 'LANDED')) {
                        setTimeout(() => {
                            if (this.state !== 'GAMEOVER') {
                                this._onBattleOver('me', '对手失足坠落！');
                            }
                        }, 600);
                    }
                }
            } catch (e) {
                console.warn('[Battle Sync] Error:', e);
            }
        }, 180);
    }

    _updateRaceTrack(myStep, oppStep) {
        const myRunner = document.getElementById('track-runner-my');
        const oppRunner = document.getElementById('track-runner-opp');
        const distLabel = document.getElementById('track-dist-label');

        const diff = myStep - oppStep;
        if (distLabel) {
            if (diff > 0) {
                distLabel.textContent = `领跑中 (+${diff} 阶)`;
            } else if (diff < 0) {
                distLabel.textContent = `追赶中 (${diff} 阶)`;
            } else {
                distLabel.textContent = '实时竞速: 并驾齐驱';
            }
        }

        const base = Math.max(0, Math.min(myStep, oppStep) - 2);
        const windowSpan = 8;
        const myPct = Math.min(92, Math.max(4, ((myStep - base) / windowSpan) * 100));
        const oppPct = Math.min(92, Math.max(4, ((oppStep - base) / windowSpan) * 100));

        if (myRunner) myRunner.style.left = `${myPct.toFixed(1)}%`;
        if (oppRunner) oppRunner.style.left = `${oppPct.toFixed(1)}%`;
    }

    _stopBattleSync() {
        if (this.battleSyncTimer) {
            clearInterval(this.battleSyncTimer);
            this.battleSyncTimer = null;
        }
    }

    _onBattleOver(winner, customReason = null) {
        this.state = 'GAMEOVER';
        this._stopBattleSync();

        document.getElementById('in-game-hud').classList.add('hidden');
        document.getElementById('battle-hud').classList.add('hidden');
        const modal = document.getElementById('battle-result-modal');
        if (modal) modal.classList.remove('hidden');

        const isMeWinner = (winner === 'me' || (this.network && this.network.user && winner === this.network.user.id));

        const pill = document.getElementById('battle-result-pill');
        const title = document.getElementById('battle-result-title');
        const desc = document.getElementById('battle-result-desc');

        const myNameEl = document.getElementById('duel-summary-my-name');
        const myScoreEl = document.getElementById('duel-summary-my-score');
        const oppNameEl = document.getElementById('duel-summary-opp-name');
        const oppScoreEl = document.getElementById('duel-summary-opp-score');

        if (myNameEl && this.network.user) myNameEl.textContent = this.network.user.name;
        if (myScoreEl) myScoreEl.textContent = this.score.toString();
        if (oppNameEl && this.opponent) oppNameEl.textContent = this.opponent.name;
        if (oppScoreEl) oppScoreEl.textContent = (this.opponentScore || 0).toString();

        if (isMeWinner) {
            window.soundManager.playLand('perfect', 3);
            if (pill) {
                pill.textContent = 'VICTORY';
                pill.className = 'modal-pill-tag tag-success';
            }
            if (title) title.textContent = customReason || '旗开得胜！';
            if (desc) desc.textContent = customReason ? `判定胜出：${customReason}` : '你在跳跃对决中技高一筹，成功击败对手！';
        } else {
            window.soundManager.playGameOver();
            if (pill) {
                pill.textContent = 'DEFEAT';
                pill.className = 'modal-pill-tag tag-warning';
            }
            if (title) title.textContent = customReason || '惜败收场';
            if (desc) desc.textContent = customReason ? `本局结束：${customReason}` : '稳住节奏，下次定能战胜强敌！';
        }
    }

    /* ==========================================================
     *  对决地狱模式 (Sudden Death / Hell Mode)
     * ========================================================== */

    enableHellMode() {
        if (this.isHellMode) return;
        this.isHellMode = true;

        const alertEl = document.getElementById('hell-mode-alert');
        if (alertEl) {
            alertEl.classList.remove('hidden');
            setTimeout(() => {
                alertEl.classList.add('hidden');
            }, 3600);
        }

        this._triggerCameraShake(0.65, 0.35);
        this._showFloatingFeedback('🔥 地狱模式开启！岩浆升腾！', 'perfect');
        window.soundManager.playLand('perfect', 4);

        // 场景变色：血红苍穹、浓雾与暗红色光照
        if (this.skyDome && this.skyHellTex) {
            this.skyMat.map = this.skyHellTex;
            this.skyMat.needsUpdate = true;
        }
        this.scene.background = new THREE.Color(0x380606);
        if (this.scene.fog) {
            this.scene.fog.color = new THREE.Color(0x5e0d0d);
            this.scene.fog.density = 0.030;
        }
        if (this.sunLight) {
            this.sunLight.color = new THREE.Color(0xff4422);
            this.sunLight.intensity = 1.35;
        }
        if (this.hemiLight) {
            this.hemiLight.color = new THREE.Color(0xff5533);
            this.hemiLight.groundColor = new THREE.Color(0x330000);
        }

        // 切换底层海平面：隐藏纯净白云海，展现沸腾熔岩海
        if (this.cloudSea) {
            this.cloudSea.visible = false;
        }
        if (this.lavaSea) {
            this.lavaSea.visible = true;
            this.lavaSea.position.y = -1.2;
            if (this.lavaMat) {
                this.lavaMat.color = new THREE.Color(0xff2200);
                this.lavaMat.emissive = new THREE.Color(0xaa1100);
                this.lavaMat.emissiveIntensity = 0.9;
            }
        }

        // 障碍飞鸟加速与密集狂暴化 (烈焰血蝠)
        if (this.obstacles) {
            this.obstacles.setHellMode(true);
        }

        // 对手模型切换至地狱幻影红光
        if (this.rival) {
            this.rival.setHellMode(true);
        }
    }

    disableHellMode() {
        if (!this.isHellMode) {
            // 确保底层海平面状态与普通模式完全一致
            if (this.cloudSea) this.cloudSea.visible = true;
            if (this.lavaSea) this.lavaSea.visible = false;
            return;
        }
        this.isHellMode = false;

        const alertEl = document.getElementById('hell-mode-alert');
        if (alertEl) alertEl.classList.add('hidden');

        // 恢复清新蓝天天空穹顶与温暖日光
        if (this.skyDome && this.skyNormalTex) {
            this.skyMat.map = this.skyNormalTex;
            this.skyMat.needsUpdate = true;
        }
        this.scene.background = new THREE.Color(0xbfe6f8);
        if (this.scene.fog) {
            this.scene.fog.color = new THREE.Color(0xeef7fd);
            this.scene.fog.density = 0.016;
        }
        if (this.sunLight) {
            this.sunLight.color = new THREE.Color(0xfff6ea);
            this.sunLight.intensity = 1.15;
        }
        if (this.hemiLight) {
            this.hemiLight.color = new THREE.Color(0xffffff);
            this.hemiLight.groundColor = new THREE.Color(0xffdcb8);
        }

        // 切换底层海平面：恢复纯净白云海，隐藏熔岩海
        if (this.cloudSea) {
            this.cloudSea.visible = true;
            this.cloudSea.position.set(0, -4.8, 0);
        }
        if (this.lavaSea) {
            this.lavaSea.visible = false;
            this.lavaSea.position.set(0, -6.0, 0);
        }

        if (this.obstacles) {
            this.obstacles.setHellMode(false);
        }
        if (this.rival) {
            this.rival.setHellMode(false);
        }
    }

    /* ==========================================================
     *  局内投降与快捷聊天互动
     * ========================================================== */

    promptSurrender() {
        window.soundManager.playClick();
        const modal = document.getElementById('surrender-confirm-modal');
        if (modal) modal.classList.remove('hidden');
    }

    async confirmSurrender() {
        window.soundManager.playClick();
        const modal = document.getElementById('surrender-confirm-modal');
        if (modal) modal.classList.add('hidden');

        if (this.mode === 'BATTLE' && this.battleRoomId && this.network) {
            try {
                await this.network.surrenderDuel(this.battleRoomId);
            } catch (e) {
                console.warn('[Surrender] Error:', e);
            }
            this._onBattleOver('opponent', '我方已投降认输');
        }
    }

    async sendDuelChatMessage(text) {
        if (!text || !text.trim()) return;
        const cleanText = text.trim();
        const drawer = document.getElementById('duel-chat-drawer');
        if (drawer) drawer.classList.add('hidden');

        this._showChatToast(this.network?.user?.name || '我', cleanText, true);

        if (this.mode === 'BATTLE' && this.battleRoomId && this.network) {
            try {
                await this.network.sendDuelChat(this.battleRoomId, cleanText);
            } catch (e) {
                console.warn('[Duel Chat] Send error:', e);
            }
        }
    }

    _onReceiveDuelChat(msg) {
        if (!msg || !msg.text) return;
        if (this.network && this.network.user && msg.senderId === this.network.user.id) return;

        // 3D 头顶对决气泡
        if (this.rival) {
            this.rival.showSpeechBubble(msg.text);
        }

        // 屏幕浮动提示条
        this._showChatToast(msg.senderName || '对手', msg.text, false);
    }

    _showChatToast(senderName, text, isMe) {
        const toast = document.getElementById('duel-chat-toast');
        const sEl = document.getElementById('duel-chat-sender');
        const cEl = document.getElementById('duel-chat-content');
        if (!toast || !sEl || !cEl) return;

        sEl.textContent = `${senderName}:`;
        cEl.textContent = text;
        toast.classList.remove('hidden');
        toast.style.borderColor = isMe ? 'var(--primary-color)' : '#a855f7';

        if (this.chatToastTimer) clearTimeout(this.chatToastTimer);
        this.chatToastTimer = setTimeout(() => {
            toast.classList.add('hidden');
        }, 3200);
    }

    /* ==========================================================
     *  全球实时排行榜与选手名片
     * ========================================================== */

    async showLeaderboardModal() {
        window.soundManager.playClick();
        const modal = document.getElementById('leaderboard-modal');
        if (modal) modal.classList.remove('hidden');

        const container = document.getElementById('leaderboard-items-container');
        if (container) {
            container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 24px 0;">正在拉取全球实时榜单...</div>';
        }

        if (!this.network) return;
        try {
            const data = await this.network.getLeaderboard();
            this._renderLeaderboard(data);
        } catch (e) {
            if (container) {
                container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 24px 0;">拉取失败，请检查网络连接</div>';
            }
        }
    }

    _renderLeaderboard(data) {
        const podium = document.getElementById('leaderboard-podium');
        const container = document.getElementById('leaderboard-items-container');
        const myRankBadge = document.getElementById('my-rank-badge');
        const myRankTitle = document.getElementById('my-rank-title');
        const myRankSub = document.getElementById('my-rank-sub');
        const myRankScore = document.getElementById('my-rank-score-val');

        if (!data || !data.records || data.records.length === 0) {
            if (container) container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 24px 0;">暂无记录</div>';
            return;
        }

        const records = data.records || data.leaderboard || [];
        if (records.length === 0) {
            if (container) container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 24px 0;">暂无记录</div>';
            return;
        }

        const myId = this.network.user ? this.network.user.id : null;

        const escapeStr = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        if (podium) {
            const top3 = records.slice(0, 3);
            const first = top3[0];
            const second = top3[1];
            const third = top3[2];

            const renderPodiumCol = (item, rank, className) => {
                if (!item) return `<div class="podium-col ${className} empty"></div>`;
                const pName = item.name || item.playerName || '高手奶蛙';
                return `
                    <div class="podium-col ${className}">
                        <div class="podium-rank-badge rank-${rank}">${rank}</div>
                        <div class="podium-name">${escapeStr(pName)}</div>
                        <div class="podium-score">${item.score}</div>
                        <div class="podium-pedestal p${rank}"></div>
                    </div>
                `;
            };

            podium.innerHTML = `
                ${renderPodiumCol(second, 2, 'second')}
                ${renderPodiumCol(first, 1, 'first')}
                ${renderPodiumCol(third, 3, 'third')}
            `;
        }

        if (container) {
            const rest = records.slice(3);
            if (rest.length === 0) {
                container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 12px 0; font-size: 13px;">全部排位已在前三展示</div>';
            } else {
                container.innerHTML = rest.map((item, idx) => {
                    const rank = idx + 4;
                    const pId = item.id || item.playerId;
                    const pName = item.name || item.playerName || '跳跃选手';
                    const isMe = myId && (pId === myId);
                    return `
                        <div class="leaderboard-row ${isMe ? 'is-me' : ''}">
                            <div class="lb-rank">${rank}</div>
                            <div class="lb-info">
                                <span class="lb-name">${escapeStr(pName)}</span>
                                <span class="lb-verified-badge" title="通过 SHA-256 动作链反作弊校验">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    <span>已验证</span>
                                </span>
                            </div>
                            <div class="lb-meta">
                                <span class="lb-combo">COMBO ×${item.maxCombo || 0}</span>
                                <span class="lb-score">${item.score}</span>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        let myRank = null;
        let myRecord = null;
        for (let i = 0; i < records.length; i++) {
            const pId = records[i].id || records[i].playerId;
            if (myId && pId === myId) {
                myRank = i + 1;
                myRecord = records[i];
                break;
            }
        }

        if (myRankBadge) myRankBadge.textContent = myRank ? `#${myRank}` : '--';
        if (myRankTitle) myRankTitle.textContent = this.network.user ? this.network.user.name : '我的当前排位';
        if (myRankSub) {
            myRankSub.textContent = myRank ? `全球第 ${myRank} 名 · 历史峰值已认证` : '尚未进入前 50 强，继续跳跃上榜吧！';
        }
        if (myRankScore) {
            myRankScore.textContent = `${myRecord ? myRecord.score : (this.highScore || 0)} 分`;
        }
    }

    showProfileModal() {
        window.soundManager.playClick();
        const modal = document.getElementById('profile-modal');
        if (modal) modal.classList.remove('hidden');

        const input = document.getElementById('input-player-name');
        if (input && this.network && this.network.user) {
            input.value = this.network.user.name || '';
        }

        const tokenPreview = document.getElementById('profile-token-preview');
        if (tokenPreview && this.network && this.network.token) {
            const tok = this.network.token;
            tokenPreview.textContent = `${tok.slice(0, 10)}...${tok.slice(-8)}`;
        }

        if (this.network && this.network.user) {
            this.selectedAvatar = this.network.user.avatar || 'frog-green';
            this._updateAvatarPickerUI();

            const stats = this.network.user.stats || {};
            const total = stats.total || (stats.wins || 0) + (stats.losses || 0);
            const winRate = stats.winRate !== undefined ? stats.winRate : (total > 0 ? Math.round(((stats.wins || 0) / total) * 100) : 0);

            const totalEl = document.getElementById('stat-duel-total');
            const wrEl = document.getElementById('stat-duel-winrate');
            const recEl = document.getElementById('stat-duel-record');

            if (totalEl) totalEl.textContent = total.toString();
            if (wrEl) wrEl.textContent = `${winRate}%`;
            if (recEl) recEl.textContent = `${stats.wins || 0} 胜 ${stats.losses || 0} 负`;
        }
    }

    _updateAvatarPickerUI() {
        document.querySelectorAll('.avatar-pick-btn').forEach(btn => {
            const av = btn.getAttribute('data-avatar');
            if (av === this.selectedAvatar) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    async saveProfileData() {
        window.soundManager.playClick();
        const input = document.getElementById('input-player-name');
        const newName = input ? input.value.trim() : '';

        if (this.network) {
            try {
                const res = await this.network.updateProfile({
                    name: newName || undefined,
                    avatar: this.selectedAvatar
                });
                if (res && res.user) {
                    const nameEl = document.getElementById('menu-user-name');
                    if (nameEl) nameEl.textContent = res.user.name;
                    const vsMyName = document.getElementById('vs-my-name');
                    if (vsMyName) vsMyName.textContent = res.user.name;
                    const avatarEl = document.getElementById('menu-user-avatar');
                    if (avatarEl) {
                        const avatarMap = { 'frog-green': '🐸', 'frog-gold': '👑', 'frog-purple': '🟣', 'frog-red': '🔥', 'frog-blue': '🌊', 'frog-ninja': '🥷' };
                        avatarEl.textContent = avatarMap[res.user.avatar] || '🐸';
                    }
                    this._showFloatingFeedback('选手名片已更新！', 'perfect');
                }
            } catch (e) {
                console.warn('[Profile] Update profile error:', e);
            }
        }

        const modal = document.getElementById('profile-modal');
        if (modal) modal.classList.add('hidden');
    }


    showRecordsModal() {
        window.soundManager.playClick();
        document.getElementById('record-best-score').textContent = this.highScore;
        document.getElementById('record-max-combo').textContent = this.allTimeMaxCombo;
        document.getElementById('record-perfects').textContent = this.allTimePerfects;
        document.getElementById('records-modal').classList.remove('hidden');
    }

    showSettingsModal() {
        window.soundManager.playClick();
        document.getElementById('settings-modal').classList.remove('hidden');
    }

    _updateHUD() {
        const scoreEl = document.getElementById('hud-score');
        const bestEl = document.getElementById('hud-best-score');
        const comboBadge = document.getElementById('hud-combo-badge');

        if (scoreEl) scoreEl.textContent = this.score.toString().padStart(6, '0');
        if (bestEl) bestEl.textContent = this.highScore.toString();

        if (comboBadge) {
            if (this.combo > 1) {
                comboBadge.classList.remove('hidden');
                const textEl = document.getElementById('hud-combo-text');
                if (textEl) {
                    textEl.textContent = `COMBO ×${this.combo}`;
                } else {
                    comboBadge.textContent = `COMBO ×${this.combo}`;
                }
                comboBadge.classList.add('bounce');
                setTimeout(() => comboBadge.classList.remove('bounce'), 250);
            } else {
                comboBadge.classList.add('hidden');
            }
        }
    }

    _updateChargeUI(ratio) {
        const bar = document.getElementById('charge-meter-fill');
        const percentText = document.getElementById('charge-meter-percent');
        const pct = Math.round(ratio * 100);

        if (bar) bar.style.width = `${pct}%`;
        if (percentText) percentText.textContent = `${pct}%`;
    }

    animate() {
        requestAnimationFrame(this.animate);

        const dt = Math.min(this.clock.getDelta(), 0.1);

        if (this.state !== 'PAUSED') {
            // 1. 蓄力状态更新
            if (this.state === 'CHARGING') {
                const elapsed = (performance.now() - this.chargeStartTime) / 1000;
                let ratio = Math.min(1.0, elapsed / this.maxChargeTime);

                // 地狱模式：蓄力条随机剧烈波动与难度剧增
                if (this.isHellMode) {
                    const now = performance.now();
                    const jitter = Math.sin(now * 0.02) * 0.14 + (Math.random() - 0.5) * 0.10;
                    ratio = Math.min(1.0, Math.max(0.04, ratio + jitter));
                }

                this.currentChargeRatio = ratio;
                this.player.setChargeRatio(ratio);
                window.soundManager.updateCharge(ratio);
                this._updateChargeUI(ratio);
            }

            // 2. 角色逻辑更新
            this.player.update(dt);
            if (this.rival) this.rival.update(dt);

            // 3. 干扰项飞鸟更新与空中拦截碰撞检测
            const curPlatform = this.platforms.getCurrentPlatform();
            const nextPlatform = this.platforms.getNextPlatform();
            const playerPos = this.player.getWorldPosition();

            if (this.obstacles) {
                this.obstacles.update(
                    dt,
                    curPlatform,
                    nextPlatform,
                    playerPos,
                    this.state === 'JUMPING',
                    (bird, knockDir) => this._onFrogHitByBird(bird, knockDir)
                );
            }

            // 4. 地狱模式熔岩余烬与翻滚升腾
            if (this.isHellMode && this.particles) {
                this.particles.emitLavaEmbers(playerPos);
                if (this.lavaSea) {
                    this.lavaSea.position.y = -1.2 + Math.sin(performance.now() * 0.003) * 0.14;
                }
            }

            // 检查跳跃是否落地
            if (this.state === 'JUMPING' && this.player.jumpProgress >= 1.0) {
                this._onJumpFinished();
            }

            // 5. 平台更新
            this.platforms.update(dt);

            // 6. 粒子系统更新
            this.particles.update(dt);

            // 7. 环境云朵游弋与无限步进跟随
            const playerZ = playerPos.z;
            for (let cloud of this.clouds) {
                cloud.position.x += cloud.userData.speed * dt;
                if (cloud.position.x > cloud.userData.resetX) {
                    cloud.position.x = -cloud.userData.resetX;
                }
                // 当云朵落在玩家身后的视野盲区时，循环重置到玩家前方
                if (cloud.position.z > playerZ + 25) {
                    cloud.position.z = playerZ - 20 - Math.random() * 65;
                    cloud.position.x = (Math.random() - 0.5) * 60;
                }
            }

            // 远景山丘循环铺展
            if (this.hills) {
                for (let hill of this.hills) {
                    if (hill.position.z > playerZ + 35) {
                        hill.position.z = playerZ - 45 - Math.random() * 50;
                        hill.position.x = (Math.random() > 0.5 ? 1 : -1) * (20 + Math.random() * 26);
                    }
                }
            }

            // 底部云海整体跟随玩家 Z 轴平移，保持平台下方永远有梦幻白云海托底
            if (this.cloudSea) {
                this.cloudSea.position.z = playerZ;
                this.cloudSea.position.x = playerPos.x * 0.4;
            }
            if (this.lavaSea && this.isHellMode) {
                this.lavaSea.position.z = playerZ;
                this.lavaSea.position.x = playerPos.x * 0.4;
            }

            // 天空穹顶随相机平移，营造真正的无限远景视差
            if (this.skyDome) {
                this.skyDome.position.set(this.camera.position.x, this.camera.position.y * 0.25, this.camera.position.z);
            }

            // 阳光与阴影智能跟随玩家，确保每个台阶都有柔和清晰的实时软阴影
            if (this.sunLight) {
                this.sunLight.position.set(playerPos.x + 9, 18, playerZ + 7);
                this.sunLight.target.position.set(playerPos.x, 0, playerZ - 3);
                this.sunLight.target.updateMatrixWorld();
            }
        }

        // 6. 相机智能平滑追踪 (第三人称视角)
        this._updateCamera(dt);

        // 7. 渲染
        this.renderer.render(this.scene, this.camera);
    }

    _updateCamera(dt) {
        if (this.state === 'MENU') {
            // 主菜单：环绕展示奶蛙正脸，慢速柔和晃动，将奶蛙置于画面上半部黄金视觉中心
            const angle = Date.now() * 0.0003;
            const targetX = Math.cos(angle) * 0.4 + 1.8;
            const targetZ = Math.sin(angle) * 0.4 + 4.0;
            this.camera.position.x += (targetX - this.camera.position.x) * 2.5 * dt;
            this.camera.position.y += (3.3 - this.camera.position.y) * 2.5 * dt;
            this.camera.position.z += (targetZ - this.camera.position.z) * 2.5 * dt;
            this.camera.lookAt(0, -0.70, 0);
            return;
        }

        const playerPos = this.player.getWorldPosition();
        const nextPlatform = this.platforms.getNextPlatform();
        const curPlatform = this.platforms.getCurrentPlatform();

        // 聚焦点位于奶蛙与目标平台的中点前方，提供良好预判视野
        let centerPoint = playerPos.clone();
        if (nextPlatform && curPlatform) {
            centerPoint.add(nextPlatform.center).multiplyScalar(0.5);
        }

        const targetCamPos = new THREE.Vector3(
            centerPoint.x + this.cameraOffset.x,
            Math.max(2.5, centerPoint.y + this.cameraOffset.y),
            centerPoint.z + this.cameraOffset.z
        );

        if (this.state === 'FALLING') {
            // 掉落时相机保持在平台水平面之上，以优雅俯视角度目送奶蛙坠入柔和云海
            targetCamPos.y = Math.max(2.8, playerPos.y + 4.8);
        }

        // 平滑 lerp 插值追踪
        const smoothSpeed = (this.state === 'FALLING') ? 2.8 : 4.8;
        this.camera.position.lerp(targetCamPos, smoothSpeed * dt);

        const lookY = (this.state === 'FALLING') ? Math.max(-2.5, playerPos.y) : 0.5;
        this.cameraLookTarget.lerp(
            new THREE.Vector3(centerPoint.x, lookY, centerPoint.z),
            smoothSpeed * dt
        );

        // 震屏反馈
        if (this.cameraShakeTime > 0) {
            this.cameraShakeTime -= dt;
            const shake = this.cameraShakeIntensity;
            this.camera.position.x += (Math.random() - 0.5) * shake;
            this.camera.position.y += (Math.random() - 0.5) * shake;
        }

        this.camera.lookAt(this.cameraLookTarget);
    }
}

// 页面加载完成后自动启动游戏
window.addEventListener('DOMContentLoaded', () => {
    window.game = new NaiwaGame();
});
