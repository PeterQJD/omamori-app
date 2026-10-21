# Omamori Collection

A personal app for recording my collection of omamori (charms from Japanese Shinto shrines). For my own iPhone only — not public. I'm not a coder; Claude writes the code and explains anything I need to do in plain, step-by-step language.

## Setup
- Linux laptop, VS Code, git. No Mac.
- Hosted on GitHub Pages; installed on my iPhone via Safari → Share → Add to Home Screen.
- Preview locally with `python3 -m http.server`, then push and test on the iPhone.

## Technical decisions
- PWA: plain HTML, CSS and JavaScript. No frameworks, no build step, no npm.
- Must work well in iPhone Safari (primary target) and also on iPad.
- Works offline (service worker). Show a visible version number in the app and bump it with every change, so I can confirm the phone has the latest version.
- All data (records and photos) stays on the device in IndexedDB. Nothing personal goes into the repo.
- Compress photos when they're added to keep storage and backups small.
- Include export/backup and import from the start.

## Each omamori record
- Front and back photos
- Shrine name (Japanese, plus English/romanised)
- Shrine location
- Purpose (chosen from a lookup table of common purposes, e.g. 交通安全 traffic safety, 学業成就 academic success, 縁結び matchmaking), with a free-text option
- Date acquired
- Notes

## Text entry
I'll copy Japanese text from photos using iOS Live Text and paste it in. Make pasting and correcting text easy. Don't rely on in-browser OCR.

## Build stages
1. Collection list + add/edit/delete entries + photos + backup/import
2. Map of shrine locations (OpenStreetMap)
3. Purpose lookup and translation helpers

## Working style
- One feature at a time; keep changes small and testable.
- Commit with clear messages after each working change; ask before pushing.
- Tell me exactly what to check on my iPhone after each change.
