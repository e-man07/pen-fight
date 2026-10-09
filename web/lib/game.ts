/* eslint-disable @typescript-eslint/no-explicit-any */
import { PublicKey } from "@solana/web3.js";
import type { Pen, Pens } from "./sim";

export const PROGRAM_ID = new PublicKey(
  "FYd5yQ5ntHDUsmjrSbkm3EaxnzNpadtfjYHTQSnaNPM",
);

export const PHASE = {
  OPEN: 0,
  READY: 1,
  NEED_SEED: 2,
  SEED_PENDING: 3,
  PLAYING: 4,
  ROUND_OVER: 5,
  FINISHED: 6,
} as const;

/** Winner / round-result codes: 1..=4 = that seat (seat + 1), 5 = draw. */
export const WINNER = { NONE: 0, DRAW: 5 } as const;

/** Seat index for a winner code, or null for none/draw. */
export const winnerSeat = (code: number): number | null =>
  code >= 1 && code <= 4 ? code - 1 : null;

/** Mirrors TURN_TIMEOUT / SEED_TIMEOUT in the program (seconds). */
export const TURN_TIMEOUT = 45;
export const SEED_TIMEOUT = 40;
/** Flicks per player before a round is decided on edge margin (mirrors the program). */
export const FLICKS_PER_PLAYER = 6;
export const maxFlicks = (players: number) => FLICKS_PER_PLAYER * players;

export interface GameState {
  gameId: bigint;
  /** Joined seats in order (seat 0 is the creator). */
  players: PublicKey[];
  /** Lobby size: 2..4. */
  maxPlayers: number;
  stake: bigint;
  targetWins: number;
  phase: number;
  winner: number;
  paid: boolean;
  /** Round wins per seat (length maxPlayers). */
  wins: number[];
  round: number;
  /** Seat whose flick it is. */
  turn: number;
  roundResult: number;
  flickCount: number;
  seed: bigint;
  seedRequestedAt: number;
  lastActionAt: number;
  /** One pen per seat (length maxPlayers). */
  pens: Pens;
  prePens: Pens;
  lastFlickPlayer: number;
  lastFlickAngle: number;
  lastFlickPower: number;
}

export type Layer = "base" | "er" | "local";

export const gamePda = (gameId: bigint) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("game"), u64le(gameId)],
    PROGRAM_ID,
  )[0];

export const vaultPda = (gameId: bigint) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), u64le(gameId)],
    PROGRAM_ID,
  )[0];

/** Little-endian u64 (DataView: the browser Buffer polyfill lacks the BigInt helpers). */
export function u64le(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v)));
const big = (v: unknown) => BigInt(String(v));

function decodePen(p: any): Pen {
  return { x: num(p.x), z: num(p.z), vx: num(p.vx), vz: num(p.vz), out: !!p.out };
}

/** Normalise an Anchor-decoded `Game` account into plain values. */
export function normalizeGame(raw: any): GameState {
  const max = num(raw.maxPlayers);
  const count = num(raw.playerCount);
  return {
    gameId: big(raw.gameId),
    players: (raw.players as PublicKey[]).slice(0, count),
    maxPlayers: max,
    stake: big(raw.stake),
    targetWins: num(raw.targetWins),
    phase: num(raw.phase),
    winner: num(raw.winner),
    paid: !!raw.paid,
    wins: (raw.wins as unknown[]).slice(0, max).map(num),
    round: num(raw.round),
    turn: num(raw.turn),
    roundResult: num(raw.roundResult),
    flickCount: num(raw.flickCount),
    seed: big(raw.seed),
    seedRequestedAt: num(raw.seedRequestedAt),
    lastActionAt: num(raw.lastActionAt),
    pens: (raw.pens as unknown[]).slice(0, max).map(decodePen),
    prePens: (raw.prePens as unknown[]).slice(0, max).map(decodePen),
    lastFlickPlayer: num(raw.lastFlickPlayer),
    lastFlickAngle: num(raw.lastFlickAngle),
    lastFlickPower: num(raw.lastFlickPower),
  };
}

/** My seat in a game (0-based), or null for a spectator. */
export function seatOf(g: GameState, me: PublicKey | null): number | null {
  if (!me) return null;
  const i = g.players.findIndex((p) => p.equals(me));
  return i === -1 ? null : i;
}

export const lamportsToSol = (l: bigint | number) => Number(l) / 1_000_000_000;

export const shortKey = (k: PublicKey | string) => {
  const s = typeof k === "string" ? k : k.toBase58();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
};

/** Stable unique key for a flick, used to trigger animations exactly once. */
export const flickKey = (g: GameState) =>
  g.flickCount > 0 ? `${g.gameId}:${g.round}:${g.flickCount}` : null;
