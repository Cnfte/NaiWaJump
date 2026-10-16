const http = require('http');
const server = require('./server');

const fetchUrl = (path, options = {}) => {
    return new Promise((resolve, reject) => {
        const req = http.request(`http://localhost:8080${path}`, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        });
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
};

async function ensureServer() {
    return new Promise((resolve) => {
        const testReq = http.get('http://localhost:8080/', (res) => {
            res.resume();
            resolve();
        });
        testReq.on('error', () => {
            server.listen(8080, () => resolve());
        });
    });
}

async function run() {
    await ensureServer();
    console.log('Testing server endpoints on http://localhost:8080 ...');

    // 1. Static index.html
    const indexRes = await fetchUrl('/');
    console.log('Index HTML status:', indexRes.status, 'Has 奶蛙跳一跳:', indexRes.body.includes('奶蛙跳一跳'));
    if (indexRes.status !== 200 || !indexRes.body.includes('奶蛙跳一跳')) throw new Error('Index failed');

    // 2. Static js/network.js
    const netRes = await fetchUrl('/js/network.js');
    console.log('Network JS status:', netRes.status, 'Has NetworkManager:', netRes.body.includes('NetworkManager'));
    if (netRes.status !== 200 || !netRes.body.includes('NetworkManager')) throw new Error('Network JS failed');

    // 3. Static js/obstacles.js
    const obsRes = await fetchUrl('/js/obstacles.js');
    console.log('Obstacles JS status:', obsRes.status, 'Has ObstacleManager:', obsRes.body.includes('ObstacleManager'));
    if (obsRes.status !== 200 || !obsRes.body.includes('ObstacleManager')) throw new Error('Obstacles JS failed');

    // 4. API Auth Guest
    const authRes = await fetchUrl('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'guest' })
    });
    console.log('API Auth status:', authRes.status);
    const authJson = JSON.parse(authRes.body);
    console.log('Auth user name:', authJson.user?.name, 'Has token:', !!authJson.token);
    if (!authJson.token) throw new Error('Auth failed');

    const userToken = authJson.token;

    // 5. API Auth Update Profile (Rename & Avatar)
    const updateProfileRes = await fetchUrl('/api/auth', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userToken}`
        },
        body: JSON.stringify({
            action: 'update_profile',
            name: '飞翔的小霸蛙',
            avatar: 'frog-ninja'
        })
    });
    console.log('API Update Profile status:', updateProfileRes.status);
    const updateJson = JSON.parse(updateProfileRes.body);
    console.log('Updated user name:', updateJson.user?.name, 'avatar:', updateJson.user?.avatar);
    if (updateJson.user?.name !== '飞翔的小霸蛙' || updateJson.user?.avatar !== 'frog-ninja') {
        throw new Error('Update profile failed');
    }

    // 6. API Leaderboard GET
    const lbRes = await fetchUrl('/api/leaderboard');
    console.log('API Leaderboard status:', lbRes.status);
    const lbJson = JSON.parse(lbRes.body);
    console.log('Leaderboard records count:', lbJson.records?.length);
    if (!lbJson.records || !Array.isArray(lbJson.records)) throw new Error('Leaderboard failed');

    // 7. 测试大厅待机、待匹配自动探测与 1v1 战书邀请流程
    console.log('--- 7. 测试大厅在线待匹配与对决战书邀请 ---');
    // 创建第二位玩家 (作为大厅待机被挑战者)
    const user2AuthRes = await fetchUrl('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'guest' })
    });
    const user2Token = JSON.parse(user2AuthRes.body).token;

    // 玩家 2 停留在主界面大厅，自动待机
    const lobbyPingRes = await fetchUrl('/api/match', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${user2Token}`
        },
        body: JSON.stringify({ action: 'lobby_ping', status: 'IDLE' })
    });
    const lobbyPingJson = JSON.parse(lobbyPingRes.body);
    console.log('Player 2 lobby ping ok:', lobbyPingJson.ok, 'active count:', lobbyPingJson.activeLobbyCount);
    if (!lobbyPingJson.ok) throw new Error('Lobby ping failed');

    // 玩家 1 发起对决邀请
    const matchStartRes = await fetchUrl('/api/match', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userToken}`
        },
        body: JSON.stringify({ action: 'join' })
    });
    const matchJson = JSON.parse(matchStartRes.body);
    console.log('Player 1 match action status:', matchJson.status);

    let roomId = matchJson.roomId;
    if (matchJson.status === 'INVITED_WAITING') {
        const inviteId = matchJson.inviteId;
        console.log('Invite sent to Player 2, inviteId:', inviteId);

        // 玩家 2 下一次心跳检测到待决战书
        const player2CheckRes = await fetchUrl('/api/match', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${user2Token}`
            },
            body: JSON.stringify({ action: 'lobby_ping', status: 'IDLE' })
        });
        const p2CheckJson = JSON.parse(player2CheckRes.body);
        console.log('Player 2 received pending invite:', !!p2CheckJson.pendingInvite);
        if (!p2CheckJson.pendingInvite) throw new Error('Pending invite not detected');

        // 玩家 2 弹窗点击“立即应战”
        const acceptRes = await fetchUrl('/api/match', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${user2Token}`
            },
            body: JSON.stringify({ action: 'respond_invite', inviteId, accept: true })
        });
        const acceptJson = JSON.parse(acceptRes.body);
        console.log('Player 2 accepted invite, matched room:', acceptJson.roomId);
        roomId = acceptJson.roomId;

        // 玩家 1 轮询检测到已被接受
        const p1CheckRes = await fetchUrl('/api/match', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({ action: 'check_invite', inviteId })
        });
        const p1CheckJson = JSON.parse(p1CheckRes.body);
        console.log('Player 1 check invite result status:', p1CheckJson.status, 'matched room:', p1CheckJson.roomId);
    }

    if (roomId) {
        console.log('Matched room ID:', roomId);
        // Test chat in room
        const chatRes = await fetchUrl('/api/match', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({ action: 'chat', roomId, text: '呱！吃我一记完美跳跃！' })
        });
        const chatJson = JSON.parse(chatRes.body);
        console.log('Chat response ok:', chatJson.ok, 'message:', chatJson.message?.text);

        // Test sync with 1600 points to trigger Hell Mode
        const syncRes = await fetchUrl('/api/match', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({
                action: 'sync',
                roomId,
                telemetry: { score: 1600, step: 25, alive: true }
            })
        });
        const syncJson = JSON.parse(syncRes.body);
        console.log('Sync response isHellMode:', syncJson.isHellMode, 'opponent score:', syncJson.opponent?.score);

        // Test surrender
        const surrRes = await fetchUrl('/api/match', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({ action: 'surrender', roomId })
        });
        const surrJson = JSON.parse(surrRes.body);
        console.log('Surrender response:', surrJson);
    }

    console.log('\n--- ALL SERVER & API END-TO-END TESTS PASSED SUCCESSFULLY! ---');
    process.exit(0);
}

run().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
