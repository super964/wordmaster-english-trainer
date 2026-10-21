'use strict';
/* ================= 听力模块 ================= */
const ListenPage = {
  items: [],
  idx: 0,
  plays: [],        // 每段播放次数
  mastered: [],     // 是否已听熟
  playing: false,
  playCountInSeq: 0,
  playHandle: null,
  playStartTs: 0,
  showZh: false,
  busy: false,

  init() {
    $('#listen-fetch').onclick = () => this.fetchBatch();
    $('#listen-play').onclick = () => this.playing ? this.stop('已暂停') : this.play();
    $('#listen-prev').onclick = () => this.select(this.idx - 1);
    $('#listen-next').onclick = () => this.select(this.idx + 1);
    $('#listen-toggle-zh').onclick = () => {
      this.showZh = !this.showZh;
      $('#listen-zh').classList.toggle('hidden', !this.showZh);
      $('#listen-toggle-zh').textContent = this.showZh ? '隐藏译文' : '显示译文';
    };
    $('#listen-toggle-en').onclick = () => {
      const el = $('#listen-en');
      const blurred = el.classList.toggle('blur');
      $('#listen-toggle-en').textContent = blurred ? '显示原文' : '隐藏原文';
    };
    $('#listen-master').onclick = () => this.master();
    $('#listen-hard').onclick = () => this.feedback(-1);
    $('#listen-easy').onclick = () => this.feedback(1);
    $('#listen-copy').onclick = async () => {
      const it = this.items[this.idx];
      if (!it) return;
      await navigator.clipboard.writeText(it.en + (it.zh ? '\n' + it.zh : ''));
      toast('已复制中英对照', 'good');
    };
    $('#listen-preset').onchange = () => this.preset(+$('#listen-preset').value);

    const rate = $('#listen-rate');
    rate.value = Store.state.settings.rate;
    $('#listen-rate-val').textContent = (+rate.value).toFixed(2) + 'x';
    rate.oninput = () => {
      $('#listen-rate-val').textContent = (+rate.value).toFixed(2) + 'x';
      Store.state.settings.rate = +rate.value;
      Store.save();
    };
    $('#listen-repeat').onchange = () => this.stop('循环设置已更新');
  },

  onShow() { this.updateChips(); },

  /* 一键难度预设 */
  preset(value) {
    Store.setPreset('listen', value);
    this.updateChips();
    toast(`难度已设为「${levelName(value)}」，正在按新难度推送…`, 'good');
    this.fetchBatch();
  },

  updateChips() {
    const d = Store.state.difficulty.listen;
    $('#listen-level-chip').textContent = levelName(d) + ' · ' + Math.round(d);
    $('#listen-source-chip').textContent = AI.isConfigured() ? 'AI 生成' : '内置题库';
    $('#side-level').textContent = '当前：' + levelName(d);
    const sel = $('#listen-preset');
    if (sel) sel.value = this.nearestPreset(d);
  },

  /* 把当前难度映射到最接近的预设选项 */
  nearestPreset(d) {
    const opts = [22, 37, 52, 67, 81, 94];
    return opts.reduce((a, b) => Math.abs(b - d) < Math.abs(a - d) ? b : a, opts[0]);
  },

  /* ---------------- 获取一批文段 ---------------- */
  async fetchBatch() {
    if (this.busy) return;
    this.busy = true;
    this.stop('');
    $('#listen-loading').classList.remove('hidden');
    $('#listen-fetch').disabled = true;
    try {
      const n = Store.state.settings.batchSize.listen;
      const items = await AI.getListenBatch(Store.state.difficulty.listen, n);
      this.items = items;
      this.plays = new Array(items.length).fill(0);
      this.mastered = new Array(items.length).fill(false);
      this.select(0, true);
      this.updateChips();
      this.renderList();
      Store.addLibrary('listen', items, Store.state.difficulty.listen);
      toast(`已推送 ${items.length} 段 · ${levelName(Store.state.difficulty.listen)}难度（已存入学习库）`, 'good');
    } catch (e) {
      toast('获取失败：' + e.message, 'bad');
      $('#listen-en').textContent = '获取失败，点击「换一批文段」重试';
    } finally {
      this.busy = false;
      $('#listen-loading').classList.add('hidden');
      $('#listen-fetch').disabled = false;
    }
  },

  /* ---------------- 渲染 ---------------- */
  renderList() {
    const ul = $('#listen-list');
    ul.innerHTML = this.items.map((it, i) => `
      <li class="${i === this.idx ? 'active' : ''} ${this.mastered[i] ? 'mastered' : ''}" data-i="${i}">
        <span class="seg-idx">${this.mastered[i] ? '✓' : i + 1}</span>
        <span>${escHtml(it.en.slice(0, 42))}${it.en.length > 42 ? '…' : ''}</span>
        <span class="seg-plays">${this.plays[i] ? this.plays[i] + '次' : ''}</span>
      </li>`).join('');
    $('#listen-list-meta').textContent = this.items.length ? `共 ${this.items.length} 段` : '';
    $$('#listen-list li').forEach(li => li.onclick = () => this.select(+li.dataset.i));
  },

  render() {
    const it = this.items[this.idx];
    if (!it) return;
    $('#listen-en').textContent = it.en;
    $('#listen-zh').textContent = it.zh || '';
    $('#listen-list-meta').textContent = `共 ${this.items.length} 段 · 已听熟 ${this.mastered.filter(Boolean).length}`;
    this.renderList();
  },

  select(i, silent) {
    if (!this.items.length) return;
    if (i < 0) i = 0;
    if (i >= this.items.length) { this.master(); return; }
    if (!silent) this.stop('');
    this.idx = i;
    this.render();
    $('#listen-state').textContent = '待播放（第 ' + (i + 1) + ' 段）';
  },

  /* ---------------- 播放 ---------------- */
  play() {
    const it = this.items[this.idx];
    if (!it) { toast('请先点击「换一批文段」'); return; }
    const repeat = +$('#listen-repeat').value;   // 0 = 连续循环
    const seqStart = () => { this.playCountInSeq = 0; this._playOnce(repeat); };
    seqStart();
  },

  _playOnce(repeat) {
    const it = this.items[this.idx];
    const rate = +$('#listen-rate').value;
    this.playing = true;
    $('#listen-play').textContent = '⏸ 暂停';
    $('#listen-state').textContent = repeat === 0
      ? `循环播放中 · 第 ${this.playCountInSeq + 1} 遍（点暂停结束）`
      : `朗读中 · 第 ${this.playCountInSeq + 1} / ${repeat} 遍`;

    this.playHandle = TTS.speak(it.en, {
      rate,
      onStart: () => { this.playStartTs = Date.now(); },
      onEnd: () => {
        if (!this.playing) return;
        const sec = (Date.now() - this.playStartTs) / 1000 || countWords(it.en) * 0.45;
        Store.addRecord({ skill: 'listen', type: 'play', sec, count: 1, words: countWords(it.en) });
        this.plays[this.idx]++;
        this.playCountInSeq++;
        const autoAdvance = $('#listen-auto').checked;
        const doneAll = repeat !== 0 && this.playCountInSeq >= repeat;
        if (!doneAll) {
          this.renderList();
          this._playOnce(repeat);
        } else if (autoAdvance && this.idx < this.items.length - 1) {
          $('#listen-state').textContent = '听熟程度不错，自动进入下一段…';
          this.renderList();
          setTimeout(() => { if (this.playing) { this.playing = false; this.select(this.idx + 1); this.play(); } }, 700);
        } else {
          this.playing = false;
          $('#listen-play').textContent = '▶ 播放';
          $('#listen-state').textContent = this.idx === this.items.length - 1 ? '已是最后一段' : '播放完成，可点「听熟了，下一段」';
          this.renderList();
        }
      },
      onError: (e) => {
        this.playing = false;
        $('#listen-play').textContent = '▶ 播放';
        $('#listen-state').textContent = '播放失败';
        toast('朗读失败：' + e.message + '（可在设置里换语音引擎）', 'bad');
      }
    });
  },

  stop(msg) {
    TTS.stop();
    if (this.playing && this.playStartTs) {
      // 中途停止也记一笔短时长
    }
    this.playing = false;
    this.playCountInSeq = 0;
    $('#listen-play').textContent = '▶ 播放';
    if (msg) $('#listen-state').textContent = msg;
  },

  /* ---------------- 听熟 / 反馈 ---------------- */
  master() {
    if (!this.items.length) return;
    if (!this.mastered[this.idx]) {
      this.mastered[this.idx] = true;
      Store.addRecord({ skill: 'listen', type: 'master', count: 1 });
    }
    this.stop('已标记听熟');
    this.renderList();
    if (this.idx < this.items.length - 1) this.select(this.idx + 1);
    else { toast('本批全部听熟 🎉', 'good'); this.fetchBatch(); }
  },

  async feedback(dir) {
    if (!this.items.length) { toast('请先开始训练'); return; }
    const res = Store.adjustDifficulty('listen', dir);
    this.updateChips();
    toast(dir < 0 ? `已调低难度 → ${levelName(res.next)}（后面会更简单）` : `已提高难度 → ${levelName(res.next)}（后面会更难）`, 'good');
    this.stop('');
    await this.fetchBatch();   // 立即按新难度重推一批
  }
};
