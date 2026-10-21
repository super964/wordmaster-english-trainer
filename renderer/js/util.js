'use strict';
/* ================= 基础工具 ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function toast(msg, kind = '') {
  const wrap = $('#toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; }, 2400);
  setTimeout(() => el.remove(), 2900);
}

function debounce(fn, ms) {
  let t = null;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function countWords(text) {
  return (String(text).trim().match(/[A-Za-z0-9'’-]+/g) || []).length;
}

function fmtSec(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function fmtMin(sec) {
  return (Math.round((sec || 0) / 6) / 10).toFixed(1);
}

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function fmtDateLabel(key) {
  const [, m, d] = key.split('-');
  return `${+m}/${+d}`;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ================= 难度分级 ================= */
const STAGES = [
  { max: 14,  name: '小学低年级', tag: 'PRIMARY 1-2', desc: 'American grades 1-2 (age 6-8). Very simple present-tense sentences, about 300 basic sight words, short everyday topics.' },
  { max: 29,  name: '小学高年级', tag: 'PRIMARY 3-6', desc: 'American grades 3-6 (age 8-12). Simple past and future, basic connectors, around 1000-1500 vocabulary words.' },
  { max: 44,  name: '初中',       tag: 'JUNIOR HIGH', desc: 'Junior high school (CEFR A2). Past/future tenses, common idioms, 2000 word vocabulary, everyday and school topics.' },
  { max: 59,  name: '高中',       tag: 'SENIOR HIGH', desc: 'Senior high school (CEFR A2+/B1). Perfect tenses, passive voice, relative clauses, 3000-4000 words.' },
  { max: 74,  name: '大学四级',   tag: 'CET-4', desc: 'Chinese college CET-4 level (CEFR B1+). College-life and general-interest topics, 4500 words, some abstract ideas.' },
  { max: 87,  name: '大学六级',   tag: 'CET-6', desc: 'Chinese college CET-6 level (CEFR B2). Argumentative and expository prose, 6000 words, nuanced expressions.' },
  { max: 100, name: '考研留学',   tag: 'IELTS/TOEFL', desc: 'Postgraduate entrance exam or overseas-study level (CEFR C1). Academic vocabulary, complex syntax, formal register.' }
];

function stageIndex(v) {
  for (let i = 0; i < STAGES.length; i++) if (v <= STAGES[i].max) return i;
  return STAGES.length - 1;
}
function stageOf(v) { return STAGES[stageIndex(v)]; }
function levelName(v) { return stageOf(v).name; }
function levelTag(v) { return stageOf(v).tag; }

/* 各阶段文章词数区间（供 AI 生成与离线库校验） */
const ARTICLE_RANGES = [
  [70, 120], [110, 170], [160, 260], [250, 380], [350, 500], [450, 620], [550, 750]
];

const SKILL_NAMES = { listen: '听', speak: '说', read: '读', write: '写' };
const SKILL_COLORS = { listen: '#4f6ef7', speak: '#22c1c3', read: '#f7a23b', write: '#ef476f' };

/* ================= 相似度 / 差异 ================= */
function lcsDiff(a, b) {
  // 返回 ops: [{ch, type:'ok'|'miss'|'extra', pos}]
  const n = a.length, m = b.length;
  if (n * m > 400000) return fallbackDiff(a, b);
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ ch: a[i], type: 'ok' }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ ch: a[i], type: 'miss' }); i++; }
    else { ops.push({ ch: b[j], type: 'extra' }); j++; }
  }
  while (i < n) ops.push({ ch: a[i++], type: 'miss' });
  while (j < m) ops.push({ ch: b[j++], type: 'extra' });
  return ops;
}

function fallbackDiff(a, b) {
  const ops = [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (i < a.length && i < b.length && a[i] === b[i]) ops.push({ ch: a[i], type: 'ok' });
    else if (i < a.length) ops.push({ ch: a[i], type: 'miss' });
    else ops.push({ ch: b[i], type: 'extra' });
  }
  return ops;
}

function similarity(expected, typed) {
  const a = expected.replace(/\s+/g, ' ').trim();
  const b = typed.replace(/\s+/g, ' ').trim();
  if (!a && !b) return 1;
  const n = a.length, m = b.length;
  if (n * m > 400000) return a === b ? 1 : 1 - Math.abs(n - m) / Math.max(n, m);
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  return (2 * dp[0][0]) / (n + m);
}

function renderDiffHtml(ops) {
  return ops.map(o => {
    const esc = o.ch === ' ' ? '&nbsp;' : o.ch === '\n' ? '<br>' : o.ch;
    if (o.type === 'ok') return `<span class="ok">${esc}</span>`;
    if (o.type === 'miss') return `<span class="miss">${esc}</span>`;
    return `<span class="extra">${esc}</span>`;
  }).join('');
}

function escHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
