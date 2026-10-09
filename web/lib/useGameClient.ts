"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { GameClient } from "./client";

/** A GameClient bound to the connected wallet (null while disconnected). */
export function useGameClient(): GameClient | null {
  const { publicKey, signTransaction } = useWallet();
  return useMemo(() => {
    if (!publicKey || !signTransaction) return null;
    return new GameClient({
      publicKey,
      signTransaction: async <T extends Transaction>(tx: T) => (await signTransaction(tx)) as T,
    });
  }, [publicKey, signTransaction]);
}
