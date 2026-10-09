/**
 * Headless end-to-end run of the real GameClient against a cluster. N simulated
 * wallets (PLAYERS=2|3|4) fill a staked lobby, play a full match on the Ephemeral
 * Rollup, settle and claim the pot. Also tests leave/cancel refunds and timeouts.
 *
 *   # local cluster (anchor/scripts/start-local.sh) running:
 *   NEXT_PUBLIC_CLUSTER=local PLAYERS=4 npx tsx scripts/e2e.ts [--timeout]
 *
 * Env: PLAYERS (default 2), FUND_SOL (default 5), STAKE_SOL (default 0.1),
 *      FUNDER=<keypair file> to fund wallets by transfer (and sweep back) instead of airdrop.
 */
import { readFileSync } from "node:fs";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { GameClient, type KeyValueStore } from "../lib/client";
import { PHASE, vaultPda, winnerSeat, type GameState } from "../lib/game";
import { aliveCount, angleToward, clonePens, simulateFlick } from "../lib/sim";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PLAYERS = Number(process.env.PLAYERS ?? 2);
const FUND_SOL = Number(process.env.FUND_SOL ?? 5);
const STAKE = BigInt(Math.round(Number(process.env.STAKE_SOL ?? 0.1) * LAMPORTS_PER_SOL));

const memStore = (): KeyValueStore => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
};

function clientFor(kp: Keypair): GameClient {
  return new GameClient(
    {
      publicKey: kp.publicKey,
      signTransaction: async <T extends Transaction>(tx: T) => {
        tx.partialSign(kp);
        return tx;
      },
    },
    memStore(),
  );
}

const funder = process.env.FUNDER
  ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.FUNDER, "utf8"))))
  : null;

async function fund(c: GameClient, sol: number) {
  if (funder) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: funder.publicKey,
        toPubkey: c.me,
        lamports: Math.round(sol * LAMPORTS_PER_SOL),
      }),
    );
    await sendAndConfirmTransaction(c.base, tx, [funder], { commitment: "confirmed" });
    return;
  }
  const sig = await c.base.requestAirdrop(c.me, sol * LAMPORTS_PER_SOL);
  await c.base.confirmTransaction(sig, "confirmed");
}

/** Return leftover funds from a test wallet (and its session key) to the funder. */
async function sweep(c: GameClient, kp: Keypair) {
  if (!funder) return;
  for (const from of [kp, c.session]) {
    const bal = await c.base.getBalance(from.publicKey);
    if (bal <= 5000) continue;
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: funder.publicKey, lamports: bal - 5000 }),
    );
    tx.feePayer = from.publicKey;
    await sendAndConfirmTransaction(c.base, tx, [from], { commitment: "confirmed" }).catch(() => {});
  }
}

async function waitState(
  c: GameClient,
  id: bigint,
  pred: (s: GameState) => boolean,
  label: string,
  ms = 40000,
): Promise<GameState> {
  const t0 = Date.now();
  for (;;) {
    const g = await c.fetchGame(id);
    if (g && pred(g.state)) return g.state;
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`);
    await sleep(400);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function waitOnEr(c: GameClient, id: bigint) {
  for (let i = 0; i < 60; i++) {
    if ((await c.fetchGame(id))?.layer === "er") return;
    await sleep(500);
  }
  throw new Error("match never reached the ER");
}

async function waitSettled(c: GameClient, id: bigint): Promise<GameState> {
  for (let i = 0; i < 120; i++) {
    const g = await c.fetchGame(id);
    if (g?.layer === "base" && g.state.phase === PHASE.FINISHED) return g.state;
    await sleep(500);
  }
  throw new Error("never undelegated");
}

const openLobbies: { id: bigint; creator: GameClient }[] = [];

async function openLobby(clients: GameClient[], targetWins: number): Promise<bigint> {
  const id = await clients[0].createGame(STAKE, targetWins, clients.length);
  openLobbies.push({ id, creator: clients[0] });
  for (let i = 1; i < clients.length; i++) await clients[i].joinGame(id);
  return id;
}

let kps: Keypair[] = [];
let cs: GameClient[] = [];

/** Cancel lobbies still open (refunding everyone), then sweep leftover funds back. */
async function cleanup() {
  for (const l of openLobbies) {
    try {
      const g = await l.creator.fetchGame(l.id);
      if (g && g.layer === "base" && g.state.phase === PHASE.OPEN) await l.creator.cancelGame(g.state);
    } catch {
      /* best effort */
    }
  }
  for (let i = 0; i < cs.length; i++) await sweep(cs[i], kps[i]).catch(() => {});
}

async function main() {
  kps = Array.from({ length: PLAYERS }, () => Keypair.generate());
  cs = kps.map(clientFor);
  for (const c of cs) await fund(c, FUND_SOL);
  console.log(`${PLAYERS} players`, cs.map((c) => c.me.toBase58().slice(0, 6)).join(" "));

  const stakeNum = Number(STAKE);

  // ------------------------------------------------------------ lobby behaviour
  {
    const id = await cs[0].createGame(STAKE, 2, PLAYERS);
    openLobbies.push({ id, creator: cs[0] });
    assert((await cs[0].base.getBalance(vaultPda(id))) === stakeNum, "vault holds creator stake");
    let listed = false;
    for (let i = 0; i < 20 && !listed; i++) {
      listed = (await cs[1].listOpenGames()).some((g) => g.gameId === id);
      if (!listed) await sleep(1000);
    }
    assert(listed, "lobby listed as open");

    if (PLAYERS > 2) {
      // a joiner leaves and is refunded; then the creator cancels a half-full lobby
      await cs[1].joinGame(id);
      assert((await cs[0].base.getBalance(vaultPda(id))) === stakeNum * 2, "vault has two stakes");
      const before = await cs[1].base.getBalance(cs[1].me);
      await cs[1].leaveGame(id);
      const afterLeave = await cs[1].base.getBalance(cs[1].me);
      assert(afterLeave - before >= stakeNum - 10000, "leaver refunded");
      assert((await cs[0].base.getBalance(vaultPda(id))) === stakeNum, "vault back to one stake");

      await cs[1].joinGame(id);
      const b0 = await cs[0].base.getBalance(cs[0].me);
      const b1 = await cs[1].base.getBalance(cs[1].me);
      const st = (await cs[0].fetchGame(id))!.state;
      assert(st.players.length === 2, "two players in lobby before cancel");
      await cs[0].cancelGame(st);
      assert((await cs[0].base.getBalance(vaultPda(id))) === 0, "vault emptied by cancel");
      assert((await cs[0].base.getBalance(cs[0].me)) - b0 >= stakeNum - 20000, "creator refunded");
      assert((await cs[1].base.getBalance(cs[1].me)) - b1 === stakeNum, "joiner refunded");
      console.log("leave + cancel refunds OK");
    } else {
      const before = await cs[0].base.getBalance(cs[0].me);
      await cs[0].cancelGame((await cs[0].fetchGame(id))!.state);
      assert((await cs[0].base.getBalance(cs[0].me)) - before >= stakeNum - 20000, "creator refunded");
      console.log("cancel refund OK");
    }
  }

  // ------------------------------------------------------------- full match
  const id = await openLobby(cs, 2);
  console.log("lobby filled; game", id.toString());
  assert((await cs[0].base.getBalance(vaultPda(id))) === stakeNum * PLAYERS, "vault holds every stake");
  await waitOnEr(cs[0], id);

  let maxCu = 0;
  let flicks = 0;
  let rounds = 0;
  for (let guard = 0; guard < 900; guard++) {
    const s = (await cs[0].fetchGame(id))!.state;
    if (s.phase === PHASE.FINISHED) break;
    if (s.phase === PHASE.READY || s.phase === PHASE.NEED_SEED || s.phase === PHASE.ROUND_OVER) {
      if (s.phase === PHASE.ROUND_OVER) {
        rounds++;
        console.log(`  round ${s.round} -> seat ${winnerSeat(s.roundResult) ?? "draw"} | wins ${s.wins.join(":")}`);
      }
      await cs[0].requestSeed(id).catch((e) => console.log("  requestSeed:", String(e.message).slice(0, 80)));
      await sleep(500);
      continue;
    }
    if (s.phase === PHASE.SEED_PENDING) {
      await sleep(300);
      continue;
    }
    const turn = s.turn;
    assert(!s.pens[turn].out, "the player on turn has a live pen");
    // aim at a random live opponent
    const foes = s.pens.map((p, i) => ({ p, i })).filter((x) => x.i !== turn && !x.p.out);
    const foe = foes[Math.floor(Math.random() * foes.length)];
    const angle = (angleToward(s.pens[turn], foe.p) + Math.floor(Math.random() * 16 - 8) + 720) % 720;
    const power = 55 + Math.floor(Math.random() * 46);
    const predicted = simulateFlick(clonePens(s.pens), turn, angle, power).final;
    const sig = await cs[turn].playFlick(id, turn, angle, power);
    flicks++;
    const after = (await cs[0].fetchGame(id))!.state;
    assert(
      JSON.stringify(after.pens) === JSON.stringify(predicted),
      "TS sim == chain after flick",
    );
    const tx = await cs[0].er.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    maxCu = Math.max(maxCu, tx?.meta?.computeUnitsConsumed ?? 0);
  }

  const done = (await cs[0].fetchGame(id))!.state;
  assert(done.phase === PHASE.FINISHED, "match finished");
  const wSeat = winnerSeat(done.winner);
  assert(wSeat !== null && wSeat < PLAYERS, "a seat won the match");
  console.log(
    `match over: seat ${wSeat} wins (${done.wins.join(":")}) after ${flicks} flicks / ${rounds + 1} rounds, max flick CU=${maxCu}`,
  );

  // any player can commit; do it from two to check idempotence
  await cs[PLAYERS - 1].finishGame(id).catch(() => {});
  await cs[0].finishGame(id).catch(() => {});
  const settled = await waitSettled(cs[0], id);

  const winner = cs[wSeat!];
  const before = await cs[0].base.getBalance(winner.me);
  await cs[PLAYERS - 1].claimPot(settled);
  const after = await cs[0].base.getBalance(winner.me);
  assert(after - before === stakeNum * PLAYERS, `winner got ${PLAYERS}x stake (got ${after - before})`);
  assert((await cs[0].base.getBalance(vaultPda(id))) === 0, "vault empty");
  assert((await cs[0].fetchGame(id))!.state.paid, "marked paid");
  let double = false;
  try {
    await cs[0].claimPot(settled);
  } catch {
    double = true;
  }
  assert(double, "double claim rejected");
  console.log("pot claimed by seat", wSeat, "OK");

  // ---------------------------------------------------------------- timeouts
  if (process.argv.includes("--timeout")) {
    const id2 = await openLobby(cs, 3);
    await waitOnEr(cs[0], id2);
    await cs[0].requestSeed(id2);
    const s = await waitState(cs[0], id2, (x) => x.phase === PHASE.PLAYING, "playing");
    const staller = s.turn;
    const other = (staller + 1) % PLAYERS;
    console.log(`seat ${staller} stalls...`);
    let early = false;
    try {
      await cs[other].claimTimeout(id2);
    } catch {
      early = true;
    }
    assert(early, "too-early timeout claim rejected");
    await sleep(47000);
    await cs[other].claimTimeout(id2);
    if (PLAYERS === 2) {
      const f = await waitState(cs[0], id2, (x) => x.phase === PHASE.FINISHED, "forfeit finished");
      assert(winnerSeat(f.winner) === other, "other player wins by forfeit");
      console.log("2-player forfeit OK");
    } else {
      const f = await waitState(cs[0], id2, (x) => x.pens[staller].out, "staller eliminated");
      assert(f.phase === PHASE.PLAYING && f.turn !== staller, "play continues without the staller");
      assert(aliveCount(f.pens) === PLAYERS - 1, "one pen removed");
      console.log("multi-player stall elimination OK");
    }
    // This second match is left unsettled on purpose.
  }

  await cleanup();
  console.log(`E2E PASSED (${PLAYERS} players)`);
  process.exit(0);
}

main().catch(async (e) => {
  console.error("E2E FAILED:", e);
  await cleanup().catch(() => {});
  process.exit(1);
});
