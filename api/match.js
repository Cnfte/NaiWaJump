/**
 * 《奶蛙跳一跳》 - 1v1 多人对战匹配与实时状态同步 API
 * 路由: /api/match
 */

const { verifyPlayerToken } = require('./_antiCheat');
const {
    addToQueue, removeFromQueue, findMatchFor, getRoom, updateRoomState,
    finishRoom, addRoomMessage, surrenderRoom, updateLobbyPresence,
    createDuelInvite, respondDuelInvite, checkInviteStatus, cancelDuelInvite
} = require('./_storage');

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-naiwa-signature');
}

module.exports = async function handler(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace(/^Bearer\s+/i, '');
        const decoded = verifyPlayerToken(token);

        if (!decoded) {
            return res.status(401).json({ ok: false, error: '请先登录获取身份凭证' });
        }

        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { body = {}; }
        }
        body = body || {};

        const { action = 'join', roomId, telemetry = {} } = body;

        // 0. 大厅在线状态心跳与待决战书探测 (无需点击任何按钮，停留在主界面自动待匹配)
        if (action === 'lobby_ping' || action === 'lobby_heartbeat') {
            const lobbyRes = updateLobbyPresence({
                id: decoded.id,
                name: decoded.name,
                avatar: body.avatar || 'frog-green'
            }, body.status || 'IDLE');
            return res.status(200).json(lobbyRes);
        }

        // 0.1 响应对决邀请 (接受或谢绝)
        if (action === 'respond_invite') {
            const resp = respondDuelInvite(body.inviteId, decoded.id, !!body.accept);
            return res.status(200).json(resp);
        }

        // 0.2 检查发出的邀请是否已被对方接受
        if (action === 'check_invite') {
            const check = checkInviteStatus(body.inviteId);
            return res.status(200).json(check);
        }

        // 0.3 取消发出的战书
        if (action === 'cancel_invite') {
            const cancelRes = cancelDuelInvite(body.inviteId, decoded.id);
            return res.status(200).json(cancelRes);
        }

        // 0.4 主动向大厅在线待机玩家发起挑战战书
        if (action === 'invite') {
            const invRes = createDuelInvite({
                id: decoded.id,
                name: decoded.name,
                avatar: body.avatar || 'frog-green'
            }, body.targetPlayerId);
            return res.status(200).json(invRes);
        }

        // 1. 加入排队 (优先撮合队列，其次向大厅待机选手发战书，最后安排 AI)
        if (action === 'join') {
            addToQueue({ id: decoded.id, name: decoded.name });
            const matchResult = findMatchFor(decoded.id);

            if (matchResult) {
                if (matchResult.status === 'INVITED_WAITING') {
                    return res.status(200).json({
                        ok: true,
                        status: 'INVITED_WAITING',
                        inviteId: matchResult.inviteId,
                        targetPlayer: matchResult.targetPlayer,
                        expiresAt: matchResult.expiresAt
                    });
                }
                return res.status(200).json({
                    ok: true,
                    status: 'MATCHED',
                    roomId: matchResult.room.id,
                    seed: matchResult.room.seed,
                    isAi: matchResult.room.isAi,
                    startTime: matchResult.room.startTime,
                    opponent: matchResult.opponent
                });
            }

            return res.status(200).json({
                ok: true,
                status: 'WAITING',
                message: '正在大厅连通可应战选手...'
            });
        }

        // 2. 轮询匹配状态
        if (action === 'poll') {
            const matchResult = findMatchFor(decoded.id);
            if (matchResult) {
                if (matchResult.status === 'INVITED_WAITING') {
                    return res.status(200).json({
                        ok: true,
                        status: 'INVITED_WAITING',
                        inviteId: matchResult.inviteId,
                        targetPlayer: matchResult.targetPlayer,
                        expiresAt: matchResult.expiresAt
                    });
                }
                return res.status(200).json({
                    ok: true,
                    status: 'MATCHED',
                    roomId: matchResult.room.id,
                    seed: matchResult.room.seed,
                    isAi: matchResult.room.isAi,
                    startTime: matchResult.room.startTime,
                    opponent: matchResult.opponent
                });
            }
            return res.status(200).json({
                ok: true,
                status: 'WAITING'
            });
        }

        // 3. 取消排队
        if (action === 'cancel') {
            removeFromQueue(decoded.id);
            return res.status(200).json({ ok: true, status: 'CANCELLED' });
        }

        // 4. 比赛中双向实时遥测状态同步 (Sync)
        if (action === 'sync') {
            if (!roomId) {
                return res.status(400).json({ ok: false, error: '缺少对战房间 ID' });
            }
            const syncResult = updateRoomState(roomId, decoded.id, telemetry);
            if (!syncResult) {
                return res.status(404).json({ ok: false, error: '房间不存在或已解散' });
            }

            return res.status(200).json({
                ok: true,
                roomStatus: syncResult.roomStatus,
                winner: syncResult.winner,
                surrenderedBy: syncResult.surrenderedBy,
                isHellMode: syncResult.isHellMode,
                messages: syncResult.messages,
                opponent: syncResult.opponent,
                serverTime: Date.now()
            });
        }

        // 5. 临时聊天框快速发言 (Chat)
        if (action === 'chat') {
            const { text } = body;
            if (!roomId || !text) {
                return res.status(400).json({ ok: false, error: '缺少房间 ID 或聊天内容' });
            }
            const msg = addRoomMessage(roomId, decoded.id, decoded.name, text);
            return res.status(200).json({ ok: true, message: msg });
        }

        // 6. 局内主动认输投降 (Surrender)
        if (action === 'surrender') {
            if (!roomId) {
                return res.status(400).json({ ok: false, error: '缺少对战房间 ID' });
            }
            const room = surrenderRoom(roomId, decoded.id);
            if (!room) {
                return res.status(404).json({ ok: false, error: '房间不存在' });
            }
            return res.status(200).json({ ok: true, status: 'SURRENDERED', winner: room.winner });
        }

        // 7. 比赛正常结算 (Finish)
        if (action === 'finish') {
            const { winnerId } = body;
            const room = finishRoom(roomId, winnerId);
            return res.status(200).json({
                ok: true,
                status: 'FINISHED',
                winner: winnerId
            });
        }

        return res.status(400).json({ ok: false, error: '未知对战操作' });
    } catch (err) {
        console.error('Match API Error:', err);
        return res.status(500).json({ ok: false, error: '多人匹配对战服务异常' });
    }
};
