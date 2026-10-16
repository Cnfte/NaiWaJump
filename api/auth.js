/**
 * 《奶蛙跳一跳》 - 玩家身份鉴权与安全登录 API (Serverless Handler)
 * 路由: /api/auth
 */

const { createPlayerToken, verifyPlayerToken } = require('./_antiCheat');
const { getOrCreateUser, updateUserName, updateUserProfile } = require('./_storage');

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
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { body = {}; }
        }
        body = body || {};

        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace(/^Bearer\s+/i, '');

        // 1. GET 请求：凭证校验并返回完整选手档案
        if (req.method === 'GET') {
            if (!token) {
                return res.status(401).json({ ok: false, error: '未提供凭证 Token' });
            }
            const decoded = verifyPlayerToken(token);
            if (!decoded) {
                return res.status(401).json({ ok: false, error: '凭证无效或已过期' });
            }
            const user = await getOrCreateUser(decoded.id, decoded.name);
            return res.status(200).json({ ok: true, user, verified: true });
        }

        // 2. POST 请求：登录 / 匿名游客 / 更改名片与头像
        const { action = 'guest', username, avatar, title, playerId } = body;

        if (action === 'guest') {
            const newId = playerId || 'frog_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
            const frogAdjectives = ['元气', '呆萌', '敏捷', '疾风', '蹦跳', '抹茶', '荷塘', '奶油', '水上漂', '弹簧'];
            const randomAdj = frogAdjectives[Math.floor(Math.random() * frogAdjectives.length)];
            const defaultName = username || `${randomAdj}小奶蛙#${Math.floor(1000 + Math.random() * 9000)}`;

            const user = await getOrCreateUser(newId, defaultName, avatar || 'frog-green');
            const userToken = createPlayerToken({ id: user.id, name: user.name });

            return res.status(200).json({
                ok: true,
                user,
                token: userToken,
                isGuest: true
            });
        }

        if (action === 'rename' || action === 'update_profile') {
            const decoded = verifyPlayerToken(token);
            if (!decoded) {
                return res.status(401).json({ ok: false, error: '修改选手资料需要有效凭证' });
            }
            const updates = {};
            const rawName = body.name || body.username || username;
            if (rawName && typeof rawName === 'string') {
                const safeName = rawName.trim().slice(0, 16);
                if (safeName) updates.name = safeName;
            }
            if (avatar && typeof avatar === 'string') {
                updates.avatar = avatar;
            }
            if (title && typeof title === 'string') {
                updates.title = title;
            }

            const updated = await updateUserProfile(decoded.id, updates);
            const newToken = createPlayerToken({ id: decoded.id, name: updated.name });
            return res.status(200).json({ ok: true, user: updated, token: newToken });
        }

        return res.status(400).json({ ok: false, error: '未知操作类型' });
    } catch (err) {
        console.error('Auth API Error:', err);
        return res.status(500).json({ ok: false, error: '服务器鉴权服务异常' });
    }
};
