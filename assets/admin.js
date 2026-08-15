/* croft coffee · shared admin logic for the photo managers.
   Each page sets window.ADMIN = { key: 'interior'|'insta', max: 6|20, ... }
   Photos are converted to WebP in the browser before they are uploaded, so
   the site never serves a heavy original. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getDatabase, ref as dbRef, onValue, push, set, update, remove
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import {
  getStorage, ref as stRef, uploadBytes, getDownloadURL, deleteObject
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

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
const MAX_EDGE = CFG.maxEdge || 1200;   /* longest side after resize */
const QUALITY = 0.82;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

const $ = (id) => document.getElementById(id);
const gate = $('gate');
const panel = $('panel');
const msg = $('msg');
const bar = $('bar');
const barFill = $('barFill');
const items = $('items');
const countEl = $('count');

function say(text, kind) {
  msg.textContent = text || '';
  msg.className = 'msg' + (kind ? ' ' + kind : '');
}

/* ---------- auth ---------- */
$('loginBtn').addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    say('로그인에 실패했습니다: ' + (e.code || e.message), 'err');
  }
});
$('logoutBtn').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
    gate.hidden = true;
    panel.hidden = false;
    $('who').textContent = user.email + ' 로 로그인됨';
    watch();
  } else {
    gate.hidden = false;
    panel.hidden = true;
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
  countEl.textContent = '사진 ' + rows.length + '장 / 최대 ' + MAX + '장';
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
    img.src = r.url;
    img.alt = '';
    img.loading = 'lazy';
    thumb.appendChild(img);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = (i + 1) + (i >= MAX ? ' · 숨김' : '');
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
    link.className = 'link';
    link.type = 'url';
    link.placeholder = '인스타 게시물 주소 (선택)';
    link.value = r.link || '';
    link.addEventListener('change', () => {
      update(dbRef(db, KEY + '/' + r.id), { link: link.value.trim() })
        .then(() => say('주소를 저장했습니다.', 'ok'))
        .catch((e) => say('저장 실패: ' + e.code, 'err'));
    });

    card.append(thumb, meta, link);
    items.appendChild(card);
  });
}

function swap(a, b) {
  if (b < 0 || b >= rows.length) return;
  const A = rows[a], B = rows[b];
  const patch = {};
  patch[KEY + '/' + A.id + '/order'] = b;
  patch[KEY + '/' + B.id + '/order'] = a;
  update(dbRef(db), patch).catch((e) => say('순서 변경 실패: ' + e.code, 'err'));
}

async function wipe(r) {
  if (!confirm('이 사진을 삭제할까요?')) return;
  try {
    await remove(dbRef(db, KEY + '/' + r.id));
    if (r.path) { try { await deleteObject(stRef(storage, r.path)); } catch (e) {} }
    say('삭제했습니다.', 'ok');
  } catch (e) {
    say('삭제 실패: ' + e.code, 'err');
  }
}

/* ---------- convert in the browser, then upload ---------- */
function toWebP(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_EDGE / Math.max(im.width, im.height));
      const w = Math.round(im.width * scale), h = Math.round(im.height * scale);
      /* square crop so the grid stays even */
      const side = Math.min(w, h);
      const c = document.createElement('canvas');
      c.width = side; c.height = side;
      const ctx = c.getContext('2d');
      const sSide = Math.min(im.width, im.height);
      ctx.drawImage(im, (im.width - sSide) / 2, (im.height - sSide) / 2, sSide, sSide, 0, 0, side, side);
      c.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('이 브라우저가 WebP 변환을 지원하지 않습니다.'));
      }, 'image/webp', QUALITY);
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
  for (const f of use) {
    try {
      say('변환 중… ' + f.name);
      const blob = await toWebP(f);
      const name = KEY + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.webp';
      say('올리는 중… ' + f.name);
      const ref = stRef(storage, name);
      await uploadBytes(ref, blob, { contentType: 'image/webp', cacheControl: 'public,max-age=31536000' });
      const url = await getDownloadURL(ref);
      const node = push(dbRef(db, KEY));
      await set(node, {
        url: url, path: name, order: rows.length + done,
        link: '', createdAt: Date.now(),
        kb: Math.round(blob.size / 1024)
      });
      done++;
      barFill.style.width = Math.round((done / use.length) * 100) + '%';
    } catch (e) {
      say((f.name + ': ' + (e.message || e.code)), 'err');
    }
  }
  setTimeout(() => { bar.classList.remove('on'); barFill.style.width = '0'; }, 700);
  if (done) say(done + '장을 올렸습니다. 메인 페이지에 바로 반영됩니다.', 'ok');
}

const drop = $('drop');
$('pick').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault(); drop.classList.add('over');
}));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault(); if (ev === 'dragleave' && drop.contains(e.relatedTarget)) return;
  drop.classList.remove('over');
}));
drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
