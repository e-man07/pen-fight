"use client";

import { spawn } from "@/lib/sim";
import { Scene } from "./DynamicScene";

const IDLE_PENS = spawn(0n);
const noop = () => {};

/** The live 3D classroom with idle students, used behind the lobby. */
export function ClassroomBackdrop({ names }: { names: string[] }) {
  return (
    <div className="absolute inset-0">
      <Scene mode="lobby"
        seat={0}
        names={names}
        score={[0, 0]}
        targetWins={2}
        round={1}
        pens={IDLE_PENS}
        resetKey="lobby"
        flick={null}
        turn={null}
        canAim={false}
        onFlick={noop}
        roundWinner={null}
      />
    </div>
  );
}
