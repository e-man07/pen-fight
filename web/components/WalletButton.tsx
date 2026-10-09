"use client";

import { useSyncExternalStore } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

const subscribe = () => () => {};

/** The wallet-adapter button renders differently on the server; mount it client-side only. */
export function WalletButton() {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  if (!mounted) return <div className="h-[42px] w-36" />;
  return <WalletMultiButton />;
}
