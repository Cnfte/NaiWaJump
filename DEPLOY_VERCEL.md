# 《奶蛙跳一跳》(NAIWA JUMP) - Vercel 部署指南与技术架构说明

本项目已成功从纯静态架构升级为 **Three.js 3D 客户端 + Vercel Serverless Functions 云原生架构**。
支持 **1v1 实时多人对战**、**全球防作弊实时排行榜**、**HMAC-SHA256 身份鉴权** 与 **全自动无服务器弹性扩缩容**。

---

## 目录
1. [技术架构总览](#一技术架构总览)
2. [Vercel 部署方法](#二vercel-部署方法)
   - [方法 A：Vercel CLI 一键终端发布 (推荐最快)](#方法-a-vercel-cli-一键终端发布-推荐最快)
   - [方法 B：GitHub 仓库关联自动发布 (持续集成)](#方法-b-github-仓库关联自动发布-持续集成)
3. [环境变量配置说明 (可选高级存储)](#三环境变量配置说明-可选高级存储)
4. [核心功能与反作弊鉴权技术实现](#四核心功能与反作弊鉴权技术实现)
5. [常见部署问题与排错注意事项](#五常见部署问题与排错注意事项)

---

## 一、技术架构总览

```
                        ┌──────────────────────────────────────────────┐
                        │              客户端 (Client Side)              │
                        │  - Three.js 3D 渲染 (奶蛙模型/浮空场景/粒子)   │
                        │  - Web Audio 动作音效与背景音乐引擎           │
                        │  - Web Crypto API 动作链 SHA-256 实时签名      │
                        │  - 确定性 PRNG 随机种 (同台竞技赛道一致性)    │
                        └──────────────────────┬───────────────────────┘
                                               │ HTTP / HTTPS (REST API)
                                               ▼
                        ┌──────────────────────────────────────────────┐
                        │         Vercel Serverless Functions          │
                        │                                              │
                        │  /api/auth        - 匿名游客登录与身份鉴权   │
                        │  /api/leaderboard - 验签上报与全球榜单排名   │
                        │  /api/match       - 1v1 撮合与毫秒状态同步   │
                        │                                              │
                        │  安全防护模块：                              │
                        │  - HMAC-SHA256 Token 签名防伪造              │
                        │  - 单步耗时物理审查 (>=0.35s)               │
                        │  - 抛物线距离与蓄力比校验                   │
                        │  - 单步分值递增上限防溢出                   │
                        └──────────────────────┬───────────────────────┘
                                               │
                        ┌──────────────────────▼───────────────────────┐
                        │               多级持久化存储适配              │
                        │  - 模式 1：零配置 /tmp 文件持久化 + 内存高速  │
                        │  - 模式 2：Vercel KV / Upstash Redis 分布式  │
                        └──────────────────────────────────────────────┘
```

---

## 二、Vercel 部署方法

### 方法 A：Vercel CLI 一键终端发布 (推荐最快)

这是最直接、耗时最短的方式，无需手动配置 Git。

#### 1. 全局安装 Vercel CLI (若未安装)
```bash
npm install -g vercel
```

#### 2. 在项目根目录执行登录与部署
在当前项目目录（包含 `vercel.json`、`index.html`、`api/` 的文件夹）中打开终端运行：
```bash
vercel
```
CLI 将引导你进行确认：
- `Set up and deploy?` 输入 `y`
- `Which scope do you want to deploy to?` 选择你的个人或团队账户
- `Link to existing project?` 输入 `N`
- `What's your project's name?` 默认 `naiwa-jump`（直接回车）
- `In which directory is your code located?` 默认 `./`（直接回车）
- `Want to modify these settings?` 输入 `N`

#### 3. 部署到生产环境域名 (Production)
```bash
vercel --prod
```
控制台将输出你的生产环境 HTTPS 域名，例如：
`https://naiwa-jump.vercel.app`
直接在手机或电脑浏览器中打开即可畅玩多人对战与榜单！

---

### 方法 B：GitHub 仓库关联自动发布 (持续集成)

适合团队协作或长期维护，代码推送后自动部署更新。

#### 1. 将项目推送到 GitHub
在项目根目录下初始化并推送到你的 GitHub 仓库：
```bash
git init
git add .
git commit -m "feat: release Naiwa Jump v2.0 on Vercel"
git branch -M main
git remote add origin https://github.com/<你的用户名>/naiwa-jump.git
git push -u origin main
```

#### 2. 在 Vercel 控制台导入项目
1. 访问 [https://vercel.com/dashboard](https://vercel.com/dashboard) 并登录。
2. 点击右上角 **"Add New..."** -> **"Project"**。
3. 在 GitHub 列表中找到刚才推送的 `naiwa-jump` 仓库，点击 **"Import"**。
4. **Framework Preset** 选择 **"Other"**（原生静态 + Node.js Serverless）。
5. **Root Directory** 保持默认 `./`。
6. 点击 **"Deploy"**。
7. 等待约 30 秒，构建完成后即可获得全球 CDN 加速的访问网址。

---

## 三、环境变量配置说明 (可选高级存储)

本项目原生内置了**零配置自适应持久化方案**：
- 在未配置任何外部云数据库时，后端会自动使用 Node.js 内存与 `/tmp` 容器缓存，预置了全球前十高手战绩，且支持真人匹配与 AI 陪练，**零配置直接可用**。
- 若你希望全球不同地区的多实例 Serverless 节点实现**跨地域实时强一致性**，可在 Vercel 中一键绑定 Upstash Redis 或 Vercel KV：

| 环境变量名 | 说明 | 示例值 |
| :--- | :--- | :--- |
| `KV_REST_API_URL` | Upstash Redis / Vercel KV REST API 地址 | `https://prompt-xxxx.upstash.io` |
| `KV_REST_API_TOKEN` | Upstash Redis / Vercel KV REST 访问令牌 | `AXxxxx...` |
| `NAIWA_SECRET` | 服务端 HMAC-SHA256 签名密钥（防止 Token 伪造） | `任意复杂自定义安全字符串` |

#### 配置方法：
在 Vercel 控制台项目页面 -> **Settings** -> **Environment Variables** 添加上述变量，保存后重新触发一次 Deploy 即可生效。

---

## 四、核心功能与反作弊鉴权技术实现

### 1. 匿名游客鉴权与签名防伪造
- 每个新进入游戏的玩家在未注册前由服务端 `/api/auth` 签发专属 `JWT-like` 凭证（包含 `playerId`、`iat`、`exp`），并由后端秘密密钥进行 `HMAC-SHA256` 验签。
- 玩家在游戏内修改昵称时，需携带有效 Token 请求，杜绝非法冒充。

### 2. 多重动作链反作弊防御
在玩家完成一轮跳跃并提交高分到 `/api/leaderboard` 时，服务端执行以下 4 重安全审计：
1. **防重放随机数审查**：提交必须携带 `timestamp` 与 `nonce`，时间戳超出 120 秒或重复提交即刻作废。
2. **物理抛物线时序审查**：
   - 检查客户端上传的跳跃间隔时长 $\Delta t$。根据 3D 抛物线物理引擎规则，单步落地用时必大于等于 $0.35$ 秒，任何一瞬间生成数百步的作弊脚本直接拦截。
3. **蓄力比与位移相关性判定**：
   - 蓄力比 $r \in [0, 1.0]$，跳跃位移必须满足公式 $d \approx 2.4 + 8.4 \times r$。位移与蓄力严重不符的请求将被标记作弊。
4. **单步得分增量上限**：
   - 即使连续达成 Perfect，单步得分也不会超过物理极值（150 分/步）。

### 3. 1v1 多人对战撮合与低延迟同步
- **确定性 PRNG 随机种同步**：双方匹配成功后，服务端下发全局唯一的确定性随机种子 `seed`（基于 Mulberry32 算法）。双方客户端在本地独立生成的跳跃台阶位置、距离、旋转角度完全一致，保证 100% 竞技公平。
- **3D 幽灵对手实时重现**：通过 `/api/match` 短轮询同步对手的三维坐标 $(x, y, z)$、角色动作、当前台阶与比分。3D 场景中将动态渲染幽灵幻影奶蛙，带有头顶发光铭牌与动态距离指示。
- **智能防死锁撮合机制**：若天梯队列中 2.8 秒内暂未遇到真人玩家，系统会自动调度智能模拟选手加入对局，确保玩家随时随地秒级开局，绝不卡在匹配界面。

---

## 五、常见部署问题与排错注意事项

### 1. 3D 模型在生产环境加载失败或 404？
- 确认项目根目录下存在 `naiwa.glb` 或 `naiwa.zip`。
- 本项目 `js/loader.js` 具备三级兜底智能加载：
  1. 优先请求同级目录下的 `naiwa.glb`；
  2. 若不存在则读取解压 `naiwa.zip`；
  3. 若均被拦截，页面会自动弹出友好指引，支持直接将文件拖拽进网页启动。

### 2. Vercel 构建日志提示 Function Payload Exceeded？
- 本项目后端采用 Node.js 原生标准库编写（`crypto`, `http`, `fs`, `url`），**零外部庞大 npm 依赖**，极速秒级冷启动，构建产物仅几十 KB，永远不会触发 Vercel 体积限制。

### 3. 本地如何一键预览完整前后端功能？
- 推荐使用我们配置的本地完整测试服务：
  ```bash
  npm start
  ```
  或者双击根目录下的 `启动游戏.bat`，将自动在 `http://localhost:8080` 启动与 Vercel 生产环境 100% 一致的 API 仿真服务器。
- 执行完整自动化回归测试：
  ```bash
  npm test
  ```
