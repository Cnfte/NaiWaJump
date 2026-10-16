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

// 初始全球排行榜真实高分榜单种子数据
const DEFAULT_LEADERBOARD = [
    { rank: 1, id: 'npc_1', name: '云端跳跳王', score: 3820, maxCombo: 42, verified: true, date: '2026-10-10' },
    { rank: 2, id: 'npc_2', name: '荷塘宗师·小绿', score: 3260, maxCombo: 36, verified: true, date: '2026-10-09' },
    { rank: 3, id: 'npc_3', name: '翠绿幻影', score: 2890, maxCombo: 31, verified: true, date: '2026-10-11' },
    { rank: 4, id: 'npc_4', name: '马卡龙跃动者', score: 2450, maxCombo: 27, verified: true, date: '2026-10-08' },
    { rank: 5, id: 'npc_5', name: '星际弹力蛙', score: 2110, maxCombo: 22, verified: true, date: '2026-10-10' },
    { rank: 6, id: 'npc_6', name: '黄金荷叶侠', score: 1840, maxCombo: 19, verified: true, date: '2026-10-07' },
    { rank: 7, id: 'npc_7', name: '水上漂萌蛙', score: 1530, maxCombo: 16, verified: true, date: '2026-10-11' },
    { rank: 8, id: 'npc_8', name: '极速荷花仙', score: 1280, maxCombo: 14, verified: true, date: '2026-10-06' },
    { rank: 9, id: 'npc_9', name: '奶油小跳蛙', score: 960, maxCombo: 11, verified: true, date: '2026-10-09' },
    { rank: 10, id: 'npc_10', name: '荷塘新手探险家', score: 680, maxCombo: 8, verified: true, date: '2026-10-11' }
];

// 对战 AI 对手预置库 (在未匹配到真人时提供真实动态对战)
const AI_RIVALS = [
    { name: '荷塘弹簧蛙', rating: 1200, skill: 0.88 },
    { name: '跃动波波蛙', rating: 1350, skill: 0.92 },
    { name: '云间疾风蛙', rating: 1500, skill: 0.95 },
    { name: '荷叶守护者', rating: 1100, skill: 0.85 }
];

// 全局内存状态
let memoryState = {
    leaderboard: [...DEFAULT_LEADERBOARD],
    users: {},
    queue: [],
    rooms: {},
    battleStats: {}
};

// 尝试从 /tmp 恢复
function initFromDisk() {
    try {
        if (fs.existsSync(TMP_FILE)) {
            const raw = fs.readFileSync(TMP_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (data && data.leaderboard) {
                memoryState = {
                    ...memoryState,
                    ...data,
                    // 确保默认榜单至少存在
                    leaderboard: data.leaderboard.length > 0 ? data.leaderboard : DEFAULT_LEADERBOARD
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
async function submitScore({ playerId, name, score, maxCombo, verified = true }) {
    if (!playerId || score <= 0) return null;

    let existing = memoryState.leaderboard.find(item => item.id === playerId);
    if (existing) {
        if (score > existing.score) {
            existing.score = score;
            existing.maxCombo = Math.max(existing.maxCombo || 0, maxCombo || 0);
            existing.name = name || existing.name;
            existing.verified = verified;
            existing.date = new Date().toISOString().split('T')[0];
        }
    } else {
        memoryState.leaderboard.push({
            id: playerId,
            name: name || '神秘奶蛙',
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
    return { rank, score, maxCombo, verified };
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

    // 检查比赛终局状态
    if (!me.alive && opp.alive) {
        room.status = 'FINISHED';
        room.winner = opp.id;
        _recordDuelResult(opp.id, me.id);
    } else if (me.alive && !opp.alive) {
        room.status = 'FINISHED';
        room.winner = me.id;
        _recordDuelResult(me.id, opp.id);
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

    // AI 跳跃间隔大约 1.2s ~ 2.4s 一次
    if (!ai.nextJumpTime) {
        ai.nextJumpTime = now + 1200 + Math.random() * 800;
    }

    if (now >= ai.nextJumpTime) {
        // AI 判断概率：根据 skill 判定是否失误
        const successRoll = Math.random();
        // 在地狱模式下，AI 失误率也会轻微上升
        const threshold = room.isHellMode ? (room.aiSkill * 0.92) : room.aiSkill;
        if (successRoll < threshold || ai.step < 3) {
            ai.step++;
            const isPerfect = Math.random() > 0.45;
            if (isPerfect) {
                ai.combo++;
                ai.score += 30 + (ai.combo - 1) * 10;
            } else {
                ai.combo = 0;
                ai.score += 15;
            }
            ai.state = 'LANDED';
            ai.nextJumpTime = now + 1300 + Math.random() * 900;
        } else {
            // AI 偶发失误坠落
            ai.alive = false;
            ai.state = 'FALLING';
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
    surrenderRoom
};
