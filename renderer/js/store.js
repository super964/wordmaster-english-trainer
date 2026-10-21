'use strict';
/* ================= 数据存储（IPC 落盘 + 内存态） ================= */
const Store = {
  state: null,
  MAX_RECORDS: 20000,

  defaultState() {
    return {
      version: 1,
      settings: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o-mini',
        temperature: 0.8,
        maxTokens: 8000,
        batchSize: { listen: 8, speak: 10, read: 3, write: 10 },
        theme: 'light',
        ttsEngine: 'edge',
        systemVoice: '',
        edgeVoice: 'en-US-AvaMultilingualNeural',
        edgePitch: 0,
        aiVoice: 'alloy',
        aiTtsModel: 'tts-1',
        rate: 0.9,
        fontScale: 1,
        readFontSize: 19,
        goals: { listen: 15, speak: 20, read: 20, write: 300 }
      },
      difficulty: { listen: 30, read: 30, speak: 30, write: 30 },
      records: [],        // {ts, skill, type, sec, count, chars, words, level, note}
      diffHistory: [],    // {ts, skill, v}
      library: [],        // 学习库：{id, skill, ts, title, en, zh, level}
      words: [],          // 生词本：{id, word, meaning, sentence, sentenceZh, source, ts, box, due, lapses, last}
      phonics: {},        // 字母音标 AI 例词缓存：{'字母:A': {words:[{en,zh}], ts}}
      dict: { entries: {}, themes: {}, queries: {}, history: [] }  // 词典缓存与搜索历史
    };
  },

  MAX_LIBRARY: 5000,

  /* 艾宾浩斯遗忘曲线复习间隔（天）：第 1/2/4/7/15/30 天 */
  VOCAB_INTERVALS: [1, 2, 4, 7, 15, 30],

  async load() {
    let saved = null;
    try {
      const res = await window.api.loadData();
      if (res && res.ok && res.json) saved = JSON.parse(res.json);
    } catch (e) { console.error('load data failed', e); }

    const def = this.defaultState();
    this.state = saved ? this.merge(def, saved) : def;
    // 老版本迁移：启用 Edge 神经语音
    if (saved && (!saved.settings || saved.settings.edgeVoice === undefined)) {
      this.state.settings.ttsEngine = 'edge';
      this.state.settings.edgeVoice = 'en-US-AriaNeural';
    }
    // 难度历史初始值
    if (!this.state.diffHistory.length) {
      const t = Date.now() - 86400000 * 30;
      for (const k of Object.keys(this.state.difficulty)) {
        this.state.diffHistory.push({ ts: t, skill: k, v: this.state.difficulty[k] });
      }
    }
    if (!Array.isArray(this.state.library)) this.state.library = [];
    return this.state;
  },

  merge(def, saved) {
    const out = Object.assign({}, def, saved);
    out.settings = Object.assign({}, def.settings, saved.settings || {});
    out.settings.batchSize = Object.assign({}, def.settings.batchSize, (saved.settings || {}).batchSize || {});
    out.settings.goals = Object.assign({}, def.settings.goals, (saved.settings || {}).goals || {});
    out.difficulty = Object.assign({}, def.difficulty, saved.difficulty || {});
    out.records = Array.isArray(saved.records) ? saved.records : [];
    out.diffHistory = Array.isArray(saved.diffHistory) ? saved.diffHistory : [];
    out.library = Array.isArray(saved.library) ? saved.library : [];
    out.words = Array.isArray(saved.words) ? saved.words : [];
    out.phonics = (saved.phonics && typeof saved.phonics === 'object') ? saved.phonics : {};
    out.dict = Object.assign({ entries: {}, themes: {}, queries: {}, history: [] }, saved.dict || {});
    out.dict.entries = saved.dict && saved.dict.entries ? saved.dict.entries : {};
    out.dict.themes = saved.dict && saved.dict.themes ? saved.dict.themes : {};
    out.dict.queries = saved.dict && saved.dict.queries ? saved.dict.queries : {};
    out.dict.history = Array.isArray(saved.dict && saved.dict.history) ? saved.dict.history : [];
    return out;
  },

  save: null,
  init() {
    this.save = debounce(() => {
      try { window.api.saveData(JSON.stringify(this.state)); }
      catch (e) { console.error('save failed', e); }
    }, 600);
  },

  /* ---------- 难度预设（一键设定） ---------- */
  setPreset(skill, value) {
    const v = Math.max(0, Math.min(100, value));
    const cur = this.state.difficulty[skill];
    if (cur === v) return { next: v, changed: false };
    this.state.difficulty[skill] = v;
    this.state.diffHistory.push({ ts: Date.now(), skill, v });
    this.addRecord({ skill, type: 'feedback', note: 'preset:' + levelName(v), level: v });
    this.save();
    return { next: v, changed: true };
  },

  /* ---------- 学习库（所有学过的内容自动归档） ---------- */
  addLibrary(skill, items, level) {
    const existing = new Set(this.state.library.map(x => (x.skill + '|' + x.en.trim().slice(0, 120))));
    let added = 0;
    for (const it of items) {
      if (!it || !it.en) continue;
      const key = skill + '|' + it.en.trim().slice(0, 120);
      if (existing.has(key)) continue;
      existing.add(key);
      this.state.library.unshift({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        skill,
        ts: Date.now(),
        title: it.title || '',
        en: it.en.trim(),
        zh: String(it.zh || '').trim(),
        level: level != null ? level : this.state.difficulty[skill]
      });
      added++;
    }
    if (this.state.library.length > this.MAX_LIBRARY) {
      this.state.library.length = this.MAX_LIBRARY;
    }
    if (added) this.save();
    return added;
  },

  removeLibrary(id) {
    const i = this.state.library.findIndex(x => x.id === id);
    if (i >= 0) { this.state.library.splice(i, 1); this.save(); }
  },

  /* ---------- 生词本 ---------- */
  MAX_WORDS: 3000,

  /* 收藏生词；重复单词返回 {added:false, item} */
  addWord({ word, meaning, sentence, sentenceZh, source }) {
    const w = String(word || '').trim().replace(/\s+/g, ' ');
    if (!w) return { added: false, error: 'empty' };
    const key = w.toLowerCase();
    const exist = this.state.words.find(x => x.word.toLowerCase() === key);
    if (exist) {
      // 已存在：刷新原句与释义（保留复习进度）
      if (sentence) { exist.sentence = sentence; exist.sentenceZh = sentenceZh || ''; }
      if (meaning) exist.meaning = meaning;
      this.save();
      return { added: false, item: exist };
    }
    const now = Date.now();
    const item = {
      id: now.toString(36) + Math.random().toString(36).slice(2, 7),
      word: w,
      meaning: String(meaning || '').trim(),
      sentence: String(sentence || '').trim(),
      sentenceZh: String(sentenceZh || '').trim(),
      source: source || 'listen',
      ts: now,
      box: 0,          // 艾宾浩斯记忆阶段 0~5（5 = 已掌握）
      due: now + this.VOCAB_INTERVALS[0] * 86400000,  // 1 天后首次复习
      lapses: 0,       // 忘记次数
      last: 0          // 上次复习时间
    };
    this.state.words.unshift(item);
    if (this.state.words.length > this.MAX_WORDS) {
      this.state.words.length = this.MAX_WORDS;
    }
    this.save();
    return { added: true, item };
  },

  removeWord(id) {
    const i = this.state.words.findIndex(x => x.id === id);
    if (i >= 0) { this.state.words.splice(i, 1); this.save(); return true; }
    return false;
  },

  /* 复习打卡：grade = 'again'(忘了) | 'hard'(模糊) | 'good'(认识) */
  gradeWord(id, grade) {
    const it = this.state.words.find(x => x.id === id);
    if (!it) return null;
    const now = Date.now();
    it.last = now;
    if (grade === 'again') {
      it.lapses++;
      it.box = 0;
      it.due = now + 10 * 60000;   // 10 分钟后重来（本次会话内再练）
    } else if (grade === 'hard') {
      // 模糊：停留在当前阶段，按当前阶段间隔的一半再来
      const days = Math.max(0.5, this.VOCAB_INTERVALS[Math.min(it.box, 5)] / 2);
      it.due = now + days * 86400000;
    } else {
      it.box = Math.min(5, it.box + 1);
      it.due = now + this.VOCAB_INTERVALS[Math.min(it.box, 5)] * 86400000;
    }
    this.save();
    return it;
  },

  /* 今天到期需要复习的单词 */
  dueWords() {
    const now = Date.now();
    return this.state.words
      .filter(w => w.due <= now)
      .sort((a, b) => a.due - b.due);
  },

  wordStats() {
    const now = Date.now();
    const ws = this.state.words;
    return {
      total: ws.length,
      due: ws.filter(w => w.due <= now).length,
      learning: ws.filter(w => w.box < 5).length,
      mastered: ws.filter(w => w.box >= 5).length
    };
  },

  /* 生词本导出 CSV */
  wordsToCSV() {
    const esc2 = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const head = ['单词', '释义', '原句', '原句翻译', '来源模块', '记忆阶段', '下次复习', '忘记次数', '收藏时间'];
    const lines = [head.join(',')];
    const srcName = { listen: '听', speak: '说', read: '读', write: '写', phonics: '音标', dict: '词典' };
    for (const w of this.state.words) {
      lines.push([
        esc2(w.word), esc2(w.meaning), esc2(w.sentence), esc2(w.sentenceZh),
        esc2(srcName[w.source] || w.source), esc2('L' + w.box),
        esc2(new Date(w.due).toLocaleDateString('zh-CN')),
        esc2(w.lapses), esc2(new Date(w.ts).toLocaleString('zh-CN'))
      ].join(','));
    }
    return '\uFEFF' + lines.join('\n');
  },

  /* ---------- 字母音标 AI 例词缓存 ---------- */
  getPhonicsWords(tab, key) {
    const slot = this.state.phonics[tab + ':' + key];
    return (slot && Array.isArray(slot.words)) ? slot.words : null;
  },

  setPhonicsWords(tab, key, words) {
    this.state.phonics[tab + ':' + key] = { words: words.slice(0, 20), ts: Date.now() };
    this.save();
  },

  /* ---------- 词典缓存 ---------- */
  getDictEntry(word) {
    return this.state.dict.entries[String(word).toLowerCase()] || null;
  },

  setDictEntry(word, entry) {
    const k = String(word).toLowerCase();
    this.state.dict.entries[k] = entry;
    // 限制缓存规模
    const keys = Object.keys(this.state.dict.entries);
    if (keys.length > 1500) {
      const sorted = keys.map(x => ({ x, ts: this.state.dict.entries[x].ts || 0 })).sort((a, b) => a.ts - b.ts);
      for (let i = 0; i < 300; i++) delete this.state.dict.entries[sorted[i].x];
    }
    this.pushDictHistory(k);
    this.save();
  },

  pushDictHistory(word) {
    const k = String(word).toLowerCase();
    const h = this.state.dict.history;
    const i = h.indexOf(k);
    if (i >= 0) h.splice(i, 1);
    h.unshift(k);
    if (h.length > 60) h.length = 60;
  },

  getDictTheme(key) { return this.state.dict.themes[key] || null; },
  setDictTheme(key, words) {
    this.state.dict.themes[key] = { words: words.slice(0, 60), ts: Date.now() };
    this.save();
  },

  getDictQuery(key) { return this.state.dict.queries[key] || null; },
  setDictQuery(key, words) {
    this.state.dict.queries[key] = { words: words.slice(0, 60), ts: Date.now() };
    const keys = Object.keys(this.state.dict.queries);
    if (keys.length > 200) delete this.state.dict.queries[keys[0]];
    this.save();
  },

  /* ---------- 记录 ---------- */
  addRecord(r) {
    const rec = Object.assign({ ts: Date.now(), count: 0, sec: 0, chars: 0, words: 0 }, r);
    if (rec.level == null && rec.skill) rec.level = this.state.difficulty[rec.skill];
    this.state.records.push(rec);
    if (this.state.records.length > this.MAX_RECORDS) {
      this.state.records.splice(0, this.state.records.length - this.MAX_RECORDS);
    }
    this.save();
    if (typeof App !== 'undefined' && App.onRecord) App.onRecord(rec);
    return rec;
  },

  /* ---------- 难度调整：dir = -1 太难 / +1 太简单 ---------- */
  adjustDifficulty(skill, dir) {
    const step = 8;
    const cur = this.state.difficulty[skill];
    const next = Math.max(0, Math.min(100, cur + dir * step));
    if (next === cur) { this.addRecord({ skill, type: 'feedback', note: dir < 0 ? 'hard-min' : 'easy-max' }); return { next, changed: false }; }
    this.state.difficulty[skill] = next;
    this.state.diffHistory.push({ ts: Date.now(), skill, v: next });
    this.addRecord({ skill, type: 'feedback', note: dir < 0 ? 'hard' : 'easy', level: next });
    this.save();
    return { next, changed: true, stageChanged: stageIndex(cur) !== stageIndex(next) };
  },

  /* ---------- 聚合 ---------- */
  todayRecords() {
    const key = dayKey();
    return this.state.records.filter(r => dayKey(r.ts) === key);
  },

  aggregateToday() {
    const out = { listen: { sec: 0, count: 0, units: 0, chars: 0 }, speak: { sec: 0, count: 0, units: 0, chars: 0 },
                  read: { sec: 0, count: 0, units: 0, chars: 0 }, write: { sec: 0, count: 0, units: 0, chars: 0 } };
    for (const r of this.todayRecords()) {
      const s = out[r.skill];
      if (!s) continue;
      s.sec += r.sec || 0;
      s.count += r.count || 0;
      s.chars += r.chars || 0;
      s.units += (r.chars || 0) || (r.words || 0);
    }
    return out;
  },

  /* 近 n 天每日聚合 → [{key, listen:{sec,count,units}, ...}] */
  aggregateDays(n) {
    const out = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const byDay = {};
    for (const r of this.state.records) {
      const k = dayKey(r.ts);
      (byDay[k] = byDay[k] || []).push(r);
    }
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000);
      const k = dayKey(d.getTime());
      const agg = { key: k, listen: { sec: 0, count: 0, units: 0, chars: 0 }, speak: { sec: 0, count: 0, units: 0, chars: 0 },
                    read: { sec: 0, count: 0, units: 0, chars: 0 }, write: { sec: 0, count: 0, units: 0, chars: 0 } };
      for (const r of (byDay[k] || [])) {
        const s = agg[r.skill];
        if (!s) continue;
        s.sec += r.sec || 0;
        s.count += r.count || 0;
        s.chars += r.chars || 0;
        s.units += (r.chars || 0) || (r.words || 0);
      }
      out.push(agg);
    }
    return out;
  },

  streakDays() {
    const days = new Set(this.state.records.map(r => dayKey(r.ts)));
    let n = 0;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (!days.has(dayKey(d.getTime()))) d.setTime(d.getTime() - 86400000); // 今天没练不打断昨天开始的连续
    while (days.has(dayKey(d.getTime()))) { n++; d.setTime(d.getTime() - 86400000); }
    return n;
  },

  /* 难度历史（按天取最后一点） */
  difficultySeries(days = 30) {
    const byDaySkill = {};
    const start = Date.now() - days * 86400000;
    for (const h of this.state.diffHistory) {
      if (h.ts < start) continue;
      byDaySkill[h.skill + '|' + dayKey(h.ts)] = h; // 同一天保留最后一条
    }
    const keys = Object.keys(byDaySkill).map(k => k.split('|')[1]).sort();
    const uniq = Array.from(new Set(keys));
    const skills = ['listen', 'read', 'speak', 'write'];
    const series = {};
    for (const s of skills) series[s] = uniq.map(day => {
      const hit = byDaySkill[s + '|' + day];
      return hit ? hit.v : null;   // null = 当天无变化，断线
    });
    return { labels: uniq, series };
  },

  /* 导出 CSV */
  toCSV() {
    const head = ['时间', '模块', '动作', '时长秒', '次数', '字符/词数', '难度', '备注'];
    const typeZh = { play: '播放', master: '听熟', feedback: '难度反馈', shadow: '跟读', record: '录音读', done: '读完', submit: '提交', article: '阅读', skip: '跳过' };
    const rows = this.state.records.map(r => [
      new Date(r.ts).toLocaleString('zh-CN'),
      SKILL_NAMES[r.skill] || r.skill,
      typeZh[r.type] || r.type,
      Math.round(r.sec || 0), r.count || 0, r.chars || r.words || 0,
      r.level != null ? Math.round(r.level) : '',
      r.note || ''
    ]);
    return '\uFEFF' + [head, ...rows].map(row => row.map(c => {
      const s = String(c ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
  }
};
