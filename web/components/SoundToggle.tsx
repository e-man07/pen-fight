"use client";

import { useEffect, useRef, useState } from "react";
import { Ambience } from "@/lib/ambience";

/** Background music: starts on the first interaction, with a clear on-screen mute button. */
export function SoundToggle() {
  const amb = useRef<Ambience | null>(null);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const a = new Ambience();
    amb.current = a;
    // The persisted preference only exists on the client.
    const t = setTimeout(() => setMuted(a.muted), 0);
    const start = () => a.start();
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      a.dispose();
      amb.current = null;
    };
  }, []);

  const toggle = () => {
    const a = amb.current;
    if (!a) return;
    a.start(); // harmless if already started
    a.setMuted(!a.muted);
    setMuted(a.muted);
  };

  return (
    <button
      onClick={toggle}
      aria-pressed={muted}
      aria-label={muted ? "Turn music on" : "Mute music"}
      title={muted ? "Turn music on" : "Mute music"}
      className="glass font-hand fixed bottom-8 right-3 z-40 flex items-center gap-2 !rounded-full px-4 py-2 text-lg leading-none text-chalk transition hover:brightness-125"
    >
      <span className="text-xl">{muted ? "🔇" : "🎵"}</span>
      <span>{muted ? "Music off" : "Music on"}</span>
    </button>
  );
}
