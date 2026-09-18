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
      // Chaos, redesigned: Jev shortlists its top 3 pieces, then its top 4
      // destination squares for each piece (any square allowed, even illegal),
      // then ranks all 12 ideas. We play the first legal one. A turn is only
      // forfeited if every single idea is illegal.
      interface PieceInfo {
        square: string;
        type: string;
        label: string;
      }
      const ownPieces: PieceInfo[] = [];
      const pieceCriteria: Criteria = {};
      for (const row of chess.board()) {
        for (const p of row) {
          if (p && p.color === chess.turn()) {
            const label = `${PIECE_NAMES[p.type]} on ${p.square}`;
            pieceCriteria[p.square] = label;
            ownPieces.push({ square: p.square, type: p.type, label });
          }
        }
      }
      const aPieces = await askChoice(
        pieceCriteria,
        { fen, side_to_move: colorName, step: "pick_pieces" },
        `You are playing chess as ${colorName}, but today you are pure chaos. ` +
          `Which of your pieces itch to move? Your probability distribution ` +
          `over the pieces is the shortlist: the top 3 will be used.`
      );
      const pieceProbs =
        aPieces.probabilities ?? { [aPieces.choice]: aPieces.confidence ?? 1 };
      const topPieces = ownPieces
        .map((op) => ({ ...op, confidence: pieceProbs[op.square] ?? 0 }))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3);
      if (topPieces.length === 0) throw new Error("Jev picked no pieces");

      // Top 4 destination squares per piece, asked in parallel.
      const allSquares: string[] = [];
      const sqCriteria: Criteria = {};
      for (const f of "abcdefgh")
        for (let r = 1; r <= 8; r++) {
          const sq = `${f}${r}`;
          allSquares.push(sq);
          sqCriteria[sq] = sq;
        }
      const squareAnswers = await Promise.all(
        topPieces.map((p) =>
          askChoice(
            sqCriteria,
            {
              fen,
              side_to_move: colorName,
              step: "pick_squares",
              piece: p.label,
              from: p.square,
            },
            `You are playing chess as ${colorName}, and chaos is the plan. ` +
              `Send the ${p.label} somewhere wild. Any square is allowed, ` +
              `even an illegal one. Your probability distribution over the ` +
              `squares is the shortlist: the top 4 destinations will be used. ` +
              `Be bold.`
          )
        )
      );
      interface Candidate {
        pieceLabel: string;
        pieceType: string;
        from: string;
        to: string;
      }
      const candidates: Candidate[] = [];
      topPieces.forEach((p, i) => {
        const ans = squareAnswers[i];
        const sp = ans.probabilities ?? { [ans.choice]: ans.confidence ?? 1 };
        const top = allSquares
          .map((to) => ({ to, confidence: sp[to] ?? 0 }))
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 4);
        for (const t of top)
          candidates.push({
            pieceLabel: p.label,
            pieceType: p.type,
            from: p.square,
            to: t.to,
          });
      });

      // Rank all 12 ideas.
      const rankCriteria: Criteria = {};
      candidates.forEach((c, i) => {
        rankCriteria[String(i)] = `${c.pieceLabel} to ${c.to}`;
      });
      const aRank = await askChoice(
        rankCriteria,
        {
          fen,
          side_to_move: colorName,
          step: "rank_moves",
          candidates: candidates.map((c, i) => ({
            id: i,
            piece: c.pieceLabel,
            from: c.from,
            to: c.to,
          })),
        },
        `You are playing chess as ${colorName}, judging a chaos contest. ` +
          `The move ideas are in state.candidates. Pick the most deliciously ` +
          `chaotic one: prefer captures, checks, and absurd piece journeys. ` +
          `Legality is checked separately, so do not worry about whether a ` +
          `move is legal. Your probability distribution over the ideas is ` +
          `the final ranking.`
      );
      const rankProbs =
        aRank.probabilities ?? { [aRank.choice]: aRank.confidence ?? 1 };
      const legalMoves = chess.moves({ verbose: true });
      const options = candidates
        .map((cand, i) => {
          const legal = legalMoves.filter(
            (m) => m.from === cand.from && m.to === cand.to
          );
          const mv =
            legal.find((m) => m.promotion === "q") ?? legal[0] ?? null;
          return {
            pieceLabel: cand.pieceLabel,
            pieceType: cand.pieceType,
            from: cand.from,
            to: cand.to,
            san: mv ? mv.san : null,
            uci: mv ? uciOf(mv) : cand.from + cand.to,
            confidence: rankProbs[String(i)] ?? 0,
            legal: !!mv,
            played: false,
          };
        })
        .sort((a, b) => b.confidence - a.confidence);

      const played = options.find((o) => o.legal) ?? null;
      if (!played) {
        return NextResponse.json({
          ok: true,
          mode: "chaos",
          legal: false,
          forfeited: true,
          options,
          confidence: options[0]?.confidence ?? 0,
        });
      }
      played.played = true;
      return NextResponse.json({
        ok: true,
        mode: "chaos",
        legal: true,
        move: { uci: played.uci, san: played.san },
        confidence: played.confidence,
        options,
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
