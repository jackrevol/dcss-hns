# About DCSS HNS Mobile

This is [DCSS HNS](https://github.com/jackrevol/dcss-hns), using the mobile UI
from [PocketZot](https://github.com/pocketzot/pocketzot).

**Play offline** runs the HNS engine built from this repository: triple floor
item generation and doubled item quality factor by default, no random dungeon malice, and
unlimited revival at the last floor entry. Public online servers run their
own rules; connecting to them does not enable HNS.

In the offline lobby, open **아이템 드랍 → 설정** to adjust floor item frequency,
quality and minimum level, good item / random artefact chances, gold and
consumable stack sizes. These settings affect ordinary floor items only. Presets restore
HNS defaults or original item settings. Save, then start or resume a game:
changes affect newly generated items. Existing floors and monster equipment
stay as generated. Settings apply to all offline characters on this device.

The Android APK bundles the engine and tiles, so it can start without an
internet connection. Saves remain on this device across app updates. Use
Backup to export a copy; uninstalling the app removes its private storage.
The Android Back button acts as Escape. Backgrounding requests a save at the
next safe input point. Anonymous usage reporting is disabled in this build.

Complete source: <https://github.com/jackrevol/dcss-hns>.
Mobile UI: AGPL-3.0-or-later, Copyright © 2026 the PocketZot developer;
[license](LICENSE), [attribution](ATTRIBUTION.md).
Engine: GPL-2.0-or-later; port adapted from
<https://github.com/pocketzot/pocketzot-engine>.

The upstream PocketZot guide follows.

## About PocketZot

PocketZot is an unofficial [DCSS](https://crawl.develz.org) app designed for iOS and Android phones in portrait mode. Play online on public [WebTiles](https://crawl.develz.org/wordpress/howto) servers, or offline with DCSS running entirely on your device.

## Getting started

DCSS has no app on the App Store, but you don't need one: install PocketZot like an app with "Add to Home Screen". Then log in to a WebTiles server and play, or tap "Play offline". iPads and other tablets work too.

## Features

- Custom ASCII-first design that fits the full standard console map onto a phone in portrait mode, with a font still large enough to read
- Offline play support
- Tiles support
- Chat support
- Customizable controls
- Map touch gestures
- Log in with multiple WebTiles server accounts and switch between them
- Inline tap targets in many menus and descriptions
- Context-aware control sets for common situations
- Spectator mode with an expanded map view
- Floating, collapsible monster list; tap to inspect monsters
- 8.6 trillion logos
- Installs to your home screen as a PWA

## Controls

The controls are organized into three tabs: **@**, **>**, and **?**. The mental model is:

- **@** *"micro"* — moment-to-moment actions, including during battle
- **>** *"macro"* — actions often taken outside of battle, or after clearing a floor
- **?** *"info"* — commands to get information about your character or game

Obligatory virtual keyboard also available.

## Gestures

- Tap floating monster list to inspect monsters
- Swipe floating monster list to the other side, or drag it to peek behind
- Tap place name in HUD (e.g. @D:1) to toggle minimap
- Long press on map cell to see what's there
- Long press a spell, then drag to rearrange the spell rail
- Tap or drag on map while targeting or examining (`x`) to move the cursor
- Drag map to open level map (`X`)
- Double tap on map to toggle zoom level
- Two-finger long press on map to toggle ASCII/tiles
- Hold a d-pad direction to shift-move
- Double tap Shift to lock it

### Level map (`X`)

- Drag to pan
- Tap or drag the minimap to pan
- Tap to place the cursor

## Offline play

Tap the "Play offline" card on the login screen to run DCSS directly on your device with no server, account, or connection required. The first launch installs the engine and tile data as a one-time download. After that, games can start and play even in airplane mode.

Offline characters get named save slots, a past-games list with scores and morgues, an editable options (RC) file, and a Backup feature that exports everything to a single file you can keep or move to another device. Saves live in your browser's storage, which the OS can evict under storage pressure. If a character matters to you, export a backup occasionally.

## Version support

Current stable and trunk DCSS are supported. Versions back to 0.24 generally work; older versions and forks may or may not. In particular, starting a new character on versions before 0.24 doesn't work. Offline play currently ships 0.35-a0.

## Security and privacy

PocketZot has no accounts of its own. Your browser connects directly to your chosen DCSS server over an encrypted WebSocket, just like the desktop WebTiles client. Credentials go only in the login message and are never stored. Saved logins keep the server's session cookie, not your password. The site records anonymous usage counts.

## How it was built

Most of the code was written with Claude Code. The design, product decisions, testing, and review were mine.

The source is available at <https://github.com/pocketzot/pocketzot>, licensed under [AGPL-3.0-or-later](LICENSE). See [ATTRIBUTION.md](ATTRIBUTION.md) for its relationship to DCSS.

## Feedback

Please send any comments, questions, or bug reports to <pocketzot@proton.me>. If you're enjoying the app, I'd love to hear from you.

## Thanks

My thanks to the following people, whose feedback, feature requests, and bug reports have helped improve the app. In chronological order:

- Tanach
- yfiyjf
- Tremis
- AscendedTourist
- AllRuneOrDeath
- Ralph Hayward
- MudToeberg
- evrim.zone
- invasionofsmallcubes
- aeshna-cyanea
- Caeous

And thanks to everyone else who has sent a kind word. I always appreciate your messages.
