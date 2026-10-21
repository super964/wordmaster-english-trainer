'use strict';
/* ================= 语音朗读（Edge 神经语音 / 系统语音 / AI 语音） ================= */

/* 精选音色（联网拉取失败时的兜底列表；含卡通童声 / 幽默 / 情感丰富） */
const EDGE_VOICES = [
  { id: 'en-US-AvaMultilingualNeural',   name: '✨ Ava · 感情丰富的美女声（强烈推荐）', lang: 'en-US' },
  { id: 'en-US-EmmaMultilingualNeural',  name: '✨ Emma · 开朗爱笑的美女声', lang: 'en-US' },
  { id: 'en-US-AndrewMultilingualNeural', name: '✨ Andrew · 暖男磁性声', lang: 'en-US' },
  { id: 'en-US-BrianMultilingualNeural', name: '✨ Brian · 随性幽默的男生', lang: 'en-US' },
  { id: 'en-US-AnaNeural',               name: '👧 Ana · 卡通小妹妹（动画童声）', lang: 'en-US' },
  { id: 'en-GB-MaisieNeural',            name: '👧 Maisie · 英国小女孩（动画童声）', lang: 'en-GB' },
  { id: 'zh-CN-YunxiaNeural',            name: '👦 云夏 · 卡通小男孩（动画童声）', lang: 'zh-CN' },
  { id: 'zh-CN-XiaoyiNeural',            name: '👧 晓伊 · 俏皮可爱女生', lang: 'zh-CN' },
  { id: 'zh-CN-liaoning-XiaobeiNeural',  name: '😂 晓北 · 东北幽默大姐', lang: 'zh-CN' },
  { id: 'zh-CN-XiaoxiaoNeural',          name: '💕 晓晓 · 温暖知性女声', lang: 'zh-CN' },
  { id: 'zh-CN-YunxiNeural',             name: '阳光 云希 · 阳光少年', lang: 'zh-CN' },
  { id: 'zh-CN-YunjianNeural',           name: '激情 云健 · 热血激情男声', lang: 'zh-CN' },
  { id: 'en-US-JennyNeural',             name: 'Jenny（美音·女·温暖亲和）', lang: 'en-US' },
  { id: 'en-US-AriaNeural',              name: 'Aria（美音·女·自然流畅）', lang: 'en-US' },
  { id: 'en-US-GuyNeural',               name: 'Guy（美音·男·热情）', lang: 'en-US' },
  { id: 'en-US-RogerNeural',             name: 'Roger（美音·男·活泼）', lang: 'en-US' },
  { id: 'en-US-ChristopherNeural',       name: 'Christopher（美音·男·沉稳）', lang: 'en-US' },
  { id: 'en-US-MichelleNeural',          name: 'Michelle（美音·女·亲切）', lang: 'en-US' },
  { id: 'en-US-EricNeural',              name: 'Eric（美音·男·理性）', lang: 'en-US' },
  { id: 'en-US-SteffanNeural',           name: 'Steffan（美音·男·清晰）', lang: 'en-US' },
  { id: 'en-GB-SoniaNeural',             name: 'Sonia（英音·女·优雅）', lang: 'en-GB' },
  { id: 'en-GB-RyanNeural',              name: 'Ryan（英音·男·绅士）', lang: 'en-GB' },
  { id: 'en-GB-LibbyNeural',             name: 'Libby（英音·女·清新）', lang: 'en-GB' },
  { id: 'en-AU-NatashaNeural',           name: 'Natasha（澳音·女）', lang: 'en-AU' },
  { id: 'zh-CN-YunyangNeural',           name: '云扬（中文·男·新闻播音）', lang: 'zh-CN' },
  { id: 'zh-TW-HsiaoChenNeural',         name: '曉臻（台湾腔·女）', lang: 'zh-TW' }
];

const AI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'ash', 'coral', 'sage'];

const TTS = {
  voices: [],
  _current: null,
  _aiAudio: null,

  init() {
    const load = () => {
      this.voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
      if (typeof SettingsPage !== 'undefined') SettingsPage.refreshVoices();
    };
    load();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = load;
    setTimeout(load, 800);
    setTimeout(load, 2500);
  },

  defaultEnglishVoice() {
    const en = this.voices.filter(v => /^en[-_]/i.test(v.lang));
    const prefer = en.find(v => /aria|zira|jenny|samantha|karen|daniel|google us english/i.test(v.name));
    return (prefer || en[0] || this.voices[0] || null);
  },

  /* 语速数字 → prosody 百分比（Edge prosody 上限 +100% = 2倍；更快时用播放倍速补齐） */
  _ratePercent(rate) {
    const pct = Math.round((Math.min(rate, 2) - 1) * 100);
    return (pct >= 0 ? '+' : '') + pct + '%';
  },

  /* 超过 2 倍速的部分用 audio.playbackRate 补齐 */
  _extraPlaybackRate(rate) {
    return rate > 2 ? (rate / 2) : 1;
  },

  stop() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (this._aiAudio) { try { this._aiAudio.pause(); } catch (e) {} this._aiAudio = null; }
    this._current = null;
  },

  /**
   * 朗读英文。回调 onStart / onEnd / onError，返回 {cancel()}
   */
  speak(text, opt = {}) {
    const settings = Store.state.settings;
    const rate = opt.rate != null ? opt.rate : settings.rate;
    this.stop();

    const engine = settings.ttsEngine || 'system';
    if (engine === 'edge') return this._speakEdge(text, opt, rate);
    if (engine === 'ai' && settings.apiKey) return this._speakAI(text, opt, rate);
    return this._speakSystem(text, opt, rate, opt.voiceName || settings.systemVoice);
  },

  /* ---- Edge 神经语音（在线） ---- */
  _speakEdge(text, opt, rate) {
    const s = Store.state.settings;
    const handle = { canceled: false, cancel() { this.canceled = true; } };
    const pitchPct = opt.pitch != null ? opt.pitch : (s.edgePitch || 0);
    const pitchStr = (pitchPct >= 0 ? '+' : '') + pitchPct + '%';
    window.api.edgeTts({ text, voice: opt.voiceName || s.edgeVoice, rate: this._ratePercent(rate), pitch: pitchStr })
      .then(res => {
        if (handle.canceled) return;
        if (!res.ok) {
          // 降级到系统语音
          toast('Edge 语音失败（' + res.error + '），已切换系统语音', 'bad');
          this._speakSystem(text, opt, rate, s.systemVoice);
          return;
        }
        const blob = new Blob([res.data], { type: 'audio/mpeg' });
        const audio = new Audio(URL.createObjectURL(blob));
        const extra = this._extraPlaybackRate(rate);
        if (extra > 1) audio.playbackRate = extra;
        this._aiAudio = audio;
        audio.onplay = () => opt.onStart && opt.onStart(handle);
        audio.onended = () => { if (!handle.canceled) opt.onEnd && opt.onEnd(handle); };
        audio.onerror = () => { if (!handle.canceled) opt.onError && opt.onError(new Error('音频播放失败')); };
        audio.play().catch(e => { if (!handle.canceled) opt.onError && opt.onError(e); });
      })
      .catch(e => {
        if (!handle.canceled) {
          toast('Edge 语音请求异常，已切换系统语音', 'bad');
          this._speakSystem(text, opt, rate, s.systemVoice);
        }
      });
    return handle;
  },

  /* ---- 系统语音（离线） ---- */
  _speakSystem(text, opt, rate, voiceName) {
    if (!window.speechSynthesis) {
      const err = new Error('当前环境不支持系统语音');
      opt.onError && opt.onError(err);
      return { cancel() {} };
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = Math.max(0.5, Math.min(3, rate));
    utter.pitch = 1;
    const voice = this.voices.find(v => v.name === voiceName) || this.defaultEnglishVoice();
    if (voice) utter.voice = voice;
    const handle = { utter, canceled: false, cancel() { this.canceled = true; window.speechSynthesis.cancel(); } };
    utter.onstart = () => opt.onStart && opt.onStart(handle);
    utter.onend = () => { if (!handle.canceled) opt.onEnd && opt.onEnd(handle); };
    utter.onerror = (e) => {
      if (handle.canceled || e.error === 'interrupted' || e.error === 'canceled') return;
      opt.onError && opt.onError(new Error('语音合成失败: ' + e.error));
    };
    this._current = handle;
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utter);
    return handle;
  },

  /* ---- AI 音色（OpenAI 兼容 /audio/speech） ---- */
  async _speakAI(text, opt, rate) {
    const s = Store.state.settings;
    const handle = { canceled: false, cancel() { this.canceled = true; } };
    try {
      const res = await window.api.aiTts({
        baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.aiTtsModel,
        voice: s.aiVoice, input: text, speed: rate
      });
      if (handle.canceled) return handle;
      if (!res.ok) throw new Error(res.error);
      const blob = new Blob([res.data], { type: 'audio/mpeg' });
      const audio = new Audio(URL.createObjectURL(blob));
      this._aiAudio = audio;
      audio.onplay = () => opt.onStart && opt.onStart(handle);
      audio.onended = () => { if (!handle.canceled) opt.onEnd && opt.onEnd(handle); };
      audio.onerror = () => { if (!handle.canceled) opt.onError && opt.onError(new Error('AI 语音播放失败')); };
      await audio.play();
    } catch (e) {
      opt.onError && opt.onError(e);
    }
    return handle;
  },

  speakAsync(text, opt = {}) {
    return new Promise((resolve, reject) => {
      this.speak(text, Object.assign({}, opt, { onEnd: resolve, onError: reject }));
    });
  }
};
