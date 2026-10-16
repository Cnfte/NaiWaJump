/**
 * 《奶蛙跳一跳》 - 现代化游戏音效与背景音乐引擎 (Audio Engine)
 * 
 * 音频资源与规则对应：
 * 1. 背景音乐(点击开始游戏后2s淡出).mp3
 *    - 主菜单待机音乐，循环播放
 *    - 玩家点击“开始游戏”时，在 2 秒内平滑淡出，随后无缝启动游戏中背景音乐
 * 2. 游戏中背景音乐(循环播放).mp3
 *    - 正式对局沉浸式背景音乐，循环播放
 *    - 暂停时音量压低，失败时快速淡出，返回主页时切回主菜单音乐
 * 3. UI点击&蓄力(蓄力从最开始的慢逐渐变快).mp3
 *    - UI 点击：界面所有按钮点击音效（单次触发，轻快利落）
 *    - 动态蓄力：长按蓄力时循环播放，playbackRate 随蓄力进度由慢(0.70x)平滑加速变快(1.85x)
 * 4. 落地音效.mp3
 *    - 奶蛙成功落地平台时的厚实敲击冲击声，结合落点评价（Good/Great/Perfect）叠加华丽和弦琶音
 * 5. 失败音效.mp3
 *    - 踏空掉落与结算专属失败戏剧音效
 * 6. 支持 Web Audio API 降级容灾与独立 BGM / SFX 音量控制
 */
class SoundManager {
    constructor() {
        this.ctx = null;
        this.initialized = false;
        this.userInteracted = false;

        // 音量与开关设置
        this.masterVolume = 0.70;
        this.bgmVolume = 0.75;
        this.sfxVolume = 0.85;
        this.bgmEnabled = true;
        this.sfxEnabled = true;

        // 蓄力合成器备用节点
        this.chargeOsc = null;
        this.chargeGain = null;

        // 背景音乐状态: 'NONE' | 'MENU' | 'GAME'
        this.bgmState = 'NONE';
        this.bgmFadeTimer = null;

        // 音频资源路径映射 (优先 URL-Safe 路径适配 GitHub Pages 与静态 CDN，自动双向容灾)
        this.audioPaths = {
            menuBgm: 'audio/menu_bgm.mp3',
            gameBgm: 'audio/game_bgm.mp3',
            clickCharge: 'audio/click_charge.mp3',
            land: 'audio/land.mp3',
            fail: 'audio/fail.mp3'
        };

        this.fallbackAudioPaths = {
            menuBgm: '音效/背景音乐(点击开始游戏后2s淡出).mp3',
            gameBgm: '音效/游戏中背景音乐(循环播放).mp3',
            clickCharge: '音效/UI点击&蓄力(蓄力从最开始的慢逐渐变快).mp3',
            land: '音效/落地音效.mp3',
            fail: '音效/失败音效.mp3'
        };

        // 尝试从 localStorage 恢复用户偏好
        this._loadStorage();

        // 预实例化音频对象
        this._initAudioElements();

        // 监听浏览器首次交互唤醒音频策略
        this._bindUserInteraction();
    }

    _loadStorage() {
        try {
            const savedMaster = localStorage.getItem('naiwa_sound_volume');
            if (savedMaster !== null) this.masterVolume = parseFloat(savedMaster);

            const savedBgmEn = localStorage.getItem('naiwa_bgm_enabled');
            if (savedBgmEn !== null) this.bgmEnabled = savedBgmEn === 'true';

            const savedSfxEn = localStorage.getItem('naiwa_sfx_enabled');
            if (savedSfxEn !== null) {
                this.sfxEnabled = savedSfxEn === 'true';
            } else {
                const legacyEn = localStorage.getItem('naiwa_sound_enabled');
                if (legacyEn !== null) {
                    this.sfxEnabled = legacyEn === 'true';
                    this.bgmEnabled = legacyEn === 'true';
                }
            }
        } catch (e) {}
    }

    _saveStorage() {
        try {
            localStorage.setItem('naiwa_sound_volume', this.masterVolume.toString());
            localStorage.setItem('naiwa_bgm_enabled', this.bgmEnabled.toString());
            localStorage.setItem('naiwa_sfx_enabled', this.sfxEnabled.toString());
            localStorage.setItem('naiwa_sound_enabled', (this.sfxEnabled && this.bgmEnabled).toString());
        } catch (e) {}
    }

    _createAudio(key, loop = false) {
        const audio = new Audio(this.audioPaths[key]);
        audio.loop = loop;
        audio.preload = 'auto';
        audio.addEventListener('error', () => {
            const fallback = this.fallbackAudioPaths[key];
            if (fallback && audio.src.indexOf(encodeURI(fallback)) === -1) {
                audio.src = fallback;
                audio.load();
            }
        }, { once: true });
        return audio;
    }

    _initAudioElements() {
        try {
            this.menuBgm = this._createAudio('menuBgm', true);
            this.gameBgm = this._createAudio('gameBgm', true);
            this.chargeAudio = this._createAudio('clickCharge', true);
            this.clickAudio = this._createAudio('clickCharge', false);
            this.landAudio = this._createAudio('land', false);
            this.failAudio = this._createAudio('fail', false);
        } catch (e) {
            console.warn('Audio elements 初始化异常:', e);
        }
    }

    _bindUserInteraction() {
        const unlock = () => {
            this.userInteracted = true;
            this.resume();
            // 如果处于主菜单阶段且 BGM 打开，启动主菜单背景音乐
            if (this.bgmState === 'NONE' || this.bgmState === 'MENU') {
                this.playMenuBgm();
            }
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
            window.removeEventListener('touchstart', unlock);
        };

        window.addEventListener('pointerdown', unlock, { passive: true });
        window.addEventListener('keydown', unlock, { passive: true });
        window.addEventListener('touchstart', unlock, { passive: true });
    }

    init() {
        if (this.ctx) return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.ctx = new AudioCtx();
                this.initialized = true;
            }
        } catch (e) {
            console.warn('AudioContext 初始化失败:', e);
        }
    }

    resume() {
        if (!this.ctx) this.init();
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }
    }

    // 辅助音量计算
    getRealBgmVolume() {
        if (!this.bgmEnabled) return 0;
        return Math.max(0, Math.min(1, this.masterVolume * this.bgmVolume));
    }

    getRealSfxVolume() {
        if (!this.sfxEnabled) return 0;
        return Math.max(0, Math.min(1, this.masterVolume * this.sfxVolume));
    }

    // 设置项更新
    setMasterVolume(val) {
        this.masterVolume = Math.max(0, Math.min(1, val));
        this._applyCurrentVolumes();
        this._saveStorage();
    }

    // 兼容原版 API
    setVolume(val) {
        this.setMasterVolume(val);
    }

    get volume() {
        return this.masterVolume;
    }

    get enabled() {
        return this.sfxEnabled && this.bgmEnabled;
    }

    setEnabled(val) {
        this.setBgmEnabled(val);
        this.setSfxEnabled(val);
    }

    setBgmEnabled(val) {
        this.bgmEnabled = !!val;
        if (!this.bgmEnabled) {
            if (this.menuBgm) this.menuBgm.pause();
            if (this.gameBgm) this.gameBgm.pause();
        } else {
            if (this.bgmState === 'MENU') {
                this.playMenuBgm();
            } else if (this.bgmState === 'GAME') {
                this.playGameBgm();
            }
        }
        this._saveStorage();
    }

    setSfxEnabled(val) {
        this.sfxEnabled = !!val;
        if (!this.sfxEnabled) {
            this.stopCharge();
        }
        this._saveStorage();
    }

    _applyCurrentVolumes() {
        const bgmVol = this.getRealBgmVolume();
        if (this.bgmState === 'MENU' && this.menuBgm) {
            this.menuBgm.volume = bgmVol;
        } else if (this.bgmState === 'GAME' && this.gameBgm) {
            this.gameBgm.volume = bgmVol;
        }
    }

    // ================== 背景音乐调度 ==================

    /**
     * 播放主菜单背景音乐
     * 《背景音乐(点击开始游戏后2s淡出).mp3》
     */
    playMenuBgm(fadeInTime = 0.8) {
        this.bgmState = 'MENU';
        if (!this.bgmEnabled || !this.menuBgm) return;

        if (this.bgmFadeTimer) {
            clearInterval(this.bgmFadeTimer);
            this.bgmFadeTimer = null;
        }

        if (this.gameBgm) {
            this.gameBgm.pause();
            this.gameBgm.currentTime = 0;
        }

        const targetVol = this.getRealBgmVolume();
        if (targetVol <= 0) return;

        this.menuBgm.currentTime = 0;
        this.menuBgm.volume = 0;
        const playPromise = this.menuBgm.play();
        if (playPromise) {
            playPromise.then(() => {
                this._fadeVolume(this.menuBgm, 0, targetVol, fadeInTime);
            }).catch(() => {});
        }
    }

    /**
     * 核心规则：点击开始游戏后 2 秒内平滑淡出，淡出完成后无缝过渡到游戏中背景音乐
     */
    onGameStartFadeBgm(fadeDuration = 2.0) {
        if (this.bgmFadeTimer) {
            clearInterval(this.bgmFadeTimer);
            this.bgmFadeTimer = null;
        }

        if (!this.menuBgm || this.menuBgm.paused || this.menuBgm.volume <= 0.001) {
            // 如果菜单音乐未在播放，直接启动游戏背景音乐
            this.playGameBgm(0.6);
            return;
        }

        const startVol = this.menuBgm.volume;
        const startTime = performance.now();
        const durationMs = fadeDuration * 1000;

        this.bgmFadeTimer = setInterval(() => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(1.0, elapsed / durationMs);
            const currentVol = startVol * (1.0 - progress);

            if (this.menuBgm) {
                this.menuBgm.volume = Math.max(0, currentVol);
            }

            if (progress >= 1.0) {
                clearInterval(this.bgmFadeTimer);
                this.bgmFadeTimer = null;
                if (this.menuBgm) {
                    this.menuBgm.pause();
                    this.menuBgm.currentTime = 0;
                }
                // 2 秒淡出结束后，无缝启动游戏中背景音乐
                this.playGameBgm(0.6);
            }
        }, 30);
    }

    /**
     * 播放游戏中背景音乐 (循环播放)
     * 《游戏中背景音乐(循环播放).mp3》
     */
    playGameBgm(fadeInTime = 0.6) {
        this.bgmState = 'GAME';
        if (!this.bgmEnabled || !this.gameBgm) return;

        if (this.bgmFadeTimer) {
            clearInterval(this.bgmFadeTimer);
            this.bgmFadeTimer = null;
        }

        if (this.menuBgm) {
            this.menuBgm.pause();
        }

        const targetVol = this.getRealBgmVolume();
        if (targetVol <= 0) return;

        this.gameBgm.volume = 0;
        const playPromise = this.gameBgm.play();
        if (playPromise) {
            playPromise.then(() => {
                this._fadeVolume(this.gameBgm, 0, targetVol, fadeInTime);
            }).catch(() => {});
        }
    }

    /**
     * 暂停时压低背景音乐
     */
    pauseGameBgm() {
        if (!this.gameBgm || !this.bgmEnabled) return;
        const targetVol = this.getRealBgmVolume() * 0.25;
        this._fadeVolume(this.gameBgm, this.gameBgm.volume, targetVol, 0.25);
    }

    /**
     * 继续游戏时恢复背景音乐
     */
    resumeGameBgm() {
        if (!this.gameBgm || !this.bgmEnabled) return;
        const targetVol = this.getRealBgmVolume();
        this._fadeVolume(this.gameBgm, this.gameBgm.volume, targetVol, 0.3);
    }

    /**
     * 返回主菜单时切回主菜单音乐
     */
    returnToMenu() {
        if (this.bgmFadeTimer) {
            clearInterval(this.bgmFadeTimer);
            this.bgmFadeTimer = null;
        }

        if (this.gameBgm && !this.gameBgm.paused) {
            this._fadeVolume(this.gameBgm, this.gameBgm.volume, 0, 0.4, () => {
                if (this.gameBgm) this.gameBgm.pause();
                this.playMenuBgm(0.8);
            });
        } else {
            this.playMenuBgm(0.8);
        }
    }

    _fadeVolume(audio, fromVol, toVol, duration, callback) {
        if (!audio) return;
        const startTime = performance.now();
        const durationMs = Math.max(50, duration * 1000);
        audio.volume = fromVol;

        const timer = setInterval(() => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(1.0, elapsed / durationMs);
            audio.volume = Math.max(0, Math.min(1, fromVol + (toVol - fromVol) * progress));

            if (progress >= 1.0) {
                clearInterval(timer);
                if (callback) callback();
            }
        }, 30);
    }

    // ================== 音效与互动反馈 ==================

    /**
     * 1. 按钮点击音效
     * 采用《UI点击&蓄力(蓄力从最开始的慢逐渐变快).mp3》单次利落播放
     */
    playClick() {
        if (!this.sfxEnabled) return;
        this.resume();

        try {
            if (this.clickAudio) {
                const click = this.clickAudio.cloneNode();
                click.volume = this.getRealSfxVolume();
                // 细微音调随机扰动，杜绝连击机械感
                click.playbackRate = 1.0 + (Math.random() - 0.5) * 0.08;
                click.play().catch(() => this._synthClick());
            } else {
                this._synthClick();
            }
        } catch (e) {
            this._synthClick();
        }
    }

    /**
     * 2. 蓄力音效
     * 核心规则：蓄力从最开始的慢逐渐变快！
     * playbackRate 从初始 0.70x 平滑加速提升至 1.85x
     */
    startCharge() {
        if (!this.sfxEnabled) return;
        this.resume();
        this.stopCharge();

        try {
            if (this.chargeAudio) {
                this.chargeAudio.currentTime = 0;
                this.chargeAudio.loop = true;
                this.chargeAudio.playbackRate = 0.70; // 从最初的慢开始
                this.chargeAudio.volume = this.getRealSfxVolume() * 0.82;
                this.chargeAudio.play().catch(() => {});
            }
        } catch (e) {}

        this._startSynthCharge();
    }

    /**
     * 蓄力中持续同步：随着蓄力 ratio (0 -> 1) 动态平滑提升播放速率
     */
    updateCharge(ratio) {
        if (!this.sfxEnabled) return;
        const r = Math.max(0, Math.min(1, ratio));

        // 速率映射：0.70x (慢速) -> 1.85x (极速)
        const targetRate = 0.70 + r * 1.15;
        if (this.chargeAudio) {
            this.chargeAudio.playbackRate = targetRate;
            this.chargeAudio.volume = Math.min(1.0, this.getRealSfxVolume() * (0.80 + r * 0.25));
        }

        this._updateSynthCharge(r);
    }

    stopCharge() {
        try {
            if (this.chargeAudio) {
                this.chargeAudio.pause();
                this.chargeAudio.currentTime = 0;
                this.chargeAudio.playbackRate = 1.0;
            }
        } catch (e) {}

        this._stopSynthCharge();
    }

    /**
     * 3. 起跳弹射音 (Boing)
     */
    playJump(powerRatio = 0.5) {
        this.stopCharge();
        if (!this.sfxEnabled) return;
        this.resume();
        if (!this.ctx) return;

        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        const startFreq = 220 + powerRatio * 80;
        const peakFreq = 480 + powerRatio * 260;

        osc.frequency.setValueAtTime(startFreq, t);
        osc.frequency.linearRampToValueAtTime(peakFreq, t + 0.09);
        osc.frequency.exponentialRampToValueAtTime(startFreq * 0.9, t + 0.22);

        gain.gain.setValueAtTime(0.35 * this.getRealSfxVolume(), t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(t);
        osc.stop(t + 0.22);
    }

    /**
     * 4. 落地音效
     * 采用《落地音效.mp3》真实撞击采样
     * 针对 Good / Great / Perfect 叠加华丽五声音阶和弦琶音
     */
    playLand(grade = 'normal', combo = 0) {
        if (!this.sfxEnabled) return;
        this.resume();

        // 播放真实物理落地撞击音
        try {
            if (this.landAudio) {
                const land = this.landAudio.cloneNode();
                land.volume = this.getRealSfxVolume();
                land.play().catch(() => this._synthThud());
            } else {
                this._synthThud();
            }
        } catch (e) {
            this._synthThud();
        }

        // 叠加落点精准度奖励音调
        if (this.ctx) {
            if (grade === 'good') {
                this._playTone(523.25, 0.22, 0.24, 'triangle', 0.03); // C5
            } else if (grade === 'great') {
                this._playTone(587.33, 0.20, 0.26, 'sine', 0.03); // D5
                this._playTone(880.00, 0.25, 0.28, 'triangle', 0.10); // A5
            } else if (grade === 'perfect') {
                const pentatonic = [659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98];
                const baseIndex = Math.min(combo % 5, pentatonic.length - 3);
                const n1 = pentatonic[baseIndex];
                const n2 = pentatonic[baseIndex + 1];
                const n3 = pentatonic[baseIndex + 2];

                this._playTone(n1, 0.35, 0.30, 'triangle', 0.0);
                this._playTone(n2, 0.40, 0.32, 'sine', 0.06);
                this._playTone(n3, 0.55, 0.35, 'triangle', 0.13);
                this._playTone(n3 * 2, 0.45, 0.24, 'sine', 0.20);
            }
        }
    }

    /**
     * 5. 掉落滑音 (踏空下坠)
     */
    playFall() {
        if (!this.sfxEnabled) return;
        this.resume();

        // 快速压低游戏背景音乐
        if (this.gameBgm && !this.gameBgm.paused) {
            this._fadeVolume(this.gameBgm, this.gameBgm.volume, this.getRealBgmVolume() * 0.15, 0.3);
        }

        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(560, t);
        osc.frequency.exponentialRampToValueAtTime(110, t + 0.85);

        gain.gain.setValueAtTime(0.18 * this.getRealSfxVolume(), t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.85);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(900, t);
        filter.frequency.exponentialRampToValueAtTime(300, t + 0.85);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(t);
        osc.stop(t + 0.85);
    }

    /**
     * 6. 游戏结束失败音效
     * 采用《失败音效.mp3》戏剧化结语
     */
    playGameOver() {
        if (!this.sfxEnabled) return;
        this.resume();

        // 关停游戏背景音乐
        if (this.gameBgm) {
            this.gameBgm.pause();
        }

        try {
            if (this.failAudio) {
                this.failAudio.currentTime = 0;
                this.failAudio.volume = this.getRealSfxVolume();
                this.failAudio.play().catch(() => this._synthGameOver());
            } else {
                this._synthGameOver();
            }
        } catch (e) {
            this._synthGameOver();
        }
    }

    // ================== Web Audio 纯程序化兜底与合成器 ==================

    _startSynthCharge() {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        this.chargeOsc = this.ctx.createOscillator();
        this.chargeGain = this.ctx.createGain();

        this.chargeOsc.type = 'triangle';
        this.chargeOsc.frequency.setValueAtTime(180, t);

        this.chargeGain.gain.setValueAtTime(0.001, t);
        this.chargeGain.gain.linearRampToValueAtTime(0.12 * this.getRealSfxVolume(), t + 0.08);

        this.chargeOsc.connect(this.chargeGain);
        this.chargeGain.connect(this.ctx.destination);
        this.chargeOsc.start(t);
    }

    _updateSynthCharge(ratio) {
        if (!this.chargeOsc || !this.ctx) return;
        const targetFreq = 180 + ratio * 340;
        this.chargeOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.05);
    }

    _stopSynthCharge() {
        if (this.chargeGain && this.ctx) {
            const t = this.ctx.currentTime;
            this.chargeGain.gain.cancelScheduledValues(t);
            this.chargeGain.gain.linearRampToValueAtTime(0.0001, t + 0.05);
            if (this.chargeOsc) {
                this.chargeOsc.stop(t + 0.05);
            }
        }
        this.chargeOsc = null;
        this.chargeGain = null;
    }

    _synthClick() {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(650, t);
        osc.frequency.exponentialRampToValueAtTime(320, t + 0.08);

        gain.gain.setValueAtTime(0.3 * this.getRealSfxVolume(), t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(t);
        osc.stop(t + 0.08);
    }

    _synthThud() {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);

        gain.gain.setValueAtTime(0.4 * this.getRealSfxVolume(), t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(t);
        osc.stop(t + 0.12);
    }

    _synthGameOver() {
        if (!this.ctx) return;
        const notes = [440, 392, 349.23, 293.66];
        notes.forEach((freq, idx) => {
            this._playTone(freq, 0.35, 0.25, 'triangle', idx * 0.16);
        });
    }

    _playTone(freq, dur, vol, type = 'sine', delay = 0) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);

        gain.gain.setValueAtTime(vol * this.getRealSfxVolume(), t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(t);
        osc.stop(t + dur);
    }
}

window.soundManager = new SoundManager();
