/* 拉取 Edge 官方完整音色列表并分析 */
const https = require('https');
const fs = require('fs');

const url = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4';

https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    try {
      const list = JSON.parse(data);
      fs.writeFileSync('tools/voices-raw.json', JSON.stringify(list, null, 1));
      console.log('total voices:', list.length);
      // 看结构
      console.log('sample:', JSON.stringify(list[0]).slice(0, 400));
      // 找童声 & 活泼性格的
      const kid = list.filter(v => /ana|kid|child|shuang|xiaobei|yunxia/i.test(v.ShortName));
      console.log('\n--- kid-like ---');
      kid.forEach(v => console.log(v.ShortName, '|', v.Gender, '|', JSON.stringify(v.VoiceTag || {})));
      const cheerful = list.filter(v => v.VoiceTag && (v.VoiceTag.VoicePersonalities || []).some(p => /cheerful|lively|humorous|warm|excited|friendly/i.test(p)));
      console.log('\n--- cheerful/lively (' + cheerful.length + ') ---');
      cheerful.slice(0, 60).forEach(v => console.log(v.ShortName, '|', v.Gender, '|', (v.VoiceTag.VoicePersonalities || []).join(',')));
    } catch (e) { console.log('parse fail:', e.message, data.slice(0, 200)); }
  });
}).on('error', e => console.log('ERR', e.message));
