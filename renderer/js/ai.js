'use strict';
/* ================= AI 内容层（OpenAI 兼容；失败自动降级内置题库） ================= */
const AI = {
  TOPICS: [
    'daily life', 'school', 'family', 'friends', 'food and cooking', 'sports', 'travel',
    'animals', 'nature', 'science and technology', 'space', 'history', 'health',
    'environment', 'internet and AI', 'art and music', 'festivals', 'cities',
    'psychology', 'economy', 'education', 'jobs', 'weather', 'transport'
  ],

  isConfigured() {
    const s = Store.state.settings;
    return !!(s.apiKey && s.baseUrl);
  },

  topics(n) { return shuffle(this.TOPICS).slice(0, n).join(', '); },

  async chat(messages, temperature) {
    const s = Store.state.settings;
    const res = await window.api.aiChat({
      baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model,
      messages, temperature: temperature != null ? temperature : s.temperature,
      maxTokens: s.maxTokens || 0
    });
    if (!res.ok) throw new Error(res.error);
    console.warn('[AI] finish_reason =', res.finish || '(空)', '| usage =', JSON.stringify(res.usage || {}));
    if (res.finish === 'length') {
      console.warn('[AI] 输出被 max_tokens 截断');
    }
    return res.text;
  },

  /* 发送请求（自动带系统提示词，压制推理型模型的思考输出） */
  ask(prompt, temperature) {
    return this.chat([
      { role: 'system', content: this.systemPrompt() },
      { role: 'user', content: prompt }
    ], temperature);
  },

  systemPrompt() {
    return 'You are an expert ESL curriculum designer. Reply with valid JSON ONLY — no markdown fences, no commentary, no analysis, no thinking-out-loud. Output compact JSON directly and make sure it is complete and valid.';
  },

  /* 从模型输出中稳健地抠出 JSON */
  parseJSON(text, expectArray = true) {
    let t = String(text || '').trim();
    console.warn('[AI] 原始返回长度 =', t.length, '| 结尾片段 =', JSON.stringify(t.slice(-120)));
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    const s = expectArray ? t.indexOf('[') : t.indexOf('{');
    const e = expectArray ? t.lastIndexOf(']') : t.lastIndexOf('}');
    if (s >= 0 && e > s) t = t.slice(s, e + 1);
    t = t.replace(/,\s*([}\]])/g, '$1');
    t = t.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
    try { return JSON.parse(t); }
    catch (err) {
      // 抢救：从被截断的输出中提取所有完整的对象（条目是扁平结构，无嵌套大括号）
      const objs = t.match(/\{[^{}]*\}/g);
      if (objs && objs.length) {
        const items = [];
        for (const o of objs) {
          try { items.push(JSON.parse(o.replace(/,\s*$/, '').replace(/[\u201c\u201d]/g, '"'))); } catch (_) {}
        }
        if (items.length) {
          console.warn('[AI] 输出被截断，已抢救出', items.length, '条完整内容');
          return expectArray ? items : items[0];
        }
      }
      throw new Error('AI 返回的不是合法 JSON（可能是输出超长被截断，请降低"每次生成数量"或提高"输出上限"）');
    }
  },

  cleanItems(arr, fields) {
    return (Array.isArray(arr) ? arr : [])
      .filter(x => x && typeof x.en === 'string' && x.en.trim())
      .map(x => {
        const o = { en: x.en.trim() };
        if (fields.includes('zh')) o.zh = String(x.zh || '').trim();
        if (fields.includes('title')) o.title = String(x.title || 'Untitled').trim();
        return o;
      });
  },

  /* 生成 + 失败降级的通用包装 */
  async generateOrFallback(kind, diff, n, aiFn) {
    if (this.isConfigured()) {
      try {
        return await aiFn();
      } catch (e) {
        console.error('[AI] 生成失败:', e.message);
        toast(`AI 生成失败（${e.message.slice(0, 60)}），本次已自动切换内置题库`, 'bad');
      }
    }
    return this.corpusBatch(kind, diff, n);
  },

  /* ---------------- 听力：≤50 词的短文段 ---------------- */
  async getListenBatch(diff, n) {
    const st = stageOf(diff);
    return this.generateOrFallback('sentences', diff, n, async () => {
      const prompt =
        `Generate ${n} short English passages for listening practice.
Target level: ${st.desc}
STRICT RULES: every passage MUST be at most 50 English words (hard limit), 1 to 3 simple spoken-style sentences, standalone and complete. Use varied topics from: ${this.topics(6)}.
Each item: "en" = the English passage, "zh" = a natural Simplified Chinese translation.
Return ONLY a JSON array of exactly ${n} items: [{"en":"...","zh":"..."}]`;
      const raw = await this.ask(prompt);
      const items = this.cleanItems(this.parseJSON(raw, true), ['zh']);
      if (items.length < Math.ceil(n / 2)) throw new Error('生成结果太少');
      return items;
    });
  },

  /* ---------------- 口语：句子跟读 ---------------- */
  async getSpeakBatch(diff, n) {
    const st = stageOf(diff);
    return this.generateOrFallback('sentences', diff + 5, n, async () => {
      const prompt =
        `Generate ${n} English sentences or very short paragraphs (max 25 words each) for shadowing / speaking practice at this level: ${st.desc}
Make them natural, useful, speakable aloud, with varied everyday topics such as: ${this.topics(6)}.
Each item: "en" = English text, "zh" = natural Simplified Chinese translation.
Return ONLY a JSON array of exactly ${n} items: [{"en":"...","zh":"..."}]`;
      const raw = await this.ask(prompt);
      const items = this.cleanItems(this.parseJSON(raw, true), ['zh']);
      if (items.length < Math.ceil(n / 2)) throw new Error('生成结果太少');
      return items;
    });
  },

  /* ---------------- 阅读：分层文章 ---------------- */
  async getReadBatch(diff, n) {
    const st = stageOf(diff);
    const idx = stageIndex(diff);
    const [lo, hi] = ARTICLE_RANGES[idx];
    return this.generateOrFallback('articles', diff, n, async () => {
      let lastErr = null;
      let count = n;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const prompt =
            `Generate ${count} English articles for reading practice at this level: ${st.desc}
Each article: ${lo}-${hi} words, with a catchy title, 2-5 paragraphs, engaging content about topics such as: ${this.topics(5)}.
Mix the genres: narrative, explanatory, and argumentative.
Each item: "title" = English title, "en" = full English article (paragraphs separated by \\n\\n), "zh" = the COMPLETE Simplified Chinese translation (paragraphs separated by \\n\\n).
Return ONLY a valid JSON array of ${count} items: [{"title":"...","en":"...","zh":"..."}]`;
          const raw = await this.ask(prompt);
          const items = this.cleanItems(this.parseJSON(raw, true), ['zh', 'title']);
          if (!items.length) throw new Error('生成结果为空');
          return items;
        } catch (e) {
          lastErr = e;
          count = Math.max(1, count - 1);
          console.warn('[AI] 阅读生成失败，减量重试:', e.message);
        }
      }
      throw lastErr;
    });
  },

  /* ---------------- 写作：抄写句子 ---------------- */
  async getWriteBatch(diff, n) {
    const st = stageOf(diff);
    return this.generateOrFallback('sentences', diff + 8, n, async () => {
      const prompt =
        `Generate ${n} English sentences or short paragraphs (12 to 35 words each) for typing/copywriting practice at this level: ${st.desc}
Use varied topics such as: ${this.topics(6)}. Each one should be a complete, well-formed sentence or two.
Each item: "en" = English text, "zh" = natural Simplified Chinese translation.
Return ONLY a JSON array of exactly ${n} items: [{"en":"...","zh":"..."}]`;
      const raw = await this.ask(prompt);
      const items = this.cleanItems(this.parseJSON(raw, true), ['zh']);
      if (items.length < Math.ceil(n / 2)) throw new Error('生成结果太少');
      return items;
    });
  },

  /* ---------------- 内置题库取材 ---------------- */
  _cursors: {},

  corpusBatch(kind, diff, n) {
    const levels = (window.CORPUS && window.CORPUS.levels) || [];
    let st = stageIndex(diff);
    const poolLevels = [st];
    if (st > 0 && Math.random() < 0.25) poolLevels.push(st - 1);
    if (st < levels.length - 1 && Math.random() < 0.2) poolLevels.push(st + 1);

    let pool = [];
    for (const li of poolLevels) {
      const lv = levels[li];
      if (!lv) continue;
      pool = pool.concat((lv[kind] || []).map((it, i) => Object.assign({ _id: li + ':' + kind + ':' + i }, it)));
    }
    if (!pool.length) throw new Error('内置题库为空');

    const key = kind + '|' + st;
    let start = this._cursors[key] || 0;
    const picked = [];
    const step = Math.max(1, Math.floor(pool.length / Math.max(n, 1)));
    for (let i = 0; i < n; i++) {
      picked.push(pool[(start + i * step + Math.floor(Math.random() * step)) % pool.length]);
    }
    this._cursors[key] = (start + n) % pool.length;
    return shuffle(picked).map(({ _id, ...rest }) => rest);
  },

  /* 生词释义：结合原句上下文让 AI 给出简洁中文释义 */
  async translateWord(word, sentence) {
    if (!this.isConfigured()) return { meaning: '', ok: false, reason: 'no-key' };
    try {
      const prompt =
        `Give the Chinese meaning of the English word/phrase "${word}" as used in this sentence:\n"${sentence || '(no context)'}"\n` +
        `Rules: concise (max 20 Chinese characters), give the meaning IN THIS CONTEXT first, ` +
        `then optionally a second common meaning separated by "; ". Reply with the Chinese meaning ONLY — no pinyin, no English, no explanation.`;
      const raw = await this.chat([{ role: 'user', content: prompt }], 0.2);
      const meaning = String(raw || '').replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0].trim();
      return { meaning: meaning.slice(0, 80), ok: true };
    } catch (e) {
      return { meaning: '', ok: false, reason: e.message };
    }
  },

  /* ---------------- 字母/音标练习例词 ---------------- */
  async getPhonicsWords(o) {
    const prompt = o.kind === 'letters'
      ? `Generate ${o.n} simple, common English words for BEGINNERS that START with the capital letter "${o.key}" (letter name pronounced like "${o.demo}").
For kids / zero-basis learners. All words must be concrete and easy (nouns, verbs, adjectives daily life).
Each item: "en" = the word (lowercase unless proper noun), "zh" = its Simplified Chinese meaning (max 8 chars).
Return ONLY a JSON array of exactly ${o.n} items: [{"en":"apple","zh":"苹果"}]`
      : `Generate ${o.n} simple, common English words for BEGINNERS that clearly demonstrate the English ${o.kind === 'vowels' ? 'VOWEL' : 'CONSONANT'} sound "${o.key}" (as in "${o.demo}", ${o.tip}).
For kids / zero-basis learners. Words must actually CONTAIN the sound and be easy.
Each item: "en" = the word, "zh" = its Simplified Chinese meaning (max 8 chars).
Return ONLY a JSON array of exactly ${o.n} items: [{"en":"sheep","zh":"绵羊"}]`;
    const raw = await this.ask(prompt, 0.5);
    const items = this.cleanItems(this.parseJSON(raw, true), ['zh']);
    if (items.length < 6) throw new Error('生成例词太少（' + items.length + '）');
    // 去重 + 过滤非字母
    const seen = new Set();
    return items.filter(x => {
      const w = x.en.toLowerCase();
      if (seen.has(w) || !/^[a-z][a-z' -]*$/i.test(x.en)) return false;
      seen.add(w);
      return true;
    }).slice(0, o.n);
  },

  /* ---------------- 词典：主题词表 ---------------- */
  async getDictThemeWords(theme, n) {
    const prompt =
      `Generate ${n} common English words a beginner should know about the theme "${theme}".
Each item: "en" = the English word, "zh" = Simplified Chinese meaning (max 10 chars), "ex" = one short example sentence (max 12 words).
Return ONLY a JSON array of exactly ${n} items: [{"en":"banana","zh":"香蕉","ex":"I like bananas."}]`;
    const raw = await this.ask(prompt, 0.6);
    const items = this.parseJSON(raw, true).filter(x => x && typeof x.en === 'string' && x.en.trim());
    if (items.length < Math.ceil(n / 2)) throw new Error('生成词表太少');
    const seen = new Set();
    return items.map(x => ({
      en: String(x.en).trim().slice(0, 40),
      zh: String(x.zh || '').trim().slice(0, 30),
      ex: String(x.ex || '').trim().slice(0, 90)
    })).filter(x => {
      const k = x.en.toLowerCase();
      if (!x.en || seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, n);
  },

  /* ---------------- 词典：按中文含义反查英文单词 ---------------- */
  async getWordsByMeaning(query, n) {
    const prompt =
      `Find ${n} English words whose meaning matches this Chinese description: "${query}".
For English learners. Include the best match first, then related/synonymous words.
Each item: "en" = the word, "zh" = its Simplified Chinese meaning (max 12 chars), "ex" = one short example sentence (max 12 words).
Return ONLY a JSON array of exactly ${n} items: [{"en":"happy","zh":"开心的","ex":"She looks happy."}]`;
    const raw = await this.ask(prompt, 0.5);
    const items = this.parseJSON(raw, true).filter(x => x && typeof x.en === 'string' && x.en.trim());
    if (!items.length) throw new Error('没有找到匹配的单词');
    const seen = new Set();
    return items.map(x => ({
      en: String(x.en).trim().slice(0, 40),
      zh: String(x.zh || '').trim().slice(0, 30),
      ex: String(x.ex || '').trim().slice(0, 90)
    })).filter(x => {
      const k = x.en.toLowerCase();
      if (!x.en || seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, n);
  },

  /* 词典释义翻译成中文（缓存于 dict entry） */
  async translateDefinition(word, definition) {
    if (!this.isConfigured()) return '';
    try {
      const prompt = `Translate this English dictionary definition into concise Simplified Chinese (max 40 chars), reply Chinese ONLY:\nWord: ${word}\nDefinition: ${definition}`;
      const raw = await this.chat([{ role: 'user', content: prompt }], 0.2);
      return String(raw || '').split('\n')[0].trim().slice(0, 80);
    } catch (e) { return ''; }
  },

  /* 测试连接 */
  async test() {
    const t0 = Date.now();
    const text = await this.chat([{ role: 'user', content: 'Reply with exactly: OK' }], 0);
    return { ok: true, ms: Date.now() - t0, text: text.slice(0, 40) };
  }
};
