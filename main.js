'use strict';
const { app, BrowserWindow, ipcMain, session, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');

/* ---------------- 窗口 ---------------- */
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: '#0f1220',
    title: 'WordMaster · 英语听说读写 AI 训练',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // 把渲染进程的日志转发到终端，方便排查问题
  win.webContents.on('console-message', (...args) => {
    const ev = args[0];
    const msg = (ev && ev.message) ? ev.message : args[1];
    const src = (ev && ev.sourceId) ? `${ev.sourceId}:${ev.line}` : '';
    console.log('[renderer]', msg, src);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ---------------- 麦克风等权限 ---------------- */
function setupPermissions() {
  const allowed = new Set([
    'media', 'mediaKeySystem', 'audioCapture', 'videoCapture',
    'fullscreen', 'clipboard-sanitized-write', 'display-capture'
  ]);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return allowed.has(permission);
  });
}

/* ---------------- 数据持久化 ---------------- */
function dataFile() {
  return path.join(app.getPath('userData'), 'wordmaster-data.json');
}

function loadData() {
  try {
    const p = dataFile();
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    console.error('loadData failed:', e);
    return null;
  }
}

function saveData(json) {
  try {
    const p = dataFile();
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, p);           // 原子写入，避免写一半损坏
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/* ---------------- AI 请求（在主进程发，规避 CORS） ---------------- */
function joinUrl(base, pathName) {
  return String(base || '').replace(/\/+$/, '') + pathName;
}

async function aiChat(_evt, opts) {
  const {
    baseUrl = 'https://api.openai.com/v1',
    apiKey = '',
    model = 'gpt-4o-mini',
    messages = [],
    temperature = 0.8,
    maxTokens = 0,
    timeout = 120000
  } = opts || {};

  if (!apiKey) return { ok: false, error: '未配置 API Key' };

  const doFetch = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const body = { model, messages, temperature, stream: false };
      if (maxTokens > 0) body.max_tokens = maxTokens;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = text;
        try { msg = JSON.parse(text).error?.message || text; } catch (_) {}
        const err = new Error(`接口返回 ${res.status}：${msg}`);
        err.status = res.status;
        throw err;
      }
      const data = JSON.parse(text);
      return {
        ok: true,
        text: data.choices?.[0]?.message?.content ?? '',
        usage: data.usage || null,
        finish: data.choices?.[0]?.finish_reason || ''
      };
    } catch (e) {
      if (e && e.name === 'AbortError') { const err = new Error('请求超时（AI 生成时间过长）'); err.status = 0; throw err; }
      if (e.status) throw e;
      const err = new Error(String(e?.message || e));
      err.status = 0;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  const base = String(baseUrl || '').replace(/\/+$/, '');
  try {
    return await doFetch(base + '/chat/completions');
  } catch (e) {
    // 404 时自动尝试补 /v1
    if (e.status === 404 && !/\/v\d+\s*$/.test(base)) {
      try { return await doFetch(base + '/v1/chat/completions'); }
      catch (e2) { return { ok: false, error: e2.message }; }
    }
    return { ok: false, error: e.message };
  }
}

/* ---------------- Edge 微软神经语音 ---------------- */
const EDGE = {
  TOKEN: '6A5AA1D4EAFF4E9FB37E23D68491D6F4',
  VERSION: '1-143.0.3650.96',
  WSS: 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1',
  offsetMs: 0
};

function edgeGec() {
  const ticks = Math.floor((Date.now() + EDGE.offsetMs) / 1000) + 11644473600;
  const rounded = ticks - (ticks % 300);
  const windowsTicks = rounded * 10000000;
  return crypto.createHash('sha256').update(`${windowsTicks}${EDGE.TOKEN}`).digest('hex').toUpperCase();
}

function edgeTtsOnce({ text, voice, rate, pitch }) {
  return new Promise((resolve, reject) => {
    const connId = crypto.randomUUID().replace(/-/g, '');
    const reqId = crypto.randomBytes(16).toString('hex');
    const url = `${EDGE.WSS}?Ocp-Apim-Subscription-Key=${EDGE.TOKEN}&Sec-MS-GEC=${edgeGec()}&Sec-MS-GEC-Version=${EDGE.VERSION}&ConnectionId=${connId}`;
    const ws = new WebSocket(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold'
      }
    });
    const chunks = [];
    let done = false;
    const finish = (fn, arg) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch (_) {} fn(arg); };
    const timer = setTimeout(() => finish(reject, new Error('Edge 语音合成超时')), 30000);

    ws.on('unexpected-response', (req, res) => {
      const code = res.statusCode;
      const serverDate = res.headers.date;
      req.destroy(); res.destroy();
      const err = new Error(`Edge 语音服务返回 ${code}`);
      err.status = code;
      err.serverDate = serverDate;
      finish(reject, err);
    });

    ws.on('open', () => {
      ws.send('Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n' +
        JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' }, outputFormat: 'audio-24khz-96kbitrate-mono-mp3' } } } }));
      const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const pitchStr = pitch || '+0%';
      const ssml = `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n` +
        `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${voice}"><prosody pitch="${pitchStr}" rate="${rate}" volume="+0%">${esc}</prosody></voice></speak>`;
      ws.send(ssml);
    });

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const s = data.toString();
        if (s.includes('Path:turn.end')) {
          const out = Buffer.concat(chunks);
          if (!out.length) return finish(reject, new Error('Edge 语音无音频返回'));
          finish(resolve, out);
        }
        return;
      }
      const buf = Buffer.from(data);
      const marker = Buffer.from('Path:audio\r\n');
      const idx = buf.indexOf(marker);
      if (idx >= 0) {
        const payload = buf.subarray(idx + marker.length);
        if (payload.length) chunks.push(Buffer.from(payload));
      }
    });

    ws.on('error', (e) => finish(reject, new Error('Edge 语音连接失败：' + e.message)));
  });
}

async function edgeTts(_evt, opts) {
  const { text = '', voice = 'en-US-AriaNeural', rate = '+0%', pitch = '+0%' } = opts || {};
  if (!text.trim()) return { ok: false, error: '文本为空' };
  try {
    const out = await edgeTtsOnce({ text, voice, rate, pitch });
    return { ok: true, data: out };
  } catch (e) {
    // 403 时用服务器时间校准时钟重试一次
    if (e.status === 403 && e.serverDate) {
      EDGE.offsetMs = Date.parse(e.serverDate) - Date.now();
      try {
        const out = await edgeTtsOnce({ text, voice, rate, pitch });
        return { ok: true, data: out };
      } catch (e2) {
        return { ok: false, error: e2.message };
      }
    }
    return { ok: false, error: e.message };
  }
}

/* 获取 Edge 官方音色库（322 款，本地缓存 7 天） */
const VOICES_URL = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${EDGE.TOKEN}`;

function voicesCacheFile() {
  return path.join(app.getPath('userData'), 'edge-voices-cache.json');
}

async function fetchEdgeVoices(_evt, force) {
  const cacheFile = voicesCacheFile();
  try {
    if (!force && fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Date.now() - cached.ts < 7 * 86400000 && Array.isArray(cached.list) && cached.list.length) {
        return { ok: true, list: cached.list, cached: true };
      }
    }
  } catch (_) {}

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(VOICES_URL, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal });
    clearTimeout(timer);
    const raw = JSON.parse(await res.text());
    const list = raw.map(v => ({
      id: v.ShortName,
      gender: v.Gender === 'Female' ? '女' : '男',
      locale: v.Locale,
      localeName: v.LocaleName || v.Locale,
      categories: (v.VoiceTag && v.VoiceTag.ContentCategories) || [],
      personalities: (v.VoiceTag && v.VoiceTag.VoicePersonalities) || []
    }));
    try { fs.writeFileSync(cacheFile, JSON.stringify({ ts: Date.now(), list }), 'utf8'); } catch (_) {}
    return { ok: true, list, cached: false };
  } catch (e) {
    // 网络失败时用旧缓存兜底
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Array.isArray(cached.list) && cached.list.length) return { ok: true, list: cached.list, cached: true };
    } catch (_) {}
    return { ok: false, error: String(e?.message || e), list: [] };
  }
}

/* 免费在线词典（Free Dictionary API，无需 Key） */
async function dictLookup(_evt, word) {
  const w = String(word || '').trim().toLowerCase();
  if (!w || !/^[a-z][a-z' -]{0,60}$/.test(w)) return { ok: false, error: '单词格式不正确' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (res.status === 404) return { ok: false, notFound: true, error: '未收录' };
    if (!res.ok) return { ok: false, error: '词典服务返回 ' + res.status };
    const raw = JSON.parse(await res.text());
    const first = Array.isArray(raw) ? raw[0] : null;
    if (!first) return { ok: false, notFound: true, error: '无结果' };

    // 音标（优先带音频的英音）
    let ipa = '';
    for (const p of (first.phonetics || [])) {
      if (p.text && /en-GB|uk/i.test(p.locale || '') ) { ipa = p.text; break; }
      if (!ipa && p.text) ipa = p.text;
    }

    // 第一条释义：词性 + 定义 + 例句 + 同义词
    let pos = '', def = '', ex = '', syn = [];
    for (const m of (first.meanings || [])) {
      const d = (m.definitions || [])[0];
      if (d && d.definition) {
        pos = m.partOfSpeech || '';
        def = d.definition;
        ex = d.example || '';
        syn = (m.synonyms || []).slice(0, 6);
        if (!syn.length && d.synonyms) syn = (d.synonyms || []).slice(0, 6);
        break;
      }
    }
    if (!def) return { ok: false, error: '未找到释义' };
    return {
      ok: true,
      data: { word: first.word || w, ipa, pos, def: def.slice(0, 400), ex: ex.slice(0, 240), syn, ts: Date.now() }
    };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: String(e?.message || e) };
  }
}

/* AI 语音合成（OpenAI 兼容 /audio/speech） */
async function aiTts(_evt, opts) {
  const {
    baseUrl = 'https://api.openai.com/v1',
    apiKey = '',
    model = 'tts-1',
    voice = 'alloy',
    input = '',
    speed = 1.0
  } = opts || {};
  if (!apiKey) return { ok: false, error: '未配置 API Key' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(joinUrl(baseUrl, '/audio/speech'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ model, voice, input, speed, response_format: 'mp3' }),
      signal: controller.signal
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, error: `TTS 返回 ${res.status}：${t.slice(0, 300)}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, data: buf };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- 导出 / 导入 ---------------- */
async function exportFile(_evt, { content, defaultName, filters }) {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), defaultName || 'export.txt'),
    filters: filters || [{ name: '所有文件', extensions: ['*'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(r.filePath, content, 'utf8');
  return { ok: true, path: r.filePath };
}

async function importFile(_evt, { filters }) {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: filters || [{ name: 'JSON', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const content = fs.readFileSync(r.filePaths[0], 'utf8');
  return { ok: true, content, path: r.filePaths[0] };
}

/* ---------------- 注册 IPC ---------------- */
ipcMain.handle('ai:chat', aiChat);
ipcMain.handle('ai:tts', aiTts);
ipcMain.handle('edge:tts', edgeTts);
ipcMain.handle('edge:voices', fetchEdgeVoices);
ipcMain.handle('dict:lookup', dictLookup);
ipcMain.handle('data:load', () => ({ ok: true, json: loadData() }));
ipcMain.handle('data:save', (_e, json) => saveData(json));
ipcMain.handle('file:export', exportFile);
ipcMain.handle('file:import', importFile);
ipcMain.handle('app:info', () => ({
  versions: process.versions,
  userData: app.getPath('userData'),
  platform: process.platform
}));

/* ---------------- 启动 ---------------- */
app.whenReady().then(() => {
  setupPermissions();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
