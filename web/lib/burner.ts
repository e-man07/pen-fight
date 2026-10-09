import {
  BaseMessageSignerWalletAdapter,
  WalletName,
  WalletReadyState,
  type TransactionOrVersionedTransaction,
} from "@solana/wallet-adapter-base";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";

/**
 * "Guest wallet": a throwaway keypair kept in this browser's localStorage that signs
 * without any pop-up. Handy for trying the game with devnet funds before installing
 * a wallet extension (and for automated testing). Never put real funds in it.
 *
 * Use `?guest=2` in the URL to pick a different guest slot (e.g. to play against
 * yourself in two tabs).
 */
export const GUEST_WALLET_NAME = "Guest Wallet" as WalletName<"Guest Wallet">;

const ICON =
  "data:image/svg+xml;base64," +
  (typeof btoa === "function"
    ? btoa(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1c352b"/><path d="M14 46 46 14l4 4-32 32z" fill="#2f5bff"/><path d="M44 12l8 8-3 3-8-8z" fill="#f2c230"/><circle cx="15" cy="49" r="3" fill="#f6f3e8"/></svg>`,
      )
    : "");

function slotKey(): string {
  let slot = "1";
  try {
    const q = new URLSearchParams(window.location.search).get("guest");
    if (q && /^\d{1,2}$/.test(q)) slot = q;
  } catch {
    /* ignore */
  }
  return `penfight:guest:${slot}`;
}

export function loadGuestKeypair(): Keypair {
  const key = slotKey();
  try {
    const saved = localStorage.getItem(key);
    if (saved) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved)));
  } catch {
    /* fall through */
  }
  const kp = Keypair.generate();
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(kp.secretKey)));
  } catch {
    /* ignore */
  }
  return kp;
}

export class GuestWalletAdapter extends BaseMessageSignerWalletAdapter<"Guest Wallet"> {
  name = GUEST_WALLET_NAME;
  url = "https://github.com/";
  icon = ICON;
  supportedTransactionVersions = new Set(["legacy" as const]);

  private _kp: Keypair | null = null;
  private _connecting = false;

  get publicKey(): PublicKey | null {
    return this._kp?.publicKey ?? null;
  }
  get connecting(): boolean {
    return this._connecting;
  }
  get readyState(): WalletReadyState {
    return typeof window === "undefined"
      ? WalletReadyState.Unsupported
      : WalletReadyState.Installed;
  }

  async connect(): Promise<void> {
    this._connecting = true;
    try {
      // Idempotent, but always re-emit: React StrictMode remounts the provider and a
      // second connect() must still tell the new listeners we are connected.
      this._kp ??= loadGuestKeypair();
      this.emit("connect", this._kp.publicKey);
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    this._kp = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends TransactionOrVersionedTransaction<this["supportedTransactionVersions"]>>(
    tx: T,
  ): Promise<T> {
    if (!this._kp) throw new Error("Guest wallet not connected");
    if (tx instanceof Transaction) tx.partialSign(this._kp);
    else (tx as VersionedTransaction).sign([this._kp]);
    return tx;
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this._kp) throw new Error("Guest wallet not connected");
    return nacl.sign.detached(message, this._kp.secretKey);
  }
}
