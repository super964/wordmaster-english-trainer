'use strict';
/* ================= 生词本（一键收藏 + 艾宾浩斯复习） ================= */

/* ---------- 一键收藏：双击任意英文里的单词 → 弹窗收藏 ---------- */
const WordCollect = {
  ctx: null,   // {sentence, sentenceZh, source}

  init() {
    // 在四个训练页的英文区域双击单词即可收藏
    const bind = (sel, srcFn) => {
      const el = $(sel);
      if (!el) return;
      el.addEventListener('dblclick', () => {
        const selObj = window.getSelection();
        const word = (selObj ? selObj.toString() : '').trim();
        if (!word || word.length > 60) return;
        const ctx = typeof srcFn === 'function' ? srcFn() : {};
        this.open(word, ctx.sentence || el.textContent.trim(), ctx.sentenceZh || '', ctx.source || 'listen');
      });
    };
    bind('#listen-en', () => {
      const it = ListenPage.items[ListenPage.idx];
      return it ? { sentence: it.en, sentenceZh: it.zh, source: 'listen' } : { source: 'listen' };
    });
    bind('#speak-en', () => {
      const it = SpeakPage.cur();
      return it ? { sentence: it.en, sentenceZh: it.zh, source: 'speak' } : { source: 'speak' };
    });
    bind('#read-body', () => {
      const it = ReadPage.current;
      if (!it) return { source: 'read' };
      // 找到双击所在段落对应的句子 + 该段中文
      const selObj = window.getSelection();
      let node = selObj && selObj.anchorNode;
      if (node && node.nodeType === 3) node = node.parentElement;
      const p = node && node.closest ? node.closest('p') : null;
      let sentence = it.en;
      if (p && !p.classList.contains('zh-para')) {
        const paraText = p.textContent;
        const words = (selObj ? selObj.toString() : '').trim();
        sentence = this._sentenceIn(paraText, words) || paraText;
      }
      return { sentence, sentenceZh: '', source: 'read' };
    });
    bind('#write-prompt-en', () => {
      const it = WritePage.cur();
      return it ? { sentence: it.en, sentenceZh: it.zh, source: 'write' } : { source: 'write' };
    });

    // 弹窗按钮
    $('#wc-save').onclick = () => this.save();
    $('#wc-cancel').onclick = () => this.close();
    $('#wc-mask').addEventListener('click', (e) => { if (e.target.id === 'wc-mask') this.close(); });
    $('#wc-speak').onclick = () => {
      const w = $('#wc-word').value.trim();
      if (w) TTS.speak(w, { rate: 0.85 });
    };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#wc-mask').classList.contains('hidden')) this.close();
    });
  },

  /* 在段落中找到包含某词的句子 */
  _sentenceIn(text, word) {
    if (!word) return text;
    const sentences = String(text).match(/[^.!?]+[.!?]*/g) || [text];
    const w = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\b' + w + '\\b', 'i');
    const hit = sentences.find(s => re.test(s));
    return hit ? hit.trim() : text;
  },

  open(word, sentence, sentenceZh, source) {
    this.ctx = { sentence: String(sentence || '').trim(), sentenceZh: String(sentenceZh || '').trim(), source: source || 'listen' };
    $('#wc-word').value = word || '';
    $('#wc-meaning').value = '';
    $('#wc-sentence').textContent = this.ctx.sentence || '（无原句）';
    const zhEl = $('#wc-sentence-zh');
    zhEl.textContent = this.ctx.sentenceZh || '';
    zhEl.classList.toggle('hidden', !this.ctx.sentenceZh);
    const srcName = { listen: '🎧 听', speak: '🎤 说', read: '📖 读', write: '⌨️ 写', phonics: '🔤 音标', dict: '📖 词典' };
    $('#wc-source').textContent = srcName[this.ctx.source] || this.ctx.source;
    $('#wc-msg').textContent = '';
    $('#wc-mask').classList.remove('hidden');
    setTimeout(() => $('#wc-word').focus(), 40);
    if (word) this.autoTranslate();
  },

  close() { $('#wc-mask').classList.add('hidden'); this.ctx = null; },

  async autoTranslate() {
    const word = $('#wc-word').value.trim();
    if (!word) return;
    const msg = $('#wc-msg');
    if (!AI.isConfigured()) {
      msg.textContent = '未配置 AI，请手动输入释义';
      return;
    }
    msg.textContent = '🤖 AI 翻译中…';
    const res = await AI.translateWord(word, this.ctx && this.ctx.sentence);
    if (res.ok && res.meaning) {
      $('#wc-meaning').value = res.meaning;
      msg.textContent = '✅ 已自动翻译（可修改）';
    } else {
      msg.textContent = '翻译失败，请手动输入释义';
    }
  },

  save() {
    const word = $('#wc-word').value.trim();
    if (!word) { $('#wc-msg').textContent = '请输入或选中要收藏的单词'; return; }
    const res = Store.addWord({
      word,
      meaning: $('#wc-meaning').value.trim(),
      sentence: this.ctx ? this.ctx.sentence : '',
      sentenceZh: this.ctx ? this.ctx.sentenceZh : '',
      source: this.ctx ? this.ctx.source : 'listen'
    });
    if (res.error === 'empty') { $('#wc-msg').textContent = '单词不能为空'; return; }
    if (res.added) toast(`⭐ 已收藏「${word}」到生词本`, 'good');
    else toast(`「${word}」已在生词本中，已更新原句`, 'good');
    this.close();
    VocabPage.refreshBadge();
    if (App.page === 'vocab') VocabPage.onShow();
  }
};

/* ---------- 生词本页面 ---------- */
const VocabPage = {
  filter: 'all',
  q: '',
  // 复习会话状态
  queue: [],
  qi: 0,
  revealed: false,
  doneIds: [],

  init() {
    $$('#vocab-filter button').forEach(b => {
      b.onclick = () => {
        $$('#vocab-filter button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.filter = b.dataset.f;
        this.renderList();
      };
    });
    $('#vocab-search').addEventListener('input', debounce(() => {
      this.q = $('#vocab-search').value.trim().toLowerCase();
      this.renderList();
    }, 250));
    $('#vocab-add').onclick = () => {
      WordCollect.open('', '', '', 'listen');
      $('#wc-sentence').textContent = '（手动添加：无原句）';
    };
    $('#vocab-export-csv').onclick = async () => {
      if (!Store.state.words.length) { toast('生词本是空的'); return; }
      const res = await window.api.exportFile({
        content: Store.wordsToCSV(),
        defaultName: `WordMaster生词本_${dayKey()}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      });
      if (res.ok) toast('已导出：' + res.path, 'good');
    };
    $('#vocab-start-review').onclick = () => this.startReview();
  },

  onShow() {
    this.renderStats();
    this.renderUpcoming();
    this.renderList();
    this.renderReviewBox();
  },

  /* 侧边栏角标：今日待复习数量 */
  refreshBadge() {
    const n = Store.wordStats().due;
    const badge = $('#nav-vocab-badge');
    if (!badge) return;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('hidden', n === 0);
  },

  renderStats() {
    const s = Store.wordStats();
    $('#vocab-cards').innerHTML = `
      <div class="stat-card"><div class="sc-ico">📚</div><div class="sc-num">${s.total}</div><div class="sc-label">生词总数</div></div>
      <div class="stat-card c2"><div class="sc-ico">⏰</div><div class="sc-num">${s.due}</div><div class="sc-label">今日待复习</div></div>
      <div class="stat-card c1"><div class="sc-ico">📖</div><div class="sc-num">${s.learning}</div><div class="sc-label">记忆中</div></div>
      <div class="stat-card c4"><div class="sc-ico">🏆</div><div class="sc-num">${s.mastered}</div><div class="sc-label">已掌握（L5）</div></div>`;
  },

  /* 艾宾浩斯提醒：未来 7 天到期预览 */
  renderUpcoming() {
    const days = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const start = d.getTime(), end = start + 86400000;
      const n = Store.state.words.filter(w => w.due >= start && w.due < end).length;
      days.push({ label: i === 0 ? '今天' : (d.getMonth() + 1) + '/' + d.getDate(), n, today: i === 0 });
    }
    const max = Math.max(1, ...days.map(d => d.n));
    $('#vocab-upcoming').innerHTML = days.map(d => `
      <div class="up-day${d.today ? ' today' : ''}">
        <div class="up-bar"><i style="height:${Math.round(d.n / max * 100)}%"></i></div>
        <div class="up-n">${d.n}</div>
        <div class="up-label">${d.label}</div>
      </div>`).join('');
  },

  /* ---------------- 复习（闪卡） ---------------- */
  startReview() {
    this.queue = Store.dueWords().map(w => w.id);
    this.qi = 0;
    this.revealed = false;
    this.doneIds = [];
    this.renderReviewBox();
    if (!this.queue.length) toast('今天没有需要复习的单词 🎉', 'good');
  },

  renderReviewBox() {
    const box = $('#vocab-review-box');
    const due = Store.wordStats().due;
    if (!this.queue.length) {
      box.innerHTML = due
        ? `<div class="empty" style="text-align:center;padding:22px">今天有 <b>${due}</b> 个单词到期该复习了，点上方「开始复习」卡片随时可练</div>`
        : `<div class="empty" style="text-align:center;padding:22px">🎉 目前没有到期的单词。继续学习，新收藏的单词会按艾宾浩斯曲线自动安排复习</div>`;
      return;
    }
    if (this.qi >= this.queue.length) {
      box.innerHTML = `<div class="review-done">🎉 本轮复习完成！已复习 ${this.doneIds.length} 个单词<br><span class="hint">明天记得再来，遗忘曲线不等人</span></div>`;
      this.refreshBadge();
      this.renderStats();
      this.renderUpcoming();
      return;
    }
    const it = Store.state.words.find(w => w.id === this.queue[this.qi]);
    if (!it) { this.qi++; this.renderReviewBox(); return; }

    const srcName = { listen: '🎧 听', speak: '🎤 说', read: '📖 读', write: '⌨️ 写', phonics: '🔤 音标', dict: '📖 词典' };
    const masked = it.sentence
      ? escHtml(this._maskWord(it.sentence, it.word))
      : '<i>（无原句）</i>';

    box.innerHTML = `
      <div class="review-card">
        <div class="rc-top">
          <span class="rc-progress">第 ${this.qi + 1} / ${this.queue.length} 个</span>
          <span class="rc-source">${srcName[it.source] || ''}</span>
          <span class="rc-box">阶段 L${it.box}${it.lapses ? ' · 忘过 ' + it.lapses + ' 次' : ''}</span>
        </div>
        <div class="rc-sentence">${masked}</div>
        ${it.sentenceZh ? `<div class="rc-sentence-zh">${escHtml(it.sentenceZh)}</div>` : ''}
        <div class="rc-answer${this.revealed ? '' : ' hidden'}" id="rc-answer">
          <div class="rc-word">${escHtml(it.word)} <button class="btn tiny" id="rc-speak">🔊</button></div>
          <div class="rc-meaning">${it.meaning ? escHtml(it.meaning) : '<i>（未填写释义）</i>'}</div>
        </div>
        <div class="rc-btns">
          ${this.revealed ? `
            <button class="btn hard" data-g="again">😵 忘了</button>
            <button class="btn" data-g="hard">🤔 模糊</button>
            <button class="btn done" data-g="good">✅ 认识</button>
          ` : `<button class="btn primary" id="rc-show">💡 显示答案</button>`}
          <button class="btn ghost" id="rc-skip">跳过</button>
        </div>
      </div>`;

    const $box = $('#vocab-review-box');
    if (this.revealed) {
      $('#rc-speak').onclick = () => TTS.speak(it.word, { rate: 0.85 });
      $box.querySelectorAll('.rc-btns [data-g]').forEach(b => {
        b.onclick = () => this.grade(it.id, b.dataset.g);
      });
    } else {
      $('#rc-show').onclick = () => { this.revealed = true; this.renderReviewBox(); };
    }
    $('#rc-skip').onclick = () => { this.qi++; this.revealed = false; this.renderReviewBox(); };
  },

  /* 把句子里的该词打码，逼自己回忆 */
  _maskWord(sentence, word) {
    const esc = escHtml(sentence);
    const w = escHtml(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\b(' + w + ')\\b', 'gi');
    return esc.replace(re, (m) => '●'.repeat(Math.max(2, Math.min(m.length, 10))));
  },

  grade(id, grade) {
    const it = Store.gradeWord(id, grade);
    if (!it) return;
    const dayStr = (ms) => {
      const d = new Date(ms);
      return (d.getMonth() + 1) + '/' + d.getDate();
    };
    const msgs = {
      good: `✅ 下次复习：${dayStr(it.due)}（第 ${it.box} 阶段）`,
      hard: `🤔 保持阶段 L${it.box}，${dayStr(it.due)} 再巩固`,
      again: `😵 已打回重学，10 分钟后它会再次出现`
    };
    toast(msgs[grade], grade === 'again' ? 'bad' : 'good');
    if (grade === 'again') {
      // 从队列里拿出来，重新排到后面（本次会话内再练一次）
      this.queue.splice(this.qi, 1);
      this.queue.push(id);
    } else {
      this.doneIds.push(id);
      this.qi++;
    }
    this.revealed = false;
    this.renderReviewBox();
  },

  /* ---------------- 单词列表 ---------------- */
  items() {
    const now = Date.now();
    return Store.state.words.filter(w => {
      if (this.filter === 'due' && w.due > now) return false;
      if (this.filter === 'learning' && w.box >= 5) return false;
      if (this.filter === 'mastered' && w.box < 5) return false;
      if (this.q) {
        const hay = (w.word + ' ' + w.meaning + ' ' + w.sentence).toLowerCase();
        if (!hay.includes(this.q)) return false;
      }
      return true;
    });
  },

  renderList() {
    const all = Store.state.words;
    const items = this.items();
    const dueN = Store.wordStats().due;
    $('#vocab-counts').innerHTML = `共 <b>${all.length}</b> 个生词 · ${dueN ? `<b style="color:var(--hard)">${dueN} 个今日待复习</b>` : '今日已无待复习'}` +
      (items.length !== all.length ? `（筛选出 ${items.length} 个）` : '');

    const srcName = { listen: '🎧', speak: '🎤', read: '📖', write: '⌨️', phonics: '🔤', dict: '📖' };
    const dueLabel = (w) => {
      const diff = w.due - Date.now();
      if (diff <= 0) return '<span class="due-tag now">⏰ 待复习</span>';
      const days = Math.ceil(diff / 86400000);
      return `<span class="due-tag">${days <= 30 ? days + ' 天后复习' : '已掌握'}</span>`;
    };
    const boxDots = (box) => {
      let s = '<span class="box-dots">';
      for (let i = 0; i < 5; i++) s += `<i class="${i <= box && box > 0 || (i === 0 && box === 0) ? 'on' : ''}"></i>`;
      return s + `</span>`;
    };

    $('#vocab-list').innerHTML = items.length ? items.slice(0, 400).map(w => `
      <div class="lib-card vocab-card" data-id="${w.id}">
        <div class="lib-head">
          <span class="vc-word">${escHtml(w.word)}</span>
          <button class="btn tiny" data-act="speak">🔊</button>
          ${boxDots(w.box)}
          ${dueLabel(w)}
          <span class="lib-date">${new Date(w.ts).toLocaleDateString('zh-CN')} ${srcName[w.source] || ''}</span>
          <span class="lib-actions">
            <button class="btn tiny" data-act="copy">📋</button>
            <button class="btn tiny" data-act="del">🗑</button>
          </span>
        </div>
        ${w.meaning ? `<div class="vc-meaning">${escHtml(w.meaning)}</div>` : ''}
        ${w.sentence ? `<div class="vc-sentence">${escHtml(w.sentence)}</div>` : ''}
        ${w.sentenceZh ? `<div class="vc-sentence-zh">${escHtml(w.sentenceZh)}</div>` : ''}
      </div>`).join('')
      : '<div class="empty" style="padding:30px;text-align:center">暂无生词。在听力 / 口语 / 阅读 / 写作页<b>双击任意英文单词</b>即可一键收藏（自动带上原句和 AI 释义）。</div>';

    $$('#vocab-list .vocab-card').forEach(card => {
      const id = card.dataset.id;
      const it = Store.state.words.find(x => x.id === id);
      if (!it) return;
      card.querySelectorAll('button').forEach(btn => {
        btn.onclick = async () => {
          const act = btn.dataset.act;
          if (act === 'speak') TTS.speak(it.word, { rate: 0.85 });
          else if (act === 'copy') {
            await navigator.clipboard.writeText(`${it.word}  ${it.meaning}\n${it.sentence}`);
            toast('已复制单词卡片', 'good');
          } else if (act === 'del') {
            Store.removeWord(id);
            this.renderList(); this.renderStats(); this.refreshBadge();
          }
        };
      });
    });
  }
};
