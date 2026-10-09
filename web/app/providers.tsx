"use client";

import "@/lib/polyfills";
import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { BASE_RPC } from "@/lib/config";
import { GuestWalletAdapter } from "@/lib/burner";

export function Providers({ children }: { children: React.ReactNode }) {
  // Phantom, Solflare, Backpack and other installed wallets are discovered through the
  // Wallet Standard; the Guest Wallet is an extra, no-install option for demos.
  const wallets = useMemo(
    () => (process.env.NEXT_PUBLIC_GUEST_WALLET === "0" ? [] : [new GuestWalletAdapter()]),
    [],
  );
  return (
    <ConnectionProvider endpoint={BASE_RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
