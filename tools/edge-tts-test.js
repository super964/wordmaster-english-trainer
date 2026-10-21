/* Edge TTS 协议测试 v2：新版 api.msedgeservices.com 协议 */
const crypto = require('crypto');
const WebSocket = require('ws');
const fs = require('fs');

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const VERSION = '1-143.0.3650.96';
let clockOffsetMs = 0;

function gec() {
  const ticks = Math.floor((Date.now() + clockOffsetMs) / 1000) + 11644473600;
  const rounded = ticks - (ticks % 300);
  const windowsTicks = rounded * 10000000;
  return crypto.createHash('sha256').update(`${windowsTicks}${TOKEN}`).digest('hex').toUpperCase();
}

function uuid() {
  return 'xxxxxxxx-xxxx-xxxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function synth(voice, text, rate) {
  return new Promise((resolve, reject) => {
    const connId = uuid();
    const reqId = crypto.randomBytes(16).toString('hex');
    const url = `wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=${TOKEN}&Sec-MS-GEC=${gec()}&Sec-MS-GEC-Version=${VERSION}&ConnectionId=${connId}`;
    const ws = new WebSocket(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold'
      }
    });
    const chunks = [];
    let retried = false;

    ws.on('unexpected-response', (req, res) => {
      const code = res.statusCode;
      const serverDate = res.headers.date;
      req.destroy(); res.destroy();
      if (code === 403 && serverDate && !retried) {
        retried = true;
        clockOffsetMs = Date.parse(serverDate) - Date.now();
        console.log('403 -> clock offset', clockOffsetMs, 'ms, retrying...');
        setTimeout(() => synth(voice, text, rate).then(resolve, reject), 300);
        return;
      }
      reject(new Error('HTTP ' + code));
    });

    ws.on('open', () => {
      ws.send('Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n' +
        JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' }, outputFormat: 'audio-24khz-96kbitrate-mono-mp3' } } } }));
      const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const ssml = `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n` +
        `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${voice}"><prosody pitch="+0Hz" rate="${rate}" volume="+0%">${esc}</prosody></voice></speak>`;
      ws.send(ssml);
    });

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const s = data.toString();
        if (s.includes('Path:turn.end')) {
          const out = Buffer.concat(chunks);
          fs.writeFileSync('edge-test.mp3', out);
          console.log(`SUCCESS voice=${voice} bytes=${out.length}`);
          ws.close();
          resolve(out.length);
        } else if (s.includes('Path:response') && s.includes('102')) {
          // in-progress, ignore
        }
        return;
      }
      const buf = Buffer.from(data);
      const marker = Buffer.from('Path:audio\r\n');
      const idx = buf.indexOf(marker);
      if (idx >= 0) {
        const payload = buf.subarray(idx + marker.length);
        if (payload.length) chunks.push(payload);
      }
    });

    ws.on('error', (e) => reject(e));
    setTimeout(() => reject(new Error('timeout')), 25000);
  });
}

synth(process.argv[2] || 'en-US-AriaNeural', process.argv[3] || 'Hello! This is WordMaster speaking. Your pronunciation practice starts now!', process.argv[4] || '+0%')
  .then(() => process.exit(0))
  .catch(e => { console.log('ERROR:', e.message); process.exit(1); });
