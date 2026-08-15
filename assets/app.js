/* croft coffee · scroll-scrub engine, built to the 10k standard */
(function () {
'use strict';

/* museum-browser guard: without the modern APIs this engine needs, show the
   designed still and the full page instead of attempting anything clever */
if (!window.matchMedia || !('IntersectionObserver' in window) || !window.requestAnimationFrame || !window.fetch || !window.Promise) {
  document.body.className += ' ready legacy';
  return;
}

/* ---------- format capability, decided once ----------
   WebP and VP9 WebM are far lighter, so they are the default wherever the
   browser really supports them, with JPEG and H.264 kept as the safety net. */
var probeVid = document.createElement('video');
var webmOK = !!probeVid.canPlayType && probeVid.canPlayType('video/webm; codecs="vp9"') !== '';
/* Safari's WebM decode is young and frame-accurate seeking is its weak spot,
   so the one video we scrub frame by frame stays H.264 there. */
var isSafari = /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
var webmScrubOK = webmOK && !isSafari;
var webpOK = (function () {
  var c = document.createElement('canvas');
  return !!(c.getContext && c.toDataURL('image/webp').indexOf('data:image/webp') === 0);
})();
var IMG_EXT = webpOK ? '.webp' : '.jpg';

/* every touch device (phones and tablets, both orientations) gets the cinema
   with the lighter 720p file; fine-pointer desktops keep the full-size scrub */
var MOBILE_HERO = matchMedia('(max-width: 820px), (pointer: coarse)').matches;
var VIDEO_URL = MOBILE_HERO
  ? (webmOK ? 'assets/hero-720.webm' : 'assets/hero-scrub-720.mp4')
  : (webmScrubOK ? 'assets/hero-scrub.webm' : 'assets/hero-scrub.mp4');
/* byte sizes only feed the loading ring when a server omits Content-Length */
var VIDEO_BYTES = MOBILE_HERO
  ? (webmOK ? 605000 : 1109000)
  : (webmScrubOK ? 2233000 : 2810000);
var POSTER_URL = 'assets/hero-poster' + IMG_EXT;

var video = document.getElementById('heroVideo');
var stage = document.getElementById('heroStage');
var hero = document.querySelector('.hero');
var ring = document.querySelector('.ring');
var posterLayer = document.querySelector('.poster');
var cue = document.querySelector('.cue');

/* ---------- performance tiering ----------
   Rich motion (parallax, loops) runs only where it stays smooth. Device hints
   give the first guess; a live frame-rate probe has the final say, because the
   only honest measure of a phone's speed is that phone's own frame times. */
var richMotion = true;
if (navigator.connection && navigator.connection.saveData) richMotion = false;
if (navigator.deviceMemory && navigator.deviceMemory <= 2) richMotion = false;
if (matchMedia('(prefers-reduced-motion: reduce)').matches) richMotion = false;

/* a 2ms arithmetic benchmark, calibrated on this project: a current machine
   lands near 1ms, a device roughly four times slower crosses 4ms and drops
   to plain motion. Best of two runs, so one unlucky sample cannot demote. */
if (richMotion) {
  var bench = Infinity;
  for (var br = 0; br < 2; br++) {
    var bt = performance.now(), bx = 0;
    for (var bi = 0; bi < 150000; bi++) bx += Math.sqrt(bi) * 1.0000001;
    window.__benchSink = bx;
    bench = Math.min(bench, performance.now() - bt);
  }
  if (bench > 4) richMotion = false;
}

document.body.className += ' ready fx anim-on' + (richMotion ? ' motion-rich' : '');

if (richMotion) {
  var probeStart = 0, probePrev = 0, probeFrames = 0, probeLong = 0;
  requestAnimationFrame(function probe(now) {
    if (!probeStart) probeStart = now;
    if (probePrev) { probeFrames++; if (now - probePrev > 34) probeLong++; }
    probePrev = now;
    if (now - probeStart < 2500) { requestAnimationFrame(probe); return; }
    if (probeFrames > 20 && probeLong / probeFrames > 0.2) {
      richMotion = false;
      document.body.classList.remove('motion-rich');
    }
  });
}

/* ---------- seeded rng: identical "random" offsets every load ---------- */
function rng(seed) {
  var s = seed >>> 0;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* ---------- split headlines into word and char spans ---------- */
function splitEl(el, seed) {
  var text = el.textContent;
  el.setAttribute('aria-label', text.trim());
  var rand = rng(seed);
  var wrap = document.createElement('span');
  wrap.setAttribute('aria-hidden', 'true');
  var words = text.split(/(\s+)/);
  words.forEach(function (word) {
    if (!word.length) return;
    if (/^\s+$/.test(word)) { wrap.appendChild(document.createTextNode(' ')); return; }
    var w = document.createElement('span');
    w.className = 'w';
    for (var i = 0; i < word.length; i++) {
      var c = document.createElement('span');
      c.className = 'c';
      c.textContent = word[i];
      c.style.setProperty('--th', (rand() * 0.55).toFixed(3));
      c.style.setProperty('--jx', ((rand() * 2 - 1) * 26).toFixed(1) + 'px');
      c.style.setProperty('--jy', ((rand() * 2 - 1) * 22).toFixed(1) + 'px');
      c.style.setProperty('--jr', ((rand() * 2 - 1) * 10).toFixed(1) + 'deg');
      w.appendChild(c);
    }
    wrap.appendChild(w);
  });
  el.textContent = '';
  el.appendChild(wrap);
}

/* ordered thresholds for reading-order entrances (drift, settle) */
function orderThresholds(el, spread) {
  var cs = el.querySelectorAll('.c');
  var n = Math.max(1, cs.length - 1);
  var rand = rng(7);
  cs.forEach(function (c, i) {
    c.style.setProperty('--th', ((i / n) * spread + rand() * 0.05).toFixed(3));
  });
}

/* ---------- bands ---------- */
var bands = [];
document.querySelectorAll('.band').forEach(function (el, idx) {
  var range = (el.getAttribute('data-band') || '0,1').split(',');
  var entrance = el.getAttribute('data-entrance') || 'drift';
  var b = {
    el: el,
    a: parseFloat(range[0]),
    b: parseFloat(range[1]),
    entrance: entrance,
    ramp: parseFloat(el.getAttribute('data-ramp')) || 0,
    op: -1, k: -1, ks: -1, kb: -1, kt: -1,
    first: idx === 0,
    last: idx === document.querySelectorAll('.band').length - 1
  };
  el.querySelectorAll('.split').forEach(function (s, si) { splitEl(s, idx * 31 + si * 7 + 3); });
  if (entrance === 'drift') {
    el.classList.add('entr-drift');
    el.querySelectorAll('.split').forEach(function (s) {
      orderThresholds(s, parseFloat(el.getAttribute('data-spread')) || 0.45);
    });
  }
  if (entrance === 'settle') {
    el.querySelectorAll('.split').forEach(function (s) { orderThresholds(s, 0.5); });
  }
  if (entrance === 'blur') {
    var line = el.querySelector('.band-line');
    if (line) {
      var sharp = document.createElement('span');
      sharp.className = 'sharp';
      while (line.firstChild) sharp.appendChild(line.firstChild);
      var soft = sharp.cloneNode(true);
      soft.className = 'soft';
      soft.setAttribute('aria-hidden', 'true');
      line.appendChild(soft);
      line.appendChild(sharp);
    }
  }
  bands.push(b);
});

var smoothstep = function (p, e0, e1) {
  var t = Math.min(1, Math.max(0, (p - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };

/* band one opens settled: one-time load ramp handing over to scroll */
var loadK = 0;
var loadK0 = 0;
function tickLoadK(now) {
  if (!loadK0) loadK0 = now;
  loadK = clamp((now - loadK0) / 1600, 0, 1);
  if (loadK < 1) requestAnimationFrame(tickLoadK);
  else loadK = 1;
  applyBand(bands[0], lastShown);
}
requestAnimationFrame(tickLoadK);

function applyBand(band, p) {
  var f = Math.min(0.02, (band.b - band.a) / 3);
  var op = smoothstep(p, band.a, band.a + f) * (1 - smoothstep(p, band.b - f, band.b));
  if (band.first) op = 1 - smoothstep(p, band.b - f, band.b);
  if (band.last) op = smoothstep(p, band.a, band.a + f);
  var ramp = band.ramp || Math.min(0.025, (band.b - band.a) * 0.35);
  var k = clamp((p - band.a) / ramp, 0, 1);
  if (band.first) k = Math.max(k, loadK);
  if (Math.abs(op - band.op) > 0.01 || (op > 0) !== (band.op > 0)) {
    band.op = op;
    band.el.style.opacity = op.toFixed(3);
  }
  if (Math.abs(k - band.k) > 0.008) {
    band.k = k;
    band.el.style.setProperty('--k', k.toFixed(3));
    if (band.entrance === 'settle') {
      var kt = clamp(k * 2.2, 0, 1);
      var ks = clamp((k - 0.66) * 4, 0, 1);
      var kb = clamp((k - 0.78) * 5, 0, 1);
      if (Math.abs(kt - band.kt) > 0.008) { band.kt = kt; band.el.style.setProperty('--kt', kt.toFixed(3)); }
      if (Math.abs(ks - band.ks) > 0.008) { band.ks = ks; band.el.style.setProperty('--ks', ks.toFixed(3)); }
      if (Math.abs(kb - band.kb) > 0.008) { band.kb = kb; band.el.style.setProperty('--kb', kb.toFixed(3)); }
    }
  }
}

var cueOn = null;
var stepOn = null;
var stepBtn = document.getElementById('stepBtn');
function updateCaptions(p) {
  for (var i = 0; i < bands.length; i++) applyBand(bands[i], p);
  var wantCue = p < 0.02;
  if (wantCue !== cueOn) { cueOn = wantCue; cue.classList.toggle('on', wantCue); }
  var wantStep = p < 0.955;
  if (wantStep !== stepOn) { stepOn = wantStep; stepBtn.classList.toggle('off', !wantStep); }
}

/* ---------- hero progress ---------- */
function heroProgress() {
  var range = hero.offsetHeight - window.innerHeight;
  if (range <= 0) return 0;
  return clamp(window.scrollY / range, 0, 1);
}

/* ---------- gated seeks (deadlock-safe) ---------- */
var seekBusy = false;
var pendingTime = null;
var lastSeekT = -1;
function requestSeek(t) {
  if (!video.duration) return;
  if (Math.abs(t - lastSeekT) < 0.015) return; /* sub-frame churn never reaches the decoder */
  if (seekBusy) { pendingTime = t; return; }
  seekBusy = true;
  lastSeekT = t;
  video.currentTime = t;
}
video.addEventListener('seeked', function () {
  seekBusy = false;
  if (pendingTime !== null) { var t = pendingTime; pendingTime = null; requestSeek(t); }
});
video.addEventListener('error', function () {
  seekBusy = false;
  pendingTime = null;
  failVideo();
});

/* ---------- the drive loop: lerp that rests ---------- */
var target = 0;
var shown = 0;
var lastShown = 0;
var rafId = null;
var lastTick = 0;
var heroOnScreen = true;

function tick(now) {
  var dt = Math.min(100, now - (lastTick || now));
  lastTick = now;
  var kk = 0.16;
  shown += (target - shown) * (1 - Math.pow(1 - kk, dt / 16.667));
  if (Math.abs(target - shown) < 0.0005) {
    shown = target;
    rafId = null;
    lastTick = 0;
  } else {
    rafId = requestAnimationFrame(tick);
  }
  lastShown = shown;
  if (video.duration) requestSeek(shown * video.duration);
  updateCaptions(shown);
}

function onScroll() {
  target = heroProgress();
  if (rafId === null && heroOnScreen) rafId = requestAnimationFrame(tick);
}

new IntersectionObserver(function (entries) {
  heroOnScreen = entries[0].isIntersecting;
  if (MOBILE_HERO) {
    /* the cinema rests off-screen and resumes when the visitor returns */
    if (!heroOnScreen) { try { video.pause(); } catch (e) {} }
    else if (scrubOn && stage.classList.contains('video-ready') && !video.ended) {
      var pl = video.play();
      if (pl && pl.catch) pl.catch(function () {});
    }
    return;
  }
  if (heroOnScreen) onScroll();
}).observe(hero);

/* ---------- streamed Blob with the loading ring ---------- */
var heroInited = false;
var videoFailed = false;

function initHeroOnce() {
  if (heroInited) return;
  heroInited = true;
  posterLayer.style.backgroundImage = "url('" + POSTER_URL + "')";
  video.addEventListener('canplay', function () {
    stage.classList.add('video-ready');
    if (MOBILE_HERO) startCinema();
    else requestSeek(heroProgress() * video.duration);
  }, { once: true });
  if (MOBILE_HERO) {
    /* the cinema streams progressively like the reference sites do:
       playback begins long before the whole file has arrived */
    ring.style.display = 'none';
    video.muted = true;
    video.autoplay = true;
    video.preload = 'auto';
    video.playbackRate = CINE_RATE;
    video.src = VIDEO_URL;
    video.load();
    return;
  }
  var started = false;
  function startBlobFetch() {
    if (started) return;
    started = true;
    loadHeroBlob().catch(failVideo);
  }
  var posterImg = new Image();
  posterImg.onload = startBlobFetch;
  posterImg.onerror = startBlobFetch;
  posterImg.src = POSTER_URL;
  setTimeout(startBlobFetch, 4000);
}

function loadHeroBlob() {
  var ctrl = new AbortController();
  var watchdog = setTimeout(function () { ctrl.abort(); }, 20000);
  return fetch(VIDEO_URL, { priority: 'low', signal: ctrl.signal }).then(function (res) {
    if (!res.ok || !res.body) throw new Error('video fetch failed');
    var total = Number(res.headers.get('Content-Length')) || VIDEO_BYTES;
    var reader = res.body.getReader();
    var chunks = [];
    var got = 0, lastRing = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return;
        clearTimeout(watchdog);
        watchdog = setTimeout(function () { ctrl.abort(); }, 20000);
        chunks.push(r.value);
        got += r.value.length;
        var frac = Math.min(1, got / total);
        var now = performance.now();
        if (now - lastRing > 100 || frac === 1) {
          lastRing = now;
          ring.style.setProperty('--ld', Math.round(126 * (1 - frac)));
        }
        return pump();
      });
    }
    return pump().then(function () {
      clearTimeout(watchdog);
      ring.style.setProperty('--ld', 0);
      setTimeout(function () { ring.style.opacity = 0; }, 600);
      video.src = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
      video.load();
    });
  });
}

function failVideo() {
  if (videoFailed) return;
  videoFailed = true;
  ring.style.opacity = 0;
  stage.classList.add('video-failed');
  /* the page stays complete over the poster: the settle scene carries
     the name, the hours, and the call to action */
  if (MOBILE_HERO && scrubOn) setScene(bands.length - 1);
}

/* ---------- the gate, character-identical with the CSS ---------- */
var GATES = [
  '(prefers-reduced-motion: reduce)'
];
var scrubOn = false;
function enableScrub() {
  if (scrubOn) return;
  scrubOn = true;
  initHeroOnce();
  if (MOBILE_HERO) {
    if (stage.classList.contains('video-ready')) startCinema();
    /* otherwise canplay starts the film */
    return;
  }
  addEventListener('scroll', onScroll, { passive: true });
  bands.forEach(function (b) { b.op = -1; b.k = -1; b.ks = -1; b.kb = -1; b.kt = -1; });
  updateCaptions(heroProgress());
  onScroll();
}
function disableScrub() {
  if (!scrubOn) return;
  scrubOn = false;
  removeEventListener('scroll', onScroll);
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  try { video.pause(); } catch (e) {}
}

/* ---------- the mobile cinema: the film plays itself, captions ride its clock ----------
   The page is never moved by script. This is the pattern the reference sites use. */
var CINE_RATE = 0.65;
var cineScene = -1;
var kRaf = null;
function rampK(band) {
  if (kRaf !== null) cancelAnimationFrame(kRaf);
  var t0 = performance.now();
  function stepK(now) {
    var u = clamp((now - t0) / 700, 0, 1);
    band.el.style.setProperty('--k', (u * (2 - u)).toFixed(3));
    if (band.entrance === 'settle') {
      band.el.style.setProperty('--kt', clamp(u * 2.2, 0, 1).toFixed(3));
      band.el.style.setProperty('--ks', clamp((u - 0.5) * 3, 0, 1).toFixed(3));
      band.el.style.setProperty('--kb', clamp((u - 0.65) * 4, 0, 1).toFixed(3));
    }
    kRaf = (u < 1) ? requestAnimationFrame(stepK) : null;
  }
  kRaf = requestAnimationFrame(stepK);
}
function setScene(p) {
  cineScene = p;
  for (var i = 0; i < bands.length; i++) bands[i].el.style.opacity = (i === p) ? '1' : '0';
  rampK(bands[p]);
}
function startCinema() {
  video.playbackRate = CINE_RATE;
  var seg = video.duration ? video.duration / bands.length : 0;
  setScene(seg ? Math.min(bands.length - 1, Math.floor(video.currentTime / seg)) : 0);
  if (video.ended) return;
  var played = video.play();
  if (played && played.catch) played.catch(function () {
    /* refused: the film waits at scene one with a play badge; the captions
       belong to the film's clock, so they wait too */
    setScene(0);
    armGestureRetry();
  });
}
var tapPlay = document.getElementById('tapPlay');
function armGestureRetry() {
  /* Chrome's guidance: refusal is detected from the rejected play() promise,
     and the answer is a visible Play button. Browsers grant permission on the
     RELEASE of a gesture (touchend, pointerup, click, keydown), never on the
     touch-down, so we listen there and keep retrying until playback succeeds. */
  if (tapPlay.hidden === false) return;
  tapPlay.hidden = false;
  var evs = ['pointerup', 'touchend', 'keydown', 'click'];
  function cleanup() {
    evs.forEach(function (e) { removeEventListener(e, retry, true); });
  }
  function retry() {
    if (video.ended) { cleanup(); return; }
    var p = video.play();
    if (p && p.then) p.then(cleanup).catch(function () { /* stay armed for the next gesture */ });
  }
  evs.forEach(function (e) { addEventListener(e, retry, true); });
}
video.addEventListener('play', function () {
  tapPlay.hidden = true;
});
tapPlay.addEventListener('click', function () {
  var p = video.play();
  if (p && p.catch) p.catch(function () {});
});
video.addEventListener('timeupdate', function () {
  if (!MOBILE_HERO || !video.duration) return;
  var p = Math.min(bands.length - 1, Math.floor(video.currentTime / (video.duration / bands.length)));
  if (p !== cineScene) setScene(p);
});

/* the replay button: appears 1.5s after the film truly ends, unmistakably "play it again" */
var replayBtn = document.getElementById('replayBtn');
var replayTimer = null;
function hideReplay() {
  if (replayTimer) { clearTimeout(replayTimer); replayTimer = null; }
  replayBtn.classList.remove('show');
  replayBtn.hidden = true;
}
function replayFilm() {
  hideReplay();
  if (!stage.classList.contains('video-ready')) return;
  try {
    video.pause();
    video.currentTime = 0;
  } catch (e) {}
  setScene(0);
  var pl = video.play();
  if (pl && pl.catch) pl.catch(function () { armGestureRetry(); });
}
video.addEventListener('ended', function () {
  if (!MOBILE_HERO) return;
  setScene(bands.length - 1);
  replayTimer = setTimeout(function () {
    replayBtn.hidden = false;
    requestAnimationFrame(function () { replayBtn.classList.add('show'); });
  }, 1500);
});
replayBtn.addEventListener('click', replayFilm);

/* reduced-motion visitors get the designed still, plus this opt-in:
   pressing play switches them into the cinema by their own choice */
var staticPlay = document.getElementById('staticPlay');
staticPlay.addEventListener('click', function () {
  document.body.classList.add('force-cinema');
  MOBILE_HERO = true; /* the cinema is the right opted-in experience on every device */
  enableScrub();
  if (stage.classList.contains('video-ready')) startCinema();
});

/* the logo takes the visitor to the very top and starts the film over */
document.querySelector('.nav-brand').addEventListener('click', function (e) {
  if (!MOBILE_HERO || !scrubOn) return; /* on desktop the anchor scroll rewinds the scrub by itself */
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  replayFilm();
});
function applyHeroMode() {
  if (document.body.classList.contains('force-cinema')) { enableScrub(); return; }
  if (GATES.some(function (q) { return matchMedia(q).matches; })) disableScrub();
  else enableScrub();
}
var MQLS = GATES.map(function (q) { return matchMedia(q); });
MQLS.forEach(function (m) {
  if (m.addEventListener) m.addEventListener('change', applyHeroMode);
  else m.addListener(applyHeroMode);
});
applyHeroMode();

/* ---------- entrance choreography ---------- */
var settleTimer = new WeakMap();
var entrObs = new IntersectionObserver(function (entries) {
  entries.forEach(function (e) {
    if (!e.isIntersecting) return;
    e.target.classList.add('in');
    entrObs.unobserve(e.target);
    var t = setTimeout(function () { e.target.classList.add('settled'); }, 1500);
    settleTimer.set(e.target, t);
  });
}, { threshold: 0.25 });
document.querySelectorAll('.divider, .card, .faq-item, .philosophy-figure, .visit-card, [data-reveal]')
  .forEach(function (el) { entrObs.observe(el); });

/* sections are tall, so they get their own gentler threshold */
var secObs = new IntersectionObserver(function (entries) {
  entries.forEach(function (e) {
    if (!e.isIntersecting) return;
    e.target.classList.add('in');
    secObs.unobserve(e.target);
    setTimeout(function () { e.target.classList.add('settled'); }, 1500);
  });
}, { threshold: 0.12 });
document.querySelectorAll('.section').forEach(function (el) { secObs.observe(el); });

/* ---------- space: a slow parallax, so the room holds still while you move ---------- */
var spaceFig = document.querySelector('.space-figure');
var spaceImg = spaceFig && spaceFig.querySelector('img');
var paraRaf = null;
var lastShift = null;
function parallax() {
  if (!richMotion || !spaceImg || paraRaf !== null) return;
  paraRaf = requestAnimationFrame(function () {
    paraRaf = null;
    var r = spaceFig.getBoundingClientRect();
    if (r.bottom < -60 || r.top > window.innerHeight + 60) return;
    var off = (r.top + r.height / 2 - window.innerHeight / 2) * -0.055;
    var shift = Math.round(Math.max(-24, Math.min(24, off)) * 10) / 10;
    if (shift === lastShift) return;      /* delta gate: never write the same value twice */
    lastShift = shift;
    spaceImg.style.transform = 'translate3d(0,' + shift + 'px,0) scale(1.08)';
  });
}
addEventListener('scroll', parallax, { passive: true });
parallax();

/* ---------- faq accordion on touch: fold the answers so the page is short ---------- */
if (matchMedia('(max-width: 820px), (pointer: coarse)').matches) {
  var faqList = document.querySelector('.faq-list');
  if (faqList) {
    faqList.classList.add('accordion');
    faqList.querySelectorAll('.faq-item').forEach(function (item) {
      var dt = item.querySelector('dt');
      if (!dt) return;
      var mark = document.createElement('span');
      mark.className = 'faq-mark';
      mark.setAttribute('aria-hidden', 'true');
      dt.appendChild(mark);
      dt.setAttribute('role', 'button');
      dt.setAttribute('tabindex', '0');
      dt.setAttribute('aria-expanded', 'false');
      function toggle() {
        var open = item.classList.toggle('open');
        dt.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      dt.addEventListener('click', toggle);
      dt.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); }
      });
    });
  }
}

/* ---------- the pager: one button, bottom right, the whole way down ----------
   Inside the hero it steps scene by scene (or exits, where the film is a cinema);
   below it steps section by section. On a small phone the coffee cards are stops
   of their own, so each of the three gets its own moment. */
var pager = document.getElementById('pager');
var pagerAtEnd = false;
var smallPhone = matchMedia('(max-width: 560px) and (pointer: coarse)').matches;
function topOf(el) { return Math.round(el.getBoundingClientRect().top + window.scrollY); }
function pagerStops() {
  var arr = [];
  document.querySelectorAll('#main .section, #main .film2, .footer').forEach(function (sec) {
    arr.push(topOf(sec));
    if (smallPhone && sec.id === 'coffee') {
      sec.querySelectorAll('.card').forEach(function (c) { arr.push(topOf(c) - 72); });
    }
  });
  return arr.sort(function (a, b) { return a - b; });
}
pager.addEventListener('click', function () {
  if (pagerAtEnd) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  var y = window.scrollY;
  var heroEnd = hero.offsetHeight;
  if (y < heroEnd - 12) {
    if (MOBILE_HERO) { window.scrollTo({ top: heroEnd, behavior: 'smooth' }); return; }
    var p = heroProgress();
    for (var s = 0; s < stops.length; s++) {
      if (stops[s] > p + 0.03) { animateToP(stops[s], 900); return; }
    }
    window.scrollTo({ top: heroEnd, behavior: 'smooth' });
    return;
  }
  var list = pagerStops();
  for (var i = 0; i < list.length; i++) {
    if (list[i] > y + 16) { window.scrollTo({ top: list[i], behavior: 'smooth' }); return; }
  }
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
});
var pagerRaf = null;
function updatePager() {
  if (pagerRaf !== null) return;
  pagerRaf = requestAnimationFrame(function () {
    pagerRaf = null;
    var end = (window.scrollY + window.innerHeight) >= document.body.scrollHeight - 60;
    if (end !== pagerAtEnd) {
      pagerAtEnd = end;
      pager.classList.toggle('up', end);
      pager.setAttribute('aria-label', end ? '맨 위로' : '다음으로');
    }
  });
}
pager.classList.add('show');
addEventListener('scroll', updatePager, { passive: true });
updatePager();

/* ---------- the second film: warm cup, pinned stage, captions on scroll ----------
   The video is fetched only when the visitor gets close, so it costs the first
   paint nothing. It plays and loops by itself; the captions ride the scroll. */
var reduceQ = matchMedia('(prefers-reduced-motion: reduce)');
/* the second film only ever plays forward, so WebM is safe on every browser
   that reports support, Safari included */
var F2_URL = (MOBILE_HERO ? 'assets/brew-720' : 'assets/brew-1080') + (webmOK ? '.webm' : '.mp4');
var f2Section = document.getElementById('brew');
var f2Stage = document.getElementById('film2Stage');
var f2Video = document.getElementById('film2Video');
var f2Bands = [].map.call(document.querySelectorAll('.f2band'), function (el, i, all) {
  var n = all.length;
  return { el: el, a: i / n, b: (i + 1) / n, op: -1 };
});
var f2Loaded = false;
var f2Raf = null;

function f2Progress() {
  var range = f2Section.offsetHeight - window.innerHeight;
  if (range <= 0) return 0;
  var top = f2Section.getBoundingClientRect().top + window.scrollY;
  return clamp((window.scrollY - top) / range, 0, 1);
}
function f2Update() {
  if (f2Raf !== null) return;
  f2Raf = requestAnimationFrame(function () {
    f2Raf = null;
    var p = f2Progress();
    for (var i = 0; i < f2Bands.length; i++) {
      var b = f2Bands[i];
      var f = Math.min(0.06, (b.b - b.a) / 3);
      var op = smoothstep(p, b.a, b.a + f) * (1 - smoothstep(p, b.b - f, b.b));
      if (i === 0) op = 1 - smoothstep(p, b.b - f, b.b);
      if (i === f2Bands.length - 1) op = smoothstep(p, b.a, b.a + f);
      if (Math.abs(op - b.op) > 0.01 || (op > 0) !== (b.op > 0)) {
        b.op = op;
        b.el.style.opacity = op.toFixed(3);
      }
    }
  });
}
var f2Visible = false;
function f2Play() {
  if (!f2Visible || !f2Loaded || reduceQ.matches) return;
  var pl = f2Video.play();
  if (pl && pl.catch) pl.catch(function () {});
}
function f2Load() {
  if (f2Loaded || reduceQ.matches) return;
  /* the still costs little and carries the scene, so it loads either way;
     only the video itself is withheld from a data-saver visitor */
  document.querySelector('.film2-poster').style.backgroundImage = "url('assets/brew-poster" + IMG_EXT + "')";
  if (navigator.connection && navigator.connection.saveData) return;
  f2Loaded = true;
  f2Video.addEventListener('canplay', function () {
    f2Stage.classList.add('ready');
    f2Play();   /* the stage may already be on screen by the time the file lands */
  }, { once: true });
  f2Video.addEventListener('error', function () { f2Stage.classList.remove('ready'); });
  f2Video.playbackRate = 0.8;   /* the pour keeps the room's unhurried pace */
  f2Video.src = F2_URL;
  f2Video.load();
}
/* fetch a screen early, then play only while the stage is actually on screen */
new IntersectionObserver(function (entries) {
  if (entries[0].isIntersecting) f2Load();
}, { rootMargin: '100% 0px' }).observe(f2Section);

new IntersectionObserver(function (entries) {
  f2Visible = entries[0].isIntersecting;
  if (f2Visible) { f2Update(); f2Play(); }
  else { try { f2Video.pause(); } catch (e) {} }
}, { threshold: 0 }).observe(f2Section);

addEventListener('scroll', f2Update, { passive: true });
f2Update();

/* ---------- reduced motion, honored live in both directions ---------- */
function pinToFinalStates() {
  document.querySelectorAll('.divider, .card, .faq-item, .section, .philosophy-figure, .visit-card, [data-reveal]')
    .forEach(function (el) { el.classList.add('in', 'settled'); });
  try { f2Video.pause(); } catch (e) {}
  f2Bands.forEach(function (b) { b.el.style.opacity = ''; b.op = -1; });
  bands.forEach(function (b) {
    b.el.style.opacity = '';
    b.el.style.removeProperty('--k');
  });
}
function unpinFinalStates() {
  /* scroll drives own the bands again; entrance classes may stay, that is their final state */
  bands.forEach(function (b) { b.op = -1; b.k = -1; b.ks = -1; b.kb = -1; b.kt = -1; });
}
if (reduceQ.addEventListener) {
  reduceQ.addEventListener('change', function (e) {
    if (e.matches) pinToFinalStates();
    else { unpinFinalStates(); applyHeroMode(); }
  });
}

/* ---------- the step button and the magnetic settle ----------
   One tap steps to the next scene's sweet spot. And when a finger scroll
   strands the page mid-assembly, it glides to the nearest scene center. */
var stops = bands.map(function (b) { return (b.a + b.b) / 2; });
var animId = null;
function cancelAnimP() { if (animId !== null) { cancelAnimationFrame(animId); animId = null; } }
function animateToP(p, ms) {
  var range = hero.offsetHeight - window.innerHeight;
  var from = window.scrollY;
  var to = Math.round(clamp(p, 0, 1) * range);
  if (Math.abs(to - from) < 2) return;
  cancelAnimP();
  var t0 = performance.now();
  function step(now) {
    var u = clamp((now - t0) / ms, 0, 1);
    var e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    window.scrollTo(0, from + (to - from) * e);
    animId = (u < 1) ? requestAnimationFrame(step) : null;
  }
  animId = requestAnimationFrame(step);
}
stepBtn.addEventListener('click', function () {
  if (!scrubOn) return;
  if (MOBILE_HERO) {
    document.getElementById('main').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  var p = heroProgress();
  for (var i = 0; i < stops.length; i++) {
    if (stops[i] > p + 0.03) { animateToP(stops[i], 900); return; }
  }
  animateToP(1, 900);
});
var touching = false;
addEventListener('touchstart', function () { touching = true; cancelAnimP(); }, { passive: true });
addEventListener('touchend', function () { touching = false; scheduleMagnet(); }, { passive: true });
addEventListener('wheel', cancelAnimP, { passive: true });

var magnetTimer = null;
function magnet() {
  /* desktop only: on phones the native snap owns the settling, and a script
     pulling against finger momentum is exactly what a bounce feels like */
  if (MOBILE_HERO || !scrubOn || touching || animId !== null || !heroOnScreen) return;
  var p = heroProgress();
  if (p <= 0.02 || p >= 0.955) return;
  var nearest = null, best = Infinity;
  for (var i = 0; i < bands.length; i++) {
    var b = bands[i];
    var ramp = b.ramp || Math.min(0.025, (b.b - b.a) * 0.35);
    var f = Math.min(0.02, (b.b - b.a) / 3);
    if (p >= b.a + ramp + 0.004 && p <= b.b - f - 0.004) return; /* settled and readable: leave it */
    var c = (b.a + b.b) / 2;
    var d = Math.abs(p - c);
    if (d < best) { best = d; nearest = c; }
  }
  if (nearest !== null) animateToP(nearest, 600);
}
function scheduleMagnet() {
  if (MOBILE_HERO) return;
  if (magnetTimer) clearTimeout(magnetTimer);
  magnetTimer = setTimeout(magnet, 170);
}
if (!MOBILE_HERO) addEventListener('scroll', scheduleMagnet, { passive: true });

/* ---------- instagram feed: renders when a Behold JSON feed URL is set ---------- */
var INSTA_FEED_URL = ''; /* paste the Behold feed URL here to light the grid up */
var INSTA_MAX = 32;
(function () {
  var grid = document.getElementById('instaGrid');
  var fallback = document.getElementById('instaFallback');
  if (!grid || !INSTA_FEED_URL) return;
  fetch(INSTA_FEED_URL).then(function (r) {
    if (!r.ok) throw new Error('feed unavailable');
    return r.json();
  }).then(function (data) {
    var posts = (Array.isArray(data) ? data : (data.posts || [])).slice(0, INSTA_MAX);
    if (!posts.length) return;
    var frag = document.createDocumentFragment();
    posts.forEach(function (p, i) {
      var a = document.createElement('a');
      a.href = p.permalink || 'https://www.instagram.com/croft_coffee';
      a.target = '_blank';
      a.rel = 'noopener';
      a.style.setProperty('--d', (Math.min(i, 11) * 45) + 'ms');
      a.setAttribute('aria-label', '인스타그램 게시물 열기');
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      var sized = p.sizes && (p.sizes.medium || p.sizes.small);
      img.src = (p.mediaType === 'VIDEO' && p.thumbnailUrl) ? p.thumbnailUrl : (sized ? sized.mediaUrl : p.mediaUrl);
      img.alt = '크로프트 커피 인스타그램 게시물';
      a.appendChild(img);
      frag.appendChild(a);
    });
    grid.appendChild(frag);
    grid.hidden = false;
    if (fallback) fallback.hidden = true;
    var instaObs = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      grid.classList.add('in');
      instaObs.disconnect();
      setTimeout(function () { grid.classList.add('settled'); }, 1500);
    }, { threshold: 0.05 });
    instaObs.observe(grid);
  }).catch(function () { /* the quiet instagram button stays; the page is complete without the feed */ });
})();

/* ---------- pause the living layer on hidden tabs ---------- */
document.addEventListener('visibilitychange', function () {
  document.body.classList.toggle('paused', document.hidden);
});

/* ---------- complete without the video: also catch element-level errors ---------- */
video.addEventListener('stalled', function () { /* watchdog covers the fetch; nothing to do */ });

})();
