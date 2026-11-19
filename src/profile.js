/**
 * Profil: Name und Avatar (Emoji oder eigenes Foto, verkleinert auf 128 px und lokal gespeichert).
 */
import { load, save } from './storage.js';
import { L } from './i18n.js';

const KEY = 'smartcube.profile.v1';
export const EMOJIS = ['🧊', '🐱', '🦊', '🐼', '🐸', '🐙', '🦄', '🐉', '🚀', '⚡', '🔥', '🎯', '🏆', '👾', '🤖', '😎'];

export const profile = { name: '', avatar: null, ...load(KEY, {}) }; // avatar: { type: 'emoji'|'image', value }

export function saveProfile() {
  return save(KEY, profile);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Inhalt eines Avatar-Kreises: Foto, Emoji oder Initialen */
export function avatarHtml(p = profile) {
  if (p.avatar?.type === 'image') return `<img src="${p.avatar.value}" alt="" />`;
  if (p.avatar?.type === 'emoji') return `<span class="emoji">${esc(p.avatar.value)}</span>`;
  const initials = (p.name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  return initials ? `<span class="initials">${esc(initials)}</span>` : '<span class="emoji">🧊</span>';
}

/** Bilddatei → quadratisch zugeschnitten, 128 × 128, als JPEG-Daten-URL */
export function resizeImage(file, size = 128, type = 'image/jpeg') {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas');
      c.width = c.height = size;
      c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL(type, 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(L('Bild konnte nicht gelesen werden', 'Could not read the image')));
    };
    img.src = url;
  });
}
