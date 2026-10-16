# 《奶蛙跳一跳》 GitHub Pages 极速部署指南

本项目是纯静态前端 3D 游戏，无任何后端依赖与编译构建步骤（Zero Build），天然完美支持 **GitHub Pages** 免费静态托管。

仓库已为你打包生成了即开即用的独立压缩包：
- **`naiwa-jump-gh-pages.zip`** (约 23.6 MB，剔除了本地原始开发冗余文件，已预置 `.nojekyll` 与 URL-Safe 音频)

---

## 方式一：直接在 GitHub 网页端上传部署（新手零代码推荐）

1. **新建 GitHub 仓库**：
   - 登录 [GitHub](https://github.com/)，点击右上角 `+` -> **New repository**。
   - 输入仓库名称（例如 `naiwa-jump`），选择 **Public**（公开仓库）。
   - 不要勾选 "Add a README file"（保持空仓库），点击 **Create repository**。

2. **解压并上传文件**：
   - 将本目录下的 **`naiwa-jump-gh-pages.zip`** 解压到任意文件夹。
   - 打开刚创建的 GitHub 仓库页面，点击页面中的 **"uploading an existing file"**（上传现有文件）。
   - 将解压出的全部文件与文件夹（确保包含 `index.html`、`.nojekyll`、`audio/`、`css/`、`js/`、`libs/`、`naiwa.glb`、`model_data.js` 等）**直接拖拽上传**。
   - 页面下方点击绿色 **Commit changes** 按钮提交。

3. **开启 GitHub Pages 服务**：
   - 进入该仓库的 **Settings**（设置）页面。
   - 在左侧菜单找到 **Pages**（代码托管页面）。
   - 在 **Build and deployment** 下方的 **Branch** 选择：
     - 分支：`main`
     - 目录：`/(root)`
   - 点击 **Save**（保存）。
   - 等待 1~2 分钟，页面上方会显示绿色网址：
     `Your site is live at https://<你的用户名>.github.io/<仓库名>/`
   - 点击该链接即可在手机、平板与电脑上直接玩！

---

## 方式二：使用 Git 命令行一键推送部署

如果你本地已安装 Git，可以直接在当前工程目录下推送：

```bash
# 1. 初始化本地仓库
git init

# 2. 添加所有部署文件（.gitignore 已自动为你过滤无用大文件）
git add .

# 3. 提交初始版本
git commit -m "feat: release NAIWA JUMP v1.0 for GitHub Pages"

# 4. 关联远程仓库并推送到 main 分支 (替换为你的 GitHub 仓库地址)
git branch -M main
git remote add origin https://github.com/<你的用户名>/<你的仓库名>.git
git push -u origin main
```

推送完成后，前往 GitHub 仓库 -> **Settings** -> **Pages** -> 选择 `main` 分支根目录 `/(root)` 保存即可。

---

## 关键技术配置说明

1. **`.nojekyll` 文件**：
   GitHub Pages 默认使用 Jekyll 静态生成器，会过滤下划线或特定格式文件。本项目根目录已内置 `.nojekyll` 文件，确保模型文件与音频资源直通加载。

2. **音频路径 URL-Safe 优化**：
   已建立 `audio/` 英文标准映射（`menu_bgm.mp3`、`game_bgm.mp3`、`click_charge.mp3`、`land.mp3`、`fail.mp3`），彻底避免 Linux/CDN 边缘节点因中文路径编码或 `&` 特殊符号引发的 404 问题，同时保留了原始 `音效/` 双向回退。

3. **零 CORS 与离线加载**：
   项目内置 `model_data.js` 与独立 `naiwa.glb`，即使在网络弱网环境下也能秒级解析并启动 3D 场景。
