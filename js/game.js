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

        // 1. 场景
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xbfe6f8);
        this.scene.fog = new THREE.FogExp2(0xd0edf8, 0.024);

        // 2. 相机
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 300);
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
        const d = 14;
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
            opacity: 0.88
        });

        for (let i = 0; i < 14; i++) {
            const cloudGroup = new THREE.Group();
            const puffCount = 3 + Math.floor(Math.random() * 3);
            for (let j = 0; j < puffCount; j++) {
                const puff = new THREE.Mesh(cloudGeo, cloudMat);
                puff.position.set(
                    (j - puffCount / 2) * 1.2 + (Math.random() - 0.5) * 0.4,
                    (Math.random() - 0.5) * 0.5,
                    (Math.random() - 0.5) * 0.6
                );
                const s = 0.8 + Math.random() * 0.6;
                puff.scale.set(s * 1.4, s, s);
                cloudGroup.add(puff);
            }

            const x = (Math.random() - 0.5) * 60;
            const y = 3 + Math.random() * 9;
            const z = -10 - Math.random() * 60;
            cloudGroup.position.set(x, y, z);
            cloudGroup.userData = {
                speed: 0.4 + Math.random() * 0.8,
                startX: x,
                resetX: 35
            };

            this.scene.add(cloudGroup);
            this.clouds.push(cloudGroup);
        }

        // 远景柔和起伏草丘 (Low-Poly 地平线装饰)
        const hillMat = new THREE.MeshStandardMaterial({
            color: 0xc4e5b7,
            roughness: 0.9,
            flatShading: true
        });

        for (let i = 0; i < 7; i++) {
            const hillGeo = new THREE.ConeGeometry(8 + Math.random() * 6, 9 + Math.random() * 5, 6);
            const hill = new THREE.Mesh(hillGeo, hillMat);
            hill.position.set(
                (Math.random() - 0.5) * 90,
                -4,
                -35 - Math.random() * 40
            );
            hill.scale.y = 0.7;
            this.scene.add(hill);
        }
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
        document.getElementById('btn-records').onclick = () => this.showRecordsModal();
        document.getElementById('btn-settings').onclick = () => this.showSettingsModal();
        
        document.getElementById('btn-pause').onclick = () => this.togglePause();
        document.getElementById('btn-resume').onclick = () => this.togglePause();
        document.getElementById('btn-restart-pause').onclick = () => this.restartGame();
        document.getElementById('btn-menu-pause').onclick = () => this.returnToMenu();

        document.getElementById('btn-gameover-replay').onclick = () => this.startGame();
        document.getElementById('btn-gameover-menu').onclick = () => this.returnToMenu();

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
        document.getElementById('in-game-hud').classList.remove('hidden');

        this.score = 0;
        this.combo = 0;
        this.perfectCount = 0;
        this.jumpCount = 0;

        this.platforms.reset();
        const curPlatform = this.platforms.getCurrentPlatform();
        const nextPlatform = this.platforms.getNextPlatform();

        this.player.resetTo(curPlatform.center, nextPlatform.center);
        this.particles.clear();

        this.camera.position.set(
            curPlatform.center.x + this.cameraOffset.x,
            curPlatform.center.y + this.cameraOffset.y,
            curPlatform.center.z + this.cameraOffset.z
        );

        this.state = 'READY';
        this._updateHUD();
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
        const ratio = Math.min(1.0, elapsed / this.maxChargeTime);
        this.currentChargeRatio = ratio;

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
        const jumpVec = dir.clone().multiplyScalar(jumpDistance);

        // 抛物线高度与持续时长
        const arcHeight = 1.8 + ratio * 1.4;
        const duration = 0.5 + ratio * 0.32;

        // 起跳烟尘粒子
        this.particles.emitJumpDust(this.player.getWorldPosition());

        this.player.launch(jumpVec, arcHeight, duration);
        this.jumpCount++;
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
        document.getElementById('pause-modal').classList.add('hidden');
        document.getElementById('game-over-modal').classList.add('hidden');
        document.getElementById('records-modal').classList.add('hidden');
        document.getElementById('settings-modal').classList.add('hidden');
        document.getElementById('in-game-hud').classList.add('hidden');
        document.getElementById('charge-meter-container').classList.add('hidden');
        document.getElementById('main-menu').classList.remove('hidden');

        this.platforms.reset();
        this.player.resetTo(this.platforms.getCurrentPlatform().center, this.platforms.getNextPlatform().center);
        this.state = 'MENU';
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
                const ratio = Math.min(1.0, elapsed / this.maxChargeTime);
                this.currentChargeRatio = ratio;
                this.player.setChargeRatio(ratio);
                window.soundManager.updateCharge(ratio);
                this._updateChargeUI(ratio);
            }

            // 2. 角色逻辑更新
            this.player.update(dt);

            // 检查跳跃是否落地
            if (this.state === 'JUMPING' && this.player.jumpProgress >= 1.0) {
                this._onJumpFinished();
            }

            // 3. 平台更新
            this.platforms.update(dt);

            // 4. 粒子系统更新
            this.particles.update(dt);

            // 5. 环境云朵游弋
            for (let cloud of this.clouds) {
                cloud.position.x += cloud.userData.speed * dt;
                if (cloud.position.x > cloud.userData.resetX) {
                    cloud.position.x = -cloud.userData.resetX;
                }
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
