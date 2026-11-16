# 部署说明（让别人在你关机时也能访问）

本地 `http://127.0.0.1:5173` 只能自己用。要让别人随时访问，必须放到一台 24 小时在线的公网主机上。

本项目**零依赖**（只用 node: 内置模块）、前端全相对路径、端口读 `process.env.PORT`、
`package.json` 已含 `"start": "node server/index.js"`、`engines >= 18`，所以**不需要改任何代码**即可托管。

---

## 方案 A（推荐）：Gitee 网页上传 + Render 免费托管

不用 GitHub，不用 git 命令，不用信用卡，自带 https。

### 1. 建 Gitee 仓库
- 打开 gitee.com 注册（手机号或邮箱）。
- 右上角「+」→ 新建仓库：名称 `fandian`，选「公开」，**不要**勾选「使用 Readme 初始化」（保持空仓库）。

### 2. 上传文件
仓库页 → 「上传文件」→ 把下面这些**整个文件夹拖进去**（网页支持拖目录）：

    server/                （6 个 .js：index.js config.js places.js amap.js mock.js route.js）
    public/                （index.html + css/ + js/）
    package.json
    render.yaml            （可选）

- **绝对不要上传 `config.json`**：里面有你的高德 Key（本仓库已用 .gitignore 忽略）。
- 上传后确认仓库根目录能同时看到 `server`、`public`、`package.json`。

### 3. Render 建服务
- 打开 render.com → 用邮箱注册（无需绑卡）。
- New → **Web Service** → 拉到最下面选「Public Git repository」→ 填
  `https://gitee.com/你的用户名/fandian.git`
- 参数：
  - Runtime：`Node`
  - Build Command：`npm install`
  - Start Command：`npm start`
  - Region：`Singapore`
  - Instance Type：`Free`
- Environment（可选）：要接真实高德门店就加 `AMAP_WEB_KEY`（Value 填你的「Web服务」Key）；
  不加则走演示数据，功能完整。
- Create Web Service，等 1–2 分钟。

### 4. 拿到网址
形如 `https://fandian-xxxx.onrender.com`。这个网址发给任何人，**你电脑关机也能打开**。

### 5. 验收（部署完成后逐条确认）
- `https://你的域名/api/health` → `{"ok":true,"mode":"mock"}`（配了 Key 则为 `"amap"`）
- `https://你的域名/api/places?lng=121.4737&lat=31.2304&radius=3000` → `"count": 20`
- 手机打开首页 → 地图区显示 SVG 相对方位图（无 JS Key 时）→ 列表有 20 家 → 搜「火锅」只剩 1 家

### 注意
- 免费实例 **15 分钟无访问会休眠**，别人首次打开需等约 30 秒冷启动；想常热需付费实例（约 $7/月）或换方案 B/C。
- 手机浏览器只有在 **https** 下才给定位权限；Render 自带 https，所以「用我的位置」可用。
- 公开后高德 Key 会消耗免费额度（个人认证 5000 次/日）。不想冒险就先不配 Key（演示数据）。
- 若担心被随意访问，可在 Render 上加 `BASIC_AUTH` 之类的反代策略（本项目未内置鉴权，需要另加，属新需求）。

---

## 方案 B：Fly.io（不用任何仓库，命令行直传）

适合愿意装命令行工具的人；注册需绑信用卡（免费额度内不扣费）。

    # 一次性安装（Windows，解开即用）
    # https://fly.io/docs/flyctl/install/
    fly auth signup
    cd D:\大肥鱼办公区\fandian
    fly launch --name fandian-demo --region hkg --no-deploy
    fly deploy

生成 `https://fandian-demo.fly.dev`。需要 Dockerfile（可让我补）。

## 方案 C：轻量云服务器（最可控，需付费）

阿里云/腾讯云轻量 → 选**香港/新加坡**（免备案）→ Ubuntu 22.04 → 部署：

    # 服务器上
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
    mkdir -p /srv/fandian && cd /srv/fandian
    # 本机上传（PowerShell 执行）
    # scp -r D:\大肥鱼办公区\fandian\* root@服务器IP:/srv/fandian/
    PORT=80 node server/index.js

长期常驻用 systemd 或 pm2；要域名 + https 用 Caddy/Nginx（大陆节点域名需备案）。

---

## 不适用的情况
- **内网穿透（ngrok / frp / cpolar）**：你关机就断，不满足本需求。
- **纯静态托管（Vercel/Netlify 静态）**：本项目有服务端接口（/api/*、高德 Key 必须留在服务端），纯静态跑不起来。

---

## 方案 D（已实际落地）：阿里云函数计算 FC · Web 函数

线上地址：`https://fandian-hqkefcnfxg.cn-hangzhou.fcapp.run`（华东1 杭州，免备案，自带 https，访客无需代理）

### 控制台关键取值（照抄即可）

| 项 | 值 | 填错的后果 |
|---|---|---|
| 函数类型 | Web 函数 | 选事件函数，HTTP 服务起不来 |
| 运行环境 | Node.js 20 | — |
| 代码上传 | ZIP 包（`fandian-deploy.zip`） | 用「示例代码」会覆盖你的包 |
| 启动命令 | `node server/index.js` | — |
| 监听端口 | `9000` | 与 `PORT` 不一致会一直健康检查失败 |
| 环境变量 `PORT` | `9000` | 同上 |
| 环境变量 `TZ` | `Asia/Shanghai` | **不加则容器按 UTC 算时间**，「只看营业中」会全部显示营业中 |
| 触发器 | HTTP，认证方式 **无需认证** | 选签名认证别人打不开；每个函数只能有 1 个 HTTP 触发器 |
| 最小实例数 | `0` | 填 1 会按小时持续计费 |

### 踩过的坑（实测）

- **时区**：`TZ` 未设时 `openNow` 结果从「5/20」变成「20/20」——UTC 比北京时间慢 8 小时，凌晨会被算成傍晚。填了 `Asia/Shanghai` 才正确，可用 `node check-deploy.mjs <网址>` 的「时区生效」一项验证。
- **重复建触发器**：函数创建时自带一条 HTTP 触发器，再点新建会被拒（每函数上限 1 条）。去「触发器」页签核对认证方式即可。
- **静态 MIME**：务必确认 `/js/app.js` 返回 `application/javascript` 而非 `text/html`，否则浏览器不执行脚本、页面全白。`check-deploy.mjs` 有专门一项检查。

### 上线后如何自查

```
双击 fandian\验收网址.cmd        （或 node check-deploy.mjs https://你的域名）
```

10 项检查：首页 / 中文编码 / health / 20 家门店 / 时区 / JS MIME / CSS MIME / 深色主题 / 路径穿越 / 路径规划。全绿即可放心发人。