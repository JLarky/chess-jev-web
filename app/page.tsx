"use client";

import { useEffect, useMemo, useState } from "react";
import { Chess, Square } from "chess.js";

type Mode = "strict" | "chaos";

const GLYPHS: Record<string, string> = {
  wk: "♔",
  wq: "♕",
  wr: "♖",
  wb: "♗",
  wn: "♘",
  wp: "♙",
  bk: "♚",
  bq: "♛",
  br: "♜",
  bb: "♝",
  bn: "♞",
  bp: "♟",
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

// Chaos mode: Jev forfeits the turn, so flip the side to move in the FEN.
function flipTurn(fen: string): string {
  const parts = fen.split(" ");
  parts[1] = parts[1] === "w" ? "b" : "w";
  return parts.join(" ");
}

function squareName(file: number, rank: number): Square {
  return (FILES[file] + (rank + 1)) as Square;
}

export default function Page() {
  const [fen, setFen] = useState(() => new Chess().fen());
  const [humanColor, setHumanColor] = useState<"w" | "b">("w");
  const [mode, setMode] = useState<Mode>("strict");
  const [selected, setSelected] = useState<Square | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [jevInfo, setJevInfo] = useState<string | null>(null);
  const [roast, setRoast] = useState<string | null>(null);
  const [illegalCount, setIllegalCount] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chess = useMemo(() => new Chess(fen), [fen]);
  const turn = chess.turn();

  const gameOver = useMemo(() => {
    if (chess.isCheckmate())
      return `Checkmate. ${chess.turn() === "w" ? "Black" : "White"} wins.`;
    if (chess.isStalemate()) return "Stalemate. Draw.";
    if (chess.isThreefoldRepetition())
      return "Draw by threefold repetition.";
    if (chess.isInsufficientMaterial())
      return "Draw by insufficient material.";
    if (chess.isDraw()) return "Draw.";
    return null;
  }, [chess]);

  const targets = useMemo(() => {
    if (!selected) return new Map<string, boolean>();
    const m = new Map<string, boolean>();
    for (const mv of chess.moves({ square: selected, verbose: true })) {
      m.set(mv.to, !!mv.captured);
    }
    return m;
  }, [chess, selected]);

  const newGame = (color: "w" | "b") => {
    setHumanColor(color);
    setFen(new Chess().fen());
    setHistory([]);
    setSelected(null);
    setJevInfo(null);
    setRoast(null);
    setIllegalCount(0);
    setError(null);
    setThinking(false);
  };

  const onSquare = (sq: Square) => {
    if (thinking || gameOver || turn !== humanColor) return;
    if (selected && targets.has(sq)) {
      try {
        const c = new Chess(fen);
        const move = c.move({ from: selected, to: sq, promotion: "q" });
        setHistory((h) => [...h, move.san]);
        setFen(c.fen());
        setSelected(null);
        setRoast(null);
        setError(null);
      } catch {
        setSelected(null);
      }
      return;
    }
    const piece = chess.get(sq);
    if (piece && piece.color === humanColor) {
      setSelected(selected === sq ? null : sq);
    } else {
      setSelected(null);
    }
  };

  useEffect(() => {
    if (gameOver || turn === humanColor || thinking) return;
    let cancelled = false;
    setThinking(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch("/api/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fen, mode }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (cancelled) return;
        if (data.mode === "chaos" && !data.legal) {
          setRoast(
            `Jev tried ${data.attempt.pieceLabel} to ${data.attempt.to}... illegal! Turn forfeited.`
          );
          setIllegalCount((c) => c + 1);
          setJevInfo(null);
          setFen(flipTurn(fen));
        } else {
          const c = new Chess(fen);
          const move = c.move(data.move.san);
          setHistory((h) => [...h, move.san]);
          setFen(c.fen());
          setJevInfo(
            `Jev played ${move.san} (confidence ${Math.round(
              (data.confidence ?? 0) * 100
            )}%)`
          );
          setRoast(null);
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Jev request failed");
      } finally {
        if (!cancelled) setThinking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fen, mode, humanColor, gameOver, turn]);

  const board = chess.board();
  const status = gameOver
    ? gameOver
    : thinking
    ? "Jev is thinking..."
    : turn === humanColor
    ? `Your move (${humanColor === "w" ? "White" : "Black"})${chess.inCheck() ? ", check!" : ""}`
    : `Jev to move (${turn === "w" ? "White" : "Black"})`;

  return (
    <div className="container">
      <h1>Jev Chess</h1>
      <p className="subtitle">
        TypeSafe&apos;s Jev picks the moves. You handle the consequences.
      </p>

      <div className="controls">
        <div className="control-group">
          <span className="control-label">You play</span>
          <div className="seg">
            <button
              className={humanColor === "w" ? "active" : ""}
              onClick={() => newGame("w")}
            >
              White
            </button>
            <button
              className={humanColor === "b" ? "active" : ""}
              onClick={() => newGame("b")}
            >
              Black
            </button>
          </div>
        </div>
        <div className="control-group">
          <span className="control-label">Jev&apos;s moves</span>
          <div className="seg">
            <button
              className={mode === "strict" ? "active" : ""}
              onClick={() => setMode("strict")}
              title="Jev only picks from legal moves"
            >
              Legal only
            </button>
            <button
              className={mode === "chaos" ? "active" : ""}
              onClick={() => setMode("chaos")}
              title="Jev picks a piece, then any square. Illegal attempts forfeit the turn."
            >
              Chaos
            </button>
          </div>
        </div>
        <button className="btn" onClick={() => newGame(humanColor)}>
          New game
        </button>
      </div>

      <div className="main">
        <div className="board">
          {board.map((row, r) =>
            row.map((piece, f) => {
              const rank = 8 - r;
              const sq = squareName(f, rank - 1);
              const isLight = (f + rank) % 2 === 0;
              const isTarget = targets.has(sq);
              const isCapture = targets.get(sq) === true;
              return (
                <button
                  type="button"
                  key={sq}
                  aria-label={sq}
                  className={
                    "sq" +
                    (isLight ? " light" : " dark") +
                    (selected === sq ? " selected" : "") +
                    (isTarget && !isCapture ? " target" : "") +
                    (isCapture ? " capture" : "")
                  }
                  onClick={() => onSquare(sq)}
                >
                  {piece && (
                    <span className={"piece " + piece.color}>
                      {GLYPHS[piece.color + piece.type]}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="side">
          <div className="status">
            <b>{status}</b>
          </div>
          {jevInfo ? (
            <div className="jev-line">{jevInfo}</div>
          ) : (
            <div className="jev-line" aria-hidden="true">
              {"\u00a0"}
            </div>
          )}
          {roast && <div className="roast">{roast}</div>}
          {illegalCount > 0 && (
            <div className="jev-line">
              Illegal attempts by Jev: {illegalCount}
            </div>
          )}
          {error && <div className="error">Error: {error}</div>}
          <div className="moves" aria-live="off">
            {history.map((san, i) => (
              <span key={i}>
                {i % 2 === 0 && <b>{i / 2 + 1}. </b>}
                {san}{" "}
              </span>
            ))}
          </div>
        </div>
      </div>

      <p className="note">
        Jev is a judgment model, not a chess engine. In legal-only mode it
        picks from real candidate moves. In chaos mode it picks a piece and
        then any square, and illegal attempts forfeit its turn. Either way,
        expect Levy-would-roast-it chess.
      </p>
    </div>
  );
}
