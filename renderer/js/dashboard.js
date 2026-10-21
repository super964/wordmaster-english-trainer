'use strict';
/* ================= 总记录 / 可视化 ================= */
const Dashboard = {
  metric: 'min',

  init() {
    $$('#dash-metric-toggle button').forEach(b => {
      b.onclick = () => {
        $$('#dash-metric-toggle button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.metric = b.dataset.metric;
        this.renderMainChart();
      };
    });
    $('#dash-export-csv').onclick = async () => {
      const res = await window.api.exportFile({
        content: Store.toCSV(),
        defaultName: `WordMaster训练记录_${dayKey()}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      });
      if (res.ok) toast('已导出：' + res.path, 'good');
    };
    window.addEventListener('resize', debounce(() => Charts.redrawAll(), 200));
  },

  onShow() {
    this.renderCards();
    this.renderMainChart();
    this.renderDiffChart();
    this.renderTodayChart();
    this.renderTable();
  },

  /* ---------------- 顶部卡片 ---------------- */
  renderCards() {
    const today = Store.aggregateToday();
    const goals = Store.state.settings.goals;
    const totalSec = Store.state.records.reduce((a, r) => a + (r.sec || 0), 0);
    const streak = Store.streakDays();
    const ws = Store.wordStats();

    const card = (cls, ico, num, label, pct, page) => `
      <div class="stat-card ${cls}" ${page ? `data-goto="${page}" style="cursor:pointer" title="点击跳转"` : ''}>
        <div class="sc-ico">${ico}</div>
        <div class="sc-num">${num}</div>
        <div class="sc-label">${label}</div>
        <div class="sc-bar"><i style="width:${Math.min(100, Math.round(pct))}%"></i></div>
      </div>`;

    $('#dash-cards').innerHTML =
      card('c1', '🎧', fmtMin(today.listen.sec) + ' 分', `听力 · 目标 ${goals.listen} 分钟`, today.listen.sec / 60 / goals.listen * 100) +
      card('c2', '🎤', today.speak.count + ' 次', `口语 · 目标 ${goals.speak} 次`, today.speak.count / goals.speak * 100) +
      card('c3', '📖', fmtMin(today.read.sec) + ' 分', `阅读 · 目标 ${goals.read} 分钟`, today.read.sec / 60 / goals.read * 100) +
      card('c4', '⌨️', today.write.chars + ' 字', `写作 · 目标 ${goals.write} 字符`, today.write.chars / goals.write * 100) +
      card('', '🔥', streak + ' 天', '连续训练天数', streak / 30 * 100) +
      card('', '⏱️', (Math.round(totalSec / 36) / 10) + ' 小时', '累计训练时长', 100) +
      (ws.total ? card(ws.due ? 'c2' : 'c4', ws.due ? '⏰' : '⭐', ws.due ? ws.due + ' 个' : '✅', ws.due ? '生词待复习 · 点击去复习' : '生词今日已复习完', ws.total ? (ws.mastered / ws.total * 100) : 0, 'vocab') : '');

    $$('#dash-cards [data-goto]').forEach(el => {
      el.onclick = () => App.switchPage(el.dataset.goto);
    });
  },

  /* ---------------- 30 天曲线 ---------------- */
  renderMainChart() {
    const days = Store.aggregateDays(30);
    const labels = days.map(d => d.key);
    const val = (skill) => days.map(d => {
      const s = d[skill];
      if (this.metric === 'min') return Math.round(s.sec / 6) / 10;
      if (this.metric === 'count') return s.count;
      return s.units;
    });
    const unit = this.metric === 'min' ? ' 分钟' : this.metric === 'count' ? ' 次' : '';
    const series = ['listen', 'speak', 'read', 'write'].map(skill => ({
      name: SKILL_NAMES[skill] + ' · ' + ({ listen: '听力', speak: '口语', read: '阅读', write: '写作' })[skill],
      color: SKILL_COLORS[skill],
      data: val(skill),
      fill: skill === 'listen'
    }));
    Charts.line($('#dash-chart'), {
      labels, series,
      xFormat: fmtDateLabel,
      valueFormat: v => v + unit
    });
    $('#dash-legend').innerHTML = series.map(s =>
      `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('') +
      `<span style="color:var(--ink-3)">悬停曲线可查看具体数值</span>`;
  },

  /* ---------------- 难度曲线 ---------------- */
  renderDiffChart() {
    const { labels, series } = Store.difficultySeries(30);
    const opts = [];
    if (labels.length) {
      opts.push({ name: '听力难度', color: SKILL_COLORS.listen, data: series.listen, fill: true });
      opts.push({ name: '阅读难度', color: SKILL_COLORS.read, data: series.read, fill: true });
    }
    Charts.line($('#dash-diff-chart'), {
      labels: labels.length ? labels : [],
      series: opts,
      xFormat: fmtDateLabel,
      valueFormat: v => Math.round(v) + ' 分'
    });
    $('#dash-diff-legend').innerHTML = `
      <span><i style="background:${SKILL_COLORS.listen}"></i>听力难度（0-100）</span>
      <span><i style="background:${SKILL_COLORS.read}"></i>阅读难度（0-100）</span>
      <span style="color:var(--ink-3)">点「太难 / 太简单」就会推动曲线变化</span>`;
  },

  /* ---------------- 今日分布（完成度） ---------------- */
  renderTodayChart() {
    const t = Store.aggregateToday();
    const g = Store.state.settings.goals;
    const pcts = [
      Math.round(t.listen.sec / 60 / g.listen * 100),
      Math.round(t.speak.count / g.speak * 100),
      Math.round(t.read.sec / 60 / g.read * 100),
      Math.round(t.write.chars / g.write * 100)
    ];
    Charts.bar($('#dash-today-chart'), {
      labels: ['听', '说', '读', '写'],
      values: pcts,
      colors: [SKILL_COLORS.listen, SKILL_COLORS.speak, SKILL_COLORS.read, SKILL_COLORS.write],
      valueFormat: v => v + '%'
    });
  },

  /* ---------------- 明细表 ---------------- */
  renderTable() {
    const typeZh = { play: '播放一段', master: '标记听熟', feedback: '难度反馈', shadow: '跟读', record: '录音读', done: '读完一篇', submit: '提交打字', article: '阅读中', skip: '跳过' };
    const rows = Store.state.records.slice(-30).reverse();
    $('#dash-table').innerHTML = rows.length ? rows.map(r => `
      <tr>
        <td>${new Date(r.ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
        <td><b style="color:${SKILL_COLORS[r.skill] || '#666'}">${SKILL_NAMES[r.skill] || r.skill}</b></td>
        <td>${typeZh[r.type] || r.type}${r.note ? ' · ' + escHtml(r.note) : ''}</td>
        <td>${r.sec ? Math.round(r.sec) + 's' : '—'}</td>
        <td>${r.count ? r.count + ' 次' : ''}${r.chars ? ' / ' + r.chars + ' 字符' : ''}${r.words ? ' / ' + r.words + ' 词' : ''}</td>
        <td>${r.level != null ? levelName(r.level) : '—'}</td>
      </tr>`).join('') : '<tr><td colspan="6" style="color:var(--ink-3);padding:16px">还没有训练记录，去「听 / 说 / 读 / 写」开始吧</td></tr>';
  }
};
