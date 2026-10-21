'use strict';
/* ================= 字母音标模块（零基础：字母 + 音标 + 例词） ================= */
const PhonicsPage = {
  tab: 'letters',   // letters | vowels | consonants
  playing: null,

  DATA: window.PHONICS_DATA,

  init() {
    $$('#phonics-tabs button').forEach(b => {
      b.onclick = () => {
        $$('#phonics-tabs button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.tab = b.dataset.tab;
        this.render();
      };
    });
    $('#phonics-gen').onclick = () => this.generateCurrent(true);
    $('#phonics-speak-all').onclick = () => this.speakAll();
    $('#phonics-stop').onclick = () => this.stopSeq();

    // 点击卡片上的按钮（事件委托）
    $('#phonics-grid').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      const card = e.target.closest('.ph-card');
      if (!card) return;
      const key = card.dataset.key;
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'demo') this.speakDemo(key);
      else if (act === 'word') {
        const w = btn.dataset.word;
        TTS.speak(w, { rate: 0.8 });
      } else if (act === 'collect') {
        this.collectWord(btn.dataset.word, btn.dataset.zh, key);
      } else if (act === 'gen') this.generateOne(key);
    });
  },

  onShow() { this.render(); },

  currentList() {
    if (this.tab === 'vowels') return this.DATA.vowels;
    if (this.tab === 'consonants') return this.DATA.consonants;
    return this.DATA.letters;
  },

  tabName() {
    return this.tab === 'letters' ? '字母' : this.tab === 'vowels' ? '元音' : '辅音';
  },

  /* 已保存的 AI 例词（Store 持久化），否则用内置 */
  wordsFor(item) {
    const saved = Store.getPhonicsWords(this.tab, item.key);
    if (saved && saved.length) return { words: saved, ai: true };
    return { words: item.words.split(',').map(p => {
      const m = p.match(/^([^一-龥]+)([一-龦].*)$/);
      return m ? { en: m[1].trim(), zh: m[2].trim() } : { en: p.trim(), zh: '' };
    }), ai: false };
  },

  render() {
    const list = this.currentList();
    const genCount = list.filter(it => (Store.getPhonicsWords(this.tab, it.key) || []).length).length;
    $('#phonics-gen').textContent = genCount
      ? `🤖 AI 重新生成本组例词（已存 ${genCount}/${list.length}）`
      : `🤖 AI 生成全部例词（一键 · 自动保存）`;

    $('#phonics-grid').innerHTML = list.map(item => {
      const { words, ai } = this.wordsFor(item);
      const wordChips = words.map(w => `
        <div class="ph-word">
          <button class="btn tiny ghost" data-act="word" data-word="${escHtml(w.en)}" title="点我朗读">${escHtml(w.en)}</button>
          <span class="ph-zh">${escHtml(w.zh)}</span>
          <button class="btn tiny" data-act="collect" data-word="${escHtml(w.en)}" data-zh="${escHtml(w.zh)}" title="收藏到生词本">⭐</button>
        </div>`).join('');
      return `
      <div class="ph-card${this.tab === 'letters' ? ' letter' : ''}" data-key="${escHtml(item.key)}">
        <div class="ph-head">
          <div class="ph-big">${escHtml(item.key)}</div>
          <div class="ph-meta">
            <div class="ph-ipa">${escHtml(item.ipa || ('/' + item.key + '/'))}</div>
            <div class="ph-tip">${escHtml(item.tip || (item.ipa ? '字母发音' : ''))}${ai ? ' <span class="ph-ai-tag">🤖AI例词</span>' : ''}</div>
          </div>
          <div class="ph-btns">
            <button class="btn tiny primary" data-act="demo" title="听发音">🔊 发音</button>
            <button class="btn tiny" data-act="gen" title="AI 生成/更新本词例词">🤖</button>
          </div>
        </div>
        <div class="ph-words">${wordChips}</div>
      </div>`;
    }).join('');
  },

  /* 单个发音（字母读字母名；音标读示范词） */
  speakDemo(key) {
    const item = this.currentList().find(x => x.key === key);
    if (!item) return;
    const text = this.tab === 'letters' ? item.key : item.demo;
    this.setPlaying(key);
    TTS.speak(text, {
      rate: 0.75,
      onEnd: () => this.setPlaying(null),
      onError: () => this.setPlaying(null)
    });
  },

  setPlaying(key) {
    this.playing = key;
    $$('#phonics-grid .ph-card').forEach(c => c.classList.toggle('playing', c.dataset.key === key));
  },

  /* 连续朗读整组（字母/音标 + 示范词） */
  async speakAll() {
    if (this._seqRunning) { toast('正在连读中…'); return; }
    const list = this.currentList();
    this._seqRunning = true;
    $('#phonics-speak-all').classList.add('hidden');
    $('#phonics-stop').classList.remove('hidden');
    toast('开始连读：每项读「发音 + 示范词」，点「⏹ 停止」结束', 'good');
    for (const item of list) {
      if (!this._seqRunning) break;
      this.setPlaying(item.key);
      await this._speakOne(this.tab === 'letters' ? item.key : item.demo);
      if (!this._seqRunning) break;
      await this._speakOne(item.demo);
    }
    this._seqRunning = false;
    $('#phonics-speak-all').classList.remove('hidden');
    $('#phonics-stop').classList.add('hidden');
    this.setPlaying(null);
  },

  stopSeq() {
    this._seqRunning = false;
    TTS.stop();
    this.setPlaying(null);
    $('#phonics-speak-all').classList.remove('hidden');
    $('#phonics-stop').classList.add('hidden');
  },

  _speakOne(text) {
    this._lastText = text;
    return new Promise(resolve => {
      if (!this._seqRunning) return resolve();
      TTS.speak(text, { rate: 0.72, onEnd: resolve, onError: resolve });
      // 兜底超时
      setTimeout(resolve, 6000);
    });
  },

  /* ---------------- AI 生成例词（保存到 Store，下次不再生成） ---------------- */
  async generateCurrent(force) {
    const list = this.currentList();
    const missing = list.filter(it => !(Store.getPhonicsWords(this.tab, it.key) || []).length);
    const targets = (force && missing.length === 0) ? list : missing;
    if (!targets.length) { toast('本组例词已全部生成并保存 ✅ 无需重复生成', 'good'); return; }
    if (!AI.isConfigured()) { toast('请先在设置里配置 AI 接口，或直接使用内置例词', 'bad'); return; }
    $('#phonics-gen').disabled = true;
    let ok = 0, fail = 0;
    for (let i = 0; i < targets.length; i++) {
      const it = targets[i];
      $('#phonics-gen').textContent = `🤖 正在生成 ${i + 1}/${targets.length}…`;
      const words = await this.generateOne(it.key, true);
      if (words) ok++; else fail++;
      this.render();
    }
    $('#phonics-gen').disabled = false;
    $('#phonics-gen').textContent = `🤖 AI 重新生成本组例词（已存 ${ok ? '✓' : ''}）`;
    toast(`例词生成完成：成功 ${ok} 个${fail ? '、失败 ' + fail + ' 个（可单独点 🤖 重试）' : ''}，已自动保存`, fail ? 'bad' : 'good');
    this.render();
  },

  async generateOne(key, silent) {
    const item = this.currentList().find(x => x.key === key);
    if (!item) return null;
    if (!AI.isConfigured()) {
      if (!silent) toast('未配置 AI 接口，正在使用内置例词', 'bad');
      return null;
    }
    const label = this.tabName();
    try {
      const words = await AI.getPhonicsWords({
        kind: this.tab, key, label,
        demo: item.demo, ipa: item.ipa || ('/' + item.key + '/'),
        tip: item.tip || '', n: 10
      });
      if (!words.length) throw new Error('返回为空');
      Store.setPhonicsWords(this.tab, key, words);
      if (!silent) toast(`已生成并保存 ${words.length} 个${label}「${key}」例词 🤖`, 'good');
      this.render();
      return words;
    } catch (e) {
      if (!silent) toast(`生成失败：${e.message.slice(0, 60)}`, 'bad');
      return null;
    }
  },

  /* 收藏到生词本（音标模块来源） */
  collectWord(en, zh, key) {
    const res = Store.addWord({
      word: en,
      meaning: zh || '',
      sentence: `The ${this.tabName()} "${key}" — e.g. "${en}".`,
      sentenceZh: '',
      source: 'phonics'
    });
    toast(res.added ? `⭐ 已收藏「${en}」（含释义，到期会提醒复习）` : `「${en}」已在生词本中`, res.added ? 'good' : '');
    VocabPage.refreshBadge();
  }
};
