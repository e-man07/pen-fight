/* eslint-disable @typescript-eslint/no-explicit-any */
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  BASE_RPC,
  BASE_WS,
  ER_RPC,
  ER_VALIDATOR,
  ER_WS,
  VRF_QUEUE,
} from "./config";
import {
  GameState,
  Layer,
  PHASE,
  PROGRAM_ID,
  gamePda,
  normalizeGame,
  vaultPda,
} from "./game";
import idl from "./idl/pen_fight.json";

/** The bit of a wallet adapter we need. */
export interface WalletLike {
  publicKey: PublicKey;
  signTransaction<T extends Transaction>(tx: T): Promise<T>;
}

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const memoryStore = (): KeyValueStore => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
};

export const browserStore = (): KeyValueStore => {
  try {
    const ls = globalThis.localStorage;
    ls.setItem("__pf", "1");
    ls.removeItem("__pf");
    return {
      get: (k) => ls.getItem(k),
      set: (k, v) => ls.setItem(k, v),
    };
  } catch {
    return memoryStore();
  }
};

/** 8-byte discriminator + Game::LEN (see the program). */
const GAME_ACCOUNT_SIZE = 330;
const SESSION_TOP_UP_LAMPORTS = 10_000_000; // 0.01 SOL for session-signer fees
const SESSION_VALID_SECS = 6 * 3600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const sessionTokenSeed = "session_token_v2";

export interface OpenGame {
  gameId: bigint;
  address: PublicKey;
  state: GameState;
}

/**
 * Everything the UI does on-chain. Wallet signatures are only needed to create or
 * join a match; every in-game action is signed by a local session key.
 */
export class GameClient {
  readonly base: Connection;
  readonly er: Connection;
  readonly program: Program;
  readonly erProgram: Program;
  /** Session signer for gasless in-match moves. Replaced when its token expires. */
  session: Keypair;
  private readonly sessions: SessionTokenManager;
  private readonly store: KeyValueStore;
  private readonly storeKey: string;

  constructor(
    readonly wallet: WalletLike,
    store: KeyValueStore = browserStore(),
  ) {
    this.base = new Connection(BASE_RPC, {
      wsEndpoint: BASE_WS,
      commitment: "confirmed",
    });
    this.er = new Connection(ER_RPC, {
      wsEndpoint: ER_WS,
      commitment: "confirmed",
    });
    const walletShim = {
      publicKey: wallet.publicKey,
      signTransaction: wallet.signTransaction.bind(wallet),
      signAllTransactions: async (txs: Transaction[]) =>
        Promise.all(txs.map((t) => wallet.signTransaction(t))),
    } as unknown as anchor.Wallet;
    const baseProvider = new anchor.AnchorProvider(this.base, walletShim, {
      commitment: "confirmed",
    });
    const erProvider = new anchor.AnchorProvider(this.er, walletShim, {
      commitment: "confirmed",
    });
    this.program = new Program(idl as anchor.Idl, baseProvider);
    this.erProgram = new Program(idl as anchor.Idl, erProvider);
    this.sessions = new SessionTokenManager(walletShim, this.base);

    // One session keypair per wallet, persisted locally.
    this.store = store;
    this.storeKey = `penfight:session:${wallet.publicKey.toBase58()}`;
    const storeKey = this.storeKey;
    const saved = store.get(storeKey);
    let kp: Keypair | null = null;
    if (saved) {
      try {
        kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved)));
      } catch {
        kp = null;
      }
    }
    if (!kp) {
      kp = Keypair.generate();
      store.set(storeKey, JSON.stringify(Array.from(kp.secretKey)));
    }
    this.session = kp;
  }

  get me(): PublicKey {
    return this.wallet.publicKey;
  }

  // ------------------------------------------------------------------ sessions

  sessionTokenAddress(
    authority: PublicKey = this.me,
    signer: PublicKey = this.session.publicKey,
  ): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from(sessionTokenSeed),
        PROGRAM_ID.toBytes(),
        signer.toBytes(),
        authority.toBytes(),
      ],
      this.sessions.program.programId,
    )[0];
  }

  /**
   * State of this wallet's session: "missing" (no token yet), "expired" (token
   * exists but runs out within 10 min), "low" (token valid, signer can't pay
   * fees), or "ok".
   */
  private async sessionState(): Promise<"missing" | "expired" | "low" | "ok"> {
    const info = await this.base.getAccountInfo(this.sessionTokenAddress());
    if (!info) return "missing";
    let validUntil = 0;
    try {
      // SessionTokenV2 layout: 8 disc | authority | target_program | session_signer |
      // fee_payer (4 x 32 bytes) | valid_until i64
      const d = info.data;
      validUntil = Number(
        new DataView(d.buffer, d.byteOffset, d.byteLength).getBigInt64(8 + 32 * 4, true),
      );
    } catch {
      return "expired";
    }
    if (validUntil <= Date.now() / 1000 + 600) return "expired";
    const balance = await this.base.getBalance(this.session.publicKey);
    return balance > 2_000_000 ? "ok" : "low";
  }

  /** True if a live, funded session token for this wallet + session key exists. */
  async hasValidSession(): Promise<boolean> {
    return (await this.sessionState()) === "ok";
  }

  private createSessionIx(signer: PublicKey): Promise<TransactionInstruction> {
    return this.sessions.program.methods
      .createSessionV2(
        true,
        new BN(Math.floor(Date.now() / 1000) + SESSION_VALID_SECS),
        new BN(SESSION_TOP_UP_LAMPORTS),
      )
      .accounts({
        targetProgram: PROGRAM_ID,
        sessionSigner: signer,
        feePayer: this.me,
        authority: this.me,
      })
      .instruction();
  }

  /**
   * Instructions that make the session usable, to prepend to a wallet-signed
   * transaction. `signers` must co-sign it; call `commit()` once it confirms.
   *
   * The session token is a PDA of (session key, wallet), and createSessionV2
   * `init`s it, so it can never be created twice for the same key: retrying
   * after the token expired failed with System error 0x0 ("account already in
   * use") and locked the wallet out of creating or joining matches. An expired
   * token therefore gets a NEW session key (new PDA), and the old token is
   * revoked in the same transaction to return its rent. A valid token whose
   * signer ran low on SOL is just topped up.
   */
  private async sessionSetup(): Promise<{
    ixs: TransactionInstruction[];
    signers: Keypair[];
    commit: () => void;
  }> {
    const none = { ixs: [], signers: [], commit: () => {} };
    const state = await this.sessionState();
    if (state === "ok") return none;
    if (state === "low") {
      return {
        ...none,
        ixs: [
          SystemProgram.transfer({
            fromPubkey: this.me,
            toPubkey: this.session.publicKey,
            lamports: SESSION_TOP_UP_LAMPORTS,
          }),
        ],
      };
    }
    if (state === "missing") {
      return {
        ixs: [await this.createSessionIx(this.session.publicKey)],
        signers: [this.session],
        commit: () => {},
      };
    }
    // expired
    const fresh = Keypair.generate();
    const revoke = await this.sessions.program.methods
      .revokeSessionV2()
      .accounts({
        sessionToken: this.sessionTokenAddress(),
        feePayer: this.me,
        authority: this.me,
      })
      .instruction();
    return {
      ixs: [revoke, await this.createSessionIx(fresh.publicKey)],
      signers: [fresh],
      // Only switch keys once the new token exists on chain; a rejected popup
      // leaves the old key (and its expired token) in place to retry with.
      commit: () => {
        this.session = fresh;
        this.store.set(this.storeKey, JSON.stringify(Array.from(fresh.secretKey)));
      },
    };
  }

  // -------------------------------------------------------------------- sending

  /** Send a wallet-signed base-layer transaction (one wallet popup). */
  private async sendWithWallet(
    ixs: TransactionInstruction[],
    extraSigners: Keypair[] = [],
    skipPreflight = false,
  ): Promise<string> {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = this.me;
    const { blockhash, lastValidBlockHeight } =
      await this.base.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    if (extraSigners.length) tx.partialSign(...extraSigners);
    const signed = await this.wallet.signTransaction(tx);
    const signature = await this.base.sendRawTransaction(signed.serialize(), {
      skipPreflight,
    });
    const res = await this.base.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
    return signature;
  }

  /** Send a base-layer transaction signed by the session key (no popup). */
  private async sendWithSessionBase(ixs: TransactionInstruction[]): Promise<string> {
    const tx = new Transaction().add(...ixs);
    return sendAndConfirmTransaction(this.base, tx, [this.session], {
      commitment: "confirmed",
    });
  }

  /** Send an ER transaction signed by the session key. */
  private async sendEr(
    ixs: TransactionInstruction[],
    compute?: number,
  ): Promise<string> {
    const tx = new Transaction();
    if (compute) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: compute }));
    tx.add(...ixs);
    return sendAndConfirmTransaction(this.er, tx, [this.session], {
      skipPreflight: true,
      commitment: "confirmed",
    });
  }

  // --------------------------------------------------------------------- reads

  async fetchGame(
    gameId: bigint,
  ): Promise<{ state: GameState; layer: Layer } | null> {
    const pda = gamePda(gameId);
    const info = await this.base.getAccountInfo(pda);
    if (!info) {
      // Not on base yet (or fetch race); the ER copy only exists after delegation.
      return null;
    }
    if (info.owner.equals(PROGRAM_ID)) {
      const raw = this.program.coder.accounts.decode("game", info.data);
      return { state: normalizeGame(raw), layer: "base" };
    }
    // Delegated: the live copy lives on the ephemeral rollup.
    const erInfo = await this.er.getAccountInfo(pda);
    if (!erInfo) return null;
    const raw = this.program.coder.accounts.decode("game", erInfo.data);
    return { state: normalizeGame(raw), layer: "er" };
  }

  /** Open lobbies that still have a free seat. */
  async listOpenGames(): Promise<OpenGame[]> {
    // Filter by account size too: matches created by older program versions have a
    // different layout and must be skipped, not decoded.
    const accounts = await this.base.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { dataSize: GAME_ACCOUNT_SIZE },
        // phase byte: 8 disc + 8 id + 4*32 players + 1 count + 1 max + 8 stake + 1 target = 155
        { memcmp: { offset: 155, bytes: "1" } },
      ],
    });
    const out: OpenGame[] = [];
    for (const a of accounts) {
      try {
        const state = normalizeGame(this.program.coder.accounts.decode("game", a.account.data));
        if (state.phase === PHASE.OPEN) out.push({ gameId: state.gameId, address: a.pubkey, state });
      } catch {
        /* not a decodable match: skip */
      }
    }
    return out.sort((x, y) => (x.gameId < y.gameId ? 1 : -1));
  }

  async baseBalance(pk: PublicKey = this.me): Promise<number> {
    return this.base.getBalance(pk);
  }

  // ---------------------------------------------------------- lobby (base layer)

  /** Create a lobby for `maxPlayers` (2..4), lock the stake, set up the session key: ONE popup. */
  async createGame(stakeLamports: bigint, targetWins: number, maxPlayers = 2): Promise<bigint> {
    const gameId = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    const idBn = new BN(gameId.toString());
    const ixs: TransactionInstruction[] = [];
    const sess = await this.sessionSetup();
    ixs.push(...sess.ixs);
    ixs.push(
      await this.program.methods
        .createGame(idBn, new BN(stakeLamports.toString()), targetWins, maxPlayers)
        .accounts({
          game: gamePda(gameId),
          vault: vaultPda(gameId),
          player1: this.me,
        })
        .instruction(),
    );
    await this.sendWithWallet(ixs, sess.signers);
    sess.commit();
    return gameId;
  }

  /**
   * Join a lobby, match the stake and set up the session key. The player who FILLS the
   * lobby also delegates the match to the Ephemeral Rollup in the same transaction, so
   * every join is exactly ONE wallet popup.
   */
  async joinGame(gameId: bigint): Promise<void> {
    const current = await this.fetchGame(gameId);
    if (!current) throw new Error("Match not found.");
    const fills = current.state.players.length + 1 === current.state.maxPlayers;

    const idBn = new BN(gameId.toString());
    const ixs: TransactionInstruction[] = [];
    const sess = await this.sessionSetup();
    ixs.push(...sess.ixs);
    ixs.push(
      await this.program.methods
        .joinGame(idBn)
        .accounts({
          game: gamePda(gameId),
          vault: vaultPda(gameId),
          player: this.me,
        })
        .instruction(),
    );
    if (fills) {
      ixs.push(
        await this.program.methods
          .delegateGame()
          .accounts({ payer: this.me, pda: gamePda(gameId) })
          .remainingAccounts([
            { pubkey: ER_VALIDATOR, isSigner: false, isWritable: false },
          ])
          .instruction(),
      );
    }
    await this.sendWithWallet(ixs, sess.signers);
    sess.commit();
  }

  /** Delegate a full lobby that was not yet moved to the ER (recovery path). */
  async delegateGame(gameId: bigint): Promise<void> {
    const ix = await this.program.methods
      .delegateGame()
      .accounts({ payer: this.me, pda: gamePda(gameId) })
      .remainingAccounts([
        { pubkey: ER_VALIDATOR, isSigner: false, isWritable: false },
      ])
      .instruction();
    await this.sendWithWallet([ix]);
  }

  /** A joined player (not the creator) leaves an unfilled lobby and is refunded. */
  async leaveGame(gameId: bigint): Promise<void> {
    const ix = await this.program.methods
      .leaveGame()
      .accounts({
        game: gamePda(gameId),
        vault: vaultPda(gameId),
        player: this.me,
      })
      .instruction();
    await this.sendWithWallet([ix]);
  }

  /** The creator cancels an unfilled lobby; every joined player is refunded. */
  async cancelGame(state: GameState): Promise<void> {
    const accounts: Record<string, PublicKey | null> = {
      game: gamePda(state.gameId),
      vault: vaultPda(state.gameId),
      player1: this.me,
    };
    // Optional seats must be passed explicitly (null when empty).
    for (let seat = 1; seat < 4; seat++) accounts[`player${seat + 1}`] = state.players[seat] ?? null;
    const ix = await this.program.methods
      .cancelGame()
      .accounts(accounts as any)
      .instruction();
    await this.sendWithWallet([ix]);
  }

  // ------------------------------------------------- in-game (ER, session-signed)

  async requestSeed(gameId: bigint): Promise<string> {
    const ix = await this.erProgram.methods
      .requestSeed()
      .accounts({
        payer: this.session.publicKey,
        game: gamePda(gameId),
        oracleQueue: VRF_QUEUE,
      })
      .instruction();
    return this.sendEr([ix]);
  }

  /** Flick my pen. `angle` is in half-degrees (0..720), `power` 1..=100. */
  async playFlick(
    gameId: bigint,
    seat: number,
    angle: number,
    power: number,
  ): Promise<string> {
    void seat;
    const ix = await this.erProgram.methods
      .playFlick(((angle % 720) + 720) % 720, power)
      .accounts({
        payer: this.session.publicKey,
        game: gamePda(gameId),
        sessionToken: this.sessionTokenAddress(),
      })
      .instruction();
    return this.sendEr([ix], 400_000);
  }

  async claimTimeout(gameId: bigint): Promise<string> {
    const ix = await this.erProgram.methods
      .claimTimeout()
      .accounts({ payer: this.session.publicKey, game: gamePda(gameId) })
      .instruction();
    return this.sendEr([ix]);
  }

  async finishGame(gameId: bigint): Promise<string> {
    const ix = await this.erProgram.methods
      .finishGame()
      .accounts({ payer: this.session.publicKey, game: gamePda(gameId) })
      .instruction();
    return this.sendEr([ix]);
  }

  // --------------------------------------------------------- settle (base layer)

  async claimPot(state: GameState): Promise<string> {
    const accounts: Record<string, PublicKey | null> = {
      game: gamePda(state.gameId),
      vault: vaultPda(state.gameId),
      payer: this.session.publicKey,
      player1: state.players[0],
    };
    for (let seat = 1; seat < 4; seat++) accounts[`player${seat + 1}`] = state.players[seat] ?? null;
    const ix = await this.program.methods.claimPot().accounts(accounts as any).instruction();
    return this.sendWithSessionBase([ix]);
  }

  // ------------------------------------------------------------- watching a game

  /**
   * Watch a match: websocket subscriptions on both layers plus a polling fallback.
   * `onState` fires only when the on-chain state changed.
   */
  watchGame(
    gameId: bigint,
    onState: (s: GameState, layer: Layer) => void,
    onError?: (e: unknown) => void,
  ): () => void {
    const pda = gamePda(gameId);
    let stopped = false;
    let lastRaw = "";

    const emit = (data: Buffer, layer: Layer) => {
      if (stopped) return;
      const key = layer + data.toString("base64");
      if (key === lastRaw) return;
      lastRaw = key;
      try {
        const raw = this.program.coder.accounts.decode("game", data);
        onState(normalizeGame(raw), layer);
      } catch (e) {
        onError?.(e);
      }
    };

    const poll = async () => {
      while (!stopped) {
        try {
          const info = await this.base.getAccountInfo(pda);
          if (info) {
            if (info.owner.equals(PROGRAM_ID)) emit(info.data as Buffer, "base");
            else {
              const erInfo = await this.er.getAccountInfo(pda);
              if (erInfo) emit(erInfo.data as Buffer, "er");
            }
          }
        } catch (e) {
          onError?.(e);
        }
        await sleep(1000);
      }
    };
    void poll();

    let baseSub: number | null = null;
    let erSub: number | null = null;
    try {
      baseSub = this.base.onAccountChange(
        pda,
        (acc) => {
          if (acc.owner.equals(PROGRAM_ID)) emit(acc.data as Buffer, "base");
        },
        "confirmed",
      );
      erSub = this.er.onAccountChange(
        pda,
        (acc) => emit(acc.data as Buffer, "er"),
        "confirmed",
      );
    } catch (e) {
      onError?.(e);
    }

    return () => {
      stopped = true;
      if (baseSub !== null) void this.base.removeAccountChangeListener(baseSub).catch(() => {});
      if (erSub !== null) void this.er.removeAccountChangeListener(erSub).catch(() => {});
    };
  }
}
