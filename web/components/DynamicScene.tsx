"use client";

import dynamic from "next/dynamic";

/** The 3D scene is client-only (WebGL), so it is loaded without SSR. */
export const Scene = dynamic(() => import("./scene/Scene"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center font-hand text-2xl text-chalk/70">
      Walking into the classroom…
    </div>
  ),
});
