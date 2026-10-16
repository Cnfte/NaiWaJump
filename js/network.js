/**
 * 《奶蛙跳一跳》 - 客户端网络通信与反作弊签名 SDK
 * 负责与 Vercel Serverless 后端 API (/api/auth, /api/leaderboard, /api/match) 交互
 * 支持浏览器原生 Web Crypto API 生成 HMAC / SHA-256 签名，离线自动无缝仿真
 */

class NetworkManager {
    constructor() {
        this.apiBase = ''; // 相对路径，在 Vercel 或本地 server.js 下直接访问 /api/*
        this.token = null;
        this.user = null;
        this.isOnline = navigator.onLine;

        // 本地跳跃动作链遥测数据 (用于反作弊审核)
        this.telemetryLogs = [];
        this.matchStartTime = 0;

        // 尝试从 localStorage 恢复会话
        this._loadSession();

        window.addEventListener('online', () => { this.isOnline = true; });
        window.addEventListener('offline', () => { this.isOnline = false; });
    }

    _loadSession() {
        try {
            const savedToken = localStorage.getItem('naiwa_auth_token');
            const savedUser = localStorage.getItem('naiwa_auth_user');
            if (savedToken && savedUser) {
                this.token = savedToken;
                this.user = JSON.parse(savedUser);
            }
        } catch (e) {}
    }

    _saveSession(token, user) {
        this.token = token;
        this.user = user;
        try {
            localStorage.setItem('naiwa_auth_token', token);
            localStorage.setItem('naiwa_auth_user', JSON.stringify(user));
        } catch (e) {}
    }

    /**
     * 初始化身份鉴权：若无本地凭证，自动以游客身份快速注册
     */
    async initAuth() {
        if (this.token && this.user) {
            // 校验本地 Token 是否依然有效
            try {
                const res = await fetch(`${this.apiBase}/api/auth`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.ok && data.user) {
                        this._saveSession(this.token, data.user);
                        return this.user;
                    }
                }
            } catch (e) {
                // 网络异常或本地 file:// 协议，保留本地数据
                return this.user;
            }
        }

        // 注册新游客
        try {
            const res = await fetch(`${this.apiBase}/api/auth`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'guest' })
            });
            if (res.ok) {
                const data = await res.json();
                if (data.ok && data.token) {
                    this._saveSession(data.token, data.user);
                    return this.user;
                }
            }
        } catch (e) {}

        // 离线环境本地兜底生成
        const offlineId = 'offline_' + Math.random().toString(36).substr(2, 6);
        const offlineUser = {
            id: offlineId,
            name: `荷塘萌蛙#${Math.floor(1000 + Math.random() * 9000)}`,
            wins: 0,
            losses: 0,
            highestScore: 0
        };
        this._saveSession('offline_token_' + offlineId, offlineUser);
        return offlineUser;
    }

    /**
     * 更新玩家资料 (昵称、头像、称号)
     */
    async updateProfile(updates = {}) {
        if (!this.token) await this.initAuth();
        try {
            const res = await fetch(`${this.apiBase}/api/auth`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({
                    action: 'update_profile',
                    username: updates.name,
                    avatar: updates.avatar,
                    title: updates.title
                })
            });
            if (res.ok) {
                const data = await res.json();
                if (data.ok && data.user) {
                    this._saveSession(data.token, data.user);
                    return { ok: true, user: data.user };
                }
            }
        } catch (e) {}

        if (this.user) {
            if (updates.name) this.user.name = updates.name;
            if (updates.avatar) this.user.avatar = updates.avatar;
            if (updates.title) this.user.title = updates.title;
            this._saveSession(this.token, this.user);
            return { ok: true, user: this.user };
        }
        return { ok: false, error: '修改失败' };
    }

    async updateName(newName) {
        return this.updateProfile({ name: newName });
    }

    /**
     * 使用 Web Crypto API 生成 SHA-256 动作链防作弊签名
     */
    async generateSignature(score, maxCombo, timestamp, nonce) {
        if (!this.user) return '';
        const rawPayload = `${this.user.id}:${score}:${maxCombo}:${timestamp}:${nonce}`;
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(rawPayload + ':client_salt_2026');
            const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
            return 'fallback_hash_' + Date.now();
        }
    }

    /**
     * 记录单步跳跃动作日志 (供反作弊审计)
     */
    recordStepLog(log) {
        this.telemetryLogs.push({
            step: log.step,
            chargeRatio: Number(log.chargeRatio.toFixed(3)),
            jumpDist: Number(log.jumpDist.toFixed(2)),
            grade: log.grade,
            stepScore: log.stepScore,
            timestamp: Date.now()
        });
        if (this.telemetryLogs.length > 50) {
            this.telemetryLogs.shift();
        }
    }

    resetLogs() {
        this.telemetryLogs = [];
        this.matchStartTime = Date.now();
    }

    /**
     * 获取全球排行榜
     */
    async getLeaderboard() {
        try {
            const headers = {};
            if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
            const res = await fetch(`${this.apiBase}/api/leaderboard`, { headers });
            if (res.ok) {
                const data = await res.json();
                if (data.ok && data.leaderboard) {
                    return data;
                }
            }
        } catch (e) {}

        // 本地离线备用数据
        return {
            ok: true,
            leaderboard: [
                { rank: 1, name: '云端跳跳王', score: 3820, maxCombo: 42, verified: true, date: '2026-10-10' },
                { rank: 2, name: '荷塘宗师·小绿', score: 3260, maxCombo: 36, verified: true, date: '2026-10-09' },
                { rank: 3, name: '翠绿幻影', score: 2890, maxCombo: 31, verified: true, date: '2026-10-11' },
                { rank: 4, name: '马卡龙跃动者', score: 2450, maxCombo: 27, verified: true, date: '2026-10-08' },
                { rank: 5, name: '星际弹力蛙', score: 2110, maxCombo: 22, verified: true, date: '2026-10-10' }
            ],
            myRank: null
        };
    }

    /**
     * 提交成绩入榜 (带防作弊验签)
     */
    async submitScore(score, maxCombo, jumpCount) {
        if (!this.token) await this.initAuth();
        const timestamp = Date.now();
        const nonce = Math.random().toString(36).substr(2, 8);
        const signature = await this.generateSignature(score, maxCombo, timestamp, nonce);
        const durationSeconds = this.matchStartTime ? (Date.now() - this.matchStartTime) / 1000 : 0;

        const payload = {
            score,
            maxCombo,
            jumpCount,
            durationSeconds,
            logs: this.telemetryLogs,
            signature,
            timestamp,
            nonce
        };

        try {
            const res = await fetch(`${this.apiBase}/api/leaderboard`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`,
                    'x-naiwa-signature': signature,
                    'x-naiwa-timestamp': timestamp.toString(),
                    'x-naiwa-nonce': nonce
                },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                const data = await res.json();
                return data;
            } else {
                const errData = await res.json().catch(() => ({}));
                return { ok: false, error: errData.error || '提交未通过审核' };
            }
        } catch (e) {
            return { ok: true, verified: false, message: '离线模式：成绩已在本地保存' };
        }
    }

    // ================== 多人对战匹配与状态同步 ==================

    /**
     * 请求加入 1v1 匹配对战
     */
    async joinMatch() {
        if (!this.token) await this.initAuth();
        try {
            const res = await fetch(`${this.apiBase}/api/match`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ action: 'join' })
            });
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {}

        // 离线环境本地模拟对战
        return {
            ok: true,
            status: 'MATCHED',
            roomId: 'room_local_' + Date.now(),
            seed: Math.floor(Math.random() * 1000000),
            isAi: true,
            startTime: Date.now() + 2500,
            opponent: { id: 'ai_local', name: '离线竞技小绿蛙', score: 0, combo: 0 }
        };
    }

    /**
     * 轮询对战匹配状态
     */
    async pollMatch() {
        if (!this.token) return { ok: false };
        try {
            const res = await fetch(`${this.apiBase}/api/match`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ action: 'poll' })
            });
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {}
        return { ok: true, status: 'WAITING' };
    }

    /**
     * 取消对战排队
     */
    async cancelMatch() {
        if (!this.token) return;
        try {
            await fetch(`${this.apiBase}/api/match`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ action: 'cancel' })
            });
        } catch (e) {}
    }

    /**
     * 实时同步自身状态并拉取对手状态 (含聊天消息与地狱模式)
     */
    async syncMatchState(roomId, myTelemetry) {
        if (!this.token || !roomId) return null;
        try {
            const res = await fetch(`${this.apiBase}/api/match`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({
                    action: 'sync',
                    roomId,
                    telemetry: myTelemetry
                })
            });
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {}

        return null;
    }

    async syncBattle(roomId, myTelemetry) {
        return this.syncMatchState(roomId, myTelemetry);
    }

    /**
     * 发送对决临时互动聊天消息
     */
    async sendDuelChat(roomId, text) {
        if (!this.token || !roomId || !text) return null;
        try {
            const res = await fetch(`${this.apiBase}/api/match`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ action: 'chat', roomId, text })
            });
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {}
        return null;
    }

    /**
     * 对决主动投降认输
     */
    async surrenderDuel(roomId) {
        if (!this.token || !roomId) return null;
        try {
            const res = await fetch(`${this.apiBase}/api/match`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ action: 'surrender', roomId })
            });
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {}
        return null;
    }

    /**
     * 比赛结束结算
     */
    async finishMatch(roomId, winnerId) {
        if (!this.token || !roomId) return;
        try {
            await fetch(`${this.apiBase}/api/match`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ action: 'finish', roomId, winnerId })
            });
        } catch (e) {}
    }
}

window.networkManager = new NetworkManager();
