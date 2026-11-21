import assert from 'node:assert/strict';
import { modeCommand, hex, generationOf, supportsModeCommand, RateMeter, classifyRate, createModeSender, MODE_BYTE } from '../src/cube/cube-mode.js';
import { addSample, drainByMode, toCsv, batteryChartSvg, MAX_SAMPLES } from '../src/cube/battery-log.js';

// ---- Befehle (aus dem entschlüsselten Mitschnitt: D4 01 02 = Performance, D4 01 03 = Eco) ----
assert.equal(hex(modeCommand('performance').subarray(0, 4)), 'D4 01 02 00');
assert.equal(hex(modeCommand('eco').subarray(0, 4)), 'D4 01 03 00');
assert.equal(modeCommand('eco').length, 20, 'Befehle sind 20 Bytes lang');
assert.deepEqual(MODE_BYTE, { performance: 2, eco: 3 });
assert.throws(() => modeCommand('turbo'));

// ---- Protokollgeneration ----
assert.equal(generationOf('00000010-0000-FFF7-FFF6-FFF5FFF4FFF0'), 4);
assert.equal(generationOf('6e400001-b5a3-f393-e0a9-e50e24dc4179'), 2);
assert.equal(generationOf('8653000a-43e6-47b7-9cb0-5fc21d4ae340'), 3);
assert.equal(generationOf('nope'), null);
assert.equal(supportsModeCommand(4), true);
assert.equal(supportsModeCommand(2), false);

// ---- Rate und Erkennung ----
const m = new RateMeter(3000);
for (let t = 0; t < 3000; t += 83) m.push(t); // ~12/s
assert.ok(m.perSecond(3000) >= 11 && m.perSecond(3000) <= 13, `Rate ${m.perSecond(3000)}`);
assert.equal(classifyRate(12), 'performance');
assert.equal(classifyRate(1), 'eco');
assert.equal(classifyRate(4.5), null);
assert.equal(m.perSecond(9000), 0, 'Fenster läuft leer');

// ---- Sender: Reihenfolge, Mindestabstand, letzter Wunsch gewinnt ----
{
  let clock = 0;
  const written = [];
  const waits = [];
  const sender = createModeSender(async (mode) => written.push(mode), {
    gap: 300,
    clock: () => clock,
    wait: async (ms) => { waits.push(ms); clock += ms; },
  });
  await sender.set('eco');
  assert.deepEqual(written, ['eco']);
  await sender.set('eco');
  assert.deepEqual(written, ['eco'], 'gleicher Modus wird nicht doppelt gesendet');
  // schnelles Umschalten: nur der letzte Wunsch wird gesendet, Mindestabstand eingehalten
  const ps = [sender.set('performance'), sender.set('eco'), sender.set('performance')];
  await Promise.all(ps);
  assert.equal(written.at(-1), 'performance');
  assert.ok(written.length <= 3);
  assert.ok(waits.every((w) => w <= 300));
  sender.forget();
  await sender.set('performance');
  assert.equal(written.at(-1), 'performance');
  assert.ok(written.length >= 3, 'nach forget() wird erneut gesendet');
  await assert.rejects(() => sender.set('turbo'));
}
// Fehler beim Schreiben blockiert die Warteschlange nicht
{
  let fail = true;
  const sender = createModeSender(async () => { if (fail) throw new Error('GATT'); }, { gap: 0 });
  await assert.rejects(() => sender.set('eco'), /GATT/);
  fail = false;
  await sender.set('eco');
  assert.equal(sender.sent(), 'eco');
}

// ---- Akku-Verlauf ----
const MIN = 60000;
const T0 = Date.UTC(2026, 10, 21, 12, 0, 0);
{
  const log = [];
  assert.equal(addSample(log, T0, 90, 'performance'), true);
  assert.equal(addSample(log, T0 + MIN, 90, 'performance'), false, 'gleicher Wert wird nicht jede Minute gespeichert');
  assert.equal(addSample(log, T0 + 11 * MIN, 90, 'performance'), true, 'aber alle 10 Minuten');
  assert.equal(addSample(log, T0 + 12 * MIN, 90, 'eco'), true, 'Moduswechsel wird festgehalten');
  assert.equal(addSample(log, T0, 80, 'eco'), false, 'Uhr zurück: ignoriert');
  assert.equal(addSample(log, T0 + 20 * MIN, null, 'eco'), false);
  assert.equal(addSample(log, T0 + 21 * MIN, 140, 'eco'), true);
  assert.equal(log.at(-1).l, 100, 'Akku wird auf 0–100 begrenzt');
}
{
  // 2 h Performance mit 6 Punkten Verlust, danach 2 h Eco mit 2 Punkten Verlust (alle 10 min eine Messung)
  const log = [];
  let level = 100;
  for (let i = 0; i <= 12; i++) { if (i % 2 === 0 && i > 0) level -= 1; log.push({ t: T0 + i * 10 * MIN, l: level, m: 'P' }); }
  const tE = T0 + 130 * MIN;
  for (let i = 0; i <= 12; i++) { log.push({ t: tE + i * 10 * MIN, l: 94 - Math.floor(i / 6), m: 'E' }); }
  const d = drainByMode(log);
  assert.ok(Math.abs(d.P.ratePerHour - 3) < 0.01, `P ${d.P.ratePerHour}`);
  assert.ok(Math.abs(d.E.ratePerHour - 1) < 0.01, `E ${d.E.ratePerHour}`);
  assert.ok(d.E.fullHours > d.P.fullHours, 'Eco hält länger');
  assert.equal(drainByMode(log.slice(0, 2)).P, null, 'zu wenig Daten → null');
  // Laden und Lücken zählen nicht
  const charge = [{ t: T0, l: 50, m: 'P' }, { t: T0 + 30 * MIN, l: 80, m: 'P' }, { t: T0 + 40 * MIN, l: 79, m: 'P' }];
  assert.equal(drainByMode(charge).P, null);
  const gap = [{ t: T0, l: 90, m: 'E' }, { t: T0 + 3 * 3600000, l: 70, m: 'E' }];
  assert.equal(drainByMode(gap).E, null, 'Lücke (nicht verbunden) wird nicht als Verbrauch gerechnet');
  assert.match(toCsv(log), /^time,battery_percent,mode\n2026-11-21T12:00:00.000Z,100,performance/);
  const svg = batteryChartSvg(log, { now: tE + 120 * MIN, hours: 24 });
  assert.ok(svg.startsWith('<svg') && svg.includes('<polyline'), 'Diagramm mit Linie');
  assert.equal(batteryChartSvg(log.slice(0, 1), { now: T0 }), '', 'zu wenig Daten → leer');
}
{
  const log = [];
  for (let i = 0; i < MAX_SAMPLES + 50; i++) addSample(log, T0 + i * 11 * MIN, 50 + (i % 2), 'eco');
  assert.equal(log.length, MAX_SAMPLES, 'Verlauf bleibt begrenzt');
}
console.log('cube-mode: ok');
