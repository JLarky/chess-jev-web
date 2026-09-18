// Tiny Web Audio sound effects for the chess game. No audio assets needed;
// everything is synthesized with oscillators.

let ctx: AudioContext | null = null;
let muted = false;

export function setSoundMuted(m: boolean) {
  muted = m;
}

function ac(): AudioContext | null {
  if (muted || typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (
          window as unknown as {
            webkitAudioContext: typeof AudioContext;
          }
        ).webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType = "triangle",
  gain = 0.15,
  delay = 0,
  slideTo?: number
) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo)
    o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Short thock for a move; heavier when a piece was captured. */
export function playMove(captured = false) {
  if (captured) {
    tone(196, 0.1, "triangle", 0.22);
    tone(130, 0.14, "sine", 0.2, 0.03);
  } else {
    tone(540, 0.07, "triangle", 0.13, 0, 320);
  }
}

export type GameResult = "win" | "loss" | "draw";

/** Fanfare for the finished game. */
export function playGameEnd(result: GameResult) {
  if (result === "win") {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(f, 0.16, "triangle", 0.16, i * 0.11)
    );
  } else if (result === "loss") {
    [392, 329.63, 261.63, 196].forEach((f, i) =>
      tone(f, 0.2, "triangle", 0.16, i * 0.14)
    );
  } else {
    tone(440, 0.13, "sine", 0.13);
    tone(415.3, 0.2, "sine", 0.13, 0.16);
  }
}
