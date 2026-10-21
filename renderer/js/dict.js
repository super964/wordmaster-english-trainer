'use strict';
/* ================= 词典（免费在线查词 + 主题词表 + 中文含义反查） ================= */
const DictPage = {
  entry: null,     // 当前词条
  list: null,      // 当前列表 {title, words, src}
  busy: false,

  THEMES: [
    '🐾 动物', '🍎 食物水果', '🏫 学校', '👨‍👩‍👧 家庭', '🎨 颜色', '🧍 身体',
    '⛅ 天气', '🚗 交通', '💼 职业', '😊 情绪', '⚽ 运动', '🏠 家居'
  ],

  init() {
    $('#dict-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.lookup($('#dict-search').value.trim());
    });
    $('#dict-go').onclick = () => this.lookup($('#dict-search').value.trim());
    $('#dict-meaning-go').onclick = () => this.byMeaning();
    $('#dict-meaning-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.byMeaning();
    });

    // 主题按钮（含自定义主题输入）
    $('#dict-themes').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-theme]');
      if (btn) this.theme(btn.dataset.theme);
    });

    // 历史 / 词表 / 释义区事件委托
    $('#dict-history').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-w]');
      if (b) this.lookup(b.dataset.w);
    });
    $('#dict-entry').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'speak') TTS.speak(b.dataset.w, { rate: 0.8 });
      else if (act === 'collect') this.collect(this.entry);
      else if (act === 'syn') this.lookup(b.dataset.w);
      else if (act === 'ex-speak') TTS.speak(b.dataset.w2, { rate: 0.75 });
    });
    $('#dict-list').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const w = b.dataset.w;
      if (b.dataset.act === 'lookup') this.lookup(w);
      else if (b.dataset.act === 'speak') TTS.speak(w, { rate: 0.8 });
      else if (b.dataset.act === 'collect') {
        Store.addWord({ word: w, meaning: b.dataset.zh || '', sentence: b.dataset.ex || '', sentenceZh: '', source: 'dict' });
        toast(`⭐ 已收藏「${w}」到生词本`, 'good');
        VocabPage.refreshBadge();
      }
    });
  },

  onShow() {
    this.renderThemes();
    this.renderHistory();
    if (!this.entry && !this.list) this.renderHint();
  },

  renderHint() {
    $('#dict-entry').innerHTML = `<div class="empty" style="padding:26px;text-align:center">
      🔎 输入英文单词查免费在线词典（音标 / 释义 / 例句 / 同义词）<br>
      🎨 点下方主题可一次获得一整串相关单词；也可用中文含义反查英文<br>
      <span class="hint">查过的词和词表都会缓存，断网也能再次查看</span></div>`;
  },

  /* ---------------- 主题词表 ---------------- */
  renderThemes() {
    const cached = Object.keys(Store.state.dict.themes);
    $('#dict-themes').innerHTML =
      this.THEMES.map(t => {
        const key = t.replace(/^[^\s]+ /, '').trim();
        const has = Store.getDictTheme(key);
        return `<button class="btn tiny theme-btn${has ? ' cached' : ''}" data-theme="${escHtml(key)}">${escHtml(t)}${has ? ' ✓' : ''}</button>`;
      }).join('') +
      `<span class="theme-custom"><input type="text" id="dict-theme-custom" placeholder="自定义主题，如：太空 / 烹饪 / 心理学" spellcheck="false">
       <button class="btn tiny" id="dict-theme-go">生成词表</button></span>`;
    $('#dict-theme-go').onclick = () => {
      const v = $('#dict-theme-custom').value.trim();
      if (v) this.theme(v);
    };
    $('#dict-theme-custom').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.value.trim()) this.theme(e.target.value.trim());
    });
  },

  async theme(name) {
    if (this.busy) return;
    const key = name.trim();
    if (!key) return;
    // 主题名带 emoji 时去掉前缀只留文字
    const pure = key.replace(/^[^\p{L}\p{N}]+/u, '').trim() || key;
    this.busy = true;
    const _t1 = $('#dict-list-title');
    _t1.classList.remove('hidden');
    _t1.textContent = `「${pure}」主题词表加载中…`;
    $('#dict-list').innerHTML = '';

    let data = Store.getDictTheme(pure);
    let src = '缓存';
    if (!data) {
      if (AI.isConfigured()) {
        try {
          const words = await AI.getDictThemeWords(pure, 20);
          Store.setDictTheme(pure, words);
          data = Store.getDictTheme(pure);
          src = 'AI 生成（已保存）';
        } catch (e) {
          toast('AI 生成失败：' + e.message.slice(0, 50), 'bad');
        }
      }
      if (!data) {
        // 离线兜底：内置主题
        const local = (window.DICT_DATA.themes || []).find(t =>
          t.name.includes(pure) || t.key === pure || pure.includes(t.name.replace(/^[^\s]+ /, '')));
        if (local) {
          data = { words: local.words.split(',').map(p => {
            const m = p.match(/^([^一-龥]+)([一-龦].*)$/);
            return m ? { en: m[1].trim(), zh: m[2].trim(), ex: '' } : { en: p, zh: '' };
          }) };
          src = '内置词库（离线）';
        }
      }
      this.busy = false;
      if (!data) { $('#dict-list-title').textContent = `没有找到「${pure}」的词表（离线可用内置主题或配置 AI）`; return; }
    } else {
      this.busy = false;
    }

    this.list = { title: `「${pure}」主题词表`, words: data.words, src };
    this.renderList();
  },

  /* ---------------- 中文含义反查 ---------------- */
  async byMeaning() {
    if (this.busy) return;
    const q = $('#dict-meaning-input').value.trim();
    if (!q) { toast('请输入中文含义，如：表示开心 / 快速移动'); return; }
    this.busy = true;
    const _t2 = $('#dict-list-title');
    _t2.classList.remove('hidden');
    _t2.textContent = `按含义「${q}」搜词中…`;
    $('#dict-list').innerHTML = '';

    let data = Store.getDictQuery(q);
    let src = '缓存';
    if (!data) {
      if (AI.isConfigured()) {
        try {
          const words = await AI.getWordsByMeaning(q, 20);
          Store.setDictQuery(q, words);
          data = Store.getDictQuery(q);
          src = 'AI 生成（已保存）';
        } catch (e) {
          toast('AI 搜词失败：' + e.message.slice(0, 50), 'bad');
        }
      }
      if (!data) {
        // 离线兜底：在内置主题词库中按中文包含匹配
        const all = [];
        for (const t of window.DICT_DATA.themes) {
          for (const pair of t.words.split(',')) {
            const i = pair.search(/[一-鿿]/);
            if (i <= 0) continue;
            const en = pair.slice(0, i).trim(), zh = pair.slice(i).trim();
            if (zh.includes(q) || q.includes(zh)) all.push({ en, zh, ex: '' });
          }
        }
        if (all.length) { data = { words: all }; src = '内置词库（离线）'; }
      }
      this.busy = false;
      if (!data) { $('#dict-list-title').textContent = `离线模式没搜到「${q}」，配置 AI 后可语义搜词`; this.list = null; return; }
    } else {
      this.busy = false;
    }

    this.list = { title: `含义「${q}」→ ${data.words.length} 个词`, words: data.words, src };
    this.renderList();
  },

  renderList() {
    const l = this.list;
    if (!l) return;
    const titleEl = $('#dict-list-title');
    titleEl.classList.remove('hidden');
    titleEl.innerHTML = `${escHtml(l.title)} <span class="chip">${escHtml(l.src)}</span>`;
    $('#dict-list').innerHTML = l.words.map(w => `
      <div class="dict-word-card">
        <div class="dw-main">
          <span class="dw-en">${escHtml(w.en)}</span>
          <span class="dw-zh">${escHtml(w.zh)}</span>
        </div>
        ${w.ex ? `<div class="dw-ex">${escHtml(w.ex)}</div>` : ''}
        <div class="dw-actions">
          <button class="btn tiny" data-act="speak" data-w="${escHtml(w.en)}">🔊</button>
          <button class="btn tiny" data-act="collect" data-w="${escHtml(w.en)}" data-zh="${escHtml(w.zh)}" data-ex="${escHtml(w.ex || '')}">⭐ 收藏</button>
          <button class="btn tiny ghost" data-act="lookup" data-w="${escHtml(w.en)}">📖 详情</button>
        </div>
      </div>`).join('');
  },

  /* ---------------- 单词详情（免费在线词典） ---------------- */
  async lookup(word) {
    word = String(word || '').trim().replace(/^[^a-zA-Z']+|[^a-zA-Z']+$/g, '');
    if (!word) { toast('请输入英文单词'); return; }
    if (this.busy) return;
    this.busy = true;
    $('#dict-search').value = word;
    $('#dict-entry').innerHTML = `<div class="empty" style="padding:26px;text-align:center">正在查询「${escHtml(word)}」…</div>`;

    // 1) 本地缓存
    let entry = Store.getDictEntry(word);

    // 2) 免费在线词典（Free Dictionary API，无需 Key）
    if (!entry) {
      try {
        const res = await window.api.dictLookup(word);
        if (res.ok && res.data) {
          entry = res.data;
          // 中文释义（AI 可选翻译）
          if (AI.isConfigured() && entry.def) {
            const zh = await AI.translateDefinition(word, entry.def);
            if (zh) entry.zh = zh;
          }
          Store.setDictEntry(word, entry);
        } else if (res.notFound) {
          this.busy = false;
          $('#dict-entry').innerHTML = `
            <div class="empty" style="padding:26px;text-align:center">
              没有查到「${escHtml(word)}」<br><span class="hint">检查拼写，或把它收藏为生词让 AI 翻译</span><br><br>
              <button class="btn" id="dict-collect-404">⭐ 收藏这个词</button></div>`;
          $('#dict-collect-404').onclick = () => {
            Store.addWord({ word, meaning: '', sentence: '', source: 'dict' });
            toast('已收藏，稍后可在单词本补充释义', 'good');
            VocabPage.refreshBadge();
          };
          return;
        }
      } catch (e) { /* 网络失败走兜底 */ }

      // 3) 离线兜底：内置词库 / 语音助手
      if (!entry) {
        entry = this.offlineEntry(word);
        if (!entry && AI.isConfigured()) {
          try {
            const meaning = await AI.translateWord(word, '');
            if (meaning.ok && meaning.meaning) {
              entry = { word, ipa: '', pos: '', def: meaning.meaning, zh: meaning.meaning, ex: '', offline: true, src: 'AI 翻译' };
            }
          } catch (e) {}
        }
        if (entry) Store.setDictEntry(word, entry);
      }
    }

    this.busy = false;
    if (!entry) {
      $('#dict-entry').innerHTML = `<div class="empty" style="padding:26px;text-align:center">查询失败（网络不可用且离线词库没有该词）</div>`;
      return;
    }
    this.entry = entry;
    this.renderEntry();
    this.renderHistory();
  },

  /* 离线：内置主题词库反查 */
  offlineEntry(word) {
    const w = word.toLowerCase();
    for (const t of window.DICT_DATA.themes) {
      for (const pair of t.words.split(',')) {
        const i = pair.search(/[一-鿿]/);
        if (i <= 0) continue;
        const en = pair.slice(0, i).trim().toLowerCase();
        if (en === w) {
          return { word, ipa: '', pos: '', def: pair.slice(i).trim(), zh: pair.slice(i).trim(), ex: '', offline: true, src: '内置词库（离线）' };
        }
      }
    }
    return null;
  },

  renderEntry() {
    const e = this.entry;
    const phonetic = (e.ipa ? `<span class="dict-ipa">${escHtml(e.ipa)}</span>` : '');
    const zhBlock = e.zh ? `<div class="dict-zh">🈶 ${escHtml(e.zh)}</div>` : '';
    const srcTag = e.offline ? `<span class="chip">${escHtml(e.src || '离线')}</span>` : '';
    const syns = (e.syn && e.syn.length)
      ? `<div class="dict-syns">同义词：${e.syn.map(s => `<button class="btn tiny ghost" data-act="syn" data-w="${escHtml(s)}">${escHtml(s)}</button>`).join('')}</div>`
      : '';

    $('#dict-entry').innerHTML = `
      <div class="dict-head">
        <span class="dict-word">${escHtml(e.word)}</span>
        ${phonetic}
        <button class="btn tiny" data-act="speak" data-w="${escHtml(e.word)}">🔊</button>
        <button class="btn tiny" data-act="collect">⭐ 收藏生词</button>
        ${srcTag}
      </div>
      ${zhBlock}
      ${e.pos ? `<div class="dict-pos">${escHtml(e.pos)}</div>` : ''}
      ${e.def ? `<div class="dict-def">${escHtml(e.def)}</div>` : ''}
      ${e.ex ? `<div class="dict-ex">💬 ${escHtml(e.ex)} <button class="btn tiny ghost" data-act="ex-speak" data-w2="${escHtml(e.ex)}">🔊</button></div>` : ''}
      ${syns}`;
  },

  renderHistory() {
    const h = (Store.state.dict.history || []).slice(0, 24);
    $('#dict-history').innerHTML = h.length
      ? `<span class="dh-label">最近查过：</span>` + h.map(w => `<button class="btn tiny ghost" data-w="${escHtml(w)}">${escHtml(w)}</button>`).join('')
      : '';
  },

  collect(e) {
    if (!e) return;
    const res = Store.addWord({
      word: e.word,
      meaning: e.zh || e.def || '',
      sentence: e.ex || '',
      sentenceZh: '',
      source: 'dict'
    });
    toast(res.added ? `⭐ 已收藏「${e.word}」到生词本` : `「${e.word}」已在生词本中`, res.added ? 'good' : '');
    VocabPage.refreshBadge();
  }
};
