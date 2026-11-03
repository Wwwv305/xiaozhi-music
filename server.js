#!/usr/bin/env node
/**
 * xiaozhi-music-railway — Real music MCP WebSocket server (增强版)
 *
 * 基于 teeceetan2-cyber/xiaozhi-music-railway 原版，增强：
 *  - 修复 Railway 健康检查（新增 HTTP /healthz 路由）
 *  - 支持 resource://read_from_http 音频流协议（与方案 A 一致，点了歌才真正播放）
 *  - 新增 play / my_liked / play_liked 工具（一句话点歌、同步“我喜欢的音乐”）
 *
 * 使用 Meting (metowolf/Meting) 从 Netease / Tencent(QQ) / Kugou / Kuwo 搜索并取直链。
 * 协议：MCP JSON-RPC 2.0 over WebSocket。为 Railway 部署设计（env PORT）。
 */
import http from 'http';
import { WebSocketServer } from 'ws';
import Meting from './lib/meting/meting.js';

// ─── 配置 ────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '8765', 10);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_PAGE = 1024 * 1024; // resource/read 单页最大 1MB
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const DONE_B64 = Buffer.from('[DONE]').toString('base64');

// ─── Meting 客户端工厂 ──────────────────────────────────────
function createClient(platform) {
  const meting = new Meting(platform);
  meting.format(true);
  const cookieVar = `METING_${platform.toUpperCase()}_COOKIE`;
  const cookie = process.env[cookieVar] || process.env.METING_COOKIE;
  if (cookie) meting.cookie(cookie);
  return meting;
}

function neteaseRaw(apiObj) {
  const m = new Meting('netease');
  m.format(false);
  const cookie = process.env.METING_NETEASE_COOKIE || process.env.METING_COOKIE;
  if (cookie) m.cookie(cookie);
  return m._exec(apiObj);
}

// ─── 资源链接 / 文本 工具 ───────────────────────────────────
function resourceLink(name, audioUrl) {
  return {
    type: 'resource_link',
    uri: 'resource://read_from_http',
    name: name,
    description: audioUrl,
    mimeType: 'audio/mpeg',
  };
}

// ─── 工具定义 ───────────────────────────────────────────────
const PLATFORMS = ['netease', 'tencent', 'kugou', 'kuwo'];

const TOOLS = [
  {
    name: 'platforms',
    description: '列出支持的音乐平台（netease, tencent, kugou, kuwo）。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => JSON.stringify({ ok: true, data: PLATFORMS.map(p => ({
      code: p,
      name: { netease: '网易云音乐', tencent: 'QQ音乐', kugou: '酷狗音乐', kuwo: '酷我音乐' }[p],
    })) }, null, 2),
  },
  {
    name: 'search',
    description: '在指定平台按关键词搜索歌曲/专辑/歌手。',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORMS, description: '音乐平台' },
        keyword: { type: 'string', description: '搜索关键词（歌名/歌手）' },
        page: { type: 'integer', description: '页码', default: 1 },
        limit: { type: 'integer', description: '每页数量', default: 20 },
      },
      required: ['platform', 'keyword'],
    },
    handler: async (args) => {
      const client = createClient(args.platform);
      const options = {};
      if (args.page) options.page = args.page;
      if (args.limit) options.limit = args.limit;
      const raw = await client.search(args.keyword, options);
      return typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    },
  },
  {
    name: 'song',
    description: '按歌曲 ID 获取歌曲详情。',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORMS, description: '音乐平台' },
        id: { type: 'string', description: '歌曲 ID' },
      },
      required: ['platform', 'id'],
    },
    handler: async (args) => {
      const client = createClient(args.platform);
      const raw = await client.song(args.id);
      return typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    },
  },
  {
    name: 'url',
    description: '按歌曲 ID 获取可播放音频直链，并返回可直接播放的音频资源(ResourceLink)。',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORMS, description: '音乐平台' },
        id: { type: 'string', description: '歌曲 ID' },
        br: { type: 'integer', description: '码率(如 128/320)', default: 320 },
      },
      required: ['platform', 'id'],
    },
    handler: async (args) => {
      const client = createClient(args.platform);
      const raw = await client.url(args.id, args.br || 320);
      const info = (() => { try { return JSON.parse(raw); } catch { return {}; } })();
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
      if (!info.url) {
        return JSON.stringify({ playing: false, reason: '该歌曲无可播放直链（可能下架/版权限制）' });
      }
      return {
        content: [
          { type: 'text', text: JSON.stringify({ playing: true, url: info.url, br: info.br, source: args.platform }) },
          resourceLink(`${args.platform}-${args.id}`, info.url),
        ],
      };
    },
  },
  {
    name: 'album',
    description: '按专辑 ID 获取专辑详情。',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORMS, description: '音乐平台' },
        id: { type: 'string', description: '专辑 ID' },
      },
      required: ['platform', 'id'],
    },
    handler: async (args) => {
      const client = createClient(args.platform);
      const raw = await client.album(args.id);
      return typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    },
  },
  {
    name: 'artist',
    description: '按歌手 ID 获取歌手作品。',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORMS, description: '音乐平台' },
        id: { type: 'string', description: '歌手 ID' },
        limit: { type: 'integer', description: '最大数量', default: 50 },
      },
      required: ['platform', 'id'],
    },
    handler: async (args) => {
      const client = createClient(args.platform);
      const raw = await client.artist(args.id, args.limit || 50);
      return typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    },
  },
  {
    name: 'playlist',
    description: '按歌单 ID 获取歌单详情。',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORMS, description: '音乐平台' },
        id: { type: 'string', description: '歌单 ID' },
      },
      required: ['platform', 'id'],
    },
    handler: async (args) => {
      const client = createClient(args.platform);
      const raw = await client.playlist(args.id);
      return typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    },
  },
  {
    name: 'lyric',
    description: '按歌曲 ID 获取歌词。',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORMS, description: '音乐平台' },
        id: { type: 'string', description: '歌曲 ID' },
      },
      required: ['platform', 'id'],
    },
    handler: async (args) => {
      const client = createClient(args.platform);
      const raw = await client.lyric(args.id);
      return typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    },
  },
  {
    name: 'pic',
    description: '按资源 ID 获取封面图 URL。',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORMS, description: '音乐平台' },
        id: { type: 'string', description: '图片/资源 ID' },
        size: { type: 'integer', description: '图片尺寸(px)', default: 300 },
      },
      required: ['platform', 'id'],
    },
    handler: async (args) => {
      const client = createClient(args.platform);
      const raw = await client.pic(args.id, args.size || 300);
      return typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    },
  },
  {
    name: 'play',
    description: '一句话点歌：搜索关键词→取第一首→返回可播放音频资源(ResourceLink)。优先 netease，可指定 platform。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '歌名或“歌手 歌名”，如“周杰伦 稻香”' },
        platform: { type: 'string', enum: PLATFORMS, description: '音乐平台', default: 'netease' },
        br: { type: 'integer', description: '码率(如 128/320)', default: 320 },
      },
      required: ['keyword'],
    },
    handler: async (args) => {
      const platform = args.platform || 'netease';
      const client = createClient(platform);
      const cookie = process.env[`METING_${platform.toUpperCase()}_COOKIE`] || process.env.METING_COOKIE;
      const songsRaw = await client.search(args.keyword, { limit: 10 });
      let songs = [];
      try { songs = JSON.parse(songsRaw); } catch { songs = []; }
      if (!Array.isArray(songs) || songs.length === 0) {
        return JSON.stringify({ playing: false, reason: `未搜索到「${args.keyword}」相关歌曲` });
      }
      for (const s of songs.slice(0, 6)) {
        const id = s.id || s.url_id;
        if (!id) continue;
        const urlRaw = await (() => {
          const c2 = createClient(platform);
          if (cookie) c2.cookie(cookie);
          return c2.url(id, args.br || 320);
        })();
        let info = {};
        try { info = JSON.parse(urlRaw); } catch { info = {}; }
        if (info.url) {
          const title = s.name || '未知';
          const artist = Array.isArray(s.artist) ? s.artist.join('/') : (s.artist || '');
          return {
            content: [
              { type: 'text', text: JSON.stringify({ playing: true, title, artist, source: platform }) },
              resourceLink(`${platform}-${id}`, info.url),
            ],
          };
        }
      }
      return JSON.stringify({ playing: false, reason: `「${args.keyword}」的候选歌曲均无可播放直链（可能版权限制）` });
    },
  },
  {
    name: 'my_liked',
    description: '获取当前登录网易云账号的「我喜欢的音乐」歌单（需配置 METING_NETEASE_COOKIE）。',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: '返回数量', default: 30 } },
      required: [],
    },
    handler: async (args) => {
      const cookie = process.env.METING_NETEASE_COOKIE || process.env.METING_COOKIE;
      if (!cookie) return JSON.stringify({ ok: false, error: '未配置 METING_NETEASE_COOKIE，无法识别账号（请在 Railway 环境变量里填入网易云 Cookie）' });
      try {
        const accRaw = await neteaseRaw({ method: 'POST', url: 'http://music.163.com/api/user/account/get', body: {}, encode: 'netease_eapi' });
        const acc = JSON.parse(accRaw);
        const uid = acc?.profile?.userId || acc?.account?.id;
        if (!uid) return JSON.stringify({ ok: false, error: '获取账号信息失败（Cookie 可能已失效）' });
        const listRaw = await neteaseRaw({ method: 'POST', url: 'http://music.163.com/api/user/playlist', body: { uid, limit: 1000, offset: 0 }, encode: 'netease_eapi' });
        const list = JSON.parse(listRaw);
        const liked = (list.playlist || []).find(p => p.specialType === 5) || list.playlist?.[0];
        if (!liked) return JSON.stringify({ ok: false, error: '未找到“我喜欢的音乐”歌单' });
        const client = createClient('netease');
        const tracksRaw = await client.playlist(liked.id);
        let tracks = [];
        try { tracks = JSON.parse(tracksRaw); } catch { tracks = []; }
        const limited = (tracks.slice(0, args.limit || 30)).map((t, i) => ({
          index: i + 1, id: t.id, name: t.name, artist: Array.isArray(t.artist) ? t.artist.join('/') : (t.artist || ''), album: t.album,
        }));
        return JSON.stringify({ ok: true, playlistId: liked.id, count: limited.length, songs: limited }, null, 2);
      } catch (e) {
        return JSON.stringify({ ok: false, error: '拉取失败：' + e.message });
      }
    },
  },
  {
    name: 'play_liked',
    description: '随机或按序号播放「我喜欢的音乐」中的一首（需配置 METING_NETEASE_COOKIE）。',
    inputSchema: {
      type: 'object',
      properties: { index: { type: 'integer', description: '第几首(从1开始)，不填则随机' } },
      required: [],
    },
    handler: async (args) => {
      const cookie = process.env.METING_NETEASE_COOKIE || process.env.METING_COOKIE;
      if (!cookie) return JSON.stringify({ playing: false, reason: '未配置 METING_NETEASE_COOKIE' });
      try {
        const accRaw = await neteaseRaw({ method: 'POST', url: 'http://music.163.com/api/user/account/get', body: {}, encode: 'netease_eapi' });
        const acc = JSON.parse(accRaw);
        const uid = acc?.profile?.userId || acc?.account?.id;
        if (!uid) return JSON.stringify({ playing: false, reason: '获取账号失败（Cookie 可能失效）' });
        const listRaw = await neteaseRaw({ method: 'POST', url: 'http://music.163.com/api/user/playlist', body: { uid, limit: 1000, offset: 0 }, encode: 'netease_eapi' });
        const list = JSON.parse(listRaw);
        const liked = (list.playlist || []).find(p => p.specialType === 5) || list.playlist?.[0];
        if (!liked) return JSON.stringify({ playing: false, reason: '未找到“我喜欢的音乐”歌单' });
        const client = createClient('netease');
        const tracksRaw = await client.playlist(liked.id);
        let tracks = [];
        try { tracks = JSON.parse(tracksRaw); } catch { tracks = []; }
        if (!tracks.length) return JSON.stringify({ playing: false, reason: '歌单为空' });
        let pick = tracks[0];
        if (args.index && tracks[args.index - 1]) pick = tracks[args.index - 1];
        else pick = tracks[Math.floor(Math.random() * tracks.length)];
        const id = pick.id;
        const urlClient = createClient('netease');
        const urlRaw = await urlClient.url(id, 320);
        let info = {};
        try { info = JSON.parse(urlRaw); } catch { info = {}; }
        if (!info.url) return JSON.stringify({ playing: false, reason: `「${pick.name}」无可播放直链（版权限制）` });
        const artist = Array.isArray(pick.artist) ? pick.artist.join('/') : (pick.artist || '');
        return {
          content: [
            { type: 'text', text: JSON.stringify({ playing: true, title: pick.name, artist, source: 'netease' }) },
            resourceLink(`netease-${id}`, info.url),
          ],
        };
      } catch (e) {
        return JSON.stringify({ playing: false, reason: '播放失败：' + e.message });
      }
    },
  },
];

// ─── 音频资源流：resource://read_from_http ─────────────────
async function readAudioResource(args) {
  const a = args || {};
  let url = String(a.url || a.uri || '');
  if (!url) return DONE_B64;
  if (!/^https?:\/\//.test(url)) return DONE_B64;
  let start = Math.max(0, parseInt(args.start, 10) || 0);
  let end = parseInt(args.end, 10) || 0;
  if (!end || end <= start) end = start + 100 * 1024;
  end = Math.min(end, start + MAX_PAGE);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const resp = await fetch(url, {
      headers: { Range: `bytes=${start}-${end - 1}`, 'User-Agent': UA, Referer: 'https://music.163.com/' },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (resp.status === 416) return DONE_B64;
    if (resp.status !== 200 && resp.status !== 206) return DONE_B64;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length) return DONE_B64;
    if (resp.status === 200) {
      // 服务端不支持 Range：首段即完整文件；后续请求直接结束，避免死循环
      if (start > 0) return DONE_B64;
      return buf.toString('base64');
    }
    // 206：按页返回
    const page = end - start;
    const data = buf.subarray(0, page);
    return data.toString('base64');
  } catch {
    clearTimeout(timer);
    return DONE_B64;
  }
}

// ─── MCP JSON-RPC 处理 ───────────────────────────────────────
async function handleMessage(data) {
  const { id, method, params = {} } = data;

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: true }, resources: { subscribe: false, listChanged: false } },
            serverInfo: { name: 'xiaozhi-music-railway', version: '1.1.0' },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0', id,
          result: { tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) },
        };

      case 'tools/call': {
        const tool = TOOLS.find(t => t.name === params.name);
        if (!tool) {
          return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${params.name}` } };
        }
        const result = await tool.handler(params.arguments || {});
        if (result && result.content) {
          return { jsonrpc: '2.0', id, result: { content: result.content } };
        }
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] } };
      }

      case 'resources/list':
        return {
          jsonrpc: '2.0', id,
          result: {
            resources: [{
              uri: 'resource://read_from_http',
              name: '音频流代理',
              mimeType: 'audio/mpeg',
              description: '通过 HTTP Range 分页读取远程音频。arguments: {"url":"音频地址","start":0,"end":102400}；末尾返回 base64("[DONE]")。',
            }],
          },
        };

      case 'resources/read': {
        const blob = await readAudioResource(params.arguments || {});
        return {
          jsonrpc: '2.0', id,
          result: { contents: [{ uri: 'resource://read_from_http', mimeType: 'audio/mpeg', blob }] },
        };
      }

      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } };
    }
  } catch (err) {
    console.error(`Error handling ${method}:`, err);
    return { jsonrpc: '2.0', id, error: { code: -32603, message: err.message || 'Internal error' } };
  }
}

// ─── HTTP 服务（含 Railway 健康检查）+ WebSocket ────────────
const httpServer = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ service: 'xiaozhi-music-railway', status: 'ok', platforms: PLATFORMS }));
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  const addr = req.socket.remoteAddress;
  console.log(`[connect] ${addr}`);

  ws.on('message', async (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
      return;
    }
    const response = await handleMessage(data);
    if (response) ws.send(JSON.stringify(response));
  });

  ws.on('close', () => console.log(`[disconnect] ${addr}`));
  ws.on('error', (err) => console.error(`[error] ${addr}:`, err.message));
});

httpServer.listen(PORT, HOST, () => {
  console.log(`[ready] http+ws on ${HOST}:${PORT} | Music MCP Server (Meting)`);
  console.log(`[ready] Platforms: ${PLATFORMS.join(', ')}`);
  console.log(`[ready] NetEase cookie: ${process.env.METING_NETEASE_COOKIE || process.env.METING_COOKIE ? '已配置' : '未配置（VIP 歌曲可能无法播放）'}`);
});
