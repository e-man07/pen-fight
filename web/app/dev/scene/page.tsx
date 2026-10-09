"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { angleToward, simulateFlick, spawn, type Pens } from "@/lib/sim";
import type { FlickEvent } from "@/components/scene/Scene";

const Scene = dynamic(() => import("@/components/scene/Scene"), {
  ssr: false,
  loading: () => <div style={{ color: "#fff", padding: 20 }}>Loading scene...</div>,
});

const randSeed = () => BigInt(Math.floor(Math.random() * 2 ** 32)) | (BigInt(Math.floor(Math.random() * 2 ** 32)) << 32n);

export default function DevScenePage() {
  if (process.env.NODE_ENV === "production") {
    return <div style={{ padding: 40, fontFamily: "system-ui" }}>404 - not found</div>;
  }
  return <DevSceneClient />;
}

const btn: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid #fff6",
  background: "#000a",
  color: "#fff",
  cursor: "pointer",
  font: "13px system-ui",
};

// client-only (reads the URL for the optional ?w=&h= preview box)
const DevSceneClient = dynamic(() => Promise.resolve(DevScene), { ssr: false });

function DevScene() {
  const [players] = useState(() => {
    const n = Number(new URLSearchParams(window.location.search).get("players"));
    return n >= 2 && n <= 4 ? n : 2;
  });
  const [seat, setSeat] = useState(() => {
    const q = Number(new URLSearchParams(window.location.search).get("seat"));
    return q >= 0 && q < players ? q : 0;
  });
  const [pens, setPens] = useState<Pens>(() => spawn(1234n, players));
  const [resetKey, setResetKey] = useState("r0");
  const [flick, setFlick] = useState<FlickEvent | null>(null);
  const [turn, setTurn] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const [score, setScore] = useState<number[]>(() => Array(players).fill(0));
  const [round, setRound] = useState(1);
  const [winner, setWinner] = useState<number | "draw" | null>(null);
  const [log, setLog] = useState("drag on the desk to flick");
  const [bot, setBot] = useState(true);

  const st = useRef({ pens, seat, turn, busy, winner, bot, score, round });
  useEffect(() => {
    st.current = { pens, seat, turn, busy, winner, bot, score, round };
  });
  const idc = useRef(0);
  const pendingEnd = useRef<Pens | null>(null);
  const flickWho = useRef(0);

  const doFlick = useCallback((who: number, angle: number, power: number) => {
    const pre = st.current.pens;
    const sim = simulateFlick(pre, who, angle, power);
    const ev: FlickEvent = { id: `f${++idc.current}`, pre, who, angle, power };
    pendingEnd.current = sim.final;
    flickWho.current = who;
    setBusy(true);
    setTurn(null);
    setPens(sim.final);
    setFlick(ev);
  }, []);

  /** next living seat after `from` */
  const nextAlive = (ps: Pens, from: number) => {
    for (let k = 1; k <= ps.length; k++) {
      const i = (from + k) % ps.length;
      if (!ps[i].out) return i;
    }
    return from;
  };

  const botMove = useCallback(
    (who: number) => {
      const s = st.current;
      const me = s.pens[who];
      if (!me || me.out) return;
      let best = -1;
      let bd = 1e12;
      s.pens.forEach((p, i) => {
        if (i === who || p.out) return;
        const d = Math.hypot(p.x - me.x, p.z - me.z);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (best < 0) return;
      const ang = (angleToward(me, s.pens[best]) + Math.round((Math.random() - 0.5) * 24) + 720) % 720;
      doFlick(who, ang, 35 + Math.floor(Math.random() * 55));
    },
    [doFlick],
  );
  const botMoveRef = useRef(botMove);
  useEffect(() => {
    botMoveRef.current = botMove;
  });

  const afterTurn = useCallback((ps: Pens, who: number) => {
    const next = nextAlive(ps, who);
    setTurn(next);
    if (next !== st.current.seat && st.current.bot) setTimeout(() => botMoveRef.current(next), 1500);
  }, []);

  const onEnd = useCallback(
    (id: string) => {
      void id;
      const fin = pendingEnd.current;
      setBusy(false);
      if (!fin) return;
      const alive = fin.map((p, i) => (p.out ? -1 : i)).filter((i) => i >= 0);
      if (alive.length <= 1) {
        const w: number | "draw" = alive.length === 1 ? alive[0] : "draw";
        setWinner(w);
        if (w !== "draw") setScore((sc) => sc.map((v, i) => (i === w ? v + 1 : v)));
        setTurn(null);
        setLog(`round over: seat ${w}`);
        return;
      }
      afterTurn(fin, flickWho.current);
    },
    [afterTurn],
  );

  const newRound = () => {
    const p = spawn(randSeed(), players);
    pendingEnd.current = null;
    setFlick(null);
    setPens(p);
    setResetKey(`r${Date.now()}`);
    setWinner(null);
    setRound((r) => r + 1);
    setBusy(false);
    setTurn(0);
    if (st.current.seat !== 0 && st.current.bot) setTimeout(() => botMoveRef.current(0), 2500);
  };

  const canAim = turn === seat && !busy && winner === null;

  const [mode] = useState<"game" | "lobby">(() => (new URLSearchParams(window.location.search).get("mode") === "lobby" ? "lobby" : "game"));
  const [box] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    const w = Number(q.get("w"));
    const h = Number(q.get("h"));
    return w > 0 && h > 0 ? { width: w, height: h } : null;
  });
  return (
    <div
      style={
        box
          ? { position: "fixed", left: 0, top: 0, width: box.width, height: box.height, background: "#222" }
          : { position: "fixed", inset: 0, background: "#222" }
      }
    >
      <Scene
        mode={mode}
        seat={seat}
        playerCount={players}
        names={["aman", "bunty", "carol", "dave"].slice(0, players)}
        score={score}
        targetWins={3}
        round={round}
        pens={pens}
        resetKey={resetKey}
        flick={flick}
        onFlickAnimationEnd={onEnd}
        turn={winner === null ? turn : null}
        canAim={canAim}
        onFlick={(a, p) => {
          setLog(`onFlick angle=${a} (${(a / 2).toFixed(1)} deg) power=${p}`);
          doFlick(seat, a, p);
        }}
        roundWinner={winner}
      />
      <div style={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 6, flexWrap: "wrap", maxWidth: "95%" }}>
        <button style={btn} onClick={() => setSeat((s) => (s + 1) % players)}>
          Seat: {seat}
        </button>
        <button style={btn} onClick={newRound}>
          New round
        </button>
        <button style={btn} onClick={() => setBot((b) => !b)}>
          Bot: {bot ? "on" : "off"}
        </button>
        {Array.from({ length: players }).map((_, i) => (
          <button key={i} style={btn} onClick={() => setWinner(i)}>
            Seat{i} wins
          </button>
        ))}
        <button style={btn} onClick={() => turn !== null && turn !== seat && botMove(turn)}>
          Bot flick
        </button>
        <button style={btn} onClick={() => setWinner("draw")}>
          Draw
        </button>
        <button style={btn} onClick={() => setWinner(null)}>
          Clear
        </button>
        <button style={btn} onClick={() => setTurn(seat)}>
          My turn
        </button>
      </div>
      <div style={{ position: "absolute", bottom: 8, left: 8, color: "#fff", font: "13px monospace", textShadow: "0 1px 2px #000" }}>
        turn={String(turn)} busy={String(busy)} canAim={String(canAim)} | {log}
      </div>
    </div>
  );
}
