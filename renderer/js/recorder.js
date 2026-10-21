'use strict';
/* ================= 录音（MediaRecorder + 音量波形 + 静音自动停止） ================= */
const Recorder = {
  _active: null,

  /**
   * opt: {
   *   onLevel(rms)          实时音量 0~1
   *   onStatus(msg)         状态提示
   *   autoStop: { silenceSec, minSec, maxSec }  // 可选：静音自动结束
   *   onAutoStop(result)    自动结束回调
   * }
   */
  async start(opt = {}) {
    if (this._active) await this.stop();

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (e) {
      throw new Error('无法访问麦克风：' + (e.message || e.name) + '（请在系统设置中允许麦克风）');
    }

    const rec = { stream, chunks: [], startTs: Date.now(), opt, silenced: 0, spoke: false, raf: 0, mr: null };

    try { rec.mr = new MediaRecorder(stream); }
    catch (e) { stream.getTracks().forEach(t => t.stop()); throw new Error('录音器初始化失败'); }
    rec.mr.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
    rec.mr.start();

    // 音量检测
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    rec.audioCtx = ctx;

    const loop = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);
      opt.onLevel && opt.onLevel(rms);

      const auto = opt.autoStop;
      if (auto) {
        const elapsed = (Date.now() - rec.startTs) / 1000;
        if (rms > 0.035) { rec.spoke = true; rec.silenced = 0; }
        else if (rec.spoke) rec.silenced += 1 / 30;
        if (rec.spoke && rec.silenced > (auto.silenceSec || 1.6) && elapsed > (auto.minSec || 0.8)) {
          this.stop().then(r => opt.onAutoStop && opt.onAutoStop(r));
          return;
        }
        if (elapsed > (auto.maxSec || 45)) {
          this.stop().then(r => opt.onAutoStop && opt.onAutoStop(r));
          return;
        }
      }
      rec.raf = requestAnimationFrame(loop);
    };
    rec.raf = requestAnimationFrame(loop);

    this._active = rec;
    return {
      stop: () => this.stop()
    };
  },

  async stop() {
    const rec = this._active;
    if (!rec) return null;
    this._active = null;
    cancelAnimationFrame(rec.raf);

    const result = await new Promise((resolve) => {
      const finish = () => {
        const blob = new Blob(rec.chunks, { type: rec.mr.mimeType || 'audio/webm' });
        resolve({
          blob,
          url: URL.createObjectURL(blob),
          sec: (Date.now() - rec.startTs) / 1000
        });
      };
      rec.mr.onstop = finish;
      try { if (rec.mr.state !== 'inactive') rec.mr.stop(); else finish(); }
      catch (e) { finish(); }
    });

    rec.stream.getTracks().forEach(t => t.stop());
    try { rec.audioCtx.close(); } catch (e) {}
    return result;
  },

  isRecording() { return !!this._active; }
};

/* ================= 波形绘制 ================= */
const Waveform = {
  canvas: null, ctx: null, hist: [], raf: 0,

  start(canvas) {
    this.stop();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hist = new Array(90).fill(0);
    const loop = () => {
      const { ctx, w, h } = { ctx: this.ctx, w: canvas.width, h: canvas.height };
      ctx.clearRect(0, 0, w, h);
      const barW = w / this.hist.length;
      this.hist.forEach((v, i) => {
        const bh = Math.max(2, v * h * 2.4);
        ctx.fillStyle = `rgba(239, 71, 111, ${0.25 + 0.75 * v})`;
        const x = i * barW, y = (h - bh) / 2;
        ctx.beginPath();
        if (ctx.roundRect) { ctx.roundRect(x + 1, y, barW - 2, bh, 2); } else { ctx.rect(x + 1, y, barW - 2, bh); }
        ctx.fill();
      });
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  },

  push(rms) {
    if (!this.hist.length) return;
    this.hist.push(Math.min(1, rms * 4));
    this.hist.shift();
  },

  stop() {
    cancelAnimationFrame(this.raf);
    this.hist = [];
    if (this.ctx && this.canvas) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
};
