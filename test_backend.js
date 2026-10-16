/**
 * 自动化测试后端核心逻辑
 */
const { createPlayerToken, verifyPlayerToken, verifyActionSignature, inspectTelemetryForCheating } = require('./api/_antiCheat');
const authHandler = require('./api/auth');
const leaderboardHandler = require('./api/leaderboard');
const matchHandler = require('./api/match');

function mockReqRes(method, body = {}, headers = {}) {
    const req = {
        method,
        body,
        headers: {
            'content-type': 'application/json',
            ...headers
        }
    };
    let statusCode = 200;
    let resHeaders = {};
    let resData = null;

    const res = {
        setHeader: (k, v) => { resHeaders[k] = v; },
        status: (code) => { statusCode = code; return res; },
        json: (data) => { resData = data; return res; },
        end: () => res
    };

    return { req, res, getResult: () => ({ status: statusCode, data: resData }) };
}

async function runTests() {
    console.log('--- 1. 测试 Token 鉴权与防篡改 ---');
    const token = createPlayerToken({ id: 'frog_123', name: '荷塘小萌蛙' });
    console.log('Generated Token:', token);
    const verified = verifyPlayerToken(token);
    console.log('Verified Token Payload:', verified);
    if (!verified || verified.id !== 'frog_123') throw new Error('Token verification failed');

    console.log('--- 2. 测试反作弊签名校验 ---');
    const crypto = require('crypto');
    const { SERVER_SECRET } = require('./api/_antiCheat');
    const now = Date.now();
    const sigPayload = `frog_123:350:5:${now}:nonce_abc`;
    const sig = crypto.createHmac('sha256', SERVER_SECRET).update(sigPayload).digest('hex');
    const sigValid = verifyActionSignature('frog_123', 350, 5, now, 'nonce_abc', sig);
    console.log('Valid Signature Check:', sigValid);
    if (!sigValid) throw new Error('Signature verification failed');

    console.log('--- 3. 测试反作弊遥测检测 ---');
    const normalRun = inspectTelemetryForCheating({
        score: 350,
        maxCombo: 5,
        jumpCount: 15,
        durationSeconds: 18
    });
    console.log('Normal run check:', normalRun);
    if (!normalRun.passed) throw new Error('Normal run should pass');

    const cheatRun = inspectTelemetryForCheating({
        score: 999999,
        maxCombo: 1,
        jumpCount: 2,
        durationSeconds: 0.5
    });
    console.log('Cheat run check:', cheatRun);
    if (cheatRun.passed) throw new Error('Cheat run should be rejected');

    console.log('--- 4. 测试 Auth API (Guest) ---');
    const { req: authReq, res: authRes, getResult: getAuthRes } = mockReqRes('POST', { action: 'guest' });
    await authHandler(authReq, authRes);
    const authResult = getAuthRes();
    console.log('Auth API Guest Result:', authResult.status, authResult.data.user.name);
    if (!authResult.data.ok || !authResult.data.token) throw new Error('Auth guest failed');

    const playerToken = authResult.data.token;

    console.log('--- 5. 测试 Leaderboard API (GET & POST) ---');
    const { req: lbGetReq, res: lbGetRes, getResult: getLbGetRes } = mockReqRes('GET', {}, { authorization: `Bearer ${playerToken}` });
    await leaderboardHandler(lbGetReq, lbGetRes);
    const lbGetResult = getLbGetRes();
    console.log('Leaderboard Top Count:', lbGetResult.data.leaderboard.length);
    if (!lbGetResult.data.ok || lbGetResult.data.leaderboard.length < 5) throw new Error('Leaderboard fetch failed');

    // POST Score with signature
    const scoreNow = Date.now();
    const userPayload = `${authResult.data.user.id}:420:6:${scoreNow}:n123`;
    const userSig = crypto.createHmac('sha256', SERVER_SECRET).update(userPayload).digest('hex');

    const { req: lbPostReq, res: lbPostRes, getResult: getLbPostRes } = mockReqRes('POST', {
        score: 420,
        maxCombo: 6,
        jumpCount: 16,
        durationSeconds: 22,
        signature: userSig,
        timestamp: scoreNow,
        nonce: 'n123'
    }, {
        authorization: `Bearer ${playerToken}`
    });
    await leaderboardHandler(lbPostReq, lbPostRes);
    const lbPostResult = getLbPostRes();
    console.log('Leaderboard Submit Result:', lbPostResult.status, lbPostResult.data);
    if (!lbPostResult.data.ok || !lbPostResult.data.verified) throw new Error('Leaderboard submit failed');

    console.log('--- 6. 测试 Match API (1v1 Join & Sync) ---');
    const { req: mReq, res: mRes, getResult: getMRes } = mockReqRes('POST', { action: 'join' }, { authorization: `Bearer ${playerToken}` });
    await matchHandler(mReq, mRes);
    const matchResult = getMRes();
    console.log('Match Join Status:', matchResult.data.status);

    console.log('ALL BACKEND MODULE TESTS PASSED WITH 100% SUCCESS!');
}

runTests().catch(err => {
    console.error('Test Failed:', err);
    process.exit(1);
});
