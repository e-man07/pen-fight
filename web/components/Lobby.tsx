"use client";

import { useCallback, useEffect, useState } from "react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { GameClient, OpenGame } from "@/lib/client";
import { CLUSTER } from "@/lib/config";
import { PHASE, lamportsToSol, seatOf, shortKey } from "@/lib/game";
import type { Difficulty, LocalConfig } from "@/lib/localMatch";
import { seatName } from "@/lib/seats";
import { friendlyError } from "@/lib/useMatch";

const STAKES = [0, 0.01, 0.05, 0.1, 0.5];
const LAST_KEY = "penfight:last";

function ago(gameId: bigint): string {
  const ms = Date.now() - Number(gameId / 1000n);
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

/** Matches open for 10+ minutes are probably abandoned. */
function isStale(gameId: bigint): boolean {
  return Date.now() - Number(gameId / 1000n) > 10 * 60 * 1000;
}

/** Lobbies open for over an hour are treated as abandoned and left out of the list. */
function isAbandoned(gameId: bigint): boolean {
  return Date.now() - Number(gameId / 1000n) > 60 * 60 * 1000;
}

export function rememberGame(id: bigint | null) {
  try {
    if (id === null) localStorage.removeItem(LAST_KEY);
    else localStorage.setItem(LAST_KEY, id.toString());
  } catch {
    /* ignore */
  }
}

export function Lobby({
  client,
  onEnter,
  onPlayLocal,
}: {
  client: GameClient | null;
  onEnter: (id: bigint) => void;
  /** Start a practice match against bots (no wallet needed). */
  onPlayLocal: (cfg: Omit<LocalConfig, "nonce">) => void;
}) {
  const [stake, setStake] = useState(0.05);
  const [customStake, setCustomStake] = useState("");
  const [targetWins, setTargetWins] = useState(2);
  const [open, setOpen] = useState<OpenGame[] | null>(null);
  const [joinId, setJoinId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [resume, setResume] = useState<bigint | null>(null);
  const [tab, setTab] = useState<"play" | "open" | "bot" | "rules">("play");
  const [players, setPlayers] = useState(2);
  const [bots, setBots] = useState(1);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [botTarget, setBotTarget] = useState(2);

  // Free play is only for 2-player matches; 3-4 player lobbies always put stake in the pot.
  const stakeChoices = players > 2 ? STAKES.filter((v) => v > 0) : STAKES;
  const effectiveStake = customStake !== "" ? Number(customStake) : stake;
  // The escrow vault is a system account, so a non-zero stake must clear the
  // rent-exempt minimum (~0.00089 SOL) on the first deposit.
  const stakeValid =
    Number.isFinite(effectiveStake) &&
    effectiveStake <= 100 &&
    (effectiveStake === 0 ? players === 2 : effectiveStake >= 0.001);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      setOpen((await client.listOpenGames()).filter((g) => !isAbandoned(g.gameId)));
    } catch {
      setOpen((o) => o ?? []);
    }
    try {
      setBalance(await client.baseBalance());
    } catch {
      /* ignore */
    }
  }, [client]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, 6000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  // Offer to resume the last unfinished match.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!client) return;
      try {
        const raw = localStorage.getItem(LAST_KEY);
        if (!raw) return;
        const id = BigInt(raw);
        const g = await client.fetchGame(id);
        if (cancelled || !g) return;
        const mine = seatOf(g.state, client.me) !== null;
        const live = !(g.state.phase === PHASE.FINISHED && g.state.paid);
        if (mine && live) setResume(id);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const create = async () => {
    if (!client || !stakeValid) return;
    setError(null);
    setBusy("Creating match — approve in your wallet…");
    try {
      const lamports = BigInt(Math.round(effectiveStake * LAMPORTS_PER_SOL));
      const id = await client.createGame(lamports, targetWins, players);
      rememberGame(id);
      onEnter(id);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const join = async (id: bigint) => {
    if (!client) return;
    setError(null);
    setBusy("Joining — approve in your wallet…");
    try {
      const g = await client.fetchGame(id);
      if (!g) throw new Error("Match not found.");
      const mine = seatOf(g.state, client.me) !== null;
      if (!mine) {
        if (g.state.phase !== PHASE.OPEN) throw new Error("That match is already full or started.");
        await client.joinGame(id);
      }
      rememberGame(id);
      onEnter(id);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const airdrop = async () => {
    if (!client) return;
    setError(null);
    setBusy("Requesting devnet SOL…");
    try {
      const sig = await client.base.requestAirdrop(
        client.me,
        (CLUSTER === "local" ? 5 : 1) * LAMPORTS_PER_SOL,
      );
      await client.base.confirmTransaction(sig, "confirmed");
      await refresh();
    } catch {
      setError("Airdrop failed (rate limited?). Try https://faucet.solana.com");
    } finally {
      setBusy(null);
    }
  };

  const parsedJoin = (() => {
    const t = joinId.trim();
    const m = t.match(/game=(\d+)/) || t.match(/^(\d+)$/);
    return m ? BigInt(m[1]) : null;
  })();

  return (
    <div className="glass pop-in pointer-events-auto w-full max-w-sm p-4">
      {resume !== null && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-marker/15 px-3 py-2">
          <span className="font-hand text-lg leading-tight">Unfinished match</span>
          <button className="btn btn-sm" onClick={() => onEnter(resume)}>
            Resume
          </button>
        </div>
      )}

      {/* tabs */}
      <div className="mb-3 flex gap-1 rounded-xl bg-black/45 p-1">
        {(
          [
            ["play", "Play"],
            ["open", `Open${open && open.length ? ` (${open.length})` : ""}`],
            ["bot", "vs Bot"],
            ["rules", "Rules"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`font-hand flex-1 rounded-lg px-1.5 py-1.5 text-lg leading-none transition ${
              tab === id ? "bg-chalk/90 text-board-deep" : "text-chalk hover:bg-white/10"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------------- play */}
      {tab === "play" && (
        <div className="space-y-3">
          <div>
            <div className="font-hand mb-1 text-base text-chalk/70">Players</div>
            <div className="flex gap-1.5">
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  className={`btn btn-sm flex-1 ${players === n ? "" : "btn-ghost"}`}
                  onClick={() => {
                    setPlayers(n);
                    if (n > 2 && stake === 0 && customStake === "") setStake(0.05);
                  }}
                >
                  {n} players
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="font-hand mb-1 text-base text-chalk/70">Stake per player</div>
            <div className="flex flex-wrap gap-1.5">
              {stakeChoices.map((v) => (
                <button
                  key={v}
                  className={`btn btn-sm ${customStake === "" && stake === v ? "" : "btn-ghost"}`}
                  onClick={() => {
                    setStake(v);
                    setCustomStake("");
                  }}
                >
                  {v === 0 ? "Free" : `${v} SOL`}
                </button>
              ))}
              <input
                inputMode="decimal"
                placeholder="custom"
                value={customStake}
                onChange={(e) => setCustomStake(e.target.value.replace(/[^0-9.]/g, ""))}
                className="font-hand w-20 rounded-lg border-2 border-chalk/30 bg-black/20 px-2 text-base outline-none focus:border-marker"
              />
            </div>
          </div>

          <div>
            <div className="font-hand mb-1 text-base text-chalk/70">First to win</div>
            <div className="flex gap-1.5">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  className={`btn btn-sm flex-1 ${targetWins === n ? "" : "btn-ghost"}`}
                  onClick={() => setTargetWins(n)}
                >
                  {n} round{n > 1 ? "s" : ""}
                </button>
              ))}
            </div>
          </div>

          {!stakeValid ? (
            <p className="text-xs text-pfred">
              {players > 2
                ? "3-4 player matches need a stake of at least 0.001 SOL each."
                : "Stake must be 0 (free) or at least 0.001 SOL."}
            </p>
          ) : (
            <p className="text-xs text-chalk/70">
              Winner takes{" "}
              <b className="text-marker">
                {effectiveStake === 0
                  ? "bragging rights"
                  : `${(effectiveStake * players).toFixed(effectiveStake * players < 1 ? 3 : 2)} SOL`}
              </b>
              . Stakes are escrowed on Solana until the match settles.
            </p>
          )}

          <button
            className="btn w-full"
            disabled={!client || !stakeValid || !!busy}
            onClick={create}
          >
            {client ? `Create ${players}-player match & lock stake` : "Connect a wallet to play"}
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------- open */}
      {tab === "open" && (
        <div className="space-y-2">
          <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
            {open === null && <p className="text-sm text-chalk/60">Looking around the classroom…</p>}
            {open?.length === 0 && (
              <p className="font-hand text-base text-chalk/60">
                No open matches yet. Create one and share the link!
              </p>
            )}
            {open?.map((g) => {
              const mine = !!client && seatOf(g.state, client.me) !== null;
              return (
                <div
                  key={g.gameId.toString()}
                  className="flex items-center justify-between gap-2 rounded-xl bg-black/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="font-hand truncate text-lg leading-tight">
                      {seatName(0)}{" "}
                      <span className="font-sans text-[0.65rem] text-chalk/50">
                        {shortKey(g.state.players[0])} · {ago(g.gameId)}
                      </span>
                    </div>
                    <div className="text-xs text-chalk/70">
                      {g.state.stake === 0n ? "Free" : `${lamportsToSol(g.state.stake)} SOL each`} ·{" "}
                      {g.state.players.length}/{g.state.maxPlayers} players · first to{" "}
                      {g.state.targetWins}
                    </div>
                    {isStale(g.gameId) && !mine && (
                      <div className="text-[0.65rem] text-marker">
                        ⚠ Old match — the creator may have left.
                      </div>
                    )}
                  </div>
                  <button
                    className="btn btn-sm"
                    disabled={!client || !!busy}
                    onClick={() => join(g.gameId)}
                  >
                    {mine ? "Open" : "Join"}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex gap-1.5">
            <input
              placeholder="Match ID or invite link"
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
              className="font-hand min-w-0 flex-1 rounded-lg border-2 border-chalk/30 bg-black/20 px-2 py-1.5 text-base outline-none focus:border-marker"
            />
            <button
              className="btn btn-sm btn-blue"
              disabled={!client || parsedJoin === null || !!busy}
              onClick={() => parsedJoin !== null && join(parsedJoin)}
            >
              Join
            </button>
            <button className="btn btn-sm btn-ghost" onClick={refresh} title="Refresh">
              ↻
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------- bot */}
      {tab === "bot" && (
        <div className="space-y-3">
          <p className="text-xs text-chalk/70">
            Practice mode: instant, no wallet, no stake, nothing on-chain. Same physics and
            rules as a real match.
          </p>
          <div>
            <div className="font-hand mb-1 text-base text-chalk/70">Bot opponents</div>
            <div className="flex gap-1.5">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  className={`btn btn-sm flex-1 ${bots === n ? "" : "btn-ghost"}`}
                  onClick={() => setBots(n)}
                >
                  {n} bot{n > 1 ? "s" : ""}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="font-hand mb-1 text-base text-chalk/70">Difficulty</div>
            <div className="flex gap-1.5">
              {(["easy", "medium", "hard"] as const).map((d) => (
                <button
                  key={d}
                  className={`btn btn-sm flex-1 capitalize ${difficulty === d ? "" : "btn-ghost"}`}
                  onClick={() => setDifficulty(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="font-hand mb-1 text-base text-chalk/70">First to win</div>
            <div className="flex gap-1.5">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  className={`btn btn-sm flex-1 ${botTarget === n ? "" : "btn-ghost"}`}
                  onClick={() => setBotTarget(n)}
                >
                  {n} round{n > 1 ? "s" : ""}
                </button>
              ))}
            </div>
          </div>
          <button
            className="btn w-full"
            onClick={() =>
              onPlayLocal({ players: bots + 1, targetWins: botTarget, difficulty })
            }
          >
            Play vs {bots} bot{bots > 1 ? "s" : ""}
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------ rules */}
      {tab === "rules" && (
        <ol className="font-hand list-decimal space-y-0.5 pl-5 text-lg leading-snug text-chalk/90">
          <li>Each player has a pen; 2-4 players sit around the bench.</li>
          <li>A VRF coin-toss picks who flicks first, every round.</li>
          <li>Drag back from the desk, let go to flick.</li>
          <li>Knock the other pens off the edge: last pen on the desk wins the round.</li>
          <li>6 flicks each and still more than one pen? The one furthest from the edge wins.</li>
          <li>First to the target wins the match and the whole pot.</li>
        </ol>
      )}

      {/* ----------------------------------------------------------- footer */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-2 text-xs text-chalk/70">
        {client ? (
          <>
            <span className="min-w-0 truncate">
              <b className="font-hand text-base text-chalk">{shortKey(client.me)}</b> ·{" "}
              <b className="text-marker">
                {balance === null ? "…" : (balance / LAMPORTS_PER_SOL).toFixed(3)}
              </b>{" "}
              SOL <span className="text-chalk/40">({CLUSTER})</span>
            </span>
            <span className="flex shrink-0 gap-1">
              <button className="btn btn-sm btn-ghost !px-2 !py-1 !text-sm" onClick={airdrop} disabled={!!busy}>
                {CLUSTER === "local" ? "+5 SOL" : "+1 SOL"}
              </button>
              {CLUSTER !== "local" && (
                <a
                  className="btn btn-sm btn-ghost !px-2 !py-1 !text-sm"
                  href="https://faucet.solana.com"
                  target="_blank"
                  rel="noreferrer"
                  title="Devnet faucet"
                >
                  Faucet ↗
                </a>
              )}
            </span>
          </>
        ) : (
          <span>Connect a Solana wallet (devnet) to play for the pot.</span>
        )}
      </div>

      {(busy || error) && (
        <div className="fixed inset-x-0 bottom-4 z-50 mx-auto flex max-w-md justify-center px-4">
          <div
            className={`glass pop-in w-full px-4 py-3 text-center font-hand text-xl ${
              error ? "!border-pfred" : ""
            }`}
            onClick={() => setError(null)}
          >
            {busy ?? error}
          </div>
        </div>
      )}
    </div>
  );
}
