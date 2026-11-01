'use strict';
/* عربي — تطبيق تعليم عربي بالصوت والصورة. بدون مكتبات. البيانات كلها في data/words.json */

const $app = document.getElementById('app');
const $overlay = document.getElementById('overlay');
let DATA = null;

/* ================= أدوات صغيرة ================= */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function cp(ch) {
  const cps = [...ch].map((c) => c.codePointAt(0));
  const keep = cps.includes(0x200d) ? cps : cps.filter((c) => c !== 0xfe0f);
  return keep.map((c) => c.toString(16)).join('-');
}
function emo(ch, cls = '') {
  const img = h('img', { class: 'emo ' + cls, src: `emoji/${cp(ch)}.svg`, alt: '', draggable: 'false' });
  img.onerror = () => img.replaceWith(h('span', { class: 'emo-fallback ' + cls }, ch)); // ملف ناقص → الإيموجي النصي
  return img;
}
const ui = (k, cls) => emo(DATA.ui[k], cls);
function pic(word) {
  const list = Array.isArray(word.emoji) ? word.emoji : [word.emoji];
  return h('div', { class: 'pic' + (list.length > 1 ? ' multi' : '') }, list.map((e) => h('div', { class: 'p' }, emo(e))));
}
function captions(word) {
  const cls = word.om == null ? 'none' : word.om_ok ? '' : 'unsure';
  return [
    h('div', { class: 'omtxt ' + cls }, word.om == null ? '؟ (no translation)' : word.om),
    h('div', { class: 'ar' }, word.ar),
  ];
}

/* ================= الحفظ ================= */
const store = {
  key: 'arlearn.v1',
  d: { unlocked: 0, stars: {}, om: false, sup: false, unlockAll: false, seen: false },
  load() { try { Object.assign(this.d, JSON.parse(localStorage.getItem(this.key) || '{}')); } catch (_) {} this.apply(); },
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.d)); } catch (_) {} this.apply(); },
  apply() { document.body.classList.toggle('om', !!this.d.om); document.body.classList.toggle('sup', !!this.d.sup); },
};

/* ================= الصوت: نطق عربي من الجوال ================= */
const TTS = {
  voice: null, count: 0, gen: 0,
  supported: 'speechSynthesis' in window,
  init() {
    if (!this.supported) return;
    const refresh = () => {
      const vs = speechSynthesis.getVoices().map((v) => ({ v, l: (v.lang || '').replace('_', '-').toLowerCase() }));
      const ar = vs.filter((x) => x.l.startsWith('ar'));
      this.count = ar.length;
      this.voice = (ar.find((x) => x.l === 'ar-sa') || ar[0] || {}).v || null;
    };
    refresh();
    speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', refresh);
  },
  stop() { this.gen++; if (this.supported) try { speechSynthesis.cancel(); } catch (_) {} },
  speak(text, rate = 0.85) {
    if (!this.supported || !text) return Promise.resolve();
    const g = ++this.gen;
    return new Promise((res) => {
      try { speechSynthesis.cancel(); } catch (_) {}
      let done = false, t;
      const fin = () => { if (!done) { done = true; clearTimeout(t); res(); } };
      setTimeout(() => {
        if (g !== this.gen) return fin();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ar-SA';
        if (this.voice) u.voice = this.voice;
        u.rate = rate;
        u.onend = fin; u.onerror = fin;
        t = setTimeout(fin, 2500 + text.length * 300); // بعض الجوالات ما ترسل onend
        speechSynthesis.speak(u);
      }, 40);
    });
  },
};
const say = (w, rate) => TTS.speak(w.say || w.ar, rate);

/* مؤثرات صوتية بسيطة (WebAudio، بدون ملفات) */
const SFX = {
  ctx: null,
  _c() { if (!this.ctx) { const A = window.AudioContext || window.webkitAudioContext; if (A) this.ctx = new A(); } if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; },
  tone(freq, start, dur, type = 'sine', vol = 0.18) {
    const c = this._c(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, c.currentTime + start);
    g.gain.linearRampToValueAtTime(vol, c.currentTime + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + dur);
    o.connect(g); g.connect(c.destination);
    o.start(c.currentTime + start); o.stop(c.currentTime + start + dur + 0.05);
  },
  good() { this.tone(660, 0, 0.18); this.tone(880, 0.12, 0.18); this.tone(1320, 0.24, 0.3); },
  soft() { this.tone(330, 0, 0.25, 'triangle', 0.12); this.tone(262, 0.15, 0.3, 'triangle', 0.1); },
  win() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, i * 0.13, 0.25)); },
  tap() { this.tone(520, 0, 0.08, 'sine', 0.1); },
};

/* ================= إصبع التوجيه (بدون كلام) ================= */
let hintTimer = null;
function clearHint() { clearTimeout(hintTimer); document.querySelectorAll('.finger').forEach((f) => f.remove()); }
function armHint(getEl, delay) {
  clearTimeout(hintTimer);
  document.querySelectorAll('.finger').forEach((f) => f.remove());
  hintTimer = setTimeout(() => {
    const el = typeof getEl === 'function' ? getEl() : getEl;
    if (!el || !el.isConnected) return;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.append(h('div', { class: 'finger' }, ui('finger')));
  }, delay);
}
document.addEventListener('pointerdown', () => { clearHint(); window.__rehint && window.__rehint(); }, true);

/* ================= تنقّل ================= */
function show(node) { clearHint(); window.__rehint = null; $app.replaceChildren(node); }
function confetti() {
  const box = h('div', { class: 'confetti' });
  const cols = ['#ff6b9d', '#ffc83d', '#3aa6f5', '#2eb872', '#9b6bff', '#ff9f1c'];
  for (let i = 0; i < 36; i++) box.append(h('i', { style: `left:${Math.random() * 100}%;background:${pick(cols)};animation-duration:${1.8 + Math.random() * 1.8}s;animation-delay:${Math.random() * 0.6}s` }));
  $app.append(box); setTimeout(() => box.remove(), 4500);
}
function cheer(key) {
  const c = h('div', { class: 'cheer' }, h('div', { class: 'e' }, ui(key)));
  $app.append(c); setTimeout(() => c.remove(), 1200);
}
function starsRow(n, total = 3) {
  return h('div', { class: 'stars' }, Array.from({ length: total }, (_, i) => { const s = ui('star'); if (i >= n) s.classList.add('off'); return s; }));
}
const bigStars = (n) => h('div', { class: 'bigstars' }, [0, 1, 2].map((i) => { const s = ui('star'); if (i >= n) s.classList.add('off'); return s; }));

/* ================= شاشة الترحيب (أول مرة) ================= */
function welcome() {
  const btn = h('button', { class: 'playbig', 'aria-label': 'start', onclick: async () => {
    SFX._c(); SFX.good(); store.d.seen = true; store.save();
    TTS.speak('أهلاً وسهلاً', 0.8);
    map();
  } }, ui('play'));
  show(h('div', { class: 'screen welcome' }, h('div', { class: 'hero' }, ui('home')), btn));
  armHint(btn, 600);
}

/* ================= الخريطة ================= */
function currentLevel() {
  const n = DATA.levels.length;
  if (store.d.unlockAll) { const i = DATA.levels.findIndex((L) => !store.d.stars[L.id]); return i < 0 ? n - 1 : i; }
  return Math.min(store.d.unlocked, n - 1);
}
function map() {
  TTS.stop();
  const cur = currentLevel();
  const list = h('div', { class: 'map' });
  let curBtn = null;
  DATA.levels.forEach((L, i) => {
    const open = store.d.unlockAll || i <= store.d.unlocked;
    const stars = store.d.stars[L.id] || 0;
    const cls = ['node', !open ? 'locked' : '', i === cur && open ? 'current' : '', stars ? 'done' : ''].join(' ');
    const btn = h('button', { class: 'nodebtn', 'aria-label': L.name, onclick: () => {
      if (!open) { SFX.soft(); btn.animate([{ transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'none' }], { duration: 300 }); return; }
      SFX._c(); SFX.tap(); runLevel(i);
    } }, open ? emo(L.icon) : ui('lock'));
    if (i === cur) curBtn = btn;
    if (i) list.append(h('div', { class: 'path' }));
    list.append(h('div', { class: cls }, btn, open ? starsRow(stars) : null, h('div', { class: 'lvname' }, L.name)));
  });
  const gear = h('button', { class: 'round', 'aria-label': 'settings' }, ui('gear'));
  if (!TTS.voice && TTS.supported) setTimeout(() => { if (!TTS.voice) gear.append(h('i', { class: 'dot-alert' })); }, 1500);
  let lp; const startLP = () => { lp = setTimeout(() => { SFX.tap(); supervisor(); }, 1200); };
  gear.addEventListener('pointerdown', startLP);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => gear.addEventListener(ev, () => clearTimeout(lp)));
  const aa = h('button', { class: 'round' + (store.d.om ? ' on' : ''), 'aria-label': 'Afaan Oromoo', onclick: () => { store.d.om = !store.d.om; store.save(); aa.classList.toggle('on', store.d.om); } }, h('span', { class: 'aa' }, 'Aa'));
  show(h('div', { class: 'screen' }, h('div', { class: 'topbar' }, gear, h('div', { class: 'spacer' }), aa), list));
  const open0 = !(store.d.stars[DATA.levels[0].id]);
  armHint(curBtn, open0 ? 500 : 7000);
  window.__rehint = () => armHint(curBtn, 7000);
  setTimeout(() => curBtn && curBtn.scrollIntoView({ block: 'center' }), 50);
}

/* ================= المستوى: تعلّم ثم اختبار ================= */
function buildPlan(L) {
  const ws = L.words, chunks = [];
  let i = 0;
  while (i < ws.length) { let n = 3; if (ws.length - i - 3 === 1) n = 4; chunks.push(ws.slice(i, i + n)); i += n; }
  const plan = [];
  for (const c of chunks) { plan.push({ type: 'learn', words: c }); plan.push({ type: 'quiz', words: c, pool: c }); }
  if (chunks.length > 1) plan.push({ type: 'quiz', words: ws, pool: ws });
  return plan;
}

function runLevel(li) {
  const L = DATA.levels[li];
  const plan = buildPlan(L);
  const total = plan.reduce((a, s) => a + s.words.length, 0);
  let doneUnits = 0, mistakes = 0, si = 0;
  const fill = h('i');
  const setProg = () => { fill.style.width = Math.round((doneUnits / total) * 100) + '%'; };
  const home = h('button', { class: 'round', 'aria-label': 'home', onclick: () => map() }, ui('home'));
  const top = () => h('div', { class: 'topbar' }, home.cloneNode(true), h('div', { class: 'bar' }, fill));
  const withTop = (cls, ...kids) => {
    const t = top(); t.firstChild.onclick = () => map();
    return h('div', { class: 'screen ' + cls }, t, ...kids);
  };

  function next() {
    if (si >= plan.length) return finish();
    const s = plan[si++];
    s.type === 'learn' ? learn(s) : quiz(s);
  }

  function learn(step) {
    let k = 0;
    const card = () => {
      const w = step.words[k];
      let slow = false;
      const speak = (rate) => { cardEl.classList.remove('speaking'); void cardEl.offsetWidth; cardEl.classList.add('speaking'); return say(w, rate); };
      const cardEl = h('div', { class: 'card', onclick: () => { SFX.tap(); speak(0.85); } },
        h('div', { class: 'big' }, pic(w)), ...captions(w));
      const replay = h('button', { class: 'bigbtn blue small', 'aria-label': 'listen', onclick: () => { SFX.tap(); speak(0.85); } }, ui('speaker'));
      const slowB = h('button', { class: 'bigbtn orange small', 'aria-label': 'slow', onclick: () => { SFX.tap(); speak(0.55); } }, ui('slow'));
      const nextB = h('button', { class: 'bigbtn', 'aria-label': 'next', onclick: () => {
        SFX.good(); doneUnits++; setProg(); k++;
        k < step.words.length ? card() : next();
      } }, ui('play'));
      show(withTop('learn', cardEl, h('div', { class: 'actions' }, slowB, nextB, replay)));
      setProg();
      setTimeout(() => speak(0.85), 350);
      armHint(nextB, 5000); window.__rehint = () => armHint(nextB, 5000);
    };
    card();
  }

  function quiz(step) {
    let queue = shuffle(step.words);
    const counted = new Set();
    const finishQuiz = () => next();
    function ask() {
      if (!queue.length) return finishQuiz();
      const w = queue[0];
      let wrong = 0, locked = false;
      const others = shuffle(step.pool.filter((x) => x.id !== w.id)).slice(0, Math.min(2, step.pool.length - 1));
      const choices = shuffle([w, ...others]);
      const spk = h('button', { class: 'bigbtn blue', 'aria-label': 'listen', onclick: () => play() }, ui('speaker'));
      const play = () => { spk.classList.add('speaking'); return say(w, 0.85).then(() => spk.classList.remove('speaking')); };
      const cards = choices.map((c) => {
        const el = h('button', { class: 'opt', 'aria-label': c.id, onclick: () => choose(c, el) },
          h('div', { class: 'pbox' }, pic(c)), ...captions(c));
        return el;
      });
      const correctEl = () => cards[choices.indexOf(w)];
      async function choose(c, el) {
        if (locked) return;
        SFX._c();
        if (c.id === w.id) {
          locked = true; clearHint();
          el.classList.add('good'); cards.forEach((x) => x !== el && x.classList.add('gone'));
          SFX.good(); confetti();
          if (!counted.has(w.id)) { counted.add(w.id); doneUnits++; setProg(); }
          queue.shift();
          if (wrong > 0) queue.splice(Math.min(2, queue.length), 0, w); // كلمة أخطأت فيها: تتكرر بعد سؤالين
          await sleep(500);
          await say(w, 0.85);
          await TTS.speak(pick(DATA.praise), 0.9);
          await sleep(300);
          ask();
        } else {
          wrong++; mistakes++; locked = true; clearHint();
          el.classList.add('bad'); SFX.soft(); cheer(wrong % 2 ? 'cheer' : 'strong');
          await sleep(700);
          await TTS.speak(pick(DATA.retry), 0.9);
          await say(w, 0.8);
          locked = false;
          const left = cards.filter((x) => !x.classList.contains('bad'));
          if (wrong >= 2 || left.length === 1) correctEl().classList.add('glow');
          armHint(correctEl, 5000);
        }
      }
      show(withTop('quiz', h('div', { class: 'ask' }, spk, ...captions(w).slice(0, 1)), h('div', { class: 'opts' }, cards)));
      setProg();
      setTimeout(play, 400);
      armHint(correctEl, 8000); window.__rehint = () => armHint(correctEl, 8000);
    }
    ask();
  }

  function finish() {
    const stars = mistakes <= 2 ? 3 : mistakes <= 6 ? 2 : 1;
    const old = store.d.stars[L.id] || 0;
    store.d.stars[L.id] = Math.max(old, stars);
    store.d.unlocked = Math.max(store.d.unlocked, li + 1);
    store.save();
    SFX.win();
    const b = h('button', { class: 'bigbtn', 'aria-label': 'continue', onclick: () => { SFX.tap(); map(); } }, ui('play'));
    show(h('div', { class: 'screen done' }, h('div', { class: 'hero', style: 'width:120px;height:120px' }, ui('party')), bigStars(stars), b));
    confetti();
    setTimeout(() => TTS.speak(pick(DATA.finish), 0.85), 500);
    armHint(b, 3500);
  }

  doneUnits = 0; fill.style.width = '0';
  next();
}

/* ================= لوحة المشرف (ضغطة طويلة على ⚙️ أو #salem) ================= */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });

function sw(label, key, onchange) {
  const s = h('button', { class: 'switch' + (store.d[key] ? ' on' : ''), 'aria-label': label, onclick: () => {
    store.d[key] = !store.d[key]; store.save(); s.classList.toggle('on', store.d[key]); onchange && onchange();
  } });
  return h('div', { class: 'row' }, h('div', { class: 't' }, label), s);
}

async function offlineStatus() {
  try {
    if (!('serviceWorker' in navigator)) return '❌ المتصفح ما يدعم العمل بدون نت';
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return '⏳ لم يُسجَّل بعد (افتحي الصفحة مرة ثانية مع نت)';
    const keys = await caches.keys();
    const name = keys.find((k) => k.startsWith('arlearn-'));
    if (!name) return '⏳ التخزين لم يبدأ بعد';
    const n = (await (await caches.open(name)).keys()).length;
    return `✅ محفوظ ${n} ملف — يفترض يشتغل بدون نت (اختبريه بوضع الطيران)`;
  } catch (e) { return '❓ ' + e.message; }
}

function supervisor() {
  TTS.stop();
  let onlyUnsure = false;
  const sheet = h('div', { class: 'sheet' });
  const close = () => { $overlay.hidden = true; $overlay.replaceChildren(); if (document.querySelector('.map')) map(); };
  $overlay.onclick = (e) => { if (e.target === $overlay) close(); };

  const status = h('div', { class: 'status' }, 'جاري الفحص…');
  const render = () => {
    const rows = [];
    DATA.levels.forEach((L) => {
      const ws = L.words.filter((w) => !onlyUnsure || !w.om_ok);
      if (!ws.length) return;
      rows.push(h('tr', { class: 'lv' }, h('td', { colspan: 4 }, L.name)));
      ws.forEach((w) => rows.push(h('tr', { class: w.om_ok ? '' : 'bad' },
        h('td', { class: 'e' }, emo(Array.isArray(w.emoji) ? w.emoji[0] : w.emoji)),
        h('td', {}, w.ar),
        h('td', { class: 'o' }, (w.om ?? '—') + (w.om_ok ? '' : ' ⚠')),
        h('td', {}, h('button', { class: 'sp', 'aria-label': 'play', onclick: () => say(w, 0.85) }, '🔊')))));
    });
    table.replaceChildren(...rows);
  };
  const table = h('table');
  const unsureAll = DATA.levels.flatMap((L) => L.words).filter((w) => !w.om_ok);

  sheet.append(
    h('h2', {}, 'لوحة المشرف'),
    h('div', { class: 'note' }, 'هذي اللوحة مخفية عن العاملة. تفتح بضغطة طويلة على ⚙️ أو بإضافة #salem للرابط.'),
    h('h3', {}, 'الحالة'), status,
    h('h3', {}, 'العرض'),
    sw('وضع المشرف: يظهر تحت كل صورة الكلمة بالعربي + الأرومية (⚠ = غير مؤكدة)', 'sup'),
    sw('إظهار الأرومية (Qubee) للعاملة', 'om'),
    sw('فتح كل المستويات', 'unlockAll'),
    h('h3', {}, 'الصوت'),
    h('div', { class: 'row' }, h('div', { class: 't' }, 'جرّب النطق العربي'),
      h('button', { class: 'btn', onclick: () => TTS.speak('السلام عليكم، ما فهمت، عيدي لو سمحتي', 0.85) }, '🔊 تجربة')),
    h('h3', {}, 'التثبيت'),
    h('div', { class: 'row' }, h('div', { class: 't note' }, 'من قائمة المتصفح ⋮ اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».'),
      deferredInstall ? h('button', { class: 'btn', onclick: async () => { deferredInstall.prompt(); deferredInstall = null; } }, 'تثبيت') : null),
    h('h3', {}, 'الكلمات (' + DATA.levels.reduce((a, L) => a + L.words.length, 0) + ')'),
    h('div', { class: 'row' }, h('div', { class: 't' }, 'عرض المشكوك فيها فقط (' + unsureAll.length + ')'),
      (() => { const s = h('button', { class: 'switch', 'aria-label': 'unsure only', onclick: () => { onlyUnsure = !onlyUnsure; s.classList.toggle('on', onlyUnsure); render(); } }); return s; })()),
    h('div', { class: 'row' }, h('div', { class: 't note' }, 'للتصحيح: عدّل ملف data/words.json فقط (بدون لمس الكود).'),
      h('button', { class: 'btn grey', onclick: async (e) => {
        const txt = unsureAll.map((w) => `${w.ar}\t${w.om ?? ''}`).join('\n');
        try { await navigator.clipboard.writeText(txt); e.target.textContent = 'تم النسخ ✓'; } catch (_) { e.target.textContent = 'ما قدرت أنسخ'; }
      } }, 'نسخ المشكوك فيها')),
    table,
    h('h3', {}, 'التقدّم'),
    h('div', { class: 'row' }, h('div', { class: 't' }, 'مسح كل التقدّم والبدء من الأول'),
      h('button', { class: 'btn red', onclick: () => { if (confirm('متأكد؟')) { store.d.stars = {}; store.d.unlocked = 0; store.d.seen = false; store.save(); close(); welcome(); } } }, 'مسح')),
    h('div', { class: 'row' }, h('div', { class: 't' }, 'إغلاق'), h('button', { class: 'btn', onclick: close }, 'تم')),
  );
  render();
  $overlay.replaceChildren(sheet); $overlay.hidden = false;
  const arabicVoice = TTS.supported ? (TTS.voice ? `✅ صوت عربي: ${TTS.voice.name} (${TTS.voice.lang})` : '❌ ما لقيت صوت عربي في هذا الجوال — ثبّت «Arabic» من إعدادات تحويل النص إلى كلام') : '❌ النطق غير مدعوم في هذا المتصفح';
  offlineStatus().then((o) => { status.replaceChildren(h('div', {}, arabicVoice), h('div', {}, o), h('div', {}, navigator.onLine ? '🌐 متصل بالنت الآن' : '✈️ بدون نت الآن')); });
}

/* ================= الإقلاع ================= */
async function boot() {
  store.load();
  TTS.init();
  try {
    const res = await fetch('data/words.json');
    DATA = await res.json();
  } catch (e) {
    $app.textContent = '⚠️ ما قدرت أحمّل البيانات. افتحي الصفحة مرة وحدة مع نت.';
    return;
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (location.hash === '#salem') { map(); supervisor(); return; }
  store.d.seen ? map() : welcome();
}
window.addEventListener('hashchange', () => { if (DATA && location.hash === '#salem') supervisor(); });
boot();
