import { NextResponse } from "next/server";
import { Chess, Square } from "chess.js";

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
      // reachable destinations for each piece (a rook gets its rank and
      // file, a knight its jumps, never its own square), then ranks all
      // the ideas and plays its favorite. Every candidate is a legal move.
      // If no legal move exists at all, the API says so and the UI lets
      // the human play Jev's move. Turns are never forfeited.
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

      // Top 4 reachable destinations per piece, asked in parallel.
      const squareAnswers = await Promise.all(
        topPieces.map(async (p) => {
          const destMoves = chess.moves({
            square: p.square as Square,
            verbose: true,
          });
          // One entry per destination square; prefer queen on promotion.
          const byTo = new Map<string, (typeof destMoves)[number]>();
          for (const m of destMoves) {
            const prev = byTo.get(m.to);
            if (!prev || m.promotion === "q") byTo.set(m.to, m);
          }
          const dests = Array.from(byTo.values());
          if (dests.length === 0) return null;
          const sqCriteria: Criteria = {};
          for (const m of dests)
            sqCriteria[m.to] = `${p.label} to ${m.to}`;
          const ans = await askChoice(
            sqCriteria,
            {
              fen,
              side_to_move: colorName,
              step: "pick_squares",
              piece: p.label,
              from: p.square,
            },
            `You are playing chess as ${colorName}, and chaos is the plan. ` +
              `Send the ${p.label} somewhere wild. These are the squares ` +
              `it can actually reach. Your probability distribution over ` +
              `the squares is the shortlist: the top 4 destinations will ` +
              `be used. Be bold.`
          );
          return { ans, dests };
        })
      );
      interface Candidate {
        pieceLabel: string;
        pieceType: string;
        from: string;
        to: string;
        san: string;
        uci: string;
      }
      const candidates: Candidate[] = [];
      topPieces.forEach((p, i) => {
        const sa = squareAnswers[i];
        if (!sa) return;
        const sp = sa.ans.probabilities ?? {
          [sa.ans.choice]: sa.ans.confidence ?? 1,
        };
        const top = sa.dests
          .map((m) => ({ m, confidence: sp[m.to] ?? 0 }))
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 4);
        for (const t of top)
          candidates.push({
            pieceLabel: p.label,
            pieceType: p.type,
            from: p.square,
            to: t.m.to,
            san: t.m.san,
            uci: uciOf(t.m),
          });
      });
      // Pathological fallback: the shortlisted pieces had no moves at all
      // (the game would normally already be over). Rank legal moves instead.
      if (candidates.length === 0) {
        const seen = new Set<string>();
        for (const m of chess.moves({ verbose: true })) {
          const key = m.from + m.to;
          if (seen.has(key) || (m.promotion && m.promotion !== "q"))
            continue;
          seen.add(key);
          candidates.push({
            pieceLabel: `${PIECE_NAMES[m.piece] ?? m.piece} on ${m.from}`,
            pieceType: m.piece,
            from: m.from,
            to: m.to,
            san: m.san,
            uci: uciOf(m),
          });
          if (candidates.length >= 12) break;
        }
      }

      // Rank all the ideas.
      const rankCriteria: Criteria = {};
      candidates.forEach((c, i) => {
        rankCriteria[String(i)] = `${c.san} (${c.pieceLabel} to ${c.to})`;
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
          `Every idea is a legal move. Your probability distribution over ` +
          `the ideas is the final ranking.`
      );
      const rankProbs =
        aRank.probabilities ?? { [aRank.choice]: aRank.confidence ?? 1 };
      const options = candidates
        .map((cand, i) => ({
          pieceLabel: cand.pieceLabel,
          pieceType: cand.pieceType,
          from: cand.from,
          to: cand.to,
          san: cand.san,
          uci: cand.uci,
          confidence: rankProbs[String(i)] ?? 0,
          legal: true,
          played: false,
        }))
        .sort((a, b) => b.confidence - a.confidence);

      const played = options[0] ?? null;
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
