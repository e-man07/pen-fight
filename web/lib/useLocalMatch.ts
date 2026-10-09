"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PHASE, flickKey, type GameState } from "./game";
import {
  HUMAN_SEAT,
  applyFlick,
  botMove,
  newLocalGame,
  nextRound,
  randomSeed,
  startRound,
  type LocalConfig,
} from "./localMatch";
import type { FlickEvent, Match } from "./useMatch";

const noop = () => {};

/**
 * A practice match against bots, exposed through the same `Match` interface the on-chain
 * hook uses so the game screen doesn't care which one it is rendering. Mount with a `key`
 * that changes with `cfg.nonce` to restart.
 */
export function useLocalMatch(cfg: LocalConfig | null): Match {
  const [game, setGame] = useState<GameState | null>(() => (cfg ? newLocalGame(cfg) : null));
  const [flick, setFlick] = useState<FlickEvent | null>(null);
  const [animating, setAnimating] = useState(false);
  const flickIdRef = useRef<string | null>(null);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The authoritative state lives in a ref so transitions are computed outside React
  // updaters (which must stay pure); `commit` mirrors it into state for rendering.
  const gameRef = useRef<GameState | null>(game);
  const commit = useCallback((next: GameState) => {
    gameRef.current = next;
    setGame(next);
  }, []);

  const process = useCallback(
    (who: number, angle: number, power: number) => {
      const g = gameRef.current;
      if (!g || g.phase !== PHASE.PLAYING || g.turn !== who) return;
      const next = applyFlick(g, who, angle, power);
      commit(next);
      const id = flickKey(next);
      if (id) {
        flickIdRef.current = id;
        setFlick({ id, pre: next.prePens, who, angle, power });
        setAnimating(true);
        if (safety.current) clearTimeout(safety.current);
        safety.current = setTimeout(() => setAnimating(false), 8000);
      }
    },
    [commit],
  );

  const onFlickAnimationEnd = useCallback((id: string) => {
    if (flickIdRef.current !== id) return;
    if (safety.current) clearTimeout(safety.current);
    setAnimating(false);
  }, []);

  // The driver: seeds, bot turns and round changes. Re-runs whenever the state changes.
  useEffect(() => {
    if (!cfg || !game || animating) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    if (game.phase === PHASE.NEED_SEED) {
      t = setTimeout(() => {
        const g = gameRef.current;
        if (g && g.phase === PHASE.NEED_SEED) commit(startRound(g, randomSeed()));
      }, 900);
    } else if (game.phase === PHASE.ROUND_OVER) {
      t = setTimeout(() => {
        const g = gameRef.current;
        if (g && g.phase === PHASE.ROUND_OVER) commit(nextRound(g));
      }, 3500);
    } else if (game.phase === PHASE.PLAYING && game.turn !== HUMAN_SEAT) {
      const who = game.turn;
      t = setTimeout(() => {
        const mv = botMove(game, who, cfg.difficulty);
        process(who, mv.angle, mv.power);
      }, 800 + Math.random() * 700);
    }
    return () => {
      if (t) clearTimeout(t);
    };
  }, [cfg, game, animating, process, commit]);

  useEffect(
    () => () => {
      if (safety.current) clearTimeout(safety.current);
    },
    [],
  );

  const onFlick = useCallback(
    (angle: number, power: number) => process(HUMAN_SEAT, angle, power),
    [process],
  );

  const canAim =
    !!game && game.phase === PHASE.PLAYING && game.turn === HUMAN_SEAT && !animating;

  return {
    game,
    layer: game ? "local" : null,
    seat: cfg ? HUMAN_SEAT : null,
    flick,
    animating,
    submitting: false,
    now: 0, // unused for practice matches (no turn timers)
    error: null,
    clearError: noop,
    txLog: [],
    turnSecondsLeft: null,
    canClaimTimeout: false,
    canAim,
    onFlick,
    onFlickAnimationEnd,
    claimTimeout: noop,
    cancel: noop,
    leave: noop,
    startMatch: noop,
    join: noop,
    busy: null,
  };
}
