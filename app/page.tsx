"use client";

import { useEffect, useMemo, useState } from "react";
import { Chess, Square } from "chess.js";
import {
  playMove,
  playGameEnd,
  setSoundMuted,
  type GameResult,
} from "./lib/sound";
import { buildSave, parseSave, restorePosition } from "./lib/save";

type Mode = "strict" | "chaos";

interface ChaosOption {
  pieceLabel: string;
  pieceType: string;
  from: string;
  to: string;
  san: string | null;
  uci: string;
  confidence: number;
  legal: boolean;
  played: boolean;
}

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

// Chaos confidences can be tiny but nonzero; "0%" looks broken.
function fmtConf(c: number): string {
  if (c > 0 && c < 0.005) return "<1%";
  return `${Math.round(c * 100)}%`;
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
  const [chaosOptions, setChaosOptions] = useState<ChaosOption[] | null>(null);
  const [muted, setMuted] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  // Fanfare when the game ends. Result is from the human's perspective.
  useEffect(() => {
    if (!gameOver) return;
    let result: GameResult = "draw";
    if (chess.isCheckmate()) {
      // Side to move is mated; human wins if the winner is their color.
      const whiteWon = chess.turn() === "b";
      result = whiteWon === (humanColor === "w") ? "win" : "loss";
    }
    playGameEnd(result);
  }, [gameOver, chess, humanColor]);

  const targets = useMemo(() => {
    if (!selected) return new Map<string, boolean>();
    const m = new Map<string, boolean>();
    for (const mv of chess.moves({ square: selected, verbose: true })) {
      m.set(mv.to, !!mv.captured);
    }
    return m;
  }, [chess, selected]);

  const newGame = (color: "w" | "b", m: Mode = mode) => {
    setHumanColor(color);
    setMode(m);
    setFen(new Chess().fen());
    setHistory([]);
    setSelected(null);
    setJevInfo(null);
    setRoast(null);
    setIllegalCount(0);
    setError(null);
    setThinking(false);
    setChaosOptions(null);
    setImportError(null);
    setCopied(false);
  };

  // Load the saved sound preference after mount (localStorage is client-only).
  useEffect(() => {
    const m = localStorage.getItem("jev-muted") === "1";
    setMuted(m);
    setSoundMuted(m);
  }, []);

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    setSoundMuted(m);
    try {
      localStorage.setItem("jev-muted", m ? "1" : "0");
    } catch {
      // private mode or similar; sound just won't persist
    }
  };

  const copySave = async () => {
    const text = buildSave(mode, humanColor, history, fen);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable: drop the save into the restore box instead.
      setImportText(text);
    }
  };

  const doRestore = () => {
    setImportError(null);
    try {
      const save = parseSave(importText);
      const { chess: c, sans } = restorePosition(save);
      newGame(save.human, save.mode);
      setFen(c.fen());
      setHistory(sans);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "could not parse save");
    }
  };

  const onSquare = (sq: Square) => {
    if (thinking || gameOver || turn !== humanColor) return;
    if (selected && targets.has(sq)) {
      try {
        const c = new Chess(fen);
        const move = c.move({ from: selected, to: sq, promotion: "q" });
        playMove(!!move.captured);
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
        if (data.mode === "chaos") {
          setChaosOptions(data.options ?? null);
          if (!data.legal) {
            setRoast(
              "Jev fumbled all 12 chaotic ideas, every single one illegal! " +
                "Turn forfeited. Your move."
            );
            setIllegalCount((c) => c + 1);
            setJevInfo(null);
            setFen(flipTurn(fen));
          } else {
            const c = new Chess(fen);
            const move = c.move(data.move.san);
            playMove(!!move.captured);
            setHistory((h) => [...h, move.san]);
            setFen(c.fen());
            setJevInfo(
              `Jev played ${move.san} (confidence ${fmtConf(
                data.confidence ?? 0
              )})`
            );
            setRoast(null);
          }
        } else {
          const c = new Chess(fen);
          const move = c.move(data.move.san);
          playMove(!!move.captured);
          setHistory((h) => [...h, move.san]);
          setFen(c.fen());
          setJevInfo(
            `Jev played ${move.san} (confidence ${fmtConf(
              data.confidence ?? 0
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
              title="Jev shortlists 3 pieces and 4 chaotic squares each, ranks all 12 ideas, and plays the first legal one"
            >
              Chaos
            </button>
          </div>
        </div>
        <button className="btn" onClick={() => newGame(humanColor)}>
          New game
        </button>
        <button
          className="btn"
          onClick={toggleMute}
          title="Toggle sound effects"
          aria-pressed={muted}
        >
          {muted ? "🔇 Muted" : "🔊 Sound"}
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
          {mode === "chaos" && (
            <div className="chaos">
              <div className="chaos-title">Jev&apos;s chaotic shortlist</div>
              {chaosOptions ? (
                chaosOptions.map((o, i) => (
                  <div
                    key={i}
                    className={
                      "chaos-opt" +
                      (o.played ? " played" : "") +
                      (!o.legal ? " illegal" : "")
                    }
                  >
                    <span className="chaos-rank">{i + 1}</span>
                    <span className="chaos-piece">
                      {
                        GLYPHS[
                          (humanColor === "w" ? "b" : "w") + o.pieceType
                        ]
                      }
                    </span>
                    <span className="chaos-move">
                      {o.legal && o.san ? o.san : `${o.from}\u2192${o.to}`}
                    </span>
                    <span className="chaos-conf">
                      {Math.round(o.confidence * 100)}%
                    </span>
                    {o.played && <span className="chaos-tag">played</span>}
                    {!o.legal && <span className="chaos-tag">illegal</span>}
                  </div>
                ))
              ) : (
                <div className="chaos-empty" aria-hidden="true">
                  {"\u00a0"}
                </div>
              )}
            </div>
          )}
          <details className="advanced">
            <summary>Advanced: save / restore</summary>
            <p className="adv-desc">
              Copy the game as plain text, or paste one back to restore it.
            </p>
            <button className="btn adv-btn" onClick={copySave}>
              {copied ? "Copied!" : "Copy game state"}
            </button>
            <textarea
              className="adv-text"
              rows={5}
              placeholder={
                "# paste a saved game here, e.g.\nmode: chaos\nhuman: w\nmoves: e4 e5"
              }
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              aria-label="Saved game text to restore"
              spellCheck={false}
            />
            <button className="btn adv-btn" onClick={doRestore}>
              Restore game
            </button>
            {importError && (
              <div className="error">Restore failed: {importError}</div>
            )}
          </details>
        </div>
      </div>

      <p className="note">
        Jev is a judgment model, not a chess engine. In legal-only mode it
        picks from real candidate moves. In chaos mode Jev shortlists 3 pieces
        and 4 chaotic destinations each, ranks all 12 ideas, and plays the
        first legal one. Either way, expect Levy-would-roast-it chess.
      </p>
    </div>
  );
}
