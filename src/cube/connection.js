/**
 * Einheitliche Schnittstelle für alle Würfelquellen.
 * Jede Verbindung ruft `emit(event)` mit einem dieser Ereignisse auf:
 *   { type: 'move', move: "R'", localTimestamp, cubeTimestamp }
 *   { type: 'facelets', facelets }          vollständiger Zustand vom Würfel
 *   { type: 'gyro', quaternion: {x,y,z,w} } Lage des Würfels (GAN-Koordinaten)
 *   { type: 'battery', level }
 *   { type: 'hardware', info: {...} }
 *   { type: 'disconnect' }
 * und bietet { name, kind, supportsGyro, supportsReset, reset(), refresh(), disconnect() }.
 */
import { connectGanCube, now } from 'gan-web-bluetooth';
import { askMac, getStoredMac, storeMac } from '../ui/mac-dialog.js';
import { SOLVED, patternDataToFacelets } from './facelets.js';

export const bluetoothAvailable = () => typeof navigator !== 'undefined' && !!navigator.bluetooth;

/** Liefert die MAC-Adresse: gespeichert → automatisch (Chrome-Flag) → Eingabe */
function macProvider(device, isFallbackCall) {
  const stored = getStoredMac(device);
  if (stored && !isFallbackCall) return Promise.resolve(stored);
  // Automatisch ermitteln lassen, wenn der Browser Advertisements lesen kann
  if (!isFallbackCall && typeof device.watchAdvertisements === 'function') return Promise.resolve(null);
  return askMac(device);
}

/** GAN-Würfel (Gen2/Gen3/Gen4-Protokoll) über gan-web-bluetooth */
export async function connectGan(emit) {
  const conn = await connectGanCube(macProvider);
  storeMac(conn.deviceName, conn.deviceMAC);

  let gyroSeen = false;
  const sub = conn.events$.subscribe((e) => {
    switch (e.type) {
      case 'MOVE':
        emit({ type: 'move', move: e.move, localTimestamp: e.localTimestamp, cubeTimestamp: e.cubeTimestamp });
        break;
      case 'FACELETS':
        emit({ type: 'facelets', facelets: e.facelets });
        break;
      case 'GYRO':
        if (!gyroSeen) { gyroSeen = true; api.supportsGyro = true; emit({ type: 'gyro-available' }); }
        emit({ type: 'gyro', quaternion: e.quaternion });
        break;
      case 'BATTERY':
        emit({ type: 'battery', level: e.batteryLevel });
        break;
      case 'HARDWARE':
        emit({ type: 'hardware', info: e });
        break;
      case 'DISCONNECT':
        sub.unsubscribe();
        emit({ type: 'disconnect' });
        break;
    }
  });

  const api = {
    kind: 'gan',
    name: conn.deviceName,
    mac: conn.deviceMAC,
    supportsGyro: false,
    supportsReset: true,
    async reset() {
      await conn.sendCubeCommand({ type: 'REQUEST_RESET' });
      await conn.sendCubeCommand({ type: 'REQUEST_FACELETS' });
    },
    async refresh() {
      await conn.sendCubeCommand({ type: 'REQUEST_FACELETS' });
    },
    async requestBattery() {
      await conn.sendCubeCommand({ type: 'REQUEST_BATTERY' });
    },
    async disconnect() {
      await conn.disconnect();
    },
  };

  await conn.sendCubeCommand({ type: 'REQUEST_HARDWARE' });
  await conn.sendCubeCommand({ type: 'REQUEST_FACELETS' });
  await conn.sendCubeCommand({ type: 'REQUEST_BATTERY' });
  return api;
}

/** Andere Smartcubes (GiiKER, GoCube, Rubik's Connected, ältere GAN) über cubing.js – experimentell */
export async function connectOther(emit) {
  const { connectSmartPuzzle } = await import('cubing/bluetooth');
  const puzzle = await connectSmartPuzzle();
  puzzle.addAlgLeafListener((e) => {
    const text = e.latestAlgLeaf.toString();
    const t = now();
    // Doppelzüge in Vierteldrehungen zerlegen, damit alles einheitlich bleibt
    const m = /^([URFDLB])(2?)('?)$/.exec(text);
    if (!m) return;
    const moves = m[2] ? [m[1], m[1]] : [m[1] + m[3]];
    for (const mv of moves) emit({ type: 'move', move: mv, localTimestamp: t, cubeTimestamp: null });
  });
  // Startzustand, falls das Gerät ihn liefert
  try {
    const pattern = await puzzle.getPattern();
    emit({ type: 'facelets', facelets: patternDataToFacelets(pattern.patternData) });
  } catch {
    /* nicht unterstützt: Würfel wird als gelöst angenommen */
  }
  const device = puzzle.server?.device ?? puzzle.device;
  device?.addEventListener?.('gattserverdisconnected', () => emit({ type: 'disconnect' }));
  return {
    kind: 'other',
    name: puzzle.name() || 'Smartcube',
    supportsGyro: false,
    supportsReset: false,
    async reset() {},
    async refresh() {},
    async requestBattery() {},
    async disconnect() {
      puzzle.disconnect();
      emit({ type: 'disconnect' });
    },
  };
}

/** Virtueller Würfel: Züge über Bildschirmknöpfe oder Tastatur */
export function connectVirtual(emit) {
  return {
    kind: 'virtual',
    name: 'Virtueller Würfel',
    supportsGyro: false,
    supportsReset: true,
    turn(move) {
      emit({ type: 'move', move, localTimestamp: now(), cubeTimestamp: null });
    },
    async reset() {
      emit({ type: 'facelets', facelets: SOLVED });
    },
    async refresh() {},
    async requestBattery() {},
    async disconnect() {
      emit({ type: 'disconnect' });
    },
  };
}
