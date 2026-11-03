# xiaozhi-music-railway（增强版）

小智 AI 的**真实音乐 MCP 服务**（WebSocket），对接 Meting，支持网易云/QQ/酷狗/酷我多平台搜索与取直链，部署到 Railway 后**本机无需常开**，小智随时能点歌。

> 本版基于 `teeceetan2-cyber/xiaozhi-music-railway` 增强：
> - 修复 Railway 健康检查（`/healthz` 路由，否则会被判不健康反复重启）
> - 支持 `resource://read_from_http` 音频流协议（与本地方案 A 一致，点了歌才真正播放）
> - 新增 `play`（一句话点歌）、`my_liked`（列出“我喜欢的音乐”）、`play_liked`（随机播我喜欢的一首）

## 支持平台
- **Netease** 网易云音乐
- **Tencent** QQ音乐
- **Kugou** 酷狗音乐
- **Kuwo** 酷我音乐

## MCP 工具
| 工具 | 说明 |
|------|------|
| `platforms` | 列出支持的平台 |
| `search` | 按关键词搜索歌曲/专辑/歌手 |
| `song` | 按 ID 获取歌曲详情 |
| `url` | 获取可播放直链（同时返回可播放音频资源） |
| `album` | 获取专辑详情 |
| `artist` | 获取歌手作品 |
| `playlist` | 获取歌单详情 |
| `lyric` | 获取歌词 |
| `pic` | 获取封面图 |
| **`play`** | 一句话点歌：搜索→取第一首→返回可播放音频（推荐日常用这个） |
| **`my_liked`** | 列出当前登录网易云账号「我喜欢的音乐」歌单（需 Cookie） |
| **`play_liked`** | 随机播放「我喜欢的音乐」中的一首（需 Cookie） |

## 部署到 Railway（本机不用常开）

1. 把本仓库推到你自己的 GitHub（Fork 原仓库，或直接用本目录内容新建仓库）。
2. 打开 [Railway.app](https://railway.app) → New Project → Deploy from GitHub repo。
3. Railway 自动识别 Node.js 并部署（`railway.json` 已配置 NIXPACKS 构建 + `node server.js` 启动）。
4. 部署完成后，进入项目 **Settings → Domains**，复制生成的域名，形如：
   ```
   wss://你的项目.up.railway.app
   ```
5. 在 Railway 项目的 **Variables** 里按需填入环境变量（见下）。
6. 回到小智控制台，把 MCP 配置改为：
   ```json
   {
     "endpoint": "wss://你的项目.up.railway.app"
   }
   ```

> Railway 免费额度通常每月 500 小时，足够 24h 常驻；免费计划自带 HTTPS 域名。

## 环境变量（Variables）

| 变量 | 说明 |
|------|------|
| `METING_NETEASE_COOKIE` | 网易云登录 Cookie（**解锁 VIP/付费歌、高码率**，必填才有会员曲库） |
| `METING_TENCENT_COOKIE` | QQ音乐 Cookie（可选） |
| `METING_KUGOU_COOKIE` | 酷狗 Cookie（可选） |
| `METING_KUWO_COOKIE` | 酷我 Cookie（可选） |
| `METING_COOKIE` | 兜底 Cookie（所有平台共用，可选） |

> 不需要任何账号密码，只用 Cookie。

## 获取网易云 Cookie（会员专用）
1. 电脑浏览器打开 [music.163.com](https://music.163.com) 并**登录你的会员账号**。
2. 按 `F12` 打开开发者工具 → Network（网络）标签。
3. 随便点一首歌/刷新页面，在请求列表里找一个发往 `music.163.com` 的请求。
4. 看该请求的 **Request Headers（请求头）** → 复制整段 `Cookie:` 的值（里面要含 `MUSIC_U=...` 那段）。
5. 把这段粘贴到 Railway 的 `METING_NETEASE_COOKIE` 变量里，重新部署/重启服务。

> 注意：Cookie 有有效期，失效后会员歌会播不了，重新按上面步骤复制新的 Cookie 即可。

## 小智角色提示词（建议粘贴）
在 xiaozhi.me 控制台「配置角色」追加：
```
## 音乐播放能力
你可以通过 MCP 工具播放音乐：
1. 用户点歌时说“播放xxx/来一首xxx”，调用 play 工具，关键词给歌名或“歌手 歌名”。
2. 用户说“播放我喜欢的歌/随机来首我喜欢的”，调用 play_liked 工具。
3. play / play_liked / url 工具返回的是可播放音频，直接播放，不要向用户复述长地址。
4. 播放失败（版权限制）就换一首或换平台再试。
回答要简短口语化，像朋友聊天。
```

## 本地调试
```bash
npm install
PORT=8765 node server.js
# 另开终端用任意 WebSocket 客户端连 ws://127.0.0.1:8765 发 initialize / tools/list 测试
```
