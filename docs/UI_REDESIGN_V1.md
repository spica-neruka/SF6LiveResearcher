# UI redesign Version 1 — review snapshot

2026-09-05 / branch: `codex/ui-redesign-v1`

## Scope

Phase 0 audited the latest main at `79a8c08a20db46eec7e5a15d9e94d43ae057a17f` with a clean frontend worktree. Both existing browser suites passed before implementation.

Phases 1–3 are implemented together as one coherent review snapshot:

- White/yellow/black/pink theme, horizontal desktop header, four fixed mobile navigation destinations, and a utility menu.
- Home limited to Hero, LIVE NOW, and CHARACTERS. Mobile uses manual horizontal scrolling.
- Home shows four LIVE cards while the player uses the entire loaded, filtered queue.
- Primary watch CTA, card entry, full LIVE list, and character-filtered Explore routes.
- Explore contains the existing LIVE filters and entry points for streamers and all characters.
- Search/character/category/sort URL state and browser history for Home/Explore/upcoming.
- Loading, empty, failed, stale, and partially loaded states. Empty Home does not fetch upcoming merely to render a fallback.

## Changed files and reused behavior

| File | Change |
| --- | --- |
| index.html | Four navigation items, utility menu, brand route, theme CSS |
| css/redesign.css | Scoped theme and layout overrides; existing styles retained |
| js/app.js | Home and Explore rendering, route state, navigation and decoration fallback |
| scripts/verify-frontend.mjs | Existing regressions adapted to new navigation and available grid width |
| scripts/verify-zapping.mjs | Existing player/gesture regressions adapted to the new entry points |
| scripts/verify-redesign.mjs | New home/queue/request/history/state/mobile tests |
| scripts/preview-server.mjs | Local sample-only interactive preview, separate from production |

The API acquisition layer, resource cache, favorites storage, card renderer, and `js/zapping-player.js` are reused. No backend, database, production API endpoint, or deployment configuration changed. The persistent iframe is not recreated during switching or navigation.

## Validation

All three suites passed with local Chrome and bundled Playwright, using mocked API and YouTube data:

```sh
node scripts/verify-frontend.mjs
node scripts/verify-zapping.mjs
node scripts/verify-redesign.mjs
```

Set `UI_PLAYWRIGHT_PATH`, `UI_CHROMIUM_PATH`, and optionally `UI_OUTPUT_DIR` as described in README when using external dependencies.

- Initial Home → start → fifth stream → full list: one LIVE request total; Home four cards / player eight-item fixture queue.
- Character selection → search → playback → back/forward: zero additional API requests.
- Direct filtered URL: one initial LIVE request; conditions restored.
- Existing pagination, local search, favorites, keyboard, wheel/swipe, delayed player creation, iframe identity, audio state and history tests pass.
- Responsive Home: 320, 390, 760, 820, 1024, 1440, and 2560px. No page overflow, visible first LIVE thumbnail on mobile, and mini-player above bottom navigation.
- Existing player checks include 1366×768, 1920×1080 and 2560×1440.
- Syntax and whitespace checks pass.

Local evidence:

- `.ui-verification/phase0-frontend/`, `.ui-verification/phase0-zapping/`: baseline screenshots.
- `.ui-verification/v1-frontend/`, `.ui-verification/v1-zapping/`: regression screenshots.
- `.ui-verification/v1-redesign/results.json`: API journey counts and responsive results.
- `.ui-verification/v1-redesign/home-*.png`: deterministic screenshots with test artwork.

Screenshots and local machine dependency paths are intentionally excluded from Git. Browser tests make no production API calls. D1 Rows Read was not measured; unchanged backend/query paths and equivalent-or-fewer frontend requests are the evidence for avoiding additional load.

## Preview and limitations

```sh
node scripts/preview-server.mjs
```

The server binds only to `127.0.0.1`, prints its URL and defaults to port 4173. Set `PREVIEW_PORT` if that port is occupied. The current review session uses port 4186.

The preview is visibly labeled as sample data. It serves local SVG thumbnails and a mock player with an explanatory message, without proxying the production API or playing fabricated video IDs. Production index.html does not contain the sample API or player injection.

Hero currently uses an existing official Juri portrait as temporary artwork. The reference image's separate mascot, cat, brush lettering and brush textures are unavailable. CSS decoration and live text remain editable; no new raster image was generated. This is a layout/interaction trial, not an exact artwork reproduction.

Official character images are external dependencies. They displayed in the in-app browser during visual inspection, but the standalone capture browser could not load them. Decorative Hero image failure is handled without a broken-image icon; character names remain available without artwork. Before final visual approval, confirm the dedicated Hero asset and reliable image delivery.

Real YouTube playback, ads, device-specific fullscreen, autoplay behavior, Firefox/WebKit and screen-reader operation were not tested by these mocked Chromium suites. Production access restrictions were not changed for previewing.

## Next review gate

Review Version 1's PC/mobile layout and the temporary artwork treatment before choosing the start scope of Phase 4. Phase 4's full discovery integration, Phase 5's activity aggregation, and Phase 6's ordinary videos are not implemented. Public deployment is a separate action.
