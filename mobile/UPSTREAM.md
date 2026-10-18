# Imported sources

- UI: <https://github.com/pocketzot/pocketzot>, commit
  `18e9a32bc8e758746d71e0ae7ea250abc685b427`.
  Copyright © 2026 the PocketZot developer, AGPL-3.0-or-later.
  The complete upstream license and attribution are retained in this directory.
- Browser engine port: <https://github.com/pocketzot/pocketzot-engine>, commit
  `56b141e45159e9c5ffef63d4e19b6a9414818104` (based on DCSS
  `87e7692b6fa105ad0d95ac5d4434da0d6d3a22b2`), GPL-2.0-or-later.
  Only the `wasm/` port and browser-specific changes to the C++ engine were
  imported; game data and gameplay continue to come from DCSS HNS.

Local integration changes include Android packaging and backup support, native
lifecycle saves, raw JSPI artifact fallback for Android packaging, HNS labels/source links, disabled production event reporting,
portable data stamps, cache identities covering engine and tile bytes, publication
of the identity after the complete pack, reproducible build scripts, and
dependency patch updates. Local HNS loot settings add adjustable floor loot,
quality, artefacts, and stack quantities; these are
not upstream PocketZot gameplay rules.
The private upstream HTML-link checker is replaced by the normal Vite build.
Upstream tests and golden captures are retained. Do not replace HNS gameplay
sources or generated engine/tile packs with upstream vanilla binaries.
