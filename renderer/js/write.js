'use strict';
/* ================= 写作（打字抄写）模块 ================= */
const WritePage = {
  items: [],
  idx: 0,
  startTs: 0,
  submitted: false,
  busy: false,
  accSum: 0,
  accN: 0,

  init() {
    $('#write-fetch').onclick = () => this.fetchBatch();
    $('#write-submit').onclick = () => this.submit();
    $('#write-next').onclick = () => this.next();
    $('#write-skip').onclick = () => this.next(true);
    $('#write-speak').onclick = () => {
      const it = this.cur();
      if (!it) return;
      TTS.speak(it.en, { rate: Store.state.settings.rate });
    };
    $('#write-toggle-zh').onclick = () => {
      this.showZh = !this.showZh;
      $('#write-prompt-zh').classList.toggle('hidden', !this.showZh);
      $('#write-toggle-zh').textContent = this.showZh ? '隐藏译文' : '显示译文';
    };
    $('#write-copy').onclick = async () => {
      const it = this.cur();
      if (!it) return;
      await navigator.clipboard.writeText(it.en + (it.zh ? '\n' + it.zh : ''));
      toast('已复制中英对照', 'good');
    };
    $('#write-preset').onchange = () => {
      Store.setPreset('write', +$('#write-preset').value);
      this.onShow();
      toast(`难度已设为「${levelName(Store.state.difficulty.write)}」，正在按新难度推送…`, 'good');
      this.fetchBatch();
    };
    $('#write-input').addEventListener('input', () => {
      $('#write-count').textContent = $('#write-input').value.length + ' 字符';
    });
    $('#write-input').addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); this.submit(); }
    });
  },

  onShow() {
    const d = Store.state.difficulty.write;
    $('#write-level-chip').textContent = levelName(d) + ' · ' + Math.round(d);
    $('#write-progress-chip').textContent = this.items.length ? `第 ${this.idx + 1} / ${this.items.length} 句` : '第 0 / 0 句';
    const sel = $('#write-preset');
    if (sel) sel.value = ListenPage.nearestPreset(d);
    this.updateToday();
    setTimeout(() => { if (this.cur()) $('#write-input').focus(); }, 60);
  },

  cur() { return this.items[this.idx]; },

  async fetchBatch() {
    if (this.busy) return;
    this.busy = true;
    $('#write-fetch').disabled = true;
    $('#write-prompt-en').textContent = '正在生成句子…';
    try {
      const n = Store.state.settings.batchSize.write;
      this.items = await AI.getWriteBatch(Store.state.difficulty.write, n);
      this.idx = 0;
      this.render();
      this.onShow();
      Store.addLibrary('write', this.items, Store.state.difficulty.write);
      toast(`已推送 ${this.items.length} 句打字素材（已存入学习库）`, 'good');
    } catch (e) {
      $('#write-prompt-en').textContent = '获取失败，点击「换一批句子」重试';
      toast('获取失败：' + e.message, 'bad');
    } finally {
      this.busy = false;
      $('#write-fetch').disabled = false;
    }
  },

  render() {
    const it = this.cur();
    if (!it) return;
    $('#write-prompt-en').textContent = it.en;
    $('#write-prompt-zh').textContent = it.zh || '';
    $('#write-input').value = '';
    $('#write-count').textContent = '0 字符';
    $('#write-accuracy').textContent = '';
    $('#write-result').classList.add('hidden');
    $('#write-result').innerHTML = '';
    this.submitted = false;
    this.startTs = Date.now();
    $('#write-input').focus();
  },

  /* ---------------- 提交批改 ---------------- */
  submit() {
    const it = this.cur();
    if (!it) { toast('请先点击「换一批句子」'); return; }
    const typed = $('#write-input').value;
    if (!typed.trim()) { toast('还没有输入内容哦'); $('#write-input').focus(); return; }

    const sec = (Date.now() - this.startTs) / 1000;
    const sim = similarity(it.en, typed);
    const score = Math.round(sim * 100);
    const ops = lcsDiff(it.en, typed);

    const label = score >= 97 ? '完美 🎉' : score >= 90 ? '优秀 👍' : score >= 78 ? '不错，继续加油' : score >= 60 ? '有些地方要再仔细' : '建议对照原文重打一遍';
    const box = `
      <div class="wr-head">
        <span class="wr-score">${score}%</span>
        <span class="wr-label">${label} · 用时 ${sec.toFixed(1)}s · 输入 ${typed.length} 字符</span>
      </div>
      <div class="wr-title">逐字符对比（<span class="ok" style="color:#16a34a">绿色=正确</span> · <span style="color:var(--hard)">红色=漏打/打错</span> · <span style="color:#d1831f">橙色删除线=多打</span>）</div>
      <div class="diff-box">${renderDiffHtml(ops)}</div>
      ${score < 100 ? `<div class="wr-title">正确答案</div><div class="diff-box"><span class="ok">${escHtml(it.en)}</span></div>` : ''}
    `;
    const boxEl = $('#write-result');
    boxEl.innerHTML = box;
    boxEl.classList.remove('hidden');
    $('#write-accuracy').textContent = '准确率 ' + score + '%';

    Store.addRecord({
      skill: 'write', type: 'submit', sec,
      count: 1, chars: typed.length, note: 'acc:' + score
    });
    this.accSum += score; this.accN++;
    this.submitted = true;
    this.updateToday();
    toast(`已记录：${typed.length} 字符 · 准确率 ${score}%`, 'good');
  },

  next(skip) {
    if (skip && !this.submitted) {
      Store.addRecord({ skill: 'write', type: 'skip', count: 1 });
    }
    if (this.idx < this.items.length - 1) {
      this.idx++;
      this.render();
      $('#write-progress-chip').textContent = `第 ${this.idx + 1} / ${this.items.length} 句`;
    } else {
      toast('本批练完，点「换一批句子」继续', 'good');
    }
  },

  updateToday() {
    const agg = Store.aggregateToday().write;
    $('#write-today-chars').textContent = agg.chars;
    $('#write-today-count').textContent = agg.count;
    $('#write-today-acc').textContent = this.accN ? Math.round(this.accSum / this.accN) + '%' : '—';
  }
};
