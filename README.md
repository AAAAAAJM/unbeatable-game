# UNBEATABLE GAME

A monochrome collaborative game built around one impossible-looking goal: turn a **1,000 × 1,000** board completely white.

## Current phase — GitHub Pages prototype

This repository currently contains a client-only prototype so the visual direction and core interaction can be tested before a realtime backend is deployed.

### Implemented

- 1,000 × 1,000 board (1,000,000 cells)
- Canvas-based rendering (no million DOM elements)
- 1-bit board storage (~125 KB before Base64 encoding)
- Pan and zoom
- Black → white cell clicking
- Per-browser device ID
- One welcome click on first visit for testing
- +1 click for each hour the page remains actively visible
- Local persistence for board, timer, and click balance
- Responsive black/white UI

### Important prototype limitation

GitHub Pages is static hosting. It cannot be the authoritative realtime game server.

In this phase, device ID, timer, board state, and click balance live in the user's browser. Users on different devices therefore do **not** share a board yet, and browser data can be edited or cleared by the user.

This is intentional for the preview phase.

## Planned production architecture

When the gameplay/UI is approved, move authoritative state to Cloudflare:

1. Static frontend on Cloudflare Pages (or equivalent)
2. Cloudflare Worker for HTTP API
3. Durable Objects + WebSocket for realtime board updates
4. Server-authoritative click balance and hourly rewards
5. Board stored as a bitset; send only changed cells to connected clients
6. Rate limiting, validation, bot/abuse controls, and logging
7. Optional authentication later if stronger identity is required

A private GitHub repository helps protect source management, but it is **not** a security boundary for browser code. Anything sent to a browser can be inspected. Secrets, reward rules that must be trusted, and authoritative game state must stay on the server.

## GitHub Pages preview

Because the project uses plain HTML/CSS/JS, it needs no build step.

In GitHub:

1. Open **Settings → Pages**
2. Under **Build and deployment**, choose **Deploy from a branch**
3. Select `main` and `/ (root)`
4. Save

GitHub will provide the Pages URL after deployment.

## Files

- `index.html` — page structure
- `styles.css` — monochrome responsive UI
- `app.js` — board rendering, local device state, click/timer prototype
