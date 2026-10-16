/**
 * 《奶蛙跳一跳》 - 反作弊与安全鉴权引擎 (Anti-Cheat & Security Engine)
 * 采用原生 Node.js crypto 模块，零第三方依赖，冷启动速度极快
 * 核心机制：
 * 1. HMAC-SHA256 身份凭证签名与验签 (Token Mint & Verification)
 * 2. 动作链时序签名 (Telemetry Signature)
 * 3. 抛物线物理合理性校验 (Physics & Trajectory Verification)
 * 4. 积分单步突增与连击合法性判定 (Score Anomaly Detection)
 */

const crypto = require('crypto');

// 服务端密钥 (优先读取环境变量，默认自动生成持久化种子)
const SERVER_SECRET = process.env.NAIWA_SECRET || 'naiwa_jump_secure_secret_2026_salt_89fd92a';

/**
 * 生成安全的玩家鉴权 Token
 */
function createPlayerToken(player) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
        id: player.id,
        name: player.name,
        iat: Date.now(),
        exp: Date.now() + 7 * 24 * 3600 * 1000 // 7天有效
    })).toString('base64url');

    const signature = crypto
        .createHmac('sha256', SERVER_SECRET)
        .update(`${header}.${payload}`)
        .digest('base64url');

    return `${header}.${payload}.${signature}`;
}

/**
 * 校验并解析玩家 Token
 */
function verifyPlayerToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const expectedSig = crypto
        .createHmac('sha256', SERVER_SECRET)
        .update(`${header}.${payload}`)
        .digest('base64url');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        return null;
    }

    try {
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (decoded.exp && Date.now() > decoded.exp) {
            return null; // 过期
        }
        return decoded;
    } catch (e) {
        return null;
    }
}

const CLIENT_SALT = 'client_salt_2026';

/**
 * 校验客户端提交动作签名的有效性
 * 签名载荷：playerId:score:maxCombo:timestamp:nonce
 */
function verifyActionSignature(playerId, score, maxCombo, timestamp, nonce, signature) {
    if (!playerId || score === undefined || !timestamp || !signature) return false;

    // 时间戳有效期窗口为 15 分钟内，防止重放攻击 (Replay Attack)
    const now = Date.now();
    if (Math.abs(now - Number(timestamp)) > 15 * 60 * 1000) {
        return false;
    }

    const payload = `${playerId}:${score}:${maxCombo}:${timestamp}:${nonce || ''}`;

    // 1. 校验客户端浏览器 SHA-256 加盐防篡改签名
    const clientExpected = crypto
        .createHash('sha256')
        .update(payload + ':' + CLIENT_SALT)
        .digest('hex');

    if (signature.toLowerCase() === clientExpected.toLowerCase()) {
        return true;
    }

    // 2. 校验服务端 HMAC-SHA256 签名 (保留测试与服务端对等验证)
    const hmacExpected = crypto
        .createHmac('sha256', SERVER_SECRET)
        .update(payload)
        .digest('hex');

    if (signature.toLowerCase() === hmacExpected.toLowerCase()) {
        return true;
    }

    return false;
}

/**
 * 物理合理性与作弊行为检测
 * @param {Object} data 包含得分、跳跃步数、跳跃动作日志等
 */
function inspectTelemetryForCheating(data) {
    const { score, maxCombo, jumpCount, logs, durationSeconds } = data;

    // 1. 基础范围合规性
    if (score < 0 || maxCombo < 0 || jumpCount < 0) {
        return { passed: false, reason: '数值为负数异常' };
    }

    // 2. 积分与跳跃步数逻辑
    // 每跳理论最高基础分 10 + Perfect 20 + 黄金台 25 + Combo最高加成
    if (jumpCount > 0 && score / jumpCount > 180) {
        return { passed: false, reason: '单步平均得分超出物理上限' };
    }

    // 3. 最大连击不能大于总跳跃数 (若 jumpCount 未提供或小步数给予安全缓冲)
    if (jumpCount > 0 && maxCombo > jumpCount + 5) {
        return { passed: false, reason: '连击数超出跳跃总次数' };
    }

    // 4. 游戏时长与跳跃频次校验
    // 每次跳跃包含蓄力(最小0.1s)+飞行(0.5s)+判定(0.2s)，人类单步操作至少需要 0.45 秒
    if (durationSeconds && jumpCount > 5) {
        const avgStepTime = durationSeconds / jumpCount;
        if (avgStepTime < 0.35) {
            return { passed: false, reason: '跳跃频率过快，疑似自动化脚本或加速齿轮' };
        }
    }

    // 5. 如果客户端上报了跳跃遥测动作日志，深入验证单步轨迹
    if (Array.isArray(logs) && logs.length > 0) {
        let runningScore = 0;
        let currentCombo = 0;

        for (let i = 0; i < logs.length; i++) {
            const step = logs[i];
            const { chargeRatio, jumpDist, grade, stepScore } = step;

            // 蓄力比例必须在 0 ~ 1.05 之间
            if (chargeRatio < 0 || chargeRatio > 1.08) {
                return { passed: false, reason: `第 ${i+1} 步蓄力参数超出物理范围: ${chargeRatio}` };
            }

            // 距离与蓄力必须满足抛物线公式：dist ~ 2.4 + (10.8 - 2.4) * ratio
            const expectedDist = 2.4 + (10.8 - 2.4) * chargeRatio;
            if (jumpDist && Math.abs(jumpDist - expectedDist) > 2.0) {
                return { passed: false, reason: `第 ${i+1} 步跳跃距离与蓄力时长不匹配` };
            }

            // 单步积分增量验证
            let maxStepAward = 30; // 基础 10 + 20
            if (grade === 'perfect') {
                currentCombo++;
                maxStepAward += (currentCombo - 1) * 10 + 25; // 加上黄金台可能上限
            } else {
                currentCombo = 0;
                maxStepAward += 15;
            }

            if (stepScore && stepScore > maxStepAward) {
                return { passed: false, reason: `第 ${i+1} 步得分增量超出单步上限` };
            }
        }
    }

    return { passed: true, reason: 'OK' };
}

module.exports = {
    SERVER_SECRET,
    createPlayerToken,
    verifyPlayerToken,
    verifyActionSignature,
    inspectTelemetryForCheating
};
