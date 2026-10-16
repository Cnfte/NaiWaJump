/**
 * 《奶蛙跳一跳》 - 本地开发与全功能测试服务端
 * 提供纯静态文件分发 + /api/* Serverless 接口本地对齐仿真
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8080;

// 动态路由对应 api/ 目录下的 Serverless 处理函数
const API_ROUTES = {
    '/api/auth': require('./api/auth'),
    '/api/leaderboard': require('./api/leaderboard'),
    '/api/match': require('./api/match')
};

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.mp3': 'audio/mpeg',
    '.glb': 'model/gltf-binary',
    '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:8080'}`);
    const pathname = parsedUrl.pathname;
    const query = Object.fromEntries(parsedUrl.searchParams.entries());

    // 1. API 路由仿真
    for (const [route, handler] of Object.entries(API_ROUTES)) {
        if (pathname === route || pathname.startsWith(route + '/')) {
            // 解析 body
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                req.query = query;
                try {
                    req.body = body ? JSON.parse(body) : {};
                } catch (e) {
                    req.body = body;
                }

                // 包装 res.status 和 res.json
                res.status = function (code) {
                    res.statusCode = code;
                    return res;
                };
                res.json = function (data) {
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(data));
                };

                try {
                    await handler(req, res);
                } catch (err) {
                    console.error('API Error:', err);
                    res.statusCode = 500;
                    res.end(JSON.stringify({ ok: false, error: 'Internal Server Error' }));
                }
            });
            return;
        }
    }

    // 2. 静态资源托管 (优先查找 public/ 目录，兼容根目录)
    let cleanPath = decodeURIComponent(pathname);
    let filePath = path.join(__dirname, 'public', cleanPath);
    if (cleanPath === '/' || cleanPath === '') {
        filePath = path.join(__dirname, 'public', 'index.html');
    }
    if (!fs.existsSync(filePath)) {
        filePath = path.join(__dirname, cleanPath);
        if (cleanPath === '/' || cleanPath === '') {
            filePath = path.join(__dirname, 'index.html');
        }
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Cache-Control', 'no-cache');

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    });
});

if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`[NAIWA JUMP] Server running at http://localhost:${PORT}`);
        console.log(`[NAIWA JUMP] Serverless APIs ready: /api/auth, /api/leaderboard, /api/match`);
    });
}

module.exports = server;
