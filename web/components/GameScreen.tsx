"use client";

import { useEffect, useMemo, useState } from "react";
import type { GameClient } from "@/lib/client";
import { CLUSTER, explorerTx } from "@/lib/config";
import {
  PHASE,
  TURN_TIMEOUT,
  flicksLeft,
  WINNER,
  FLICKS_PER_PLAYER,
  lamportsToSol,
  maxFlicks,
  shortKey,
  winnerSeat,
  type GameState,
} from "@/lib/game";
import type { LocalConfig } from "@/lib/localMatch";
import { seatColor, seatName } from "@/lib/seats";
import { spawn } from "@/lib/sim";
import { useLocalMatch } from "@/lib/useLocalMatch";
import { useMatch } from "@/lib/useMatch";
import { Scene } from "./DynamicScene";
import { rememberGame } from "./Lobby";

const fmtSol = (l: bigint) => {
  const v = lamportsToSol(l);
  return v === 0 ? "0" : v < 0.01 ? v.toFixed(4) : v.toFixed(v < 1 ? 3 : 2).replace(/\.?0+$/, "");
};

function Pips({
  wins,
  target,
  color,
  small = false,
}: {
  wins: number;
  target: number;
  color: string;
  small?: boolean;
}) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: target }, (_, i) => (
        <span
          key={i}
          className={`${small ? "h-2.5 w-2.5" : "h-3.5 w-3.5"} rounded-full border-2 border-black/50`}
          style={{ background: i < wins ? color : "transparent" }}
        />
      ))}
    </div>
  );
}

function PlayerCard({
  g,
  idx,
  name,
  me,
  active,
  showKey,
  left,
  secondsLeft,
}: {
  g: GameState;
  idx: number;
  name: string;
  me: boolean;
  active: boolean;
  showKey: boolean;
  /** Flicks this player has left in the round. */
  left: number;
  /** Seconds left on the turn timer (null = no limit, e.g. practice). */
  secondsLeft: number | null;
}) {
  const pk = g.players[idx];
  const color = seatColor(idx);
  const playing = g.phase === PHASE.PLAYING;
  const out = playing && !!g.pens[idx]?.out;
  const urgent = secondsLeft !== null && secondsLeft <= 10;
  const frac = secondsLeft === null ? 1 : Math.max(0, Math.min(1, secondsLeft / TURN_TIMEOUT));
  const accent = urgent ? "#ff5a4d" : color;
  return (
    <div
      className={`panel flex w-[10.5rem] flex-col gap-1.5 px-3 py-2.5 sm:w-[12rem] ${
        active ? "pulse-ring" : ""
      } ${out ? "opacity-60" : ""}`}
      style={{ borderColor: active ? accent : undefined, borderWidth: active ? 3 : undefined }}
    >
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
        <span className="font-hand text-xl leading-none">{pk ? name : "waiting…"}</span>
        {me && <span className="chip !py-0 text-[0.65rem]">you</span>}
        {out && <span className="chip !py-0 text-[0.65rem]">out</span>}
      </div>
      {pk && showKey && <div className="-mt-1 text-[0.7rem] text-chalk/50">{shortKey(pk)}</div>}

      <div className="flex items-center justify-between gap-2">
        <span className="font-hand text-xs uppercase tracking-wider text-chalk/55">wins</span>
        <Pips wins={g.wins[idx] ?? 0} target={g.targetWins} color={color} />
      </div>

      {playing && !out && (
        <div className="flex items-center justify-between gap-2">
          <span className="font-hand text-xs uppercase tracking-wider text-chalk/55">flicks left</span>
          <div className="flex items-center gap-2">
            <div className="flex gap-[3px]">
              {Array.from({ length: FLICKS_PER_PLAYER }, (_, i) => (
                <span
                  key={i}
                  className="h-2 w-[10px] rounded-full"
                  style={{ background: i < left ? color : "rgba(255,255,255,0.16)" }}
                />
              ))}
            </div>
            <span className="font-hand w-3 text-right text-lg leading-none">{left}</span>
          </div>
        </div>
      )}

      {active && !out && (
        <div className="mt-0.5 rounded-lg bg-black/30 px-2.5 py-1.5">
          <div className="flex items-end justify-between">
            <span className="font-hand text-lg leading-none" style={{ color: accent }}>
              {me ? "YOUR TURN" : "THEIR TURN"}
            </span>
            {secondsLeft !== null && (
              <span
                className="font-hand text-4xl leading-none tabular-nums"
                style={{ color: urgent ? "#ff9a90" : "#f6f3e8" }}
              >
                {Math.ceil(secondsLeft)}
                <span className="text-base text-chalk/60">s</span>
              </span>
            )}
          </div>
          {secondsLeft !== null && (
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{ width: `${frac * 100}%`, background: accent }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Phone-sized scoreboard card: everything on two tight lines. */
function CompactCard({
  g,
  idx,
  name,
  me,
  active,
  left,
  secondsLeft,
}: {
  g: GameState;
  idx: number;
  name: string;
  me: boolean;
  active: boolean;
  left: number;
  secondsLeft: number | null;
}) {
  const color = seatColor(idx);
  const playing = g.phase === PHASE.PLAYING;
  const out = playing && !!g.pens[idx]?.out;
  const urgent = secondsLeft !== null && secondsLeft <= 10;
  const accent = urgent ? "#ff5a4d" : color;
  const frac = secondsLeft === null ? 1 : Math.max(0, Math.min(1, secondsLeft / TURN_TIMEOUT));
  return (
    <div
      className={`panel relative min-w-0 overflow-hidden px-2.5 pb-2 pt-1.5 ${
        active ? "pulse-ring" : ""
      } ${out ? "opacity-55" : ""}`}
      style={{ borderColor: active ? accent : undefined, borderWidth: active ? 2 : undefined }}
    >
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="font-hand min-w-0 truncate text-[1.05rem] leading-none">{name}</span>
        {me && <span className="text-[0.6rem] uppercase tracking-wide text-chalk/55">you</span>}
        <span className="ml-auto">
          <Pips small wins={g.wins[idx] ?? 0} target={g.targetWins} color={color} />
        </span>
      </div>
      <div className="mt-1.5 flex h-5 items-center gap-1.5">
        {out ? (
          <span className="text-xs text-chalk/60">out this round</span>
        ) : playing ? (
          <>
            <div className="flex gap-[2px]">
              {Array.from({ length: FLICKS_PER_PLAYER }, (_, i) => (
                <span
                  key={i}
                  className="h-1.5 w-2 rounded-full"
                  style={{ background: i < left ? color : "rgba(255,255,255,0.16)" }}
                />
              ))}
            </div>
            <span className="font-hand text-sm leading-none text-chalk/80">{left}</span>
            {active && secondsLeft !== null && (
              <span
                className="font-hand ml-auto text-xl leading-none tabular-nums"
                style={{ color: urgent ? "#ff9a90" : "#f6f3e8" }}
              >
                {Math.ceil(secondsLeft)}s
              </span>
            )}
            {active && secondsLeft === null && (
              <span className="font-hand ml-auto text-sm leading-none" style={{ color: accent }}>
                {me ? "your turn" : "thinking…"}
              </span>
            )}
          </>
        ) : null}
      </div>
      {active && secondsLeft !== null && !out && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
          <div className="h-full" style={{ width: `${frac * 100}%`, background: accent }} />
        </div>
      )}
    </div>
  );
}

const RULES_SEEN_KEY = "penfight:rules-seen";

function RulesCard({
  players,
  targetWins,
  staked,
  timed,
  onClose,
}: {
  players: number;
  targetWins: number;
  staked: boolean;
  timed: boolean;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="panel pop-in w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-hand text-4xl">How to play</h2>
        <ol className="font-hand mt-3 list-decimal space-y-1.5 pl-6 text-xl leading-snug text-chalk/90">
          <li>
            <b>Drag back</b> from the desk and <b>let go</b> to flick your pen. The further you
            drag, the harder the flick.
          </li>
          <li>
            {players === 2
              ? "Knock the other pen off the desk edge to win the round."
              : "Knock the other pens off the desk. The last pen on the desk wins the round."}
          </li>
          <li>
            Each player gets up to <b>{FLICKS_PER_PLAYER} flicks</b> per round ({maxFlicks(players)} in
            total). If more than one pen is still on the desk after that, the pen{" "}
            <b>furthest from the edge</b> wins.
          </li>
          {timed && (
            <li>
              You have <b>{TURN_TIMEOUT} seconds</b> per turn. The timer is at the top of the screen.{" "}
              {players === 2
                ? "If you stall, your opponent can claim the whole match."
                : "If you stall, your pen is removed for that round."}
            </li>
          )}
          <li>
            First to <b>{targetWins} round win{targetWins > 1 ? "s" : ""}</b> takes the match
            {staked ? " and the whole pot" : ""}. A drawn round is replayed.
          </li>
        </ol>
        <div className="mt-5 flex justify-center">
          <button className="btn" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export function GameScreen({
  client,
  gameId,
  onExit,
  local,
  onRematch,
}: {
  client: GameClient | null;
  gameId: bigint | null;
  onExit: () => void;
  /** Practice match vs bots (off-chain). */
  local?: LocalConfig;
  onRematch?: () => void;
}) {
  // Both hooks run unconditionally; the unused one is inert (null inputs).
  const chain = useMatch(local ? null : client, local ? null : gameId);
  const practice = useLocalMatch(local ?? null);
  const m = local ? practice : chain;
  const g = m.game;
  const isLocal = !!local;
  const [showLog, setShowLog] = useState(false);
  const [copied, setCopied] = useState(false);
  // The how-to-play card opens by itself the first time a match starts playing.
  const [rulesSeen, setRulesSeen] = useState(() => {
    try {
      return localStorage.getItem(RULES_SEEN_KEY) === "1";
    } catch {
      return true;
    }
  });
  const [rulesOpen, setRulesOpen] = useState(false);
  const closeRules = () => {
    setRulesOpen(false);
    setRulesSeen(true);
    try {
      localStorage.setItem(RULES_SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!isLocal && gameId !== null) rememberGame(gameId);
  }, [gameId, isLocal]);

  // Forget the match once it is fully settled so the lobby doesn't offer it again.
  useEffect(() => {
    if (!isLocal && g && g.phase === PHASE.FINISHED && g.paid) rememberGame(null);
  }, [g, isLocal]);

  const seat = m.seat ?? 0;
  const n = g?.maxPlayers ?? local?.players ?? 2;
  const nameOf = (i: number) => (isLocal && i !== 0 ? `${seatName(i)} (bot)` : seatName(i));
  const names = Array.from({ length: n }, (_, i) =>
    g && i >= g.players.length && !isLocal ? "—" : nameOf(i),
  );

  const placeholder = useMemo(() => spawn(0n, n), [n]);
  const pens = !g || (g.seed === 0n && g.flickCount === 0) ? placeholder : g.pens;

  const roundWinner = useMemo((): number | "draw" | null => {
    if (!g || m.animating) return null;
    const r =
      g.phase === PHASE.FINISHED ? g.winner : g.phase === PHASE.ROUND_OVER ? g.roundResult : 0;
    const s = winnerSeat(r);
    return s !== null ? s : r === WINNER.DRAW ? "draw" : null;
  }, [g, m.animating]);

  const inviteLink =
    typeof window !== "undefined" && gameId !== null
      ? `${window.location.origin}/?game=${gameId}`
      : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const joined = g?.players.length ?? 0;
  const amIn = m.seat !== null;
  const isCreator = m.seat === 0;

  // ------------------------------------------------------------- status line
  let status = "Loading match…";
  if (g) {
    switch (g.phase) {
      case PHASE.OPEN:
        status = `Waiting for players (${joined}/${g.maxPlayers})…`;
        break;
      case PHASE.READY:
        status =
          m.layer === "base"
            ? "Lobby full — moving the match onto the Ephemeral Rollup…"
            : "Match is live on the rollup — rolling the dice…";
        break;
      case PHASE.NEED_SEED:
      case PHASE.SEED_PENDING:
        status = isLocal ? "Setting up the desk…" : "Tossing the coin (VRF randomness)…";
        break;
      case PHASE.PLAYING:
        if (m.seat === null) status = `${nameOf(g.turn)} is flicking…`;
        else if (m.animating) status = "…";
        else if (g.turn === m.seat) status = m.submitting ? "Flicking…" : "Your flick! Drag back & release.";
        else status = `${nameOf(g.turn)} is lining up a flick…`;
        break;
      case PHASE.ROUND_OVER:
        status = m.animating ? "…" : "Round over — next round starting…";
        break;
      case PHASE.FINISHED:
        status = m.animating
          ? "…"
          : isLocal
            ? "Practice match over."
            : g.paid
              ? "Match settled on Solana."
              : m.layer === "er"
                ? "Match over — committing the result to Solana…"
                : "Match over — paying out the pot…";
        break;
    }
  }

  const potPlayers = g ? (g.phase === PHASE.OPEN ? joined : g.maxPlayers) : 0;
  const pot = g ? g.stake * BigInt(potPlayers) : 0n;
  const winSeat = g ? winnerSeat(g.winner) : null;
  const iWon = g !== null && m.seat !== null && winSeat === m.seat;
  const draw = g?.winner === WINNER.DRAW;
  const showResult = !!g && g.phase === PHASE.FINISHED && !m.animating;
  const showRound = !!g && g.phase === PHASE.ROUND_OVER && !m.animating;
  const scoreLine = g ? names.map((nm, i) => `${nm} ${g.wins[i] ?? 0}`).join("  ·  ") : "";
  const roundText = (() => {
    if (!g) return "";
    const w = winnerSeat(g.roundResult);
    if (w === null) return "Round drawn — replaying";
    if (m.seat === w) return "You win the round!";
    return `${nameOf(w)} wins the round`;
  })();

  const lastTx = m.txLog[0];
  const left = g ? flicksLeft(g) : [];
  const others = g ? Array.from({ length: n }, (_, i) => i).filter((i) => i !== seat) : [];
  const stalledText =
    g && g.maxPlayers === 2
      ? "Opponent stalled — claim the win"
      : "Player stalled — remove their pen";

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-board-deep">
      {/* ------------------------------------------------------------ 3D scene */}
      <div className="absolute inset-0">
        <Scene
          seat={seat}
          playerCount={n}
          names={names}
          score={g?.wins ?? Array.from({ length: n }, () => 0)}
          targetWins={g?.targetWins ?? 2}
          round={g?.round ?? 1}
          pens={pens}
          resetKey={g ? `${g.gameId}:${g.round}:${g.seed}` : "none"}
          flick={m.flick}
          onFlickAnimationEnd={m.onFlickAnimationEnd}
          turn={g && g.phase === PHASE.PLAYING ? g.turn : null}
          canAim={m.canAim}
          onFlick={m.onFlick}
          roundWinner={roundWinner}
        />
      </div>

      {/* ----------------------------------------------------------------- HUD */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 sm:p-4">
        {/* top bar: phones get a compact two-row HUD, larger screens the full one */}
        <div className="pointer-events-none flex flex-col gap-2 sm:hidden">
          {g && (
            <>
              <div className="pointer-events-auto flex items-center gap-2">
                <button
                  className="glass grid h-9 w-9 shrink-0 place-items-center !rounded-full text-lg"
                  onClick={onExit}
                  aria-label={isLocal ? "Back to menu" : "Back to lobby"}
                >
                  ←
                </button>
                <div className="panel flex min-w-0 flex-1 items-center justify-center gap-1.5 px-3 py-1.5 font-hand text-base leading-none">
                  <span>Round {g.round}</span>
                  <span className="text-chalk/50">· first to {g.targetWins}</span>
                  <span className="text-chalk/50">·</span>
                  <span className="text-marker">
                    {isLocal ? "Practice" : g.stake === 0n ? "Free" : `${fmtSol(pot)} SOL pot`}
                  </span>
                </div>
                <button
                  className="glass grid h-9 w-9 shrink-0 place-items-center !rounded-full text-base"
                  onClick={() => setRulesOpen(true)}
                  aria-label="How to play"
                >
                  ❓
                </button>
              </div>
              <div className="pointer-events-auto grid grid-cols-2 gap-2">
                {[seat, ...others].map((i) => (
                  <CompactCard
                    key={i}
                    g={g}
                    idx={i}
                    name={nameOf(i)}
                    me={i === seat && m.seat !== null}
                    active={g.phase === PHASE.PLAYING && g.turn === i}
                    left={left[i] ?? 0}
                    secondsLeft={isLocal ? null : m.turnSecondsLeft}
                  />
                ))}
              </div>
            </>
          )}
        </div>
        <div className="hidden flex-wrap items-start justify-between gap-2 sm:flex">
          <div className="pointer-events-auto flex flex-col gap-2">
            <button className="btn btn-ghost !bg-black/30 !px-3 !py-2 !text-base" onClick={onExit}>
              ← {isLocal ? "Menu" : "Lobby"}
            </button>
            {g && (
              <PlayerCard
                g={g}
                idx={seat}
                name={nameOf(seat)}
                me={m.seat !== null}
                active={g.phase === PHASE.PLAYING && g.turn === seat}
                showKey={!isLocal}
                left={left[seat] ?? 0}
                secondsLeft={isLocal ? null : m.turnSecondsLeft}
              />
            )}
          </div>

          <div className="order-last flex w-full flex-col items-center gap-2 sm:order-none sm:w-auto">
            {g && (
              <div className="panel pop-in flex items-center gap-3 px-3 py-2 sm:px-4">
                <div className="text-center">
                  <div className="font-hand text-sm leading-none text-chalk/60">POT</div>
                  <div className="font-hand text-2xl leading-none text-marker">
                    {isLocal ? "Practice" : g.stake === 0n ? "Free play" : `${fmtSol(pot)} SOL`}
                  </div>
                </div>
                <div className="h-8 w-px bg-chalk/20" />
                <div className="text-center">
                  <div className="font-hand text-sm leading-none text-chalk/60">ROUND</div>
                  <div className="font-hand text-2xl leading-none">
                    {g.round} <span className="text-base text-chalk/50">· first to {g.targetWins}</span>
                  </div>
                </div>
                {g.phase === PHASE.PLAYING && (
                  <>
                    <div className="h-8 w-px bg-chalk/20" />
                    <div className="text-center">
                      <div className="font-hand text-sm leading-none text-chalk/60">FLICKS LEFT</div>
                      <div className="font-hand text-2xl leading-none">
                        {Math.max(0, maxFlicks(g.maxPlayers) - g.flickCount)}
                        <span className="text-base text-chalk/50">/{maxFlicks(g.maxPlayers)}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span
                className={`chip pointer-events-auto ${isLocal ? "" : "cursor-pointer"} ${
                  m.layer === "er" ? "!border-marker/60 !text-marker" : ""
                }`}
                onClick={() => !isLocal && setShowLog((v) => !v)}
                title={isLocal ? "Practice match, nothing on-chain" : "Show on-chain activity"}
              >
                {isLocal
                  ? `🤖 Practice vs ${n - 1} bot${n > 2 ? "s" : ""} · off-chain`
                  : m.layer === "er"
                    ? "⚡ Ephemeral Rollup"
                    : m.layer === "base"
                      ? "◎ Solana base layer"
                      : "…"}
                {lastTx && lastTx.layer === "er" ? ` · last tx ${lastTx.ms}ms` : ""}
              </span>
              <button
                className="chip pointer-events-auto cursor-pointer"
                onClick={() => setRulesOpen(true)}
                title="How to play"
              >
                ❓ Rules
              </button>
            </div>
          </div>

          <div className="pointer-events-auto flex flex-col items-end gap-2">
            {!isLocal && <span className="chip">{CLUSTER}</span>}
            {g &&
              others.map((i) => (
                <PlayerCard
                  key={i}
                  g={g}
                  idx={i}
                  name={nameOf(i)}
                  me={false}
                  active={g.phase === PHASE.PLAYING && g.turn === i}
                  showKey={!isLocal}
                  left={left[i] ?? 0}
                  secondsLeft={isLocal ? null : m.turnSecondsLeft}
                />
              ))}
          </div>
        </div>

        {/* activity log */}
        {showLog && (
          <div className="panel pop-in pointer-events-auto absolute right-3 top-28 z-20 max-h-72 w-80 overflow-y-auto p-3 text-sm sm:right-4">
            <div className="font-hand mb-2 flex items-center justify-between text-xl">
              On-chain activity
              <button className="text-chalk/60" onClick={() => setShowLog(false)}>
                ✕
              </button>
            </div>
            {m.txLog.length === 0 && <p className="text-chalk/60">Nothing yet.</p>}
            {m.txLog.map((t) => (
              <div key={t.sig + t.at} className="flex items-center justify-between gap-2 py-0.5">
                <span className="truncate">
                  {t.layer === "er" ? "⚡" : "◎"} {t.label}
                </span>
                {t.sig.length > 20 && t.layer === "base" ? (
                  <a className="text-marker underline" href={explorerTx(t.sig)} target="_blank" rel="noreferrer">
                    {t.ms}ms
                  </a>
                ) : (
                  <span className="text-marker">{t.ms}ms</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* bottom */}
        <div className="flex flex-col items-center gap-2">
          {m.error && (
            <div
              className="panel pop-in pointer-events-auto max-w-md cursor-pointer border-pfred px-4 py-2 text-center font-hand text-lg"
              onClick={m.clearError}
            >
              {m.error}
            </div>
          )}

          {(g?.phase !== PHASE.PLAYING || m.busy || m.canClaimTimeout) && (
          <div className="panel pop-in pointer-events-auto flex max-w-xl flex-wrap items-center justify-center gap-3 px-5 py-3">
            {(g?.phase !== PHASE.PLAYING || m.busy) && (
              <span className="font-hand text-2xl leading-tight">{m.busy ?? status}</span>
            )}
            {m.canClaimTimeout && g?.phase === PHASE.PLAYING && (
              <button className="btn btn-danger !text-base" onClick={m.claimTimeout}>
                {stalledText}
              </button>
            )}
            {m.canClaimTimeout && g?.phase === PHASE.SEED_PENDING && (
              <button className="btn btn-danger !text-base" onClick={m.claimTimeout}>
                Oracle slow — abort & refund
              </button>
            )}
            {g?.phase === PHASE.READY && m.layer === "base" && m.seat !== null && (
              <button className="btn !text-base" onClick={m.startMatch}>
                Start match
              </button>
            )}
          </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------- how to play */}
      {(rulesOpen || (!rulesSeen && g?.phase === PHASE.PLAYING)) && g && (
        <RulesCard
          players={g.maxPlayers}
          targetWins={g.targetWins}
          staked={!isLocal && g.stake > 0n}
          timed={!isLocal}
          onClose={closeRules}
        />
      )}

      {/* --------------------------------------------------------- waiting room */}
      {g?.phase === PHASE.OPEN && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/55 p-4">
          <div className="panel pop-in w-full max-w-md p-6 text-center">
            <h2 className="font-hand text-4xl">
              Waiting for players ({joined}/{g.maxPlayers})
            </h2>
            <p className="font-hand mt-1 text-xl text-chalk/80">
              {g.stake === 0n
                ? "Free match"
                : `${fmtSol(g.stake)} SOL each · pot ${fmtSol(g.stake * BigInt(g.maxPlayers))} SOL`}{" "}
              · first to {g.targetWins}
            </p>

            <div className="mx-auto mt-4 grid max-w-xs gap-2">
              {Array.from({ length: g.maxPlayers }, (_, i) => {
                const pk = g.players[i];
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-xl bg-black/35 px-3 py-2 text-left"
                    style={{ borderLeft: `4px solid ${seatColor(i)}`, opacity: pk ? 1 : 0.55 }}
                  >
                    <span className="font-hand text-xl">{pk ? seatName(i) : "Open seat"}</span>
                    {pk && <span className="text-xs text-chalk/50">{shortKey(pk)}</span>}
                    {pk && m.seat === i && <span className="chip !py-0 text-[0.65rem]">you</span>}
                    {i === 0 && pk && <span className="chip !py-0 text-[0.65rem]">host</span>}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 break-all rounded-lg bg-black/30 p-3 text-xs text-chalk/80">
              {inviteLink}
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button className="btn" onClick={copy}>
                {copied ? "Copied!" : "Copy invite link"}
              </button>
              {isCreator && (
                <button className="btn btn-ghost" disabled={!!m.busy} onClick={m.cancel}>
                  Cancel & refund all
                </button>
              )}
              {amIn && !isCreator && (
                <button className="btn btn-ghost" disabled={!!m.busy} onClick={m.leave}>
                  Leave & refund me
                </button>
              )}
              {!amIn && (
                <button className="btn" disabled={!!m.busy} onClick={m.join}>
                  Join &amp; stake {fmtSol(g.stake)} SOL
                </button>
              )}
            </div>
            <p className="mt-4 text-xs text-chalk/50">
              The match starts as soon as the last seat is filled.
            </p>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- round banner */}
      {showRound && (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 z-20 grid place-items-center">
          <div className="panel pop-in px-8 py-4 text-center">
            <div className="font-hand text-5xl text-marker">{roundText}</div>
            <div className="font-hand text-xl text-chalk/70">{scoreLine}</div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- final result */}
      {showResult && g && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/60 p-4">
          <div className="panel pop-in w-full max-w-md p-6 text-center">
            <div className="text-6xl">{draw ? "🤝" : iWon ? "🏆" : m.seat === null ? "🏁" : "😵"}</div>
            <h2 className="font-hand mt-2 text-5xl">
              {draw
                ? "Draw"
                : iWon
                  ? "You win!"
                  : `${winSeat !== null ? nameOf(winSeat) : "Nobody"} wins${m.seat === null ? "!" : ""}`}
            </h2>
            <p className="font-hand mt-1 text-xl text-chalk/80">{scoreLine}</p>
            {!isLocal && g.stake > 0n && (
              <p className="font-hand mt-3 text-2xl">
                {draw ? (
                  <>Stakes refunded: <b className="text-marker">{fmtSol(g.stake)} SOL</b> each</>
                ) : iWon ? (
                  <>You take the pot: <b className="text-marker">{fmtSol(pot)} SOL</b></>
                ) : (
                  <>Pot of <b className="text-marker">{fmtSol(pot)} SOL</b> goes to the winner</>
                )}
              </p>
            )}
            {isLocal ? (
              <p className="mt-3 text-sm text-chalk/70">Practice match — nothing was staked.</p>
            ) : (
              <p className="mt-3 flex items-center justify-center gap-2 text-sm text-chalk/70">
                {g.paid ? (
                  <>✔ Settled on Solana{lastTx && lastTx.layer === "base" && lastTx.sig.length > 20 ? " · " : ""}
                    {lastTx && lastTx.layer === "base" && lastTx.sig.length > 20 && (
                      <a className="text-marker underline" href={explorerTx(lastTx.sig)} target="_blank" rel="noreferrer">
                        view tx
                      </a>
                    )}
                  </>
                ) : (
                  <>
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-marker border-t-transparent" />
                    {m.layer === "er" ? "Committing result to Solana…" : "Paying out the pot…"}
                  </>
                )}
              </p>
            )}
            <div className="mt-5 flex justify-center gap-2">
              {isLocal && onRematch && (
                <button className="btn" onClick={onRematch}>
                  Play again
                </button>
              )}
              <button className={isLocal ? "btn btn-ghost" : "btn"} onClick={onExit}>
                {isLocal ? "Back to menu" : "Back to lobby"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
