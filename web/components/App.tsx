"use client";

import Image from "next/image";
import { useCallback, useState, useSyncExternalStore } from "react";
import type { LocalConfig } from "@/lib/localMatch";
import { useGameClient } from "@/lib/useGameClient";
import { ClassroomBackdrop } from "./ClassroomBackdrop";
import { GameScreen } from "./GameScreen";
import { Lobby } from "./Lobby";
import { SoundToggle } from "./SoundToggle";
import { WalletButton } from "./WalletButton";

const NAV_EVENT = "pf-nav";

function subscribeNav(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener(NAV_EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(NAV_EVENT, cb);
  };
}

const getSearch = () => window.location.search;
const getServerSearch = () => "";

function parseGameParam(search: string): bigint | null {
  const v = new URLSearchParams(search).get("game");
  return v && /^\d+$/.test(v) ? BigInt(v) : null;
}

function navigate(url: string) {
  window.history.pushState({}, "", url);
  window.dispatchEvent(new Event(NAV_EVENT));
}

function AppInner() {
  const client = useGameClient();
  const search = useSyncExternalStore(subscribeNav, getSearch, getServerSearch);
  const gameId = parseGameParam(search);

  // A practice match vs bots lives only in memory (no URL, no wallet needed).
  const [local, setLocal] = useState<LocalConfig | null>(null);

  const enter = useCallback((id: bigint) => navigate(`/?game=${id}`), []);
  const exit = useCallback(() => {
    setLocal(null);
    navigate("/");
  }, []);
  const playLocal = useCallback(
    (cfg: Omit<LocalConfig, "nonce">) => setLocal({ ...cfg, nonce: Date.now() }),
    [],
  );
  const rematch = useCallback(
    () => setLocal((l) => (l ? { ...l, nonce: Date.now() } : l)),
    [],
  );

  if (local) {
    return (
      <GameScreen
        key={`local:${local.nonce}`}
        client={client}
        gameId={null}
        local={local}
        onExit={exit}
        onRematch={rematch}
      />
    );
  }

  if (gameId !== null && client) {
    return <GameScreen key={`${client.me.toBase58()}:${gameId}`} client={client} gameId={gameId} onExit={exit} />;
  }

  const names = ["Alice", "Bob"];

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-board-deep">
      <ClassroomBackdrop names={names} />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 p-3 sm:p-5">
        <button
          onClick={exit}
          aria-label="Pen Fight home"
          className="pointer-events-auto transition hover:scale-105"
        >
          <Image
            src="/logo.png"
            alt="Pen Fight"
            width={560}
            height={441}
            priority
            className="h-20 w-auto drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)] sm:h-32"
          />
        </button>
        <div className="pointer-events-auto">
          <WalletButton />
        </div>
      </header>

      <div className="pointer-events-none absolute inset-0 z-10 flex items-end justify-center p-3 pt-20 sm:items-center sm:justify-start sm:p-10">
        {gameId !== null && !client ? (
          <div className="glass pop-in pointer-events-auto w-full max-w-sm p-5 text-center">
            <h2 className="font-hand text-3xl">You&apos;ve been challenged!</h2>
            <p className="font-hand mt-1 text-lg text-chalk/80">
              Connect a Solana wallet to join this match.
            </p>
            <div className="mt-3 flex justify-center">
              <WalletButton />
            </div>
            <button className="btn btn-sm btn-ghost mt-3" onClick={exit}>
              Back to lobby
            </button>
          </div>
        ) : (
          <Lobby client={client} onEnter={enter} onPlayLocal={playLocal} />
        )}
      </div>

      <div className="pointer-events-none absolute bottom-2 right-3 z-10 hidden text-[0.7rem] text-chalk/50 sm:block">
        MagicBlock Ephemeral Rollups · Solana {process.env.NEXT_PUBLIC_CLUSTER === "local" ? "localnet" : "devnet"}
      </div>
    </div>
  );
}

export function App() {
  // One ambience instance for the whole app, so the sound carries from lobby into the game.
  return (
    <>
      <AppInner />
      <SoundToggle />
    </>
  );
}
