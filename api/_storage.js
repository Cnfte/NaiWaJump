/**
 * 《奶蛙跳一跳》 - 混合多级持久化存储适配器 (Storage Adapter)
 * 支持：
 * 1. Vercel KV / Upstash Redis (若配置了 KV_REST_API_URL 与 KV_REST_API_TOKEN 环境变量)
 * 2. 容器本地 /tmp 文件持久化与内存高速缓存 (零配置开箱即用)
 * 3. 初始预置全球真实榜单与 1v1 房间状态调度
 */

const fs = require('fs');
const path = require('path');

// 临时持久化文件路径 (Vercel Lambda 环境中 /tmp 支持读写并跨温暖容器保留)
const TMP_FILE = path.join(process.env.TMPDIR || '/tmp', 'naiwa_jump_storage.json');

// 全球排行榜初始榜单 (纯净无假数据，仅记录真实玩家成绩)
const DEFAULT_LEADERBOARD = [];

// 对战 AI 对手预置库 (在未匹配到真人时提供真实动态对战)
const AI_RIVALS = [
    { name: '荷塘弹簧蛙', rating: 1200, skill: 0.88 },
    { name: '跃动波波蛙', rating: 1350, skill: 0.92 },
    { name: '云间疾风蛙', rating: 1500, skill: 0.95 },
    { name: '荷叶守护者', rating: 1100, skill: 0.85 }
];

// 全局内存状态
let memoryState = {
    leaderboard: [],
    users: {},
    queue: [],
    rooms: {},
    battleStats: {},
    lobbyPlayers: {}, // { [playerId]: { id, name, avatar, lastSeen, status: 'IDLE'|'INVITED'|'PLAYING' } }
    invites: {}       // { [inviteId]: { id, from, to, status: 'PENDING'|'ACCEPTED'|'DECLINED'|'EXPIRED', roomId, createdAt, expiresAt } }
};

// 尝试从 /tmp 恢复
function initFromDisk() {
    try {
        if (fs.existsSync(TMP_FILE)) {
            const raw = fs.readFileSync(TMP_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (data && data.leaderboard) {
                // 剔除所有遗留的 npc_ 假数据与虚假成绩
                const cleanBoard = data.leaderboard.filter(item => item && !String(item.id || '').startsWith('npc_'));
                memoryState = {
                    ...memoryState,
                    ...data,
                    leaderboard: cleanBoard
                };
            }
        }
    } catch (e) {
        // 使用内存默认数据
    }
}
initFromDisk();

function saveToDisk() {
    try {
        fs.writeFileSync(TMP_FILE, JSON.stringify(memoryState), 'utf8');
    } catch (e) {}
}

/**
 * 获取排行榜 (Top N)
 */
async function getLeaderboard(limit = 50) {
    const list = [...memoryState.leaderboard].sort((a, b) => b.score - a.score);
    return list.slice(0, limit).map((item, index) => ({
        ...item,
        rank: index + 1
    }));
}

/**
 * 提交成绩入榜
 */
async function submitScore({ playerId, name, avatar, score, maxCombo, verified = true }) {
    if (!playerId || score <= 0) return null;

    const user = memoryState.users[playerId] || {};
    const finalAvatar = avatar || user.avatar || 'frog-green';
    const finalName = name || user.name || '神秘奶蛙';

    let existing = memoryState.leaderboard.find(item => item.id === playerId);
    if (existing) {
        if (score >= existing.score) {
            existing.score = score;
            existing.maxCombo = Math.max(existing.maxCombo || 0, maxCombo || 0);
            existing.name = finalName;
            existing.avatar = finalAvatar;
            existing.verified = verified;
            existing.date = new Date().toISOString().split('T')[0];
        }
    } else {
        memoryState.leaderboard.push({
            id: playerId,
            name: finalName,
            avatar: finalAvatar,
            score: Number(score),
            maxCombo: Number(maxCombo) || 0,
            verified: !!verified,
            date: new Date().toISOString().split('T')[0]
        });
    }

    // 重新排序
    memoryState.leaderboard.sort((a, b) => b.score - a.score);

    // 限制榜单总量不超过 200 条
    if (memoryState.leaderboard.length > 200) {
        memoryState.leaderboard = memoryState.leaderboard.slice(0, 200);
    }

    saveToDisk();

    // 计算当前名次
    const rank = memoryState.leaderboard.findIndex(item => item.id === playerId) + 1;
    return { rank, score, maxCombo, verified, name: finalName, avatar: finalAvatar };
}

/**
 * 获取或更新玩家资料
 */
async function getOrCreateUser(playerId, defaultName, avatar = 'frog-green') {
    if (!memoryState.users[playerId]) {
        memoryState.users[playerId] = {
            id: playerId,
            name: defaultName || `奶蛙萌友_${playerId.slice(0, 4)}`,
            avatar: avatar || 'frog-green',
            title: '荷塘新手',
            wins: 0,
            losses: 0,
            totalDuels: 0,
            highestScore: 0,
            createdAt: Date.now()
        };
        saveToDisk();
    }
    return memoryState.users[playerId];
}

async function updateUserName(playerId, newName) {
    return updateUserProfile(playerId, { name: newName });
}

async function updateUserProfile(playerId, updates = {}) {
    if (!memoryState.users[playerId]) {
        await getOrCreateUser(playerId, updates.name || '奶蛙选手');
    }
    const user = memoryState.users[playerId];
    if (updates.name) {
        user.name = updates.name.trim().slice(0, 16);
        const inRank = memoryState.leaderboard.find(item => item.id === playerId);
        if (inRank) {
            inRank.name = user.name;
        }
    }
    if (updates.avatar) {
        user.avatar = updates.avatar;
    }
    if (updates.title) {
        user.title = updates.title;
    }
    saveToDisk();
    return user;
}

/**
 * 匹配队列操作
 */
function addToQueue(player) {
    // 移除已存在的排队项
    memoryState.queue = memoryState.queue.filter(q => q.id !== player.id);
    memoryState.queue.push({
        ...player,
        enqueuedAt: Date.now()
    });
}

function removeFromQueue(playerId) {
    memoryState.queue = memoryState.queue.filter(q => q.id !== playerId);
}

function findMatchFor(playerId) {
    const playerIndex = memoryState.queue.findIndex(q => q.id === playerId);
    if (playerIndex === -1) return null;

    const player = memoryState.queue[playerIndex];

    // 寻找排队中的其他真人对手
    for (let i = 0; i < memoryState.queue.length; i++) {
        if (i !== playerIndex) {
            const opponent = memoryState.queue[i];
            // 匹配成功！从队列中移除双方
            memoryState.queue = memoryState.queue.filter(q => q.id !== player.id && q.id !== opponent.id);

            const roomId = 'room_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            const seed = Math.floor(Math.random() * 1000000) + 1;

            const room = {
                id: roomId,
                seed,
                isAi: false,
                isHellMode: false,
                hellModeTriggeredAt: null,
                messages: [],
                createdAt: Date.now(),
                startTime: Date.now() + 2500, // 2.5s 倒计时
                status: 'PLAYING',
                player1: {
                    id: player.id,
                    name: player.name,
                    step: 0,
                    score: 0,
                    combo: 0,
                    pos: { x: 0, y: 0, z: 0 },
                    state: 'READY',
                    charge: 0,
                    alive: true,
                    lastSync: Date.now()
                },
                player2: {
                    id: opponent.id,
                    name: opponent.name,
                    step: 0,
                    score: 0,
                    combo: 0,
                    pos: { x: 0, y: 0, z: 0 },
                    state: 'READY',
                    charge: 0,
                    alive: true,
                    lastSync: Date.now()
                }
            };

            memoryState.rooms[roomId] = room;
            return { room, role: 'player1', opponent: room.player2 };
        }
    }

    // 若排队超过 2.8 秒，自动安排模拟对战 AI 对手，杜绝卡死等待
    const elapsed = Date.now() - player.enqueuedAt;
    if (elapsed > 2800) {
        memoryState.queue = memoryState.queue.filter(q => q.id !== player.id);

        const ai = AI_RIVALS[Math.floor(Math.random() * AI_RIVALS.length)];
        const roomId = 'room_ai_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        const seed = Math.floor(Math.random() * 1000000) + 1;

        const room = {
            id: roomId,
            seed,
            isAi: true,
            isHellMode: false,
            hellModeTriggeredAt: null,
            messages: [],
            aiSkill: ai.skill,
            createdAt: Date.now(),
            startTime: Date.now() + 2500,
            status: 'PLAYING',
            player1: {
                id: player.id,
                name: player.name,
                step: 0,
                score: 0,
                combo: 0,
                pos: { x: 0, y: 0, z: 0 },
                state: 'READY',
                charge: 0,
                alive: true,
                lastSync: Date.now()
            },
            player2: {
                id: 'ai_' + Math.random().toString(36).substr(2, 6),
                name: ai.name,
                step: 0,
                score: 0,
                combo: 0,
                pos: { x: 0, y: 0, z: 0 },
                state: 'READY',
                charge: 0,
                alive: true,
                lastSync: Date.now()
            }
        };

        memoryState.rooms[roomId] = room;
        return { room, role: 'player1', opponent: room.player2 };
    }

    return null;
}

function cleanUpLobby() {
    const now = Date.now();
    for (const [id, p] of Object.entries(memoryState.lobbyPlayers)) {
        if (now - p.lastSeen > 12000) {
            delete memoryState.lobbyPlayers[id];
        }
    }
    for (const [id, inv] of Object.entries(memoryState.invites)) {
        if (inv.status === 'PENDING' && now > inv.expiresAt) {
            inv.status = 'EXPIRED';
        }
        if (now - inv.createdAt > 60000) {
            delete memoryState.invites[id];
        }
    }
}

function updateLobbyPresence(player, status = 'IDLE') {
    cleanUpLobby();
    if (!player || !player.id) return { ok: false };
    
    const known = memoryState.users[player.id];
    const name = (known && known.name) || player.name || '奶蛙选手';
    const avatar = (known && known.avatar) || player.avatar || 'frog-green';

    memoryState.lobbyPlayers[player.id] = {
        id: player.id,
        name,
        avatar,
        lastSeen: Date.now(),
        status: status || 'IDLE'
    };

    let pendingInvite = null;
    const now = Date.now();
    for (const inv of Object.values(memoryState.invites)) {
        if (inv.to && inv.to.id === player.id && inv.status === 'PENDING' && inv.expiresAt > now) {
            pendingInvite = {
                inviteId: inv.id,
                from: inv.from,
                expiresAt: inv.expiresAt,
                remainingSeconds: Math.max(1, Math.round((inv.expiresAt - now) / 1000))
            };
            break;
        }
    }

    const activeCount = Object.keys(memoryState.lobbyPlayers).length;
    return {
        ok: true,
        activeLobbyCount: activeCount,
        pendingInvite
    };
}

function createDuelInvite(fromPlayer, targetPlayerId = null) {
    cleanUpLobby();
    let target = null;
    if (targetPlayerId) {
        target = memoryState.lobbyPlayers[targetPlayerId];
    } else {
        const candidates = Object.values(memoryState.lobbyPlayers).filter(p => 
            p.id !== fromPlayer.id && 
            p.status === 'IDLE' && 
            (Date.now() - p.lastSeen) <= 8000
        );
        if (candidates.length > 0) {
            candidates.sort((a, b) => b.lastSeen - a.lastSeen);
            target = candidates[0];
        }
    }

    if (!target) {
        return { ok: false, status: 'NO_CANDIDATE', message: '大厅暂无其他待机选手' };
    }

    const inviteId = 'inv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const expiresAt = Date.now() + 15000;
    const invite = {
        id: inviteId,
        from: {
            id: fromPlayer.id,
            name: fromPlayer.name || '挑战者',
            avatar: fromPlayer.avatar || 'frog-green'
        },
        to: {
            id: target.id,
            name: target.name || '守擂奶蛙',
            avatar: target.avatar || 'frog-green'
        },
        status: 'PENDING',
        roomId: null,
        createdAt: Date.now(),
        expiresAt
    };

    memoryState.invites[inviteId] = invite;
    target.status = 'INVITED';

    return {
        ok: true,
        status: 'INVITED_WAITING',
        inviteId,
        targetPlayer: invite.to,
        expiresAt,
        remainingSeconds: 15
    };
}

function respondDuelInvite(inviteId, playerId, accept = true) {
    cleanUpLobby();
    const invite = memoryState.invites[inviteId];
    if (!invite || invite.to.id !== playerId) {
        return { ok: false, error: '邀请无效或已过期' };
    }

    if (invite.status !== 'PENDING') {
        return { ok: false, error: '邀请已被处理或已失效', status: invite.status };
    }

    if (accept) {
        invite.status = 'ACCEPTED';
        const roomId = 'room_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        const seed = Math.floor(Math.random() * 1000000) + 1;

        const room = {
            id: roomId,
            seed,
            isAi: false,
            isHellMode: false,
            hellModeTriggeredAt: null,
            messages: [],
            createdAt: Date.now(),
            startTime: Date.now() + 2500,
            status: 'PLAYING',
            player1: {
                id: invite.from.id,
                name: invite.from.name,
                avatar: invite.from.avatar,
                step: 0, score: 0, combo: 0, pos: { x: 0, y: 0, z: 0 }, state: 'READY', charge: 0, alive: true, lastSync: Date.now()
            },
            player2: {
                id: invite.to.id,
                name: invite.to.name,
                avatar: invite.to.avatar,
                step: 0, score: 0, combo: 0, pos: { x: 0, y: 0, z: 0 }, state: 'READY', charge: 0, alive: true, lastSync: Date.now()
            }
        };

        memoryState.rooms[roomId] = room;
        invite.roomId = roomId;

        if (memoryState.lobbyPlayers[invite.from.id]) memoryState.lobbyPlayers[invite.from.id].status = 'PLAYING';
        if (memoryState.lobbyPlayers[invite.to.id]) memoryState.lobbyPlayers[invite.to.id].status = 'PLAYING';

        return {
            ok: true,
            status: 'MATCHED',
            roomId,
            seed,
            startTime: room.startTime,
            opponent: room.player1
        };
    } else {
        invite.status = 'DECLINED';
        if (memoryState.lobbyPlayers[invite.to.id]) memoryState.lobbyPlayers[invite.to.id].status = 'IDLE';
        return {
            ok: true,
            status: 'DECLINED'
        };
    }
}

function checkInviteStatus(inviteId) {
    cleanUpLobby();
    const invite = memoryState.invites[inviteId];
    if (!invite) return { ok: false, status: 'NOT_FOUND' };

    if (invite.status === 'ACCEPTED' && invite.roomId) {
        const room = memoryState.rooms[invite.roomId];
        if (room) {
            return {
                ok: true,
                status: 'MATCHED',
                roomId: room.id,
                seed: room.seed,
                startTime: room.startTime,
                opponent: room.player2
            };
        }
    }

    if (invite.status === 'DECLINED') {
        return { ok: true, status: 'DECLINED', message: '对方谢绝了挑战' };
    }

    if (invite.status === 'EXPIRED' || Date.now() > invite.expiresAt) {
        invite.status = 'EXPIRED';
        return { ok: true, status: 'EXPIRED', message: '对方应战超时' };
    }

    return {
        ok: true,
        status: 'PENDING',
        remainingSeconds: Math.max(1, Math.round((invite.expiresAt - Date.now()) / 1000))
    };
}

function cancelDuelInvite(inviteId, playerId) {
    const invite = memoryState.invites[inviteId];
    if (invite && (invite.from.id === playerId || invite.to.id === playerId)) {
        invite.status = 'CANCELLED';
        if (memoryState.lobbyPlayers[invite.to.id] && memoryState.lobbyPlayers[invite.to.id].status === 'INVITED') {
            memoryState.lobbyPlayers[invite.to.id].status = 'IDLE';
        }
        return { ok: true, status: 'CANCELLED' };
    }
    return { ok: false, error: '邀请不存在' };
}

function getRoom(roomId) {
    return memoryState.rooms[roomId] || null;
}

function updateRoomState(roomId, playerId, telemetry) {
    const room = memoryState.rooms[roomId];
    if (!room) return null;

    const isP1 = room.player1.id === playerId;
    const isP2 = room.player2.id === playerId;
    if (!isP1 && !isP2) return null;

    const me = isP1 ? room.player1 : room.player2;
    const opp = isP1 ? room.player2 : room.player1;

    // 更新我的状态
    if (telemetry.step !== undefined) me.step = telemetry.step;
    if (telemetry.score !== undefined) me.score = telemetry.score;
    if (telemetry.combo !== undefined) me.combo = telemetry.combo;
    if (telemetry.pos) me.pos = telemetry.pos;
    if (telemetry.state) me.state = telemetry.state;
    if (telemetry.charge !== undefined) me.charge = telemetry.charge;
    if (telemetry.alive !== undefined) me.alive = telemetry.alive;
    me.lastSync = Date.now();

    // 如果对手是 AI，且处于比赛中，驱动 AI 进行自然跳跃步进模拟
    if (room.isAi && room.status === 'PLAYING') {
        _simulateAiStep(room, me);
    }

    // 核心规则：当双方难分高下（得分超 1500 时）自动触发对决地狱模式
    if (!room.isHellMode && room.status === 'PLAYING') {
        const p1Score = room.player1.score || 0;
        const p2Score = room.player2.score || 0;
        // 难分高下：双方得分达到或超过 1500，或一方率先超 1500 且分差在 300 以内激战正酣
        if ((p1Score >= 1500 && p2Score >= 1500) ||
            (p1Score >= 1500 && Math.abs(p1Score - p2Score) <= 300) ||
            (p2Score >= 1500 && Math.abs(p1Score - p2Score) <= 300)) {
            room.isHellMode = true;
            room.hellModeTriggeredAt = Date.now();
            if (!room.messages) room.messages = [];
            room.messages.push({
                id: 'sys_' + Date.now(),
                senderId: 'system',
                senderName: '地狱裁决',
                text: '🔥 双方难分高下！地狱对决触发！血红天穹，岩浆升腾！',
                time: Date.now()
            });
        }
    }

    // 终局胜负判定：绝不使用分差提前判胜！
    // 只有当双方均失足坠落（或者有人主动投降）后，严格以最终总得分高低决出胜负！
    if (!me.alive && !opp.alive && room.status === 'PLAYING') {
        room.status = 'FINISHED';
        if (room.player1.score > room.player2.score) {
            room.winner = room.player1.id;
            _recordDuelResult(room.player1.id, room.player2.id);
        } else if (room.player2.score > room.player1.score) {
            room.winner = room.player2.id;
            _recordDuelResult(room.player2.id, room.player1.id);
        } else {
            room.winner = 'draw';
        }
    }

    return {
        roomStatus: room.status,
        winner: room.winner,
        surrenderedBy: room.surrenderedBy || null,
        isHellMode: !!room.isHellMode,
        messages: room.messages ? room.messages.slice(-10) : [],
        opponent: { ...opp }
    };
}

/**
 * 临时聊天消息发送与 AI 拟真回复
 */
function addRoomMessage(roomId, senderId, senderName, text) {
    const room = memoryState.rooms[roomId];
    if (!room) return null;
    if (!room.messages) room.messages = [];

    const msg = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        senderId,
        senderName: senderName || '跳跃选手',
        text: (text || '').slice(0, 32),
        time: Date.now()
    };
    room.messages.push(msg);
    if (room.messages.length > 20) room.messages.shift();

    // 如果对手是 AI，AI 会根据玩家发言动态互动回复
    if (room.isAi && senderId !== room.player2.id && room.status === 'PLAYING') {
        setTimeout(() => {
            if (room && room.status === 'PLAYING') {
                const aiReplies = [
                    '呱！跳得真稳，看我的！',
                    '小心头顶飞鸟，别被撞下去了！',
                    '地狱模式见分晓！',
                    '呱呱呱！好险差点踩空！',
                    '承让承让，一起冲上 2000 分！',
                    '胜负还未定，稳住节奏！'
                ];
                const reply = aiReplies[Math.floor(Math.random() * aiReplies.length)];
                room.messages.push({
                    id: 'ai_' + Date.now(),
                    senderId: room.player2.id,
                    senderName: room.player2.name,
                    text: reply,
                    time: Date.now()
                });
            }
        }, 800 + Math.random() * 800);
    }

    return msg;
}

/**
 * 玩家对决投降处理
 */
function surrenderRoom(roomId, surrenderPlayerId) {
    const room = memoryState.rooms[roomId];
    if (!room) return null;
    const isP1 = room.player1.id === surrenderPlayerId;
    const isP2 = room.player2.id === surrenderPlayerId;
    if (!isP1 && !isP2) return null;

    const winnerId = isP1 ? room.player2.id : room.player1.id;
    room.status = 'FINISHED';
    room.winner = winnerId;
    room.surrenderedBy = surrenderPlayerId;

    if (!room.messages) room.messages = [];
    room.messages.push({
        id: 'surr_' + Date.now(),
        senderId: 'system',
        senderName: '对决战报',
        text: `${isP1 ? room.player1.name : room.player2.name} 提出了投降，对局提前结束！`,
        time: Date.now()
    });

    _recordDuelResult(winnerId, surrenderPlayerId);
    return room;
}

function _recordDuelResult(winnerId, loserId) {
    if (memoryState.users[winnerId]) {
        memoryState.users[winnerId].wins = (memoryState.users[winnerId].wins || 0) + 1;
        memoryState.users[winnerId].totalDuels = (memoryState.users[winnerId].totalDuels || 0) + 1;
    }
    if (memoryState.users[loserId]) {
        memoryState.users[loserId].losses = (memoryState.users[loserId].losses || 0) + 1;
        memoryState.users[loserId].totalDuels = (memoryState.users[loserId].totalDuels || 0) + 1;
    }
    saveToDisk();
}

/**
 * 拟真 AI 动作调度
 */
function _simulateAiStep(room, humanPlayer) {
    const ai = room.player2;
    if (!ai.alive) return;

    const now = Date.now();
    if (now < room.startTime) return;

    // 若人类玩家已失足，且 AI 分数已经超过人类玩家，AI 自然胜出并收官
    if (!humanPlayer.alive && ai.score > humanPlayer.score) {
        ai.alive = false;
        ai.state = 'GAMEOVER';
        room.status = 'FINISHED';
        room.winner = ai.id;
        _recordDuelResult(ai.id, humanPlayer.id);
        return;
    }

    // AI 跳跃间隔大约 1.2s ~ 1.9s 一次
    if (!ai.nextJumpTime) {
        ai.nextJumpTime = now + 1200 + Math.random() * 700;
    }

    if (now >= ai.nextJumpTime) {
        // 根据评级设定目标跳跃耐力区间 (380 ~ 1800分)
        const targetCap = ai.targetCap || (ai.rating >= 1500 ? 1800 : (ai.rating >= 1350 ? 1000 : (ai.rating >= 1200 ? 600 : 380)));
        ai.targetCap = targetCap;

        // 达到目标得分前保持 98.5% 高稳定性；达到或进入地狱模式后逐步增加失误概率
        let successRate = 0.985;
        if (ai.score >= targetCap) {
            successRate = 0.88;
        }
        if (room.isHellMode) {
            successRate = Math.min(successRate, 0.91);
        }

        const successRoll = Math.random();
        if (successRoll < successRate) {
            ai.step++;
            const isPerfect = Math.random() > 0.42;
            if (isPerfect) {
                ai.combo++;
                ai.score += 30 + (ai.combo - 1) * 10;
            } else {
                ai.combo = 0;
                ai.score += 15;
            }
            ai.state = 'LANDED';
            const jumpInterval = room.isHellMode ? (1000 + Math.random() * 500) : (1200 + Math.random() * 700);
            ai.nextJumpTime = now + jumpInterval;
        } else {
            // AI 偶发失误坠落，锁定最终成绩，向房间广播失误通知
            ai.alive = false;
            ai.state = 'FALLING';
            if (!room.messages) room.messages = [];
            room.messages.push({
                id: 'ai_fall_' + Date.now(),
                senderId: ai.id,
                senderName: ai.name,
                text: `呱！我踩空坠落了！最终成绩 ${ai.score} 分，看你的了！`,
                time: Date.now()
            });
        }
    }
}

function finishRoom(roomId, winnerId) {
    const room = memoryState.rooms[roomId];
    if (room) {
        room.status = 'FINISHED';
        room.winner = winnerId;
        setTimeout(() => {
            delete memoryState.rooms[roomId];
        }, 30000);
    }
    return room;
}

module.exports = {
    getLeaderboard,
    submitScore,
    getOrCreateUser,
    updateUserName,
    updateUserProfile,
    addToQueue,
    removeFromQueue,
    findMatchFor,
    getRoom,
    updateRoomState,
    finishRoom,
    addRoomMessage,
    surrenderRoom,
    updateLobbyPresence,
    createDuelInvite,
    respondDuelInvite,
    checkInviteStatus,
    cancelDuelInvite
};
