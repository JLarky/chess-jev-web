import { NextResponse } from "next/server";
import { Chess } from "chess.js";

const BASE_URL = process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai";
const MODEL = "jev-latest";

type Criteria = Record<string, string>;

interface ChoiceAnswer {
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

// One typed "choice" question to Jev. Set JEV_MOCK=1 to skip the API
// (random pick) for local UI testing.
async function askChoice(
  criteria: Criteria,
  state: object,
  instructions: string
): Promise<ChoiceAnswer> {
  const keys = Object.keys(criteria);
  if (process.env.JEV_MOCK === "1") {
    const choice = keys[Math.floor(Math.random() * keys.length)];
    return { choice, confidence: 1, probabilities: { [choice]: 1 } };
  }
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not set on the server");
  const res = await fetch(`${BASE_URL}/v1/systemone`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      state,
      model: MODEL,
      questions: { q: { type: "choice", instructions, criteria } },
    }),
  });
  if (!res.ok) throw new Error(`TypeSafe API error: ${res.status}`);
  const data = await res.json();
  return data.answers.q as ChoiceAnswer;
}

const PIECE_NAMES: Record<string, string> = {
  p: "Pawn",
  n: "Knight",
  b: "Bishop",
  r: "Rook",
  q: "Queen",
  k: "King",
};

const uciOf = (m: { from: string; to: string; promotion?: string }) =>
  m.from + m.to + (m.promotion ?? "");

export async function POST(req: Request) {
  try {
    const { fen, mode } = await req.json();
    const chess = new Chess(fen);
    const colorName = chess.turn() === "w" ? "white" : "black";

    if (mode === "chaos") {
      // Chaos: Jev picks a piece, then ANY square. Illegal combos forfeit.
      const pieceCriteria: Criteria = {};
      const pieceLabel: Record<string, string> = {};
      for (const row of chess.board()) {
        for (const p of row) {
          if (p && p.color === chess.turn()) {
            const label = `${PIECE_NAMES[p.type]} on ${p.square}`;
            pieceCriteria[p.square] = label;
            pieceLabel[p.square] = label;
          }
        }
      }
      const a1 = await askChoice(
        pieceCriteria,
        { fen, side_to_move: colorName, step: "pick_piece" },
        `You are playing chess as ${colorName}. Pick one of your pieces to move.`
      );
      const from = a1.choice;

      const sqCriteria: Criteria = {};
      for (const f of "abcdefgh")
        for (let r = 1; r <= 8; r++) sqCriteria[`${f}${r}`] = `${f}${r}`;
      const a2 = await askChoice(
        sqCriteria,
        {
          fen,
          side_to_move: colorName,
          step: "pick_square",
          piece: pieceLabel[from] ?? from,
          from,
        },
        `You are playing chess as ${colorName}. Move the ${
          pieceLabel[from] ?? from
        } to any square. Any square is allowed, even an illegal one. Be bold.`
      );
      const to = a2.choice;

      const legal = chess
        .moves({ verbose: true })
        .filter((m) => m.from === from && m.to === to);
      const move = legal.find((m) => m.promotion === "q") ?? legal[0] ?? null;
      const confidence = Math.min(a1.confidence ?? 0, a2.confidence ?? 0);

      if (!move) {
        return NextResponse.json({
          ok: true,
          mode: "chaos",
          legal: false,
          attempt: { pieceLabel: pieceLabel[from] ?? from, from, to },
          confidence,
        });
      }
      return NextResponse.json({
        ok: true,
        mode: "chaos",
        legal: true,
        move: { uci: uciOf(move), san: move.san },
        confidence,
        note: move.promotion
          ? "Pawn hit the last rank, auto-promoted to queen."
          : undefined,
      });
    }

    // Strict: Jev picks from legal moves only.
    const moves = chess.moves({ verbose: true });
    if (moves.length === 0)
      return NextResponse.json(
        { ok: false, error: "no legal moves" },
        { status: 400 }
      );
    if (moves.length === 1) {
      const m = moves[0];
      return NextResponse.json({
        ok: true,
        mode: "strict",
        move: { uci: uciOf(m), san: m.san },
        confidence: 1,
        forced: true,
      });
    }
    const criteria: Criteria = {};
    for (const m of moves) criteria[uciOf(m)] = m.san;
    const ans = await askChoice(
      criteria,
      {
        fen,
        side_to_move: colorName,
        fullmove: chess.moveNumber(),
        in_check: chess.inCheck(),
        legal_moves: moves.map((m) => ({ uci: uciOf(m), san: m.san })),
      },
      `You are playing chess as ${colorName}. The position is given as FEN in ` +
        `state.fen and every legal move is listed in state.legal_moves (uci ` +
        `plus human-readable san). Pick the strongest move: prefer winning ` +
        `material, giving check, developing pieces and controlling the ` +
        `center; avoid hanging pieces and pointless shuffling.`
    );
    const chosen =
      moves.find((m) => uciOf(m) === ans.choice) ?? moves[0];
    return NextResponse.json({
      ok: true,
      mode: "strict",
      move: { uci: uciOf(chosen), san: chosen.san },
      confidence: ans.confidence ?? 0,
      probabilities: ans.probabilities ?? {},
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 }
    );
  }
}
