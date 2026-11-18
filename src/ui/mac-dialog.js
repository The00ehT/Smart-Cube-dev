/**
 * GAN-Würfel verschlüsseln ihre Daten mit der MAC-Adresse als Salz.
 * Browser verraten die MAC nur mit Chrome-Flag; sonst fragen wir einmal
 * nach und merken sie uns pro Würfelname.
 */
import { load, save } from '../storage.js';

const KEY = 'smartcube.macs.v1';
const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

export function getStoredMac(device) {
  const macs = load(KEY, {});
  return macs[device.id] || macs[device.name] || null;
}

export function storeMac(name, mac) {
  if (!name || !mac) return;
  const macs = load(KEY, {});
  macs[name] = mac.toUpperCase();
  save(KEY, macs);
}

export function forgetMacs() {
  save(KEY, {});
}

export function askMac(device) {
  const dlg = document.getElementById('mac-dialog');
  const input = dlg.querySelector('input');
  const err = dlg.querySelector('.error');
  dlg.querySelector('.device-name').textContent = device.name || 'Würfel';
  input.value = getStoredMac(device) || '';
  err.textContent = '';
  dlg.showModal();
  input.focus();
  return new Promise((resolve) => {
    const finish = (value) => {
      dlg.removeEventListener('close', onClose);
      form.removeEventListener('submit', onSubmit);
      if (dlg.open) dlg.close();
      resolve(value);
    };
    const form = dlg.querySelector('form');
    const onSubmit = (e) => {
      e.preventDefault();
      if (e.submitter?.value === 'cancel') return finish(null);
      const v = input.value.trim().replace(/-/g, ':');
      if (!MAC_RE.test(v)) {
        err.textContent = 'Format: AB:12:CD:34:EF:56';
        return;
      }
      const macs = load(KEY, {});
      if (device.id) macs[device.id] = v.toUpperCase();
      if (device.name) macs[device.name] = v.toUpperCase();
      save(KEY, macs);
      finish(v.toUpperCase());
    };
    const onClose = () => finish(null);
    form.addEventListener('submit', onSubmit);
    dlg.addEventListener('close', onClose);
  });
}
