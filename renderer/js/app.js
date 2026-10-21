'use strict';
/* ================= 应用入口 ================= */
window.addEventListener('error', (e) => console.error('[WINDOW ERROR]', (e.error && e.error.stack) || e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[REJECT]', (e.reason && e.reason.stack) || String(e.reason)));

const App = {
  page: 'listen',
  modules: {},

  async init() {
    Store.init();
    await Store.load();

    document.documentElement.style.setProperty('--font-scale', Store.state.settings.fontScale || 1);
    document.documentElement.style.setProperty('--read-size', Store.state.settings.readFontSize + 'px');

    this.modules = {
      listen: ListenPage, speak: SpeakPage, read: ReadPage,
      write: WritePage, phonics: PhonicsPage, dashboard: Dashboard,
      library: LibraryPage, vocab: VocabPage, dict: DictPage, settings: SettingsPage
    };
    for (const m of Object.values(this.modules)) if (m.init) m.init();

    // 主题
    this.applyTheme(Store.state.settings.theme || 'light');
    $('#theme-toggle').onclick = () => {
      const next = (Store.state.settings.theme === 'dark') ? 'light' : 'dark';
      Store.state.settings.theme = next;
      Store.save();
      this.applyTheme(next);
    };

    // 导航
    $$('.nav-item').forEach(btn => {
      btn.onclick = () => this.switchPage(btn.dataset.page);
    });

    TTS.init();
    WordCollect.init();
    VocabPage.refreshBadge();
    this.updateModeBadge();
    this.modules.listen.onShow();

    // 启动时提醒今日待复习单词
    setTimeout(() => {
      const due = Store.wordStats().due;
      if (due > 0) {
        toast(`⏰ 今天有 ${due} 个单词到期待复习，点侧栏「单词本」开始`, 'good');
      }
    }, 1200);

    // 快捷键：Ctrl+1~9 切页
    document.addEventListener('keydown', (e) => {
      if (!e.ctrlKey) return;
      const order = ['listen', 'speak', 'read', 'write', 'phonics', 'dashboard', 'library', 'vocab', 'dict', 'settings'];
      const i = parseInt(e.key, 10);
      if (i >= 1 && i <= order.length) { e.preventDefault(); this.switchPage(order[i - 1]); }
    });

    // 侧边栏词典快搜：回车 → 打开词典页查词
    const sideDict = $('#side-dict-search');
    if (sideDict) {
      const doSearch = () => {
        const w = sideDict.value.trim();
        if (!w) return;
        this.switchPage('dict');
        DictPage.lookup(w);
      };
      sideDict.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
    }
  },

  switchPage(name) {
    if (this.page === name) return;
    // 切页时停止正在进行的音频/录音
    TTS.stop();
    if (this.page === 'listen' && ListenPage.playing) ListenPage.stop('已切换页面');
    if (this.page === 'speak' && SpeakPage.recording) SpeakPage.stopRecording();
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === name));
    $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
    this.page = name;
    const m = this.modules[name];
    if (m && m.onShow) m.onShow();
  },

  applyTheme(theme) {
    document.body.dataset.theme = theme;
    const btn = $('#theme-toggle');
    if (btn) {
      btn.querySelector('.theme-ico').textContent = theme === 'dark' ? '☀️' : '🌙';
      btn.querySelector('.theme-text').textContent = theme === 'dark' ? '浅色模式' : '深色模式';
    }
    setTimeout(() => Charts.redrawAll(), 60);
  },

  updateModeBadge() {
    const el = $('#side-mode');
    const ai = AI.isConfigured();
    el.textContent = ai ? 'AI 生成模式' : '内置素材模式';
    el.classList.toggle('ai', ai);
    if (typeof ListenPage !== 'undefined') ListenPage.updateChips();
    if (typeof ReadPage !== 'undefined') ReadPage.updateChips();
  },

  onRecord(rec) {
    // 记录产生后同步各处显示
    if (rec.skill === 'write') WritePage.updateToday();
    if (this.page === 'dashboard') Dashboard.onShow();
  }
};

window.addEventListener('DOMContentLoaded', () => App.init().catch(e => {
  console.error('[INIT ERROR]', (e && e.stack) || e);
  toast('启动失败：' + e.message, 'bad');
}));
