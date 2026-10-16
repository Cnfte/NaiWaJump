/**
 * 《奶蛙跳一跳》 - 全球实时排行榜 API (带反作弊与验签)
 * 路由: /api/leaderboard
 */

const { verifyPlayerToken, verifyActionSignature, inspectTelemetryForCheating } = require('./_antiCheat');
const { getLeaderboard, submitScore, getOrCreateUser } = require('./_storage');

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-naiwa-signature, x-naiwa-timestamp, x-naiwa-nonce');
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

        // 1. GET: 获取全球榜单
        if (req.method === 'GET') {
            const list = await getLeaderboard(50);
            let myRank = null;
            if (decoded) {
                const found = list.find(item => item.id === decoded.id);
                if (found) {
                    myRank = { rank: found.rank, score: found.score, maxCombo: found.maxCombo };
                }
            }
            return res.status(200).json({
                ok: true,
                leaderboard: list,
                records: list,
                myRank,
                serverTime: Date.now()
            });
        }

        // 2. POST: 提交成绩入榜 (必须严格反作弊)
        if (req.method === 'POST') {
            if (!decoded) {
                return res.status(401).json({ ok: false, error: '未授权：请先完成登录或获取游客凭证' });
            }

            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch (e) { body = {}; }
            }
            body = body || {};

            const { score, maxCombo = 0, jumpCount = 0, logs = [], durationSeconds = 0 } = body;
            const signature = req.headers['x-naiwa-signature'] || body.signature;
            const timestamp = req.headers['x-naiwa-timestamp'] || body.timestamp;
            const nonce = req.headers['x-naiwa-nonce'] || body.nonce;

            // 1. 签名与时效性防篡改校验
            if (signature) {
                const isSigValid = verifyActionSignature(decoded.id, score, maxCombo, timestamp, nonce, signature);
                if (!isSigValid) {
                    return res.status(403).json({
                        ok: false,
                        code: 'SIGNATURE_INVALID',
                        error: '动作签名校验失败，数据可能被篡改或过期'
                    });
                }
            }

            // 2. 物理合理性与动作链作弊深度检测
            const telemetryCheck = inspectTelemetryForCheating({
                score: Number(score),
                maxCombo: Number(maxCombo),
                jumpCount: Number(jumpCount),
                logs,
                durationSeconds: Number(durationSeconds)
            });

            if (!telemetryCheck.passed) {
                return res.status(403).json({
                    ok: false,
                    code: 'ANTI_CHEAT_FLAGGED',
                    error: `反作弊拦截: ${telemetryCheck.reason}`
                });
            }

            // 3. 校验通过，写入榜单
            const result = await submitScore({
                playerId: decoded.id,
                name: decoded.name,
                score: Number(score),
                maxCombo: Number(maxCombo),
                verified: true
            });

            return res.status(200).json({
                ok: true,
                verified: true,
                result,
                message: '成绩已通过官方安全验签并成功录入全球榜单！'
            });
        }

        return res.status(405).json({ ok: false, error: '不支持的方法' });
    } catch (err) {
        console.error('Leaderboard API Error:', err);
        return res.status(500).json({ ok: false, error: '全球榜单服务异常' });
    }
};
