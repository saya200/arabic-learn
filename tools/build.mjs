// يتحقق من data/words.json، يجلب الإيموجي الناقصة (--fetch)، ويولّد sw-manifest.js
// الاستخدام: node tools/build.mjs [--fetch]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const doFetch = process.argv.includes('--fetch');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/words.json'), 'utf8'));

const cp = (ch) => {
  const cps = [...ch].map((c) => c.codePointAt(0));
  const keep = cps.includes(0x200d) ? cps : cps.filter((c) => c !== 0xfe0f);
  return keep.map((c) => c.toString(16)).join('-');
};

const errors = [];
const ids = new Set();
const emojis = new Set(Object.values(data.ui));
let words = 0, unsure = [];
for (const L of data.levels) {
  if (!L.id || !L.icon || !L.name) errors.push(`مستوى ناقص: ${JSON.stringify(L.id)}`);
  emojis.add(L.icon);
  if (!L.words || L.words.length < 2) errors.push(`المستوى ${L.id} فيه أقل من كلمتين`);
  const seen = new Set();
  for (const w of L.words) {
    words++;
    if (ids.has(w.id)) errors.push(`id مكرر: ${w.id}`);
    ids.add(w.id);
    if (!w.ar || !w.emoji) errors.push(`كلمة ناقصة: ${w.id}`);
    if (typeof w.om_ok !== 'boolean') errors.push(`om_ok مفقود: ${w.id}`);
    if (w.om_ok && !w.om) errors.push(`om_ok=true بدون om: ${w.id}`);
    const list = Array.isArray(w.emoji) ? w.emoji : [w.emoji];
    const key = list.join('+');
    if (seen.has(key)) errors.push(`صورة مكررة داخل ${L.id}: ${w.id}`);
    seen.add(key);
    list.forEach((e) => emojis.add(e));
    if (!w.om_ok) unsure.push(`${L.id}/${w.id}: ${w.ar} → ${w.om ?? '(بدون ترجمة)'}`);
  }
}

const emojiDir = path.join(root, 'emoji');
fs.mkdirSync(emojiDir, { recursive: true });
let missing = [...emojis].map(cp).filter((f) => !fs.existsSync(path.join(emojiDir, f + '.svg')));
if (missing.length && doFetch) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-'));
  execFileSync('npm', ['pack', '@twemoji/svg', '--silent'], { cwd: tmp, stdio: 'inherit' });
  const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'));
  execFileSync('tar', ['xzf', tgz], { cwd: tmp });
  for (const f of missing) {
    const src = path.join(tmp, 'package', f + '.svg');
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(emojiDir, f + '.svg'));
  }
  missing = missing.filter((f) => !fs.existsSync(path.join(emojiDir, f + '.svg')));
}
if (missing.length) errors.push(`إيموجي ناقصة (شغّل مع --fetch): ${missing.join(', ')}`);

if (errors.length) {
  console.error('❌ أخطاء:\n - ' + errors.join('\n - '));
  process.exit(1);
}

// قائمة التخزين للعمل بدون نت
const files = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'data/words.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/favicon.svg']
  .concat([...emojis].map((e) => `emoji/${cp(e)}.svg`).sort());
const h = crypto.createHash('sha1');
for (const f of files) if (f !== './') h.update(f).update(fs.readFileSync(path.join(root, f)));
const version = h.digest('hex').slice(0, 10);
fs.writeFileSync(path.join(root, 'sw-manifest.js'),
  `// مولّد تلقائياً بواسطة tools/build.mjs — لا تعدّله يدوياً\nself.VERSION = '${version}';\nself.PRECACHE = ${JSON.stringify(files, null, 2)};\n`);
console.log(`✅ ${data.levels.length} مستوى، ${words} كلمة، ${emojis.size} صورة، نسخة ${version}`);
console.log(`⚠️ ترجمات غير مؤكدة: ${unsure.length}`);
