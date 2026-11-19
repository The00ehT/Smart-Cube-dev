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
- **CFOP-Phasen**: Kreuz, **jedes F2L-Paar einzeln** (mit Slot-Farben), OLL, PLL – mit Zeit, Zügen, TPS und
  **Erkennungszeit** (Pause vor dem ersten Zug der Phase); OLL-/PLL-Skips und X-Cross werden erkannt
- **Rekonstruktion** jedes Solves in **Echtzeit** (0,25×–2×, Zug für Zug, Zeitleiste), die **Kreuzfarbe liegt
  automatisch unten** – auch ohne Gyroskop. Lösung nach Phasen gegliedert, als **Link teilbar** (alles steckt im
  Link, kein Server nötig) und in Twizzle zu öffnen
- **Ausführliche Statistik**: Zeitraum wählbar; Bestzeit, Mittel, Median, Streuung, Ø5/12/50/100 (aktuell und
  beste), Verlauf, Verteilung, Phasen-Tabelle (Erkennung vs. Ausführung, TPS, Anteil), Skip-Raten,
  Lookahead (Pausen ≥ 0,5 s), Kreuzfarben, Zeiten je F2L-Slot; +2 / DNF; Export/Import als JSON
- **Gyroskop**: Würfeldrehungen (x/y/z) werden erkannt und in der Rekonstruktion mitgezeigt (umschaltbar),
  Griffwechsel werden geschätzt (kleine Wackler in Pausen); in den Einstellungen abschaltbar (spart Akku am Handy)
- **Online-Räume**: Raum erstellen, Code oder Link teilen; alle bekommen dasselbe Scramble, sehen sich live beim
  Lösen zu (Würfel und Zeit) und die Zeiten landen in einer gemeinsamen Tabelle mit Siegen und Ø. Die Verbindung
  läuft über WebRTC direkt zwischen den Geräten (PeerJS; nur der Verbindungsaufbau nutzt den öffentlichen
  PeerJS-Server). Zum Testen mit eigenem Server: `?peer=host:port`
- **Algorithmen** (eigener Tab): alle 21 PLL und 57 OLL mit Bild, Wahrscheinlichkeit und – aus deinen Solves –
  Häufigkeit, Ø Zeit, Ø Erkennung und Ø Ausführung je Fall; eigene Algorithmen eintippen oder **am Würfel ausführen**
  (Notation wird mitgeschrieben und geprüft, ob sie den Fall löst); freie eigene Algorithmen
- **Algorithmen-Datenbank**: alle 41 F2L-Fälle (Slot vorne rechts) mit bis zu vier geprüften Algorithmen, dazu Varianten
  für die anderen Slots (gespiegelt bzw. mit Drehung); Alternativen für PLL und OLL. Jeder Algorithmus wird automatisch
  geprüft (`npm run gen:f2l` erzeugt die F2L-Daten neu)
- **Schwächen üben**: findet deine langsamsten Fälle (aus Solves und Training) und trainiert sie gezielt
- **Coach**: Hinweise aus deinen Daten (größter Hebel, Erkennung, Pausen, Kreuz, Drehungen, Fortschritt) mit passender Aktion
- **Geister-Rennen**: gegen die eigene Bestzeit oder einen geteilten Solve – gleicher Startzustand, der Geist löst live mit
- **Live-Phasen** beim Lösen, **Rekord-Feier** (Konfetti, Klang) und **Teilen-Karte** als Bild
- **Rückgängig** statt Rückfragen beim Löschen
- **Trainer**: stellt den Fall per berechnetem Setup her (vom aktuellen Zustand aus), misst Erkennung und Ausführung,
  langsame und neue Fälle kommen öfter
- **Archiv**: gute Lösungen nach dem Solve mit einem Tipp sichern; Tabelle mit Zeit, Scramble, Zügen, TPS, Fällen und
  Notiz, sortierbar nach Zeit oder Änderungsdatum
- **Leichte Scrambles**: 2 Kreuzkanten vorgelöst oder X-Cross üben (2 Kreuzkanten + 1 Paar), für die eigene Kreuzfarbe
- **Profil** mit Name und Avatar (Emoji oder eigenes Foto); der Name erscheint auf geteilten Rekonstruktionen
- **Hell-/Dunkelmodus** (automatisch nach System oder fest)
- **Kuchendiagramme**: Zeitverteilung Kreuz/F2L/OLL/PLL, F2L-Paare, Erkennen vs. Drehen
- **Würfelansicht ohne Gyroskop**: Kreuzfarbe automatisch unten (beim Scrambeln Standardlage Weiß oben, Grün vorne)
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

Mit echter Hardware getestet: **GAN i4** und **GAN356 i Carry S**.

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
| `src/cube/solve-recorder.js` | Zeitmessung (Uhrenabgleich) |
| `src/cube/analysis.js` | CFOP-Auswertung: Kreuz, F2L-Paare einzeln, OLL, PLL, Erkennungszeiten, Skips |
| `src/solve-data.js` | Speicherformat der Solves (v1 alt, v2 mit Zugzeiten) |
| `src/stats-detail.js` | Ausführliche Statistik |
| `src/share.js` | Solve als Link kodieren/dekodieren |
| `src/ui/replay.js` | Rekonstruktion (Echtzeit-Wiedergabe, Kreuz unten, Teilen) |
| `src/ui/stats-view.js` | Statistik-Ansicht mit Diagrammen |
| `src/cube/gyro.js` | Würfeldrehungen und Griffwechsel aus den Gyroskop-Daten |
| `src/cube/ll-cases.js` | OLL-/PLL-Fälle, Erkennung, Wahrscheinlichkeiten, Prüfen von Algorithmen |
| `src/cube/easy-scramble.js` | Leichte Scrambles (Kreuzteile/Paar vorgelöst) |
| `src/algs.js`, `src/ui/algs-view.js`, `src/ui/trainer.js` | Algorithmen, Fall-Statistik, Trainer |
| `src/archive.js`, `src/ui/archive-view.js` | Archiv |
| `src/room.js` | Online-Räume (PeerJS/WebRTC, Gastgeber verteilt Scrambles und Ergebnisse) |
| `src/ui/room-view.js` | Raum-Ansicht mit Live-Würfeln und Rundentabelle |
| `src/cube/connection.js` | GAN / andere Smartcubes / virtueller Würfel mit einheitlichen Ereignissen |
| `src/ui/cube-view.js` | 3D-Darstellung mit Gyroskop |
| `src/main.js` | Ablauf, Oberfläche, Statistik, Speicherung (localStorage) |
