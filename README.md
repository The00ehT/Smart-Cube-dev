# Smartcube Timer

Web-App für GAN-Smartcubes über **Web Bluetooth**: Würfel verbinden, Scramble geführt abarbeiten,
Zeit läuft automatisch ab dem ersten Zug und stoppt, sobald der Würfel gelöst ist.

Aufgebaut auf [gan-web-bluetooth](https://github.com/afedotov/gan-web-bluetooth) (Protokoll der GAN-Würfel),
[cubing.js](https://js.cubing.net/cubing/) (3D-Würfel, Scrambles, weitere Smartcube-Marken) und den Ideen aus
[gan-cube-sample](https://github.com/afedotov/gan-cube-sample).

## Funktionen

- **Verbinden** mit GAN-Würfeln (Gen2-, Gen3- und Gen4-Protokoll, Erkennung automatisch)
- **3D-Würfel** spiegelt jeden Zug; bei Würfeln mit Gyroskop dreht er sich mit dem echten Würfel
- **Geführtes Scramble** (WCA-Zufallszustand): nächster Zug hervorgehoben, falsche Züge werden erkannt
  und rot als Korrektur angezeigt, R statt R2 oder L/R vertauscht wird mitverrechnet
- **Automatische Zeitmessung**: Start beim ersten Zug, Stopp bei gelöst; Würfel-Zeitstempel werden per
  linearer Regression an die Geräteuhr angeglichen (wie csTimer)
- **CFOP-Phasen**: Kreuz / F2L / OLL / PLL mit Zeit, Zügen und TPS (Kreuzseite wird erkannt)
- **Statistik**: Bestzeit, Ø5, Ø12, Ø100, beste Durchschnitte, Mittel, TPS; +2 / DNF; Export/Import als JSON
- Optional **15 s Inspektion** nach WCA (+2 ab 15 s, DNF ab 17 s)
- **Akkustand**, Modell, Firmware
- **Andere Smartcubes** (GiiKER, GoCube, Rubik's Connected, …) experimentell über cubing.js
- **Virtueller Würfel** zum Ausprobieren ohne Hardware (Knöpfe oder Tastatur)

## Unterstützte GAN-Würfel

Laut gan-web-bluetooth 3.0.2:

| Protokoll | Modelle |
|---|---|
| Gen2 | GAN Mini ui FreePlay, GAN12 ui FreePlay, GAN12 ui, GAN356 i Carry S, GAN356 i Carry, GAN356 i 3, Monster Go 3Ai, MoYu AI 2023 |
| Gen3 | GAN356 i Carry 2 |
| Gen4 | GAN12 ui Maglev, GAN14 ui FreePlay |

Andere GAN-Modelle funktionieren, sofern sie eines dieser drei Protokolle sprechen (die App erkennt das selbst).
Meldet die App „unbekanntes Protokoll“, nutzt der Würfel ein noch nicht unterstütztes Protokoll.

## Browser

Web Bluetooth gibt es in **Chrome** und **Edge** (Windows, macOS, Linux, Android, ChromeOS). Firefox und Safari
können es nicht; auf iPhone/iPad geht es mit dem **Bluefy**-Browser. Die Seite muss über **HTTPS** (oder
`localhost`) laufen.

### MAC-Adresse

GAN-Würfel verschlüsseln ihre Daten mit ihrer MAC-Adresse. Browser geben diese normalerweise nicht heraus:

- **Automatisch:** in Chrome/Edge `chrome://flags/#enable-experimental-web-platform-features` aktivieren
- **Sonst** fragt die App einmal danach und merkt sie sich pro Würfel. Zu finden in der GAN-App (Geräteinfo)
  oder unter `chrome://bluetooth-internals` → Devices.

## Entwickeln

```bash
npm install
npm run dev      # http://localhost:5173 (localhost zählt als sicherer Ursprung → Bluetooth geht)
npm test         # Würfelmodell, Scramble-Führung, Zeitmessung
npm run build    # → dist/
```

Jeder Push wird getestet und gebaut; der Stand von `main` wird automatisch auf GitHub Pages veröffentlicht
(siehe `.github/workflows/deploy.yml`, einmalig Settings → Pages → Source: „GitHub Actions“).

## Aufbau

| Datei | Inhalt |
|---|---|
| `src/cube/facelets.js` | Sticker-Modell des Würfels (aus 3D-Geometrie), Phasenerkennung, Umwandlung zu cubing.js |
| `src/cube/scramble-tracker.js` | Scramble-Führung mit Fehlerkorrektur |
| `src/cube/solve-recorder.js` | Zeitmessung (Uhrenabgleich) und CFOP-Phasen |
| `src/cube/connection.js` | GAN / andere Smartcubes / virtueller Würfel mit einheitlichen Ereignissen |
| `src/ui/cube-view.js` | 3D-Darstellung mit Gyroskop |
| `src/main.js` | Ablauf, Oberfläche, Statistik, Speicherung (localStorage) |
