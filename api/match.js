/**
 * 《奶蛙跳一跳》 - 1v1 多人对战匹配与实时状态同步 API
 * 路由: /api/match
 */

const { verifyPlayerToken } = require('./_antiCheat');
const { addToQueue, removeFromQueue, findMatchFor, getRoom, updateRoomState, finishRoom, addRoomMessage, surrenderRoom } = require('./_storage');

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

        // 1. 加入排队
        if (action === 'join') {
            addToQueue({ id: decoded.id, name: decoded.name });
            const matchResult = findMatchFor(decoded.id);

            if (matchResult) {
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
                message: '正在匹配实力相当的对手...'
            });
        }

        // 2. 轮询匹配状态
        if (action === 'poll') {
            const matchResult = findMatchFor(decoded.id);
            if (matchResult) {
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
