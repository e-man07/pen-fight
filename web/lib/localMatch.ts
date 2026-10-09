/**
 * Off-chain practice match against bots. It mirrors the on-chain state machine
 * (anchor/programs/pen-fight/src/lib.rs) and uses the exact same physics (lib/sim.ts),
 * so a bot match plays like a real one: no wallet, no stake, nothing on-chain.
 */
import { PublicKey } from "@solana/web3.js";
import {
  PHASE,
  WINNER,
  maxFlicks,
  type GameState,
} from "./game";
import {
  aliveCount,
  angleToward,
  applyFlick as applyImpulse,
  clonePens,
  edgeMargin,
  runToRest,
  spawn,
  type Pens,
} from "./sim";

export type Difficulty = "easy" | "medium" | "hard";

export interface LocalConfig {
  /** Total players including you (2..4); everyone else is a bot. */
  players: number;
  targetWins: number;
  difficulty: Difficulty;
  /** Changes to restart the match with the same settings. */
  nonce: number;
}

/** You always sit in seat 0. */
export const HUMAN_SEAT = 0;

const fakeKey = (i: number) => new PublicKey(new Uint8Array(32).fill(i + 1));

export function newLocalGame(cfg: LocalConfig): GameState {
  const n = cfg.players;
  return {
    gameId: BigInt(Date.now()),
    players: Array.from({ length: n }, (_, i) => fakeKey(i)),
    maxPlayers: n,
    stake: 0n,
    targetWins: cfg.targetWins,
    phase: PHASE.NEED_SEED,
    winner: WINNER.NONE,
    paid: true,
    wins: Array.from({ length: n }, () => 0),
    round: 1,
    turn: 0,
    roundResult: WINNER.NONE,
    flickCount: 0,
    seed: 0n,
    seedRequestedAt: 0,
    lastActionAt: Date.now() / 1000,
    pens: spawn(0n, n),
    prePens: spawn(0n, n),
    lastFlickPlayer: 0,
    lastFlickAngle: 0,
    lastFlickPower: 0,
  };
}

export function randomSeed(): bigint {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[i]);
  return v;
}

/** Spawn the pens for a new round and pick who flicks first. */
export function startRound(g: GameState, seed: bigint): GameState {
  const pens = spawn(seed, g.maxPlayers);
  return {
    ...g,
    seed,
    pens,
    prePens: clonePens(pens),
    turn: Math.floor(Math.random() * g.maxPlayers),
    flickCount: 0,
    lastFlickPlayer: 0,
    lastFlickAngle: 0,
    lastFlickPower: 0,
    roundResult: WINNER.NONE,
    phase: PHASE.PLAYING,
    lastActionAt: Date.now() / 1000,
  };
}

/** After ROUND_OVER: next round, waiting for a seed. */
export function nextRound(g: GameState): GameState {
  return { ...g, round: g.round + 1, flickCount: 0, phase: PHASE.NEED_SEED };
}

function lastAlive(pens: Pens): number {
  return pens.findIndex((p) => !p.out);
}

function marginWinner(pens: Pens): number {
  let best = -Infinity;
  let winner: number = WINNER.DRAW;
  let tied = false;
  pens.forEach((p, i) => {
    if (p.out) return;
    const m = edgeMargin(p);
    if (m > best) {
      best = m;
      winner = i + 1;
      tied = false;
    } else if (m === best) tied = true;
  });
  return tied ? WINNER.DRAW : winner;
}

/** Apply one flick exactly like the program's play_flick. */
export function applyFlick(g: GameState, who: number, angle: number, power: number): GameState {
  const pre = clonePens(g.pens);
  const pens = clonePens(g.pens);
  applyImpulse(pens[who], angle, power);
  runToRest(pens);

  const next: GameState = {
    ...g,
    prePens: pre,
    pens,
    lastFlickPlayer: who,
    lastFlickAngle: angle,
    lastFlickPower: power,
    flickCount: g.flickCount + 1,
    lastActionAt: Date.now() / 1000,
    wins: [...g.wins],
  };

  const alive = aliveCount(pens);
  let result: number | null = null;
  if (alive === 0) result = WINNER.DRAW;
  else if (alive === 1) result = lastAlive(pens) + 1;
  else if (next.flickCount >= maxFlicks(g.maxPlayers)) result = marginWinner(pens);

  if (result === null) {
    for (let step = 1; step <= g.maxPlayers; step++) {
      const t = (who + step) % g.maxPlayers;
      if (!pens[t].out) {
        next.turn = t;
        break;
      }
    }
    return next;
  }

  next.roundResult = result;
  if (result >= 1 && result <= 4) {
    const i = result - 1;
    next.wins[i] += 1;
    if (next.wins[i] >= g.targetWins) {
      next.winner = result;
      next.phase = PHASE.FINISHED;
      return next;
    }
  }
  next.phase = PHASE.ROUND_OVER;
  return next;
}

// ------------------------------------------------------------------------- bot AI

const SETTINGS: Record<Difficulty, { tries: number; noiseHalfDeg: number; minPower: number }> = {
  easy: { tries: 6, noiseHalfDeg: 44, minPower: 30 },
  medium: { tries: 20, noiseHalfDeg: 18, minPower: 45 },
  hard: { tries: 48, noiseHalfDeg: 6, minPower: 60 },
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Score a resulting position for the bot in seat `who` (higher is better). */
function evaluate(before: Pens, after: Pens, who: number): number {
  if (after[who].out) return -10000;
  let score = edgeMargin(after[who]) * 0.25;
  after.forEach((p, i) => {
    if (i === who) return;
    if (p.out) {
      if (!before[i].out) score += 3000; // knocked someone off
      return;
    }
    score += (4200 - edgeMargin(p)) * 0.6; // the closer a foe is to the edge, the better
  });
  return score;
}

/** Pick a flick for the bot in seat `who` by trying candidates through the real physics. */
export function botMove(
  g: GameState,
  who: number,
  difficulty: Difficulty,
): { angle: number; power: number } {
  const cfg = SETTINGS[difficulty];
  const foes = g.pens.map((p, i) => ({ p, i })).filter((x) => x.i !== who && !x.p.out);
  type Candidate = { angle: number; power: number; score: number };
  const cands: Candidate[] = [];
  for (let k = 0; k < cfg.tries; k++) {
    const foe = foes[Math.floor(Math.random() * foes.length)];
    const noise = (Math.random() + Math.random() - 1) * cfg.noiseHalfDeg;
    const angle = (((angleToward(g.pens[who], foe.p) + Math.round(noise)) % 720) + 720) % 720;
    const power = Math.round(rand(cfg.minPower, 100));
    const sim = clonePens(g.pens);
    applyImpulse(sim[who], angle, power);
    runToRest(sim);
    cands.push({ angle, power, score: evaluate(g.pens, sim, who) });
  }
  cands.sort((a, b) => b.score - a.score);
  if (difficulty === "easy") {
    // Easy bots often play one of their better-looking moves, sometimes a random one.
    const pool = Math.random() < 0.3 ? cands : cands.slice(0, 3);
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return cands[0];
}

