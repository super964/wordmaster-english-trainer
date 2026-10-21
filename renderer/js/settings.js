'use strict';
/* ================= 设置页 ================= */
const SettingsPage = {
  init() {
    const s = Store.state.settings;

    // AI 接口
    $('#set-base-url').value = s.baseUrl;
    $('#set-api-key').value = s.apiKey;
    $('#set-model').value = s.model;
    $('#set-temperature').value = s.temperature;
    $('#set-max-tokens').value = s.maxTokens;
    $('#set-n-listen').value = s.batchSize.listen;
    $('#set-n-speak').value = s.batchSize.speak;
    $('#set-n-read').value = s.batchSize.read;
    $('#set-n-write').value = s.batchSize.write;

    const saveAI = debounce(() => {
      s.baseUrl = $('#set-base-url').value.trim() || 'https://api.openai.com/v1';
      s.apiKey = $('#set-api-key').value.trim();
      s.model = $('#set-model').value.trim() || 'gpt-4o-mini';
      s.temperature = Math.max(0, Math.min(2, +$('#set-temperature').value || 0.8));
      s.maxTokens = Math.max(500, Math.min(32000, +$('#set-max-tokens').value || 8000));
      s.batchSize.listen = Math.max(3, Math.min(20, +$('#set-n-listen').value || 8));
      s.batchSize.speak = Math.max(3, Math.min(20, +$('#set-n-speak').value || 10));
      s.batchSize.read = Math.max(1, Math.min(8, +$('#set-n-read').value || 3));
      s.batchSize.write = Math.max(3, Math.min(20, +$('#set-n-write').value || 10));
      Store.save();
      App.updateModeBadge();
      ListenPage.updateChips(); ReadPage.updateChips();
    }, 400);
    ['#set-base-url', '#set-api-key', '#set-model', '#set-temperature', '#set-max-tokens',
     '#set-n-listen', '#set-n-speak', '#set-n-read', '#set-n-write']
      .forEach(sel => { $(sel).addEventListener('input', saveAI); });

    // 测试连接
    $('#set-test').onclick = async () => {
      const msg = $('#set-test-msg');
      saveAI();
      msg.textContent = '测试中…';
      $('#set-test').disabled = true;
      try {
        const r = await AI.test();
        msg.textContent = `✅ 连接成功（${r.ms}ms，模型 ${Store.state.settings.model}）`;
      } catch (e) {
        msg.textContent = '❌ ' + e.message;
      } finally {
        $('#set-test').disabled = false;
      }
    };

    // 语音
    $('#set-tts-engine').value = s.ttsEngine;
    $('#set-rate').value = s.rate;
    $('#set-rate-val').textContent = (+s.rate).toFixed(2) + 'x';

    $('#set-tts-engine').onchange = () => {
      s.ttsEngine = $('#set-tts-engine').value;
      Store.save();
      this.refreshVoices();
    };
    $('#set-voice-select').onchange = () => {
      const v = $('#set-voice-select').value;
      const engine = s.ttsEngine;
      if (engine === 'edge') s.edgeVoice = v;
      else if (engine === 'system') s.systemVoice = v;
      else s.aiVoice = v;
      Store.save();
    };
    $('#set-edge-pitch').value = s.edgePitch || 0;
    $('#set-edge-pitch-val').textContent = (s.edgePitch || 0) + '%';
    $('#set-edge-pitch').oninput = () => {
      s.edgePitch = +$('#set-edge-pitch').value;
      $('#set-edge-pitch-val').textContent = s.edgePitch + '%';
      Store.save();
    };
    $('#set-edge-pitch-reset').onclick = () => {
      s.edgePitch = 0;
      $('#set-edge-pitch').value = 0;
      $('#set-edge-pitch-val').textContent = '0%';
      Store.save();
      toast('音调已恢复默认', 'good');
    };
    $('#set-refresh-voices').onclick = async () => {
      const msg = $('#set-voice-msg');
      msg.textContent = '正在刷新音色库…';
      TTS._edgeList = null;
      await this.refreshVoices(true);
      msg.textContent = `已刷新，共 ${TTS._edgeList ? TTS._edgeList.length : 0} 款音色`;
    };
    $('#set-rate').oninput = () => {
      s.rate = +$('#set-rate').value;
      $('#set-rate-val').textContent = s.rate.toFixed(2) + 'x';
      Store.save();
    };
    $('#set-voice-preview').onclick = () => {
      const msg = $('#set-voice-msg');
      msg.textContent = '试听中…';
      TTS.speak('Hello! This is how I will read English for you. Keep practicing every day, and you will make great progress!', {
        rate: s.rate,
        onEnd: () => { msg.textContent = '✅ 试听结束，喜欢就直接用这个音色'; },
        onError: (e) => { msg.textContent = '❌ 失败：' + e.message; }
      });
    };

    // 每日目标
    $('#set-goal-listen').value = s.goals.listen;
    $('#set-goal-speak').value = s.goals.speak;
    $('#set-goal-read').value = s.goals.read;
    $('#set-goal-write').value = s.goals.write;
    const saveGoals = debounce(() => {
      s.goals.listen = Math.max(1, +$('#set-goal-listen').value || 15);
      s.goals.speak = Math.max(1, +$('#set-goal-speak').value || 20);
      s.goals.read = Math.max(1, +$('#set-goal-read').value || 20);
      s.goals.write = Math.max(50, +$('#set-goal-write').value || 300);
      Store.save();
    }, 400);
    ['#set-goal-listen', '#set-goal-speak', '#set-goal-read', '#set-goal-write'].forEach(sel => $(sel).addEventListener('input', saveGoals));

    // 数据
    $('#set-export-json').onclick = async () => {
      const res = await window.api.exportFile({
        content: JSON.stringify(Store.state, null, 2),
        defaultName: `WordMaster备份_${dayKey()}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (res.ok) toast('已导出：' + res.path, 'good');
    };
    $('#set-import-json').onclick = async () => {
      const res = await window.api.importFile({ filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!res.ok) return;
      try {
        const data = JSON.parse(res.content);
        Store.state = Store.merge(Store.defaultState(), data);
        Store.save();
        toast('导入成功，正在刷新…', 'good');
        setTimeout(() => location.reload(), 800);
      } catch (e) { toast('导入失败：文件格式不正确', 'bad'); }
    };
    $('#set-export-csv').onclick = async () => {
      const res = await window.api.exportFile({
        content: Store.toCSV(),
        defaultName: `WordMaster训练记录_${dayKey()}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      });
      if (res.ok) toast('已导出：' + res.path, 'good');
    };
    $('#set-clear').onclick = () => {
      if (!confirm('确定清空所有训练记录、难度数据和学习库吗？（生词本会保留）此操作不可恢复。')) return;
      Store.state.records = [];
      Store.state.diffHistory = [];
      Store.state.library = [];
      for (const k of Object.keys(Store.state.difficulty)) Store.state.difficulty[k] = 30;
      const t = Date.now();
      for (const k of Object.keys(Store.state.difficulty)) Store.state.diffHistory.push({ ts: t, skill: k, v: 30 });
      Store.save();
      toast('已清空训练数据', 'good');
      setTimeout(() => location.reload(), 600);
    };

    this.updateInfo();
    this.refreshVoices();
  },

  /* 精选音色（置顶推荐） */
  FAVORITES: [
    'en-US-AvaMultilingualNeural', 'en-US-EmmaMultilingualNeural', 'en-US-AndrewMultilingualNeural',
    'en-US-BrianMultilingualNeural', 'en-US-AnaNeural', 'en-GB-MaisieNeural',
    'zh-CN-YunxiaNeural', 'zh-CN-XiaoyiNeural', 'zh-CN-liaoning-XiaobeiNeural',
    'zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural', 'zh-CN-YunjianNeural',
    'en-US-JennyNeural', 'en-US-AriaNeural', 'en-US-GuyNeural', 'en-US-RogerNeural',
    'en-GB-SoniaNeural', 'en-GB-RyanNeural'
  ],

  /* 按当前引擎填充音色下拉（Edge 联网拉全量 322 款并智能分组） */
  async refreshVoices(force) {
    const sel = $('#set-voice-select');
    if (!sel) return;
    const s = Store.state.settings;
    const engine = s.ttsEngine || 'system';

    if (engine === 'edge') {
      const list = await this.edgeVoiceList(force);
      this.fillEdgeSelect(sel, list, s.edgeVoice || 'en-US-AvaMultilingualNeural');
      return;
    }
    if (engine === 'system') {
      const html = TTS.voices.length
        ? TTS.voices.map(v => `<option value="${escHtml(v.name)}">${escHtml(v.name)} (${v.lang})</option>`).join('')
        : '<option value="">（未检测到系统语音）</option>';
      sel.innerHTML = html;
      if (s.systemVoice && Array.from(sel.options).some(o => o.value === s.systemVoice)) sel.value = s.systemVoice;
      return;
    }
    sel.innerHTML = AI_VOICES.map(v => `<option value="${v}">${v}</option>`).join('');
    if (s.aiVoice && Array.from(sel.options).some(o => o.value === s.aiVoice)) sel.value = s.aiVoice;
  },

  async edgeVoiceList(force) {
    if (!force && TTS._edgeList && TTS._edgeList.length) return TTS._edgeList;
    try {
      const res = await window.api.edgeVoices(force);
      if (res.ok && res.list && res.list.length) {
        TTS._edgeList = res.list;
        return res.list;
      }
    } catch (e) { console.error('edge voices failed', e); }
    // 兜底：使用内置精选
    return EDGE_VOICES.map(v => ({ id: v.id, gender: '', locale: v.lang, localeName: v.lang, categories: [], personalities: [] }));
  },

  fillEdgeSelect(sel, list, cur) {
    const byId = new Map();
    for (const v of list) if (!byId.has(v.id)) byId.set(v.id, v);

    const fallbackName = (id) => {
      const f = EDGE_VOICES.find(x => x.id === id);
      return f ? f.name : id;
    };
    const label = (v) => {
      const f = EDGE_VOICES.find(x => x.id === v.id);
      const tags = [];
      if ((v.categories || []).some(c => /cartoon/i.test(c))) tags.push('卡通');
      if ((v.personalities || []).some(p => /humorous/i.test(p))) tags.push('幽默');
      if ((v.personalities || []).some(p => /cute/i.test(p))) tags.push('可爱');
      if ((v.personalities || []).some(p => /cheerful|lively/i.test(p))) tags.push('开朗');
      if ((v.personalities || []).some(p => /expressive/i.test(c0(p))) ) tags.push('情感丰富');
      const base = f ? f.name.replace(/^[✨👧👦😂💕]+\s*/, '') : (v.id.replace(/-Neural$/, '').split('-').slice(2).join(' ') || v.id);
      return `${base}（${v.gender || '?'}）${tags.length ? ' · ' + tags.join('/') : ''}`;
    };
    const c0 = (p) => String(p).toLowerCase();

    const used = new Set();
    const opt = (v) => { used.add(v.id); return `<option value="${escHtml(v.id)}">${escHtml(label(v))}</option>`; };
    const wrap = (title, html) => html ? `<optgroup label="${title}">${html}</optgroup>` : '';

    // 1) 精选推荐
    let html = '';
    const favHtml = this.FAVORITES.filter(id => byId.has(id)).map(id => opt(byId.get(id))).join('');
    html += wrap('⭐ 精选推荐（童声 / 幽默 / 情感丰富）', favHtml);

    // 2) 卡通童声
    const kidHtml = list.filter(v => !used.has(v.id) &&
      ((v.categories || []).some(c => /cartoon/i.test(c)) || (v.personalities || []).some(p => /cute/i.test(p))))
      .slice(0, 30).map(opt).join('');
    html += wrap('👧👦 卡通童声', kidHtml);

    // 3) 幽默 / 活泼开朗
    const funHtml = list.filter(v => !used.has(v.id) &&
      ((v.personalities || []).some(p => /humorous|cheerful|lively|bright|passion/i.test(p))))
      .slice(0, 40).map(opt).join('');
    html += wrap('😄 幽默 / 活泼开朗', funHtml);

    // 4) 情感丰富（Copilot / Expressive 系列）
    const emoHtml = list.filter(v => !used.has(v.id) &&
      ((v.personalities || []).some(p => /expressive|caring|warm|comfort|sincere/i.test(p)) ||
       (v.categories || []).some(c => /copilot|conversation/i.test(c))))
      .slice(0, 40).map(opt).join('');
    html += wrap('💕 情感丰富 / 会聊天', emoHtml);

    // 5) 中文
    const zhHtml = list.filter(v => !used.has(v.id) && /^zh-/.test(v.locale)).map(opt).join('');
    html += wrap('🇨🇳 中文（含方言）', zhHtml);

    // 6) 英语
    const enHtml = list.filter(v => !used.has(v.id) && /^en-/.test(v.locale)).map(opt).join('');
    html += wrap('🇬🇧🇺🇸 英语（各国口音）', enHtml);

    // 7) 其他语言按语言分组
    const rest = list.filter(v => !used.has(v.id));
    const byLocale = {};
    for (const v of rest) (byLocale[v.localeName] = byLocale[v.localeName] || []).push(v);
    for (const [loc, vs] of Object.entries(byLocale).slice(0, 60)) {
      html += wrap(loc, vs.slice(0, 15).map(opt).join(''));
    }

    sel.innerHTML = html || `<option value="${escHtml(cur)}">${escHtml(fallbackName(cur))}</option>`;
    if (cur && Array.from(sel.options).some(o => o.value === cur)) sel.value = cur;
    else if (sel.options.length) sel.selectedIndex = 0;
  },

  updateInfo() {
    const el = $('#set-data-info');
    if (!el) return;
    el.textContent = `已记录 ${Store.state.records.length} 条训练数据 · 学习库 ${Store.state.library.length} 条 · 生词 ${Store.state.words.length} 个 · 难度调整 ${Store.state.diffHistory.length} 次`;
  }
};
