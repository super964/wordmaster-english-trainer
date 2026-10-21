'use strict';
/* ================= 学习库（历史内容归档 / 复习 / 复制） ================= */
const LibraryPage = {
  filter: 'all',
  q: '',
  level: 'all',
  expanded: new Set(),

  init() {
    $$('#lib-filter button').forEach(b => {
      b.onclick = () => {
        $$('#lib-filter button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.filter = b.dataset.skill;
        this.render();
      };
    });
    $('#lib-search').addEventListener('input', debounce(() => {
      this.q = $('#lib-search').value.trim().toLowerCase();
      this.render();
    }, 250));
    $('#lib-level').onchange = () => { this.level = $('#lib-level').value; this.render(); };
    $('#lib-export-txt').onclick = () => this.exportTxt();
    $('#lib-export-json').onclick = async () => {
      const res = await window.api.exportFile({
        content: JSON.stringify(Store.state.library, null, 2),
        defaultName: `WordMaster学习库_${dayKey()}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (res.ok) toast('已导出：' + res.path, 'good');
    };
  },

  onShow() { this.render(); },

  items() {
    return Store.state.library.filter(it => {
      if (this.filter !== 'all' && it.skill !== this.filter) return false;
      if (this.level !== 'all' && stageIndex(it.level) !== +this.level) return false;
      if (this.q) {
        const hay = (it.title + ' ' + it.en + ' ' + it.zh).toLowerCase();
        if (!hay.includes(this.q)) return false;
      }
      return true;
    });
  },

  render() {
    const all = Store.state.library;
    const items = this.items();
    const cnt = (sk) => all.filter(x => x.skill === sk).length;
    $('#lib-counts').innerHTML =
      `共 <b>${all.length}</b> 条 · 听 ${cnt('listen')} · 说 ${cnt('speak')} · 读 ${cnt('read')} · 写 ${cnt('write')}` +
      (items.length !== all.length ? `　（筛选出 ${items.length} 条）` : '');

    const skillIco = { listen: '🎧', speak: '🎤', read: '📖', write: '⌨️' };
    $('#lib-list').innerHTML = items.length ? items.slice(0, 300).map(it => {
      const open = this.expanded.has(it.id);
      const enShort = it.en.length > 180 && !open ? it.en.slice(0, 180) + '…' : it.en;
      return `
      <div class="lib-card" data-id="${it.id}">
        <div class="lib-head">
          <span class="lib-badge b-${it.skill}">${skillIco[it.skill] || ''} ${SKILL_NAMES[it.skill]}</span>
          <span class="lib-level">${levelName(it.level)}</span>
          <span class="lib-date">${new Date(it.ts).toLocaleDateString('zh-CN')} ${fmtTime(it.ts)}</span>
          <span class="lib-actions">
            <button class="btn tiny" data-act="speak">🔊 朗读</button>
            <button class="btn tiny" data-act="copy">📋 复制</button>
            <button class="btn tiny" data-act="copy2">📋 中英对照</button>
            <button class="btn tiny" data-act="del">🗑</button>
          </span>
        </div>
        ${it.title ? `<div class="lib-title">${escHtml(it.title)}</div>` : ''}
        <div class="lib-en">${escHtml(enShort)}</div>
        <div class="lib-tools">
          ${it.en.length > 180 ? `<button class="btn tiny ghost" data-act="expand">${open ? '收起' : '展开全文'}</button>` : ''}
          ${it.zh ? `<button class="btn tiny ghost" data-act="zh">${this.expanded.has('zh' + it.id) ? '隐藏中文' : '显示中文'}</button>` : ''}
        </div>
        ${it.zh && this.expanded.has('zh' + it.id) ? `<div class="lib-zh">${escHtml(it.zh)}</div>` : ''}
      </div>`;
    }).join('') : '<div class="empty" style="padding:30px;text-align:center">暂无内容。听 / 说 / 读 / 写的训练材料会自动存进这里，方便日后复习。</div>';

    $$('#lib-list .lib-card').forEach(card => {
      const id = card.dataset.id;
      const it = Store.state.library.find(x => x.id === id);
      if (!it) return;
      card.querySelectorAll('button').forEach(btn => {
        btn.onclick = async () => {
          const act = btn.dataset.act;
          if (act === 'speak') TTS.speak(it.en, { rate: Store.state.settings.rate });
          else if (act === 'copy') { await navigator.clipboard.writeText(it.en); toast('已复制英文', 'good'); }
          else if (act === 'copy2') { await navigator.clipboard.writeText(it.en + (it.zh ? '\n' + it.zh : '')); toast('已复制中英对照', 'good'); }
          else if (act === 'del') { Store.removeLibrary(id); this.render(); }
          else if (act === 'expand') { this.expanded.has(id) ? this.expanded.delete(id) : this.expanded.add(id); this.render(); }
          else if (act === 'zh') { const k = 'zh' + id; this.expanded.has(k) ? this.expanded.delete(k) : this.expanded.add(k); this.render(); }
        };
      });
    });
  },

  async exportTxt() {
    const items = this.items();
    if (!items.length) { toast('没有可导出的内容'); return; }
    const skillIco = { listen: '【听】', speak: '【说】', read: '【读】', write: '【写】' };
    const text = items.map(it =>
      `${skillIco[it.skill] || ''} ${levelName(it.level)} · ${new Date(it.ts).toLocaleDateString('zh-CN')}\n` +
      (it.title ? it.title + '\n' : '') +
      it.en + '\n' + (it.zh || '') + '\n' + '─'.repeat(50)
    ).join('\n\n');
    const res = await window.api.exportFile({
      content: 'WordMaster 学习库导出\n\n' + text,
      defaultName: `WordMaster学习库_${dayKey()}.txt`,
      filters: [{ name: 'TXT', extensions: ['txt'] }]
    });
    if (res.ok) toast('已导出 ' + items.length + ' 条：' + res.path, 'good');
  }
};
