// يولّد صوت الأرومية (espeak-ng، صوت آلي مفتوح) لكل كلمة ورسالة في data/words.json
// المتطلبات: espeak-ng و ffmpeg. الاستخدام: node tools/gen-audio.mjs [--force]
// تسجيل متحدث أصلي: ضع الملف في audio/rec/<المفتاح>.mp3 وسيُستخدم بدل الآلي (المفتاح مثل w-bread أو m-praise-0).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/words.json'), 'utf8'));
const outDir = path.join(root, 'audio/om');
const recDir = path.join(root, 'audio/rec');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(recDir, { recursive: true });

// المفتاح → النص الأرومي
const items = {};
for (const L of data.levels) for (const w of L.words) if (w.om) items['w-' + w.id] = w.om;
for (const [k, list] of Object.entries(data.msgs)) list.forEach((m, i) => { items[`m-${k}-${i}`] = m.om; });

const manifestPath = path.join(root, 'audio/manifest.json');
const old = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const manifest = {};
let made = 0, rec = 0;
for (const [key, text] of Object.entries(items)) {
  const recFile = path.join(recDir, key + '.mp3');
  if (fs.existsSync(recFile)) {
    manifest[key] = { text, file: `audio/rec/${key}.mp3`, source: 'rec' };
    rec++; continue;
  }
  const file = path.join(outDir, key + '.mp3');
  manifest[key] = { text, file: `audio/om/${key}.mp3`, source: 'espeak-ng' };
  if (!force && old[key] && old[key].text === text && old[key].source === 'espeak-ng' && fs.existsSync(file)) continue;
  const tmp = path.join(os.tmpdir(), `om-${process.pid}-${key}.wav`);
  // om+f3: صوت أنثوي تقريباً؛ -s سرعة أبطأ للوضوح؛ -p نغمة
  execFileSync('espeak-ng', ['-v', 'om+f3', '-s', '120', '-p', '55', '-g', '4', text, '-w', tmp]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-ac', '1', '-ar', '24000',
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,apad=pad_dur=0.1', '-c:a', 'libmp3lame', '-b:a', '40k', file]);
  fs.unlinkSync(tmp);
  made++;
}
// ملفات يتيمة (كلمات انحذفت)
for (const f of fs.readdirSync(outDir)) if (!manifest[f.replace(/\.mp3$/, '')]) fs.unlinkSync(path.join(outDir, f));
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
console.log(`🔊 ${Object.keys(manifest).length} ملف صوت (جديد: ${made}، تسجيلات أصلية: ${rec})`);
