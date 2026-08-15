/* croft coffee · shared admin logic for the photo managers.
   Each page sets window.ADMIN = { key, max, maxEdge, quality }.

   Photos are shrunk, square-cropped and converted to WebP in the browser,
   then stored straight in the Realtime Database as data URLs. No Cloud
   Storage, so the project stays on the free plan and can never run a bill. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getDatabase, ref as dbRef, onValue, push, set, update, remove
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

const firebaseConfig = {
  apiKey: "AIzaSyCdS7yLXt4XtA6u5Kfa1HPqielQcHXsQVI",
  authDomain: "croft-coffee.firebaseapp.com",
  databaseURL: "https://croft-coffee-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "croft-coffee",
  storageBucket: "croft-coffee.firebasestorage.app",
  messagingSenderId: "182562882864",
  appId: "1:182562882864:web:b893701c486bf33b5bb4f5"
};

const CFG = window.ADMIN;
const MAX = CFG.max;
const KEY = CFG.key;
const MAX_EDGE = CFG.maxEdge;
const QUALITY = CFG.quality;
const PER_PHOTO_LIMIT = 190000;   /* characters; the database rule rejects more */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const $ = (id) => document.getElementById(id);
const gate = $('gate'), panel = $('panel'), msg = $('msg');
const bar = $('bar'), barFill = $('barFill'), items = $('items'), countEl = $('count');

function say(text, kind) {
  msg.textContent = text || '';
  msg.className = 'msg' + (kind ? ' ' + kind : '');
}
const kb = (n) => Math.round(n / 1024) + 'KB';

/* ---------- auth ----------
   Login problems have to be readable on the gate itself, since the panel
   that normally carries messages is hidden until someone is signed in. */
function gateSay(text, kind) {
  const el = $('gateMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'msg' + (kind ? ' ' + kind : '');
}
function explain(code) {
  if (code === 'auth/unauthorized-domain') {
    return '이 주소(' + location.hostname + ')가 파이어베이스에 등록되어 있지 않습니다. '
      + 'Authentication → 설정 → 승인된 도메인 에 추가해 주세요.';
  }
  if (code === 'auth/popup-blocked') return '브라우저가 팝업을 막았습니다. 주소창 오른쪽에서 팝업을 허용해 주세요.';
  if (code === 'auth/popup-closed-by-user') return '로그인 창이 닫혔습니다. 다시 시도해 주세요.';
  if (code === 'auth/operation-not-allowed') return '구글 로그인이 꺼져 있습니다. Authentication → Sign-in method 에서 켜 주세요.';
  return null;
}
$('loginBtn').addEventListener('click', async () => {
  gateSay('로그인 창을 여는 중…');
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    gateSay('');
  } catch (e) {
    const code = e.code || '';
    const nice = explain(code);
    gateSay(nice || ('로그인에 실패했습니다: ' + (code || e.message)), 'err');
    /* some browsers block the popup outright; the redirect flow still works */
    if (code === 'auth/popup-blocked') {
      try { await signInWithRedirect(auth, new GoogleAuthProvider()); } catch (e2) {}
    }
  }
});
$('logoutBtn').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
    gate.hidden = true; panel.hidden = false;
    $('who').textContent = user.email + ' 로 로그인됨';
    watch();
  } else {
    gate.hidden = false; panel.hidden = true;
    $('who').textContent = '';
  }
});

/* ---------- live list ---------- */
let rows = [];
function watch() {
  onValue(dbRef(db, KEY), (snap) => {
    const val = snap.val() || {};
    rows = Object.keys(val).map((id) => Object.assign({ id }, val[id]));
    rows.sort((a, b) => (a.order || 0) - (b.order || 0));
    render();
  }, (err) => {
    say('목록을 읽지 못했습니다. 데이터베이스 규칙을 확인해 주세요. (' + err.code + ')', 'err');
  });
}

function render() {
  const total = rows.reduce((n, r) => n + ((r.url || '').length), 0);
  countEl.textContent = '사진 ' + rows.length + '장 / 최대 ' + MAX + '장  ·  전체 ' + kb(total)
    + (total > 900000 ? '  (조금 무겁습니다. 오래된 사진을 지워 주세요)' : '');
  items.textContent = '';
  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = '아직 사진이 없습니다. 위에 사진을 끌어다 놓으세요.';
    items.appendChild(p);
    return;
  }
  rows.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'item' + (i >= MAX ? ' over-cap' : '');

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const img = document.createElement('img');
    img.src = r.url; img.alt = ''; img.loading = 'lazy';
    thumb.appendChild(img);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = (i + 1) + (i >= MAX ? ' · 숨김' : '') + ' · ' + kb((r.url || '').length);
    const tools = document.createElement('div');
    tools.className = 'tools';

    const up = document.createElement('button');
    up.className = 'icon-btn'; up.type = 'button'; up.title = '앞으로';
    up.textContent = '↑'; up.disabled = i === 0;
    up.addEventListener('click', () => swap(i, i - 1));

    const down = document.createElement('button');
    down.className = 'icon-btn'; down.type = 'button'; down.title = '뒤로';
    down.textContent = '↓'; down.disabled = i === rows.length - 1;
    down.addEventListener('click', () => swap(i, i + 1));

    const del = document.createElement('button');
    del.className = 'icon-btn del'; del.type = 'button'; del.title = '삭제';
    del.textContent = '✕';
    del.addEventListener('click', () => wipe(r));

    tools.append(up, down, del);
    meta.append(num, tools);

    const link = document.createElement('input');
    link.className = 'link'; link.type = 'url';
    link.placeholder = '인스타 게시물 주소 (선택)';
    link.value = r.link || '';
    link.addEventListener('change', () => {
      const v = link.value.trim();
      const alt = {}; alt[KEY + '_jpg/' + r.id + '/link'] = v;
      update(dbRef(db, KEY + '/' + r.id), { link: v })
        .then(() => { mirror(alt); say('주소를 저장했습니다.', 'ok'); })
        .catch((e) => say('저장 실패: ' + e.code, 'err'));
    });

    card.append(thumb, meta, link);
    items.appendChild(card);
  });
}

/* Every edit touches both branches, but the fallback branch is always a
   separate best-effort write: if its rule is missing, the real edit still
   goes through instead of failing with it. */
function mirror(patch) {
  return update(dbRef(db), patch).catch(function () { /* fallback only */ });
}

function swap(a, b) {
  if (b < 0 || b >= rows.length) return;
  const main = {}, alt = {};
  [[rows[a].id, b], [rows[b].id, a]].forEach(function (pair) {
    main[KEY + '/' + pair[0] + '/order'] = pair[1];
    alt[KEY + '_jpg/' + pair[0] + '/order'] = pair[1];
  });
  update(dbRef(db), main)
    .then(() => mirror(alt))
    .catch((e) => say('순서 변경 실패: ' + e.code, 'err'));
}

async function wipe(r) {
  if (!confirm('이 사진을 삭제할까요?')) return;
  try {
    await remove(dbRef(db, KEY + '/' + r.id));
    remove(dbRef(db, KEY + '_jpg/' + r.id)).catch(function () {});
    say('삭제했습니다.', 'ok');
  } catch (e) { say('삭제 실패: ' + e.code, 'err'); }
}

/* ---------- shrink, square-crop and convert, all in the browser ----------
   Two copies are made: WebP for the 97% of browsers that read it, and JPEG
   for the rest (old iPhones, pre-2020 Safari, Internet Explorer). They are
   stored in separate database branches so each visitor downloads only one. */
function squeeze(canvas, type, startQ) {
  let q = startQ;
  let data = canvas.toDataURL(type, q);
  if (data.indexOf('data:' + type) !== 0) return null;   /* format unsupported here */
  while (data.length > PER_PHOTO_LIMIT && q > 0.4) {
    q -= 0.1;
    data = canvas.toDataURL(type, q);
  }
  return data.length > PER_PHOTO_LIMIT ? null : data;
}

function toImages(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(MAX_EDGE, Math.min(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = side; c.height = side;
      const ctx = c.getContext('2d');
      const s = Math.min(im.width, im.height);
      ctx.drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, side, side);

      const webp = squeeze(c, 'image/webp', QUALITY);
      if (!webp) {
        reject(new Error('이 브라우저는 WebP 변환을 지원하지 않습니다. 크롬을 써 주세요.'));
        return;
      }
      const jpg = squeeze(c, 'image/jpeg', Math.min(0.82, QUALITY + 0.08));
      if (!jpg) {
        reject(new Error('사진이 너무 큽니다. 조금 작은 사진으로 올려 주세요.'));
        return;
      }
      resolve({ webp, jpg });
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('읽을 수 없는 파일입니다. HEIC 사진이라면 JPG로 저장한 뒤 올려 주세요.'));
    };
    im.src = url;
  });
}

async function handleFiles(fileList) {
  const files = [].slice.call(fileList).filter((f) => /^image\//.test(f.type));
  if (!files.length) { say('이미지 파일이 아닙니다.', 'err'); return; }
  const room = MAX - rows.length;
  if (room <= 0) { say('이미 ' + MAX + '장이 모두 찼습니다. 먼저 지워 주세요.', 'err'); return; }
  const use = files.slice(0, room);
  if (files.length > room) say(room + '장만 올립니다. 나머지는 자리가 없습니다.', 'err');

  bar.classList.add('on');
  let done = 0;
  let fallbackWarn = false;
  for (const f of use) {
    try {
      say('변환 중… ' + f.name);
      const pair = await toImages(f);
      say('저장 중… ' + f.name + ' (WebP ' + kb(pair.webp.length) + ' / JPG ' + kb(pair.jpg.length) + ')');
      /* one key, two branches: modern browsers read one, old ones the other.
         The main photo is saved on its own first, so a missing rule on the
         fallback branch can never block the upload itself. */
      const id = push(dbRef(db, KEY)).key;
      const order = rows.length + done;
      await set(dbRef(db, KEY + '/' + id), {
        url: pair.webp, order: order, link: '', createdAt: Date.now()
      });
      try {
        await set(dbRef(db, KEY + '_jpg/' + id), { url: pair.jpg, order: order, link: '' });
      } catch (e2) {
        fallbackWarn = true;
      }
      done++;
      barFill.style.width = Math.round((done / use.length) * 100) + '%';
    } catch (e) {
      say(f.name + ': ' + (e.message || e.code), 'err');
    }
  }
  setTimeout(() => { bar.classList.remove('on'); barFill.style.width = '0'; }, 700);
  if (done && fallbackWarn) {
    say(done + '장을 올렸습니다. 다만 구형 브라우저용 사본(' + KEY + '_jpg)은 저장되지 않았습니다. '
      + '데이터베이스 규칙에 ' + KEY + '_jpg 를 추가하고 다시 올려 주세요.', 'err');
  } else if (done) {
    say(done + '장을 올렸습니다. 홈페이지에 바로 반영됩니다.', 'ok');
  }
}

const drop = $('drop');
$('pick').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault(); drop.classList.add('over');
}));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault();
  if (ev === 'dragleave' && drop.contains(e.relatedTarget)) return;
  drop.classList.remove('over');
}));
drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
