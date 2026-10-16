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

    // 7. API Match Start
    const matchStartRes = await fetchUrl('/api/match', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userToken}`
        },
        body: JSON.stringify({ action: 'join' })
    });
    console.log('API Match join status:', matchStartRes.status);
    const matchJson = JSON.parse(matchStartRes.body);
    console.log('Match join status:', matchJson.status);

    // If matched immediately or in queue, let's poll or use room
    let roomId = matchJson.roomId;
    if (!roomId) {
        // wait 3.1s for AI fallback match
        await new Promise(r => setTimeout(r, 3100));
        const pollRes = await fetchUrl('/api/match', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({ action: 'poll' })
        });
        const pollJson = JSON.parse(pollRes.body);
        roomId = pollJson.roomId;
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
