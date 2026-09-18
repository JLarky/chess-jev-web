// Plain-text save/restore for a game. The format is human-readable and
// editable, e.g.:
//
//   # jev-chess save v1
//   mode: chaos
//   human: w
//   moves: e4 e5 Nf3 Nc6
//   fen: r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3
//
// A save can carry just a FEN (arbitrary position, empty move list) or just
// moves replayed from the standard start. When both are present the moves
// must reproduce the FEN.

import { Chess } from "chess.js";

export interface GameSave {
  mode: "strict" | "chaos";
  human: "w" | "b";
  moves: string[];
  fen: string | null;
}

export function buildSave(
  mode: "strict" | "chaos",
  human: "w" | "b",
  moves: string[],
  fen: string
): string {
  const lines = ["# jev-chess save v1", `mode: ${mode}`, `human: ${human}`];
  if (moves.length > 0) lines.push(`moves: ${moves.join(" ")}`);
  lines.push(`fen: ${fen}`);
  return lines.join("\n");
}

export function parseSave(text: string): GameSave {
  const save: GameSave = { mode: "strict", human: "w", moves: [], fen: null };
  let sawAny = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) throw new Error(`bad line: "${line}"`);
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    sawAny = true;
    if (key === "mode") {
      if (val !== "strict" && val !== "chaos")
        throw new Error(`bad mode: "${val}"`);
      save.mode = val;
    } else if (key === "human") {
      if (val !== "w" && val !== "b") throw new Error(`bad human: "${val}"`);
      save.human = val;
    } else if (key === "moves") {
      save.moves = val ? val.split(/\s+/) : [];
    } else if (key === "fen") {
      save.fen = val || null;
    } else {
      throw new Error(`unknown key: "${key}"`);
    }
  }
  if (!sawAny) throw new Error("empty save");
  return save;
}

/** Validate a parsed save and return the position plus replayed SAN history. */
export function restorePosition(save: GameSave): {
  chess: Chess;
  sans: string[];
} {
  if (save.moves.length > 0) {
    const c = new Chess();
    const sans: string[] = [];
    for (const san of save.moves) {
      try {
        sans.push(c.move(san).san);
      } catch {
        throw new Error(`invalid move "${san}"`);
      }
    }
    if (save.fen && c.fen() !== save.fen)
      throw new Error("moves do not lead to the saved position");
    return { chess: c, sans };
  }
  if (save.fen) {
    try {
      return { chess: new Chess(save.fen), sans: [] };
    } catch {
      throw new Error("invalid FEN");
    }
  }
  throw new Error("nothing to restore: need moves or a FEN");
}
