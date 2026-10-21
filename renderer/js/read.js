'use strict';
/* ================= 阅读模块 ================= */
const ReadPage = {
  queue: [],
  current: null,
  busy: false,
  readSec: 0,
  timerInt: null,
  showZh: false,

  init() {
    $('#read-fetch').onclick = () => this.fetchBatch();
    $('#read-done').onclick = () => this.done();
    $('#read-hard').onclick = () => this.feedback(-1);
    $('#read-easy').onclick = () => this.feedback(1);
    $('#read-font-plus').onclick = () => this.changeFont(1);
    $('#read-font-minus').onclick = () => this.changeFont(-1);
    $('#read-toggle-zh').onclick = () => {
      this.showZh = !this.showZh;
      $('#read-toggle-zh').textContent = this.showZh ? '🈚 隐藏译文' : '🈶 显示译文';
      this.renderBody();
    };
    $('#read-copy').onclick = async () => {
      if (!this.current) return;
      await navigator.clipboard.writeText(
        this.current.title + '\n\n' + this.current.en + (this.current.zh ? '\n\n' + this.current.zh : ''));
      toast('已复制文章（含中文）', 'good');
    };
    $('#read-preset').onchange = () => {
      Store.setPreset('read', +$('#read-preset').value);
      this.updateChips();
      toast(`难度已设为「${levelName(Store.state.difficulty.read)}」，正在按新难度推送…`, 'good');
      this.fetchBatch();
    };

    $('#read-scroll').addEventListener('scroll', () => {
      const el = $('#read-scroll');
      const pct = el.scrollHeight - el.clientHeight > 0
        ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0;
      $('#read-progress-bar').style.width = Math.round(pct * 100) + '%';
    });

    this.timerInt = setInterval(() => {
      if (this.current && $('#page-read').classList.contains('active')) {
        this.readSec++;
        $('#read-timer').textContent = '本次阅读 ' + fmtSec(this.readSec) + ' · 累计 ' + fmtMin(this.readSec) + ' 分钟';
      }
    }, 1000);

    $('#read-font-val').textContent = Store.state.settings.readFontSize + 'px';
  },

  onShow() { this.updateChips(); },

  updateChips() {
    const d = Store.state.difficulty.read;
    $('#read-level-chip').textContent = levelName(d) + ' · ' + Math.round(d);
    $('#read-source-chip').textContent = AI.isConfigured() ? 'AI 生成' : '内置题库';
    const sel = $('#read-preset');
    if (sel) sel.value = ListenPage.nearestPreset(d);
  },

  changeFont(delta) {
    const s = Store.state.settings;
    s.readFontSize = Math.max(14, Math.min(30, s.readFontSize + delta));
    document.documentElement.style.setProperty('--read-size', s.readFontSize + 'px');
    $('#read-font-val').textContent = s.readFontSize + 'px';
    Store.save();
  },

  /* ---------------- 获取文章 ---------------- */
  async fetchBatch() {
    if (this.busy) return;
    this.busy = true;
    this.commitTime('article');
    $('#read-fetch').disabled = true;
    $('#read-title').textContent = '正在生成文章…';
    $('#read-body').innerHTML = '';
    $('#read-meta').textContent = '';
    try {
      const n = Store.state.settings.batchSize.read || 3;
      const items = await AI.getReadBatch(Store.state.difficulty.read, n);
      this.queue = items;
      this.updateChips();
      Store.addLibrary('read', items, Store.state.difficulty.read);
      this.showNext(true);
      toast(`已推送 ${items.length} 篇 ${levelName(Store.state.difficulty.read)} 文章（已存入学习库）`, 'good');
    } catch (e) {
      $('#read-title').textContent = '获取失败，点击「换一篇新文章」重试';
      toast('获取失败：' + e.message, 'bad');
    } finally {
      this.busy = false;
      $('#read-fetch').disabled = false;
    }
  },

  showNext(silent) {
    if (!this.queue.length) { if (!silent) this.fetchBatch(); return; }
    this.current = this.queue.shift();
    this.readSec = 0;
    const it = this.current;
    const words = countWords(it.en);
    $('#read-title').textContent = it.title;
    $('#read-level-tag').textContent = levelTag(Store.state.difficulty.read) + ' · ' + levelName(Store.state.difficulty.read);
    $('#read-meta').innerHTML =
      `<span>≈ ${words} 词</span><span>预计 ${Math.max(1, Math.round(words / 130))} 分钟</span>` +
      `<span>剩余队列 ${this.queue.length} 篇</span>`;
    this.renderBody();
    $('#read-scroll').scrollTop = 0;
    $('#read-progress-bar').style.width = '0%';
    $('#read-timer').textContent = '本次阅读 00:00';
  },

  /* 渲染正文：英文段落 + 可选逐段中文对照 */
  renderBody() {
    if (!this.current) { $('#read-body').innerHTML = ''; return; }
    const it = this.current;
    const enParas = String(it.en).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const zhParas = String(it.zh || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

    if (!this.showZh || !zhParas.length) {
      $('#read-body').innerHTML = enParas.map(p => `<p>${escHtml(p)}</p>`).join('');
      return;
    }
    // 逐段对照（段落数不一致时，多余的中文附在文末）
    let html = '';
    enParas.forEach((p, i) => {
      html += `<p>${escHtml(p)}</p>`;
      if (zhParas[i]) html += `<p class="zh-para">${escHtml(zhParas[i])}</p>`;
    });
    if (zhParas.length > enParas.length) {
      html += `<div class="zh-block"><div class="zh-block-title">中文翻译</div>` +
        zhParas.slice(enParas.length).map(p => `<p>${escHtml(p)}</p>`).join('') + `</div>`;
    }
    $('#read-body').innerHTML = html;
  },

  /* 把当前文章的阅读时长入账 */
  commitTime(type) {
    if (!this.current || this.readSec < 2) return;
    Store.addRecord({
      skill: 'read',
      type: type || 'article',
      sec: this.readSec,
      count: type === 'done' ? 1 : 0,
      words: countWords(this.current.en)
    });
    this.readSec = 0;
  },

  /* ---------------- 完成 / 反馈 ---------------- */
  done() {
    if (!this.current) { toast('请先点击「换一篇新文章」'); return; }
    this.commitTime('done');
    Store.addRecord({ skill: 'read', type: 'done', count: 1, words: countWords(this.current.en) });
    toast('已记录本篇阅读 ✅', 'good');
    this.current = null;
    if (this.queue.length) this.showNext();
    else this.fetchBatch();
  },

  async feedback(dir) {
    if (!this.current) { toast('请先开始阅读'); return; }
    this.commitTime('feedback');
    const res = Store.adjustDifficulty('read', dir);
    this.updateChips();
    toast(dir < 0 ? `已调低难度 → ${levelName(res.next)}（后面文章会更简单）` : `已提高难度 → ${levelName(res.next)}（后面文章会更难）`, 'good');
    this.current = null;
    await this.fetchBatch();   // 立即按新难度重推
  }
};
