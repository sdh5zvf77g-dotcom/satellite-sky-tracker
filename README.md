# SatSky

High-quality, offline-capable satellite sky tracker for iPhone (and any modern browser).

**Your satellite icon is used as the Home Screen icon.**

## What it does

- Shows every loaded satellite currently above your horizon
- Real SGP4 propagation (verified)
- Search by name or NORAD ID
- Filter by type and minimum elevation
- Polar sky plot (North up)
- Next rising-pass predictions for space stations & Hubble
- Works fully offline with a solid core catalog
- Best-effort live refresh from Celestrak + IndexedDB cache of last good data
- Add to Home Screen → native-feeling PWA

## Core catalog

Includes ISS, Hubble, CSS, major weather/Earth-observation satellites, GPS/Galileo/BeiDou examples, Iridium, OneWeb, and a sample of Starlink objects. Enough to be useful immediately without any network.

## Run

```bash
npx serve .
# or any static server
```

Open on iPhone → Share → **Add to Home Screen**.

## Deploy

Push to GitHub and enable Pages. Pure static files, no backend required.

## Technical notes

- Propagation: satellite.js (SGP4)
- Live data: Celestrak groups (best-effort; many browsers block CORS)
- When live fails the app silently uses cache or the bundled core – it never breaks
- Elevation filter and list capping keep the UI smooth even with larger catalogs
