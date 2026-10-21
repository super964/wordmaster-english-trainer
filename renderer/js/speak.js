'use strict';
/* ================= 口语模块 ================= */
const SpeakPage = {
  items: [],
  idx: 0,
  stats: {},        // idx -> {shadow:n, record:n}
  recs: [],         // {url, sec, ts, idx, mode}
  recMode: null,    // 'shadow' | 'record'
  recording: false,
  busy: false,

  init() {
    $('#speak-fetch').onclick = () => this.fetchBatch();
    $('#speak-play').onclick = () => this.playDemo(0);
    $('#speak-play-slow').onclick = () => this.playDemo(-0.25);
    $('#speak-next').onclick = () => this.next();
    $('#speak-shadow').onclick = () => this.shadow();
    $('#speak-record').onclick = () => this.startRecording('record');
    $('#speak-stop').onclick = () => this.stopRecording();
    $('#speak-copy').onclick = async () => {
      const it = this.cur();
      if (!it) return;
      await navigator.clipboard.writeText(it.en + (it.zh ? '\n' + it.zh : ''));
      toast('已复制中英对照', 'good');
    };
    $('#speak-preset').onchange = () => {
      Store.setPreset('speak', +$('#speak-preset').value);
      this.updateChips();
      toast(`难度已设为「${levelName(Store.state.difficulty.speak)}」，正在按新难度推送…`, 'good');
      this.fetchBatch();
    };
    $('#speak-toggle-zh').onclick = () => {
      this.showZh = !this.showZh;
      $('#speak-zh').classList.toggle('hidden', !this.showZh);
      $('#speak-toggle-zh').textContent = this.showZh ? '隐藏译文' : '显示译文';
    };
    const rate = $('#speak-rate');
    rate.value = Store.state.settings.rate;
    $('#speak-rate-val').textContent = (+rate.value).toFixed(2) + 'x';
    rate.oninput = () => {
      $('#speak-rate-val').textContent = (+rate.value).toFixed(2) + 'x';
      Store.state.settings.rate = +rate.value;
      Store.save();
    };
  },

  onShow() { this.updateChips(); },

  updateChips() {
    const d = Store.state.difficulty.speak;
    $('#speak-level-chip').textContent = levelName(d) + ' · ' + Math.round(d);
    $('#speak-progress-chip').textContent = this.items.length ? `第 ${this.idx + 1} / ${this.items.length} 句` : '第 0 / 0 句';
    const sel = $('#speak-preset');
    if (sel) sel.value = ListenPage.nearestPreset(d);
  },

  async fetchBatch() {
    if (this.busy) return;
    this.busy = true;
    $('#speak-fetch').disabled = true;
    $('#speak-en').textContent = '正在生成句子…';
    try {
      const n = Store.state.settings.batchSize.speak;
      this.items = await AI.getSpeakBatch(Store.state.difficulty.speak, n);
      this.stats = {};
      this.idx = 0;
      this.render();
      this.updateChips();
      Store.addLibrary('speak', this.items, Store.state.difficulty.speak);
      toast(`已推送 ${this.items.length} 个跟读句子（已存入学习库）`, 'good');
    } catch (e) {
      $('#speak-en').textContent = '获取失败，点击「换一批句子」重试';
      toast('获取失败：' + e.message, 'bad');
    } finally {
      this.busy = false;
      $('#speak-fetch').disabled = false;
    }
  },

  cur() { return this.items[this.idx]; },

  render() {
    const it = this.cur();
    if (!it) return;
    $('#speak-en').textContent = it.en;
    $('#speak-zh').textContent = it.zh || '';
    this.updateChips();
    this.renderCounters();
  },

  renderCounters() {
    const st = this.stats[this.idx] || { shadow: 0, record: 0 };
    const total = Object.values(this.stats).reduce((a, b) => a + b.shadow + b.record, 0);
    $('#speak-counters').innerHTML =
      `本句跟读 <b>${st.shadow}</b> 次 · 录音 <b>${st.record}</b> 次　|　本批累计训练 <b>${total}</b> 次`;
  },

  next() {
    if (this.recording) { toast('请先完成录音'); return; }
    TTS.stop();
    if (this.idx < this.items.length - 1) { this.idx++; this.render(); }
    else { toast('本批已练完，去换一批吧', 'good'); }
  },

  playDemo(offset) {
    const it = this.cur();
    if (!it) { toast('请先点击「换一批句子」'); return; }
    const rate = Math.max(0.5, +$('#speak-rate').value + (offset || 0));
    $('#speak-status').textContent = offset ? '慢速示范中…' : '示范朗读中…';
    TTS.speak(it.en, {
      rate,
      onEnd: () => { $('#speak-status').textContent = '示范完毕，轮到你开口 → 点「🎤 跟读」'; },
      onError: (e) => { $('#speak-status').textContent = '示范失败：' + e.message; }
    });
  },

  /* ---------------- 跟读：先听示范，再自动开始录音 ---------------- */
  shadow() {
    const it = this.cur();
    if (!it) { toast('请先点击「换一批句子」'); return; }
    if (this.recording) { toast('正在录音中'); return; }
    TTS.stop();
    $('#speak-status').textContent = '示范朗读中… 仔细听';
    TTS.speak(it.en, {
      rate: +$('#speak-rate').value,
      onEnd: () => {
        $('#speak-status').textContent = '轮到你了，开口跟读（说完自动结束）…';
        this.startRecording('shadow');
      },
      onError: () => {
        $('#speak-status').textContent = '示范失败，直接进入跟读录音';
        this.startRecording('shadow');
      }
    });
  },

  async startRecording(mode) {
    if (this.recording) return;
    if (!this.cur()) { toast('请先点击「换一批句子」'); return; }
    try {
      await Recorder.start({
        onLevel: (rms) => Waveform.push(rms),
        autoStop: mode === 'shadow' ? { silenceSec: 1.8, minSec: 1, maxSec: 40 } : { silenceSec: 4, minSec: 1, maxSec: 60 },
        onAutoStop: (result) => this.finishRecording(mode, result, true)
      });
    } catch (e) {
      toast(e.message, 'bad');
      $('#speak-status').textContent = e.message;
      return;
    }
    this.recording = true;
    this.recMode = mode;
    $('#speak-stop').classList.remove('hidden');
    $('#speak-shadow').disabled = true;
    $('#speak-record').disabled = true;
    $('#speak-status').classList.add('rec');
    $('#speak-status').textContent = mode === 'shadow' ? '● 录音中（跟读）… 说完停顿 2 秒自动结束' : '● 录音中（自由朗读）… 点「完成录音」结束';
    $('#speak-wave-wrap').classList.remove('hidden');
    Waveform.start($('#speak-wave'));
  },

  async stopRecording() {
    if (!this.recording) return;
    const result = await Recorder.stop();
    if (result) this.finishRecording(this.recMode, result, false);
  },

  finishRecording(mode, result, auto) {
    this.recording = false;
    Waveform.stop();
    $('#speak-wave-wrap').classList.add('hidden');
    $('#speak-stop').classList.add('hidden');
    $('#speak-shadow').disabled = false;
    $('#speak-record').disabled = false;
    $('#speak-status').classList.remove('rec');

    // 录音列表（会话内）
    const rec = { url: result.url, sec: result.sec, ts: Date.now(), idx: this.idx, mode };
    this.recs.unshift(rec);
    if (this.recs.length > 20) { const old = this.recs.pop(); URL.revokeObjectURL(old.url); }
    this.renderRecs();

    const st = this.stats[this.idx] = this.stats[this.idx] || { shadow: 0, record: 0 };
    st[mode === 'shadow' ? 'shadow' : 'record']++;
    Store.addRecord({ skill: 'speak', type: mode === 'shadow' ? 'shadow' : 'record', sec: result.sec, count: 1 });
    this.renderCounters();

    $('#speak-status').textContent = `已保存录音 ${result.sec.toFixed(1)} 秒${auto ? '（自动结束）' : ''}，可回放对比，再点「跟读」巩固`;
  },

  renderRecs() {
    const ul = $('#speak-recs');
    if (!this.recs.length) { ul.innerHTML = '<li class="empty">还没有录音，点左边开始</li>'; return; }
    ul.innerHTML = this.recs.map((r, i) => `
      <li>
        <button class="rec-play" data-i="${i}">▶</button>
        <span>${r.mode === 'shadow' ? '跟读' : '朗读'} · ${r.sec.toFixed(1)}s · ${fmtTime(r.ts)}</span>
        <button class="rec-del" data-i="${i}" title="删除">✕</button>
      </li>`).join('');
    $$('.rec-play', ul).forEach(b => b.onclick = () => {
      const r = this.recs[+b.dataset.i];
      new Audio(r.url).play();
    });
    $$('.rec-del', ul).forEach(b => b.onclick = () => {
      const i = +b.dataset.i;
      URL.revokeObjectURL(this.recs[i].url);
      this.recs.splice(i, 1);
      this.renderRecs();
    });
  }
};
