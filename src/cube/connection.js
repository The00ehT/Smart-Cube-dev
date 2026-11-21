/**
 * Einheitliche Schnittstelle für alle Würfelquellen.
 * Jede Verbindung ruft `emit(event)` mit einem dieser Ereignisse auf:
 *   { type: 'move', move: "R'", localTimestamp, cubeTimestamp }
 *   { type: 'facelets', facelets }          vollständiger Zustand vom Würfel
 *   { type: 'gyro', quaternion: {x,y,z,w} } Lage des Würfels (GAN-Koordinaten)
 *   { type: 'battery', level }
 *   { type: 'hardware', info: {...} }
 *   { type: 'mode', mode: 'performance'|'eco' }   Gyro-Modus des Würfels wurde umgestellt (nur GAN Gen4)
 *   { type: 'disconnect' }
 * und bietet { name, kind, supportsGyro, supportsReset, reset(), refresh(), disconnect() }.
 * GAN-Würfel bieten zusätzlich: tech (Protokolldaten), modeSupported, mode, setMode(), gyroRate(), commandLog.
 */
import { connectGanCube, now } from 'gan-web-bluetooth';
import { askMac, getStoredMac, storeMac } from '../ui/mac-dialog.js';
import { L } from '../i18n.js';
import { SOLVED, patternDataToFacelets } from './facelets.js';
import { RateMeter, classifyRate, createModeSender, generationOf, hex, modeCommand, supportsModeCommand } from './cube-mode.js';

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
  const gyroMeter = new RateMeter(3000);
  const commandLog = []; // letzte gesendete Befehle (Klartext), für die Technischen Daten
  const logCommand = (label, bytes) => {
    commandLog.push({ t: Date.now(), label, hex: hex(bytes.subarray(0, 8)) });
    if (commandLog.length > 20) commandLog.shift();
  };
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
        gyroMeter.push(Date.now());
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

  // Protokolldaten: Generation aus dem Bluetooth-Service der Befehls-Characteristic
  const serviceUuid = conn.commandCharacteristic?.service?.uuid ?? null;
  const generation = generationOf(serviceUuid);
  const modeSupported = supportsModeCommand(generation) && typeof conn.sendCommandMessage === 'function';
  const modeSender = createModeSender(async (mode) => {
    const msg = modeCommand(mode);
    await conn.sendCommandMessage(msg); // verschlüsselt auf 20 Bytes und schreibt (interne Methode der Bibliothek)
    logCommand(`D4 · ${mode}`, msg);
  });

  const api = {
    kind: 'gan',
    name: conn.deviceName,
    mac: conn.deviceMAC,
    tech: {
      generation,
      service: serviceUuid,
      commandCharacteristic: conn.commandCharacteristic?.uuid ?? null,
      stateCharacteristic: conn.stateCharacteristic?.uuid ?? null,
      deviceId: conn.device?.id ?? null,
    },
    commandLog,
    modeSupported,
    /** zuletzt an den Würfel geschickter Gyro-Modus (null = noch nicht gesetzt) */
    mode: null,
    /** Gyro-Meldungen pro Sekunde (gleitend über 3 s) */
    gyroRate: () => gyroMeter.perSecond(Date.now()),
    /** aus der Rate abgeleiteter Modus: 'performance' | 'eco' | null (unklar) */
    observedMode: () => classifyRate(gyroMeter.perSecond(Date.now())),
    /** Gyro-Modus des Würfels setzen; wirft bei Fehler oder wenn der Würfel das nicht kann */
    async setMode(mode) {
      if (!modeSupported) throw new Error('Dieser Würfel unterstützt das Umschalten nicht');
      await modeSender.set(mode);
      if (modeSender.sent() === mode) {
        api.mode = mode;
        gyroMeter.clear();
        emit({ type: 'mode', mode });
      }
    },
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
    name: L('Virtueller Würfel', 'Virtual cube'),
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
