# chess-jev-web

Play chess against TypeSafe's Jev, in the browser.

Jev can't generate text, so it can't name a move from thin air. The server
generates the candidates and Jev answers one typed `choice` question per move:

- **Legal only**: Jev picks from the real legal moves (FEN + UCI/SAN list).
- **Chaos**: Jev picks one of its pieces, then picks *any* of the 64 squares.
  Illegal combos forfeit the turn. This is the funny one.

## Dev

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Environment variables:

- `TYPESAFE_API_KEY` (required): TypeSafe API key, server-side only.
- `TYPESAFE_BASE_URL` (optional): override, defaults to `https://api.typesafe.ai`.
- `JEV_MOCK=1` (optional): skip the API and pick randomly, for UI testing.

## Deploy (Vercel)

Import the repo in Vercel, add `TYPESAFE_API_KEY` as an environment
variable, deploy. No other config needed.

## Honest expectations

Jev is a judgment model, not a chess engine. Expect chaotic,
Levy-would-roast-it chess.
