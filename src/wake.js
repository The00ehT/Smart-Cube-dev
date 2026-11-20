/**
 * Bildschirm anlassen (kein Bildschirmschoner während des Trainings).
 *
 * 1. Screen Wake Lock API, wo vorhanden und wirksam (Chrome, Edge, Safari ab iOS 16.4 …)
 * 2. Auf iPhone/iPad (auch in Bluefy und anderen Apps mit WebView) zusätzlich ein unsichtbares Mini-Video
 *    (Verfahren und Video aus NoSleep.js, MIT-Lizenz). Dort meldet der Browser die Wake-Lock-API oft,
 *    ohne dass sie wirkt.
 *
 * Wichtig für iOS (WebKit lässt den Bildschirm sonst trotz Video ausgehen):
 *   – das Video darf NICHT stumm sein (es hat eine stille Tonspur) und NICHT in Schleife laufen –
 *     stattdessen springt es per timeupdate immer wieder zurück
 *   – play() muss direkt in der Berührung aufgerufen werden (nicht erst nach einem await)
 *
 * Musik im Hintergrund (Spotify …): Die stille Tonspur würde sie normalerweise anhalten. Deshalb wird die
 * Audio-Session der Seite auf „ambient“ gestellt (iOS 17+, navigator.audioSession) – dann mischt sich das
 * Video mit anderer Wiedergabe, statt sie zu unterbrechen. Ohne diese API: Einstellung „Musik hat Vorrang“
 * → stummes Video (lässt die Musik in Ruhe, hält den Bildschirm auf iOS aber evtl. nicht an).
 */
import media from 'nosleep.js/src/media.js';

let want = false;
let lock = null;
let lockFailed = false;
let video = null;
let lastError = '';
let musicFirst = false; // „Musik hat Vorrang“ (nur nötig ohne Audio-Session-API)

/** Audio-Session auf „ambient“: mischt sich mit Musik anderer Apps statt sie anzuhalten */
export const canMixAudio = () => typeof navigator !== 'undefined' && !!navigator.audioSession;
function mixWithOthers() {
  try {
    if (navigator.audioSession && navigator.audioSession.type !== 'ambient') navigator.audioSession.type = 'ambient';
  } catch {
    /* egal */
  }
}

/** Ohne Audio-Session-API: stummes Video, damit Musik weiterläuft */
export function setMusicFirst(on) {
  musicFirst = !!on;
  if (video) {
    video.muted = musicFirst && !canMixAudio();
    if (video.muted) video.setAttribute('muted', '');
    else video.removeAttribute('muted');
  }
}

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** Video nötig? Ohne Wake-Lock-API, auf iOS immer (dort unzuverlässig), oder wenn die API abgelehnt hat */
const needVideo = () => isIOS() || !('wakeLock' in navigator) || lockFailed;

function videoEl() {
  if (video) return video;
  video = document.createElement('video');
  video.setAttribute('title', 'Smartcube');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  // mp4 zuerst: hat eine (stille) Tonspur und ist länger als 1 s → kein loop nötig
  for (const [type, src] of [['mp4', media.mp4], ['webm', media.webm]]) {
    const s = document.createElement('source');
    s.src = src;
    s.type = `video/${type}`;
    video.append(s);
  }
  video.addEventListener('loadedmetadata', () => {
    if (video.duration <= 1) video.setAttribute('loop', ''); // nur webm (Desktop) – dort reicht loop
    else video.addEventListener('timeupdate', () => video.currentTime > 0.5 && (video.currentTime = Math.random()));
  });
  return video;
}

/** Video starten – muss synchron in einer Berührung passieren */
function playVideo() {
  const v = videoEl();
  mixWithOthers();
  v.muted = musicFirst && !canMixAudio();
  if (!v.paused) return;
  try {
    const p = v.play();
    p?.catch?.((e) => (lastError = e?.name || String(e)));
  } catch (e) {
    lastError = e?.name || String(e);
  }
}

async function requestLock() {
  if (lock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => (lock = null));
  } catch (e) {
    lock = null;
    lockFailed = true; // z. B. in WebViews nicht erlaubt → ab der nächsten Berührung Video
    lastError = e?.name || String(e);
  }
}

/** Bei jeder Berührung: (wieder) einschalten, falls nötig */
function onGesture() {
  if (!want || document.visibilityState !== 'visible') return;
  if (needVideo()) playVideo(); // zuerst und synchron!
  requestLock();
}

/** Bildschirm anlassen ein/aus */
export function keepAwake(on) {
  want = on;
  if (on) {
    requestLock();
    if (needVideo()) playVideo(); // klappt ohne Berührung meist nicht – dann beim nächsten Tippen
    return;
  }
  lock?.release().catch(() => {});
  lock = null;
  video?.pause();
}

/** Zustand für die Einstellungen: 'lock' | 'video' | 'both' | 'waiting' | 'off' */
export function awakeStatus() {
  if (!want) return { state: 'off' };
  const v = !!video && !video.paused;
  const l = !!lock;
  return { state: l && v ? 'both' : l ? 'lock' : v ? 'video' : 'waiting', error: lastError, ios: isIOS(), mix: canMixAudio(), muted: !!video?.muted };
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestLock();
});
for (const ev of ['touchend', 'click', 'keydown']) document.addEventListener(ev, onGesture, { capture: true, passive: true });
