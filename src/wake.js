/**
 * Bildschirm anlassen (kein Bildschirmschoner während des Trainings).
 * 1. Screen Wake Lock API, wo vorhanden
 * 2. sonst (z. B. Bluefy/iOS-WebView): unsichtbares, stummes Mini-Video in Endlosschleife –
 *    das hält den Bildschirm an (Verfahren und Video aus NoSleep.js, MIT-Lizenz).
 * Videos dürfen auf dem iPhone nur nach einer Berührung starten: deshalb bei jedem Tippen nachprüfen.
 */
import media from 'nosleep.js/src/media.js';

let want = false;
let lock = null;
let video = null;

const active = () => !!lock || (video && !video.paused);

function videoEl() {
  if (video) return video;
  video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.setAttribute('aria-hidden', 'true');
  video.muted = true;
  video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1';
  for (const [type, src] of [['webm', media.webm], ['mp4', media.mp4]]) {
    const s = document.createElement('source');
    s.src = src;
    s.type = `video/${type}`;
    video.append(s);
  }
  video.addEventListener('loadedmetadata', () => {
    if (video.duration <= 1) video.loop = true;
    else video.addEventListener('timeupdate', () => video.currentTime > 0.5 && (video.currentTime = Math.random()));
  });
  document.body.append(video);
  return video;
}

async function acquire() {
  if (!want || active() || document.visibilityState !== 'visible') return;
  if ('wakeLock' in navigator) {
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => (lock = null));
      return;
    } catch {
      lock = null; // z. B. in WebViews nicht erlaubt → Video
    }
  }
  try {
    await videoEl().play();
  } catch {
    /* braucht eine Berührung – beim nächsten Tippen erneut */
  }
}

/** Bildschirm anlassen ein/aus */
export function keepAwake(on) {
  want = on;
  if (on) return acquire();
  lock?.release().catch(() => {});
  lock = null;
  video?.pause();
}

document.addEventListener('visibilitychange', () => acquire());
for (const ev of ['pointerdown', 'keydown', 'touchend']) document.addEventListener(ev, () => acquire(), { capture: true, passive: true });
