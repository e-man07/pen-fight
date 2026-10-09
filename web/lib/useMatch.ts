"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameClient } from "./client";
import {
  GameState,
  Layer,
  PHASE,
  SEED_TIMEOUT,
  TURN_TIMEOUT,
  flickKey,
  seatOf,
  winnerSeat,
} from "./game";
import type { Pens } from "./sim";

export interface FlickEvent {
  id: string;
  pre: Pens;
  who: number;
  angle: number;
  power: number;
}

export interface TxLogEntry {
  at: number;
  label: string;
  layer: Layer | "base" | "er";
  ms: number;
  sig: string;
}

/** Program error codes (6000 + index in PenFightError). */
const PROGRAM_ERRORS: Record<number, string> = {
  6000: "Target wins must be between 1 and 5.",
  6001: "Player count must be between 2 and 4.",
  6002: "That lobby is already full.",
  6003: "You are already in this match.",
  6004: "The match isn't ready yet.",
  6005: "Only a player in this match can do that.",
  6006: "The game moved on — try again.",
  6007: "Not your turn.",
  6008: "Invalid flick.",
  6009: "Too early — the deadline hasn't passed yet.",
  6010: "The match isn't decided yet.",
  6011: "Pot already paid out.",
  6012: "Wrong player accounts.",
  6013: "Can't cancel a match that already started.",
  6014: "Can't leave a match that already started.",
  6015: "The creator must cancel the lobby instead of leaving.",
  6016: "Arithmetic overflow.",
};

/** Errors that are just races with other clients / stale UI state. */
export const BENIGN_ERRORS = new Set([6006, 6007, 6009, 6011]);

export function programErrorCode(e: unknown): number | null {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/"Custom":\s*(\d+)/) || msg.match(/custom program error: 0x([0-9a-f]+)/i);
  if (!m) return null;
  return msg.includes("custom program error") && !msg.includes('"Custom"')
    ? parseInt(m[1], 16)
    : Number(m[1]);
}

/** Turn a thrown program/RPC error into something a player can read. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const code = programErrorCode(e);
  if (code !== null && PROGRAM_ERRORS[code]) return PROGRAM_ERRORS[code];
  const known: [RegExp, string][] = [
    [/User rejected|rejected the request|Transaction cancelled/i, "Transaction cancelled in wallet."],
    [/insufficient (lamports|funds)|custom program error: 0x1\b/i, "Not enough SOL for this."],
    [/blockhash not found|expired/i, "Network hiccup — try again."],
  ];
  for (const [re, text] of known) if (re.test(msg)) return text;
  return msg.length > 140 ? `${msg.slice(0, 140)}…` : msg;
}

export interface Match {
  game: GameState | null;
  layer: Layer | null;
  seat: number | null;
  /** Latest flick for the scene to animate (null until one happens). */
  flick: FlickEvent | null;
  /** A flick animation is running; hide results until it ends. */
  animating: boolean;
  submitting: boolean;
  /** Wallclock seconds, ticking. */
  now: number;
  error: string | null;
  clearError: () => void;
  txLog: TxLogEntry[];
  /** Seconds left before the player on turn can be forfeited. */
  turnSecondsLeft: number | null;
  canClaimTimeout: boolean;
  canAim: boolean;
  onFlick: (angle: number, power: number) => void;
  onFlickAnimationEnd: (id: string) => void;
  claimTimeout: () => void;
  cancel: () => void;
  leave: () => void;
  startMatch: () => void;
  join: () => void;
  busy: string | null;
}

/** NOTE: mount with a `key` of client+gameId; state is not reset when they change. */
export function useMatch(client: GameClient | null, gameId: bigint | null): Match {
  const [game, setGame] = useState<GameState | null>(null);
  const [layer, setLayer] = useState<Layer | null>(null);
  const [flick, setFlick] = useState<FlickEvent | null>(null);
  const [animating, setAnimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [error, setError] = useState<string | null>(null);
  const [txLog, setTxLog] = useState<TxLogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  const lastFlickKey = useRef<string | null | undefined>(undefined);
  const done = useRef<Set<string>>(new Set());
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flickIdRef = useRef<string | null>(null);

  const seat = useMemo(
    () => (game && client ? seatOf(game, client.me) : null),
    [game, client],
  );

  // Clock.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 250);
    return () => clearInterval(t);
  }, []);

  const track = useCallback(
    async (label: string, layerName: Layer, run: () => Promise<string>) => {
      const t0 = performance.now();
      const sig = await run();
      const ms = Math.round(performance.now() - t0);
      setTxLog((l) => [{ at: Date.now(), label, layer: layerName, ms, sig }, ...l].slice(0, 40));
      return sig;
    },
    [],
  );

  // Subscribe to the match.
  useEffect(() => {
    if (!client || gameId === null) return;
    const stop = client.watchGame(
      gameId,
      (s, l) => {
        setGame(s);
        setLayer(l);
        const key = flickKey(s);
        if (lastFlickKey.current === undefined) {
          // First sight of this match: don't replay history.
          lastFlickKey.current = key;
          return;
        }
        if (key && key !== lastFlickKey.current) {
          lastFlickKey.current = key;
          flickIdRef.current = key;
          setFlick({
            id: key,
            pre: s.prePens,
            who: s.lastFlickPlayer,
            angle: s.lastFlickAngle,
            power: s.lastFlickPower,
          });
          setAnimating(true);
          setSubmitting(false);
          if (animTimer.current) clearTimeout(animTimer.current);
          // Safety net in case the scene never reports the animation end.
          animTimer.current = setTimeout(() => setAnimating(false), 8000);
        }
      },
      () => {
        /* transient RPC errors are retried by the poller */
      },
    );
    return () => {
      stop();
      if (animTimer.current) clearTimeout(animTimer.current);
    };
  }, [client, gameId]);

  const onFlickAnimationEnd = useCallback((id: string) => {
    if (flickIdRef.current !== id) return;
    if (animTimer.current) clearTimeout(animTimer.current);
    setAnimating(false);
  }, []);

  // ------------------------------------------------------------------ autopilot
  useEffect(() => {
    if (!client || gameId === null || !game || seat === null || !layer) return;
    const g = game;
    const tag = (name: string) => `${name}:${g.round}:${g.phase}:${g.flickCount}:${layer}`;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const run = (name: string, delay: number, fn: () => Promise<unknown>) => {
      const t = tag(name);
      if (done.current.has(t)) return;
      timers.push(
        setTimeout(async () => {
          if (done.current.has(t)) return;
          done.current.add(t);
          try {
            await fn();
          } catch (e) {
            // Races with the other client are expected; only surface real problems.
            const code = programErrorCode(e);
            if (code === null || !BENIGN_ERRORS.has(code)) setError(friendlyError(e));
            done.current.delete(t);
            timers.push(setTimeout(() => setRetry((n) => n + 1), 3000));
          }
        }, delay),
      );
    };

    if (layer === "er") {
      if (g.phase === PHASE.READY || g.phase === PHASE.NEED_SEED) {
        run("seed", 500 + seat * 4500, () =>
          track("request VRF seed", "er", () => client.requestSeed(g.gameId)),
        );
      } else if (g.phase === PHASE.ROUND_OVER && !animating) {
        run("next", 3500 + seat * 4500, () =>
          track("next round (VRF)", "er", () => client.requestSeed(g.gameId)),
        );
      } else if (g.phase === PHASE.FINISHED && !animating) {
        run("finish", 3500 + seat * 5500, () =>
          track("commit + undelegate", "er", () => client.finishGame(g.gameId)),
        );
      }
    } else if (layer === "base") {
      if (g.phase === PHASE.FINISHED && !g.paid && g.players.length >= 2) {
        const winSeat = winnerSeat(g.winner) ?? 0;
        run("claim", seat === winSeat ? 800 : 7000 + seat * 1500, () =>
          track("claim pot", "base", () => client.claimPot(g)),
        );
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [client, gameId, game, seat, layer, animating, retry, track]);

  // ------------------------------------------------------------------- actions
  const onFlick = useCallback(
    (angle: number, power: number) => {
      if (!client || gameId === null || seat === null || submitting) return;
      setSubmitting(true);
      track("flick", "er", () => client.playFlick(gameId, seat, angle, power))
        .then(() => {
          // The flick event normally arrives first and clears this; don't stick if not.
          setTimeout(() => setSubmitting(false), 2500);
        })
        .catch((e) => {
          setSubmitting(false);
          const code = programErrorCode(e);
          if (code === null || !BENIGN_ERRORS.has(code)) setError(friendlyError(e));
        });
    },
    [client, gameId, seat, submitting, track],
  );

  const claimTimeout = useCallback(() => {
    if (!client || gameId === null) return;
    setBusy("Claiming…");
    track("claim timeout", "er", () => client.claimTimeout(gameId))
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setBusy(null));
  }, [client, gameId, track]);

  const cancel = useCallback(() => {
    if (!client || gameId === null) return;
    setBusy("Cancelling…");
    if (!game) return;
    track("cancel + refund", "base", () =>
      client.cancelGame(game).then(() => "cancelled"),
    )
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setBusy(null));
  }, [client, gameId, game, track]);

  const leave = useCallback(() => {
    if (!client || gameId === null) return;
    setBusy("Leaving…");
    track("leave + refund", "base", () =>
      client.leaveGame(gameId).then(() => "left"),
    )
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setBusy(null));
  }, [client, gameId, track]);

  const join = useCallback(() => {
    if (!client || gameId === null) return;
    setBusy("Joining — approve in your wallet…");
    client
      .joinGame(gameId)
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setBusy(null));
  }, [client, gameId]);

  const startMatch = useCallback(() => {
    if (!client || gameId === null) return;
    setBusy("Moving match onto the Ephemeral Rollup…");
    client
      .delegateGame(gameId)
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setBusy(null));
  }, [client, gameId]);

  // ------------------------------------------------------------------- derived
  let turnSecondsLeft: number | null = null;
  let canClaimTimeout = false;
  if (game && game.phase === PHASE.PLAYING) {
    turnSecondsLeft = Math.max(0, TURN_TIMEOUT - (now - game.lastActionAt));
    canClaimTimeout =
      seat !== null && game.turn !== seat && turnSecondsLeft <= 0 && !animating;
  } else if (game && game.phase === PHASE.SEED_PENDING) {
    turnSecondsLeft = Math.max(0, SEED_TIMEOUT - (now - game.seedRequestedAt));
    canClaimTimeout = seat !== null && turnSecondsLeft <= 0;
  }

  const canAim =
    !!game &&
    game.phase === PHASE.PLAYING &&
    seat !== null &&
    game.turn === seat &&
    !animating &&
    !submitting;

  return {
    game,
    layer,
    seat,
    flick,
    animating,
    submitting,
    now,
    error,
    clearError: () => setError(null),
    txLog,
    turnSecondsLeft,
    canClaimTimeout,
    canAim,
    onFlick,
    onFlickAnimationEnd,
    claimTimeout,
    cancel,
    leave,
    startMatch,
    join,
    busy,
  };
}
