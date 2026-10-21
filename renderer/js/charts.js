'use strict';
/* ================= Canvas 图表（无外部依赖） ================= */
const Charts = {
  _registry: new Map(),   // canvas -> draw fn

  attach(canvas, drawFn) {
    this._registry.set(canvas, drawFn);
    drawFn();
  },

  redrawAll() {
    for (const fn of this._registry.values()) { try { fn(); } catch (e) { console.error(e); } }
  },

  sizeCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    // 高度只记录一次：canvas.height 赋值会同时改写 HTML 的 height 属性，
    // 若每次重绘都从属性里读，悬停触发的重绘会按 dpr 逐次放大画布（280→350→437→…），
    // 最终超出 GPU 纹理上限导致整块白屏。
    if (!canvas._cssH) {
      canvas._cssH = parseInt(canvas.getAttribute('height'), 10) || 260;
    }
    const h = canvas._cssH;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  },

  niceMax(v) {
    if (v <= 0) return 10;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * pow;
  },

  /* ---- 折线图（平滑曲线 + 面积填充 + 悬停提示） ---- */
  line(canvas, opt) {
    const self = this;
    const draw = () => {
      const { ctx, w, h } = self.sizeCanvas(canvas);
      const padL = 42, padR = 14, padT = 14, padB = 26;
      const cw = w - padL - padR, chh = h - padT - padB;
      const labels = opt.labels || [];
      const series = (opt.series || []).filter(s => s.data && s.data.some(v => v != null));
      ctx.clearRect(0, 0, w, h);
      if (!labels.length || !series.length) {
        ctx.fillStyle = '#98a1b5'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center';
        ctx.fillText('暂无数据，开始训练后这里会出现曲线', w / 2, h / 2);
        return;
      }
      let max = 0;
      for (const s of series) for (const v of s.data) if (v != null && v > max) max = v;
      max = self.niceMax(max * 1.15);

      // 网格 + y 轴
      ctx.strokeStyle = '#eef0f7'; ctx.fillStyle = '#98a1b5'; ctx.font = '10.5px Segoe UI'; ctx.lineWidth = 1;
      const gridN = 4;
      for (let i = 0; i <= gridN; i++) {
        const y = padT + chh - (chh * i / gridN);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.round(max * i / gridN)), padL - 8, y);
      }
      // x 轴标签
      const step = Math.ceil(labels.length / Math.min(8, labels.length));
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      labels.forEach((lb, i) => {
        if (i % step !== 0 && i !== labels.length - 1) return;
        const x = padL + (labels.length === 1 ? cw / 2 : cw * i / (labels.length - 1));
        ctx.fillText(opt.xFormat ? opt.xFormat(lb) : lb, x, padT + chh + 8);
      });

      const px = (i) => padL + (labels.length === 1 ? cw / 2 : cw * i / (labels.length - 1));
      const py = (v) => padT + chh - chh * (v / max);

      // 曲线
      for (const s of series) {
        const pts = [];
        s.data.forEach((v, i) => { if (v != null) pts.push({ x: px(i), y: py(v), i }); });
        if (!pts.length) continue;
        if (s.fill) {
          const g = ctx.createLinearGradient(0, padT, 0, padT + chh);
          g.addColorStop(0, s.color + '2e'); g.addColorStop(1, s.color + '00');
          ctx.beginPath(); tracePath(ctx, pts);
          ctx.lineTo(pts[pts.length - 1].x, padT + chh);
          ctx.lineTo(pts[0].x, padT + chh); ctx.closePath();
          ctx.fillStyle = g; ctx.fill();
        }
        ctx.beginPath(); tracePath(ctx, pts);
        ctx.strokeStyle = s.color; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.stroke();
        // 点
        ctx.fillStyle = s.color;
        const dotStep = pts.length > 40 ? 3 : 1;
        pts.forEach((p, k) => {
          if (k % dotStep !== 0 && k !== pts.length - 1) return;
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fill();
        });
      }

      // 悬停提示
      if (!canvas._tipBound) {
        canvas._tipBound = true;
        canvas.addEventListener('mousemove', (e) => {
          const rect = canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const o = canvas._last;
          if (!o) return;
          const idx = Math.round((mx - o.padL) / (o.cw / Math.max(1, o.labels.length - 1)));
          canvas._hover = (idx >= 0 && idx < o.labels.length) ? idx : null;
          draw();
        });
        canvas.addEventListener('mouseleave', () => { canvas._hover = null; draw(); });
      }
      canvas._last = { padL, cw, labels, series, px, py, max };

      // tooltip
      if (canvas._hover != null && canvas._hover < labels.length) {
        const i = canvas._hover;
        const x = px(i);
        ctx.strokeStyle = '#c8cfe2'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + chh); ctx.stroke();
        ctx.setLineDash([]);
        const lines = series.filter(s => s.data[i] != null).map(s => `${s.name}：${opt.valueFormat ? opt.valueFormat(s.data[i]) : s.data[i]}`);
        const title = opt.xFormat ? opt.xFormat(labels[i]) : labels[i];
        const tw = Math.max(ctx.measureText(title).width, ...lines.map(l => ctx.measureText(l).width)) + 22;
        const th = 14 + lines.length * 16;
        let bx = x + 12; if (bx + tw > w - 6) bx = x - tw - 12;
        const by = padT + 6;
        ctx.fillStyle = 'rgba(23,29,48,.94)';
        roundRect(ctx, bx, by, tw, th, 9); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '600 11.5px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(title, bx + 11, by + 8);
        ctx.font = '11px Segoe UI';
        lines.forEach((l, k) => {
          ctx.fillStyle = series.filter(s => s.data[i] != null)[k].color;
          ctx.fillRect(bx + 11, by + 26 + k * 16, 8, 3);
          ctx.fillStyle = '#dfe4f3';
          ctx.fillText(l, bx + 24, by + 21 + k * 16);
        });
      }
    };
    this.attach(canvas, draw);
  },

  /* ---- 柱状图 ---- */
  bar(canvas, opt) {
    const self = this;
    const draw = () => {
      const { ctx, w, h } = self.sizeCanvas(canvas);
      const padL = 30, padR = 10, padT = 18, padB = 26;
      const cw = w - padL - padR, chh = h - padT - padB;
      ctx.clearRect(0, 0, w, h);
      const labels = opt.labels || [], values = (opt.values || []).map(v => (isFinite(v) ? v : 0));
      let max = 0; values.forEach(v => { if (v > max) max = v; });
      max = self.niceMax(max * 1.2);
      ctx.strokeStyle = '#eef0f7'; ctx.fillStyle = '#98a1b5'; ctx.font = '10.5px Segoe UI';
      for (let i = 0; i <= 3; i++) {
        const y = padT + chh - chh * i / 3;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.round(max * i / 3)), padL - 6, y);
      }
      const bw = Math.min(52, cw / labels.length * 0.55);
      labels.forEach((lb, i) => {
        const cx = padL + cw * (i + 0.5) / labels.length;
        const bh = max ? chh * (values[i] / max) : 0;
        const g = ctx.createLinearGradient(0, padT + chh - bh, 0, padT + chh);
        g.addColorStop(0, (opt.colors ? opt.colors[i] : '#4f6ef7'));
        g.addColorStop(1, (opt.colors ? opt.colors[i] : '#4f6ef7') + '88');
        ctx.fillStyle = g;
        roundRect(ctx, cx - bw / 2, padT + chh - bh, bw, Math.max(bh, 2), 6); ctx.fill();
        ctx.fillStyle = '#1d2333'; ctx.font = '600 12px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(opt.valueFormat ? opt.valueFormat(values[i]) : String(values[i]), cx, padT + chh - bh - 5);
        ctx.fillStyle = '#98a1b5'; ctx.font = '11px Segoe UI'; ctx.textBaseline = 'top';
        ctx.fillText(lb, cx, padT + chh + 8);
      });
    };
    this.attach(canvas, draw);
  }
};

/* Catmull-Rom 平滑路径 */
function tracePath(ctx, pts) {
  if (pts.length === 1) { ctx.arc(pts[0].x, pts[0].y, 0.1, 0, Math.PI * 2); return; }
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2 < pts.length ? i + 2 : pts.length - 1];
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
