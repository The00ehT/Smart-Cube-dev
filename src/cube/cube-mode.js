/**
 * Gyroskop-Modus des Würfels (GAN Gen4, z. B. GAN i4): „Performance“ ⇄ „Eco“.
 *
 * Erkenntnisse aus einem Bluetooth-Mitschnitt der Hersteller-App (Befehle entschlüsselt):
 *   D4 01 02  → Performance (ca. 12 Gyro-Meldungen pro Sekunde)
 *   D4 01 03  → Eco         (ca. 1 Meldung pro Sekunde, Gyroskop-Strom praktisch aus)
 * Der Befehl wird – wie alle Befehle – auf 20 Bytes aufgefüllt, verschlüsselt und auf die
 * Befehls-Characteristic (Handle 0x0012, UUID fff5) geschrieben. Das Verschlüsseln übernimmt die
 * Verbindung von gan-web-bluetooth (`sendCommandMessage`).
 * Zur Einordnung der übrigen Befehle im Mitschnitt: DD 04 00 EF = Akku, DF 03 = Hardware,
 * DD 04 00 ED = Zustand, F0 01 01 = (unbekannt, im Handshake der Hersteller-App).
 */

export const MODE_PERFORMANCE = 'performance';
export const MODE_ECO = 'eco';
export const MODES = [MODE_PERFORMANCE, MODE_ECO];

/** Modus-Byte im Befehl D4 01 <modus> */
export const MODE_BYTE = { [MODE_PERFORMANCE]: 0x02, [MODE_ECO]: 0x03 };

/** Klartext des Befehls (20 Bytes), unverschlüsselt */
export function modeCommand(mode) {
  if (!(mode in MODE_BYTE)) throw new Error(`Unbekannter Modus: ${mode}`);
  const msg = new Uint8Array(20);
  msg.set([0xd4, 0x01, MODE_BYTE[mode]]);
  return msg;
}

export const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

/** Bluetooth-Services der GAN-Protokollgenerationen (aus gan-web-bluetooth) */
export const GAN_SERVICES = {
  '6e400001-b5a3-f393-e0a9-e50e24dc4179': 2,
  '8653000a-43e6-47b7-9cb0-5fc21d4ae340': 3,
  '00000010-0000-fff7-fff6-fff5fff4fff0': 4,
};
/** Protokollgeneration (2, 3, 4) zum Service, sonst null */
export const generationOf = (serviceUuid) => GAN_SERVICES[String(serviceUuid || '').toLowerCase()] ?? null;
/** Nur Gen4 wurde mitgeschnitten und geprüft */
export const supportsModeCommand = (generation) => generation === 4;

/** Zählt Ereignisse und liefert die Rate pro Sekunde im gleitenden Fenster */
export class RateMeter {
  constructor(windowMs = 3000) {
    this.windowMs = windowMs;
    this.times = [];
  }
  push(t) {
    this.times.push(t);
    this.trim(t);
  }
  trim(t) {
    const from = t - this.windowMs;
    let i = 0;
    while (i < this.times.length && this.times[i] < from) i++;
    if (i) this.times.splice(0, i);
  }
  /** Ereignisse pro Sekunde im Fenster, das bei `t` endet */
  perSecond(t) {
    this.trim(t);
    return (this.times.length * 1000) / this.windowMs;
  }
  clear() {
    this.times = [];
  }
}

/** Aus der gemessenen Rate auf den Modus schließen (null = unklar) */
export function classifyRate(perSecond) {
  if (perSecond >= 6) return MODE_PERFORMANCE;
  if (perSecond <= 3) return MODE_ECO;
  return null;
}

/**
 * Sendet Modus-Befehle nacheinander, mit Mindestabstand; bei schnellem Umschalten gewinnt der letzte
 * Wunsch (die Hersteller-App schaltete im Test alle ~0,3 s um).
 * @param write  async (mode) => void – schreibt den Befehl
 */
export function createModeSender(write, { gap = 300, clock = () => Date.now(), wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let wanted = null;
  let sent = null;
  let lastAt = -Infinity;
  let chain = Promise.resolve();
  const job = async () => {
    const dt = clock() - lastAt;
    if (dt < gap) await wait(gap - dt);
    const mode = wanted; // nach dem Warten neu lesen: später gewünschter Modus gewinnt
    if (mode === sent) return;
    lastAt = clock();
    await write(mode);
    sent = mode;
  };
  return {
    /** Wunsch-Modus setzen; erfüllt sich, sobald der Würfel ihn bekam (Fehler → ablehnen) */
    set(mode) {
      if (!(mode in MODE_BYTE)) return Promise.reject(new Error(`Unbekannter Modus: ${mode}`));
      wanted = mode;
      chain = chain.catch(() => {}).then(job);
      return chain;
    },
    /** zuletzt tatsächlich gesendeter Modus */
    sent: () => sent,
    wanted: () => wanted,
    /** Nach einer neuen Verbindung: der Würfel kennt den Modus nicht mehr */
    forget() {
      sent = null;
    },
  };
}
