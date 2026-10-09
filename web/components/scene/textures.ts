import * as THREE from "three";
import { SEAT_COLORS } from "@/lib/seats";

/** Small seeded RNG so procedural textures are identical on every load. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

export function canvasTex(
  w: number,
  h: number,
  draw: (g: Ctx, w: number, h: number) => void,
  repeat?: [number, number],
  srgb = true,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

export const CHALK_FONT = "'Segoe Print','Bradley Hand','Chalkboard SE','Comic Sans MS',cursive";

function carve(g: Ctx, text: string, x: number, y: number, rot: number, size: number, col = "rgba(120,70,30,0.55)") {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.font = `bold ${size}px ${CHALK_FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(255,245,220,0.55)";
  g.fillText(text, 1.8, 1.8);
  g.fillStyle = col;
  g.fillText(text, 0, 0);
  g.restore();
}

function star(g: Ctx, x: number, y: number, r: number, rot: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}

export function makeDeskTexture(): THREE.CanvasTexture {
  return canvasTex(1024, 2048, (g, w, h) => {
    const r = rng(7);
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "#e2a35c");
    grad.addColorStop(0.5, "#eeb86f");
    grad.addColorStop(1, "#dd9d56");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    // soft sheen blotches
    for (let i = 0; i < 26; i++) {
      const x = r() * w;
      const y = r() * h;
      const rad = 150 + r() * 300;
      const rg = g.createRadialGradient(x, y, 0, x, y, rad);
      rg.addColorStop(0, r() > 0.5 ? "rgba(255,240,205,0.22)" : "rgba(200,140,80,0.10)");
      rg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = rg;
      g.fillRect(0, 0, w, h);
    }
    // light grain
    for (let i = 0; i < 380; i++) {
      let x = r() * w;
      g.strokeStyle = `rgba(190,130,70,${0.04 + r() * 0.09})`;
      g.lineWidth = 0.6 + r() * 1.6;
      g.beginPath();
      g.moveTo(x, 0);
      const ph = r() * 6;
      for (let y = 0; y <= h; y += 64) {
        x += Math.sin(y * 0.005 + ph) * 1.2 + (r() - 0.5);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // few light scratches
    for (let i = 0; i < 40; i++) {
      const x = r() * w;
      const y = r() * h;
      const a = (r() - 0.5) * 1.0 + Math.PI / 2;
      const l = 40 + r() * 140;
      g.strokeStyle = `rgba(255,248,230,${0.22 + r() * 0.25})`;
      g.lineWidth = 1 + r();
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    // colour inlay border (coral outer, teal inner)
    g.lineJoin = "round";
    g.strokeStyle = "#ff6f61";
    g.lineWidth = 16;
    g.strokeRect(34, 34, w - 68, h - 68);
    g.strokeStyle = "#27c1b3";
    g.lineWidth = 8;
    g.strokeRect(62, 62, w - 124, h - 124);
    g.strokeStyle = "#ffd23f";
    g.lineWidth = 4;
    g.setLineDash([22, 18]);
    g.strokeRect(80, 80, w - 160, h - 160);
    g.setLineDash([]);
    // arena centre line + ring
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = 6;
    g.setLineDash([34, 26]);
    g.beginPath();
    g.moveTo(110, h / 2);
    g.lineTo(w - 110, h / 2);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.arc(w / 2, h / 2, 70, 0, 6.28);
    g.stroke();
    // marker doodles
    const cols = ["#ff6f91", "#6c8cff", "#34c7a5", "#ffb703", "#a77bff"];
    for (let i = 0; i < 16; i++) {
      const x = 140 + r() * (w - 280);
      const y = 140 + r() * (h - 280);
      if (Math.abs(y - h / 2) < 120) continue;
      g.strokeStyle = cols[i % cols.length];
      g.globalAlpha = 0.5;
      g.lineWidth = 5;
      g.lineCap = "round";
      if (i % 3 === 0) {
        star(g, x, y, 22 + r() * 12, r());
        g.stroke();
      } else if (i % 3 === 1) {
        g.beginPath();
        for (let k = 0; k < 40; k++) {
          const a = k * 0.5;
          g.lineTo(x + Math.cos(a) * (3 + k * 0.7), y + Math.sin(a) * (3 + k * 0.7));
        }
        g.stroke();
      } else {
        g.beginPath();
        g.moveTo(x - 24, y);
        g.quadraticCurveTo(x, y - 30, x + 24, y);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    // tasteful carvings
    carve(g, "LAST BENCH", 940, 1000, Math.PI / 2, 56);
    carve(g, "AJ", 860, 1850, -0.7, 84, "rgba(255,111,97,0.8)");
    carve(g, "Raju", 230, 1780, -Math.PI / 2 + 0.2, 70);
    carve(g, "galu", 150, 1290, -Math.PI / 2, 52);
    carve(g, "#", 200, 380, 0, 90);
    carve(g, "X O X", 200, 470, 0, 30);
    carve(g, "♥", 520, 1240, 0.3, 54, "rgba(255,90,130,0.85)");
    carve(g, "↑", 780, 1100, 0.2, 66);
    carve(g, "→", 500, 770, 0.1, 56);
    carve(g, "IX-A", 460, 1940, 0, 38);
    carve(g, "RK + PM", 780, 540, -0.3, 34, "rgba(108,140,255,0.85)");
    // ink dot cluster + mug ring
    for (let i = 0; i < 18; i++) {
      const a = r() * 6.28;
      const d = r() * r() * 30;
      g.fillStyle = `rgba(60,70,170,${0.3 + r() * 0.4})`;
      g.beginPath();
      g.arc(740 + Math.cos(a) * d, 1370 + Math.sin(a) * d, 2 + r() * 5, 0, 6.28);
      g.fill();
    }
    g.strokeStyle = "rgba(170,100,50,0.4)";
    g.lineWidth = 7;
    g.beginPath();
    g.arc(310, 640, 50, 0, 6.28);
    g.stroke();
  });
}

export function makeFloorTexture(): THREE.CanvasTexture {
  return canvasTex(1024, 1024, (g, w, h) => {
    const r = rng(3);
    const tones = ["#f6dfb5", "#f1d4a2", "#f9e6c4", "#efcd98", "#f4d9ac"];
    const pw = w / 8;
    for (let i = 0; i < 8; i++) {
      let y = -r() * 300;
      while (y < h) {
        const len = 260 + r() * 260;
        g.fillStyle = tones[Math.floor(r() * tones.length)];
        g.fillRect(i * pw, y, pw, len);
        // grain
        for (let k = 0; k < 7; k++) {
          g.strokeStyle = `rgba(190,140,80,${0.06 + r() * 0.08})`;
          g.lineWidth = 1 + r();
          const x = i * pw + 8 + r() * (pw - 16);
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + (r() - 0.5) * 10, y + len);
          g.stroke();
        }
        g.fillStyle = "rgba(150,100,50,0.35)";
        g.fillRect(i * pw, y, pw, 3);
        y += len;
      }
      g.fillStyle = "rgba(150,100,50,0.35)";
      g.fillRect(i * pw, 0, 3, h);
    }
    const sh = g.createLinearGradient(0, 0, w, h);
    sh.addColorStop(0, "rgba(255,255,255,0.14)");
    sh.addColorStop(1, "rgba(255,200,150,0.05)");
    g.fillStyle = sh;
    g.fillRect(0, 0, w, h);
  }, [4, 3]);
}

export function makeWallTexture(base: string, dots = "rgba(255,255,255,0.18)"): THREE.CanvasTexture {
  return canvasTex(256, 256, (g, w, h) => {
    const r = rng(11);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const x = r() * w;
      const y = r() * h;
      const rg = g.createRadialGradient(x, y, 0, x, y, 40 + r() * 70);
      rg.addColorStop(0, dots);
      rg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = rg;
      g.fillRect(0, 0, w, h);
    }
  }, [6, 3]);
}

export function makeSkyTexture(): THREE.CanvasTexture {
  return canvasTex(256, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "#7cc4ff");
    gr.addColorStop(1, "#e9f7ff");
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,0.9)";
    const cl = (x: number, y: number, s: number) => {
      for (const [dx, dy, rr] of [[0, 0, 26], [28, -8, 32], [58, 2, 24], [26, 10, 28]]) {
        g.beginPath();
        g.arc(x + dx * s, y + dy * s, rr * s, 0, 6.28);
        g.fill();
      }
    };
    cl(40, 150, 1);
    cl(150, 90, 0.8);
    cl(120, 210, 0.7);
  });
}

export function makePosterTexture(kind: "chart" | "map" | "space" | "abc" | "art"): THREE.CanvasTexture {
  return canvasTex(256, 340, (g, w, h) => {
    const bg = { chart: "#fff3c4", map: "#d9f3ff", space: "#2b2a6b", abc: "#ffe0ec", art: "#e3ffe9" }[kind];
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.lineWidth = 10;
    g.strokeStyle = { chart: "#ff9f1c", map: "#2ec4b6", space: "#ff6f91", abc: "#a77bff", art: "#ffb703" }[kind];
    g.strokeRect(5, 5, w - 10, h - 10);
    g.textAlign = "center";
    g.font = `bold 30px ${CHALK_FONT}`;
    g.fillStyle = kind === "space" ? "#ffe27a" : "#3a2c5c";
    g.fillText({ chart: "TABLES", map: "INDIA", space: "SPACE", abc: "ABC", art: "ART" }[kind], w / 2, 52);
    if (kind === "chart") {
      g.font = `20px ${CHALK_FONT}`;
      const c = ["#ff6f91", "#6c8cff", "#34c7a5", "#ff9f1c"];
      for (let i = 1; i <= 9; i++) {
        g.fillStyle = c[i % 4];
        g.fillText(`7 x ${i} = ${7 * i}`, w / 2, 70 + i * 28);
      }
    } else if (kind === "map") {
      g.fillStyle = "#ffb703";
      g.beginPath();
      g.moveTo(70, 90);
      g.lineTo(190, 100);
      g.lineTo(215, 150);
      g.lineTo(172, 210);
      g.lineTo(142, 310);
      g.lineTo(112, 215);
      g.lineTo(58, 155);
      g.closePath();
      g.fill();
      g.fillStyle = "#ff6f91";
      g.beginPath();
      g.arc(130, 170, 8, 0, 6.28);
      g.fill();
    } else if (kind === "space") {
      g.fillStyle = "#ffd23f";
      g.beginPath();
      g.arc(128, 160, 34, 0, 6.28);
      g.fill();
      const pl: [number, number, string][] = [[60, 160, "#6c8cff"], [190, 130, "#ff6f91"], [200, 240, "#34c7a5"], [70, 260, "#a77bff"]];
      for (const [x, y, c] of pl) {
        g.fillStyle = c;
        g.beginPath();
        g.arc(x, y, 14, 0, 6.28);
        g.fill();
      }
      g.fillStyle = "#fff";
      for (let i = 0; i < 30; i++) g.fillRect(((i * 97) % 240) + 8, ((i * 53) % 280) + 60, 2, 2);
    } else if (kind === "abc") {
      g.font = `bold 70px ${CHALK_FONT}`;
      const c = ["#ff6f91", "#6c8cff", "#34c7a5", "#ff9f1c"];
      "ABCD".split("").forEach((ch, i) => {
        g.fillStyle = c[i];
        g.fillText(ch, 66 + (i % 2) * 124, 140 + Math.floor(i / 2) * 100);
      });
    } else {
      const c = ["#ff6f91", "#6c8cff", "#34c7a5", "#ffb703", "#a77bff"];
      for (let i = 0; i < 9; i++) {
        g.fillStyle = c[i % 5];
        g.beginPath();
        g.arc(60 + (i % 3) * 68, 110 + Math.floor(i / 3) * 70, 26, 0, 6.28);
        g.fill();
      }
    }
  });
}

export function makeShelfTexture(): THREE.CanvasTexture {
  return canvasTex(256, 256, (g, w, h) => {
    const r = rng(5);
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, w, h);
    const cols = ["#ff6f91", "#6c8cff", "#34c7a5", "#ffb703", "#a77bff", "#ff8a5b", "#2ec4b6", "#4d9de0"];
    const rows = 4;
    const rh = h / rows;
    for (let k = 0; k < rows; k++) {
      g.fillStyle = "#f3ece2";
      g.fillRect(0, k * rh, w, rh);
      let x = 6;
      while (x < w - 14) {
        const bw = 10 + r() * 14;
        const bh = rh * (0.6 + r() * 0.32);
        g.fillStyle = cols[Math.floor(r() * cols.length)];
        g.fillRect(x, k * rh + rh - 8 - bh, bw, bh);
        g.fillStyle = "rgba(255,255,255,0.5)";
        g.fillRect(x + 2, k * rh + rh - 8 - bh + 6, bw - 4, 3);
        x += bw + 1.5;
      }
      g.fillStyle = "#b98a5a";
      g.fillRect(0, k * rh + rh - 8, w, 8);
    }
  });
}

export function makeGlobeTexture(): THREE.CanvasTexture {
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = "#4db6ff";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#7bd88f";
    const r = rng(2);
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.ellipse(r() * w, 20 + r() * (h - 40), 14 + r() * 24, 8 + r() * 14, r(), 0, 6.28);
      g.fill();
    }
    g.strokeStyle = "rgba(255,255,255,0.35)";
    for (let i = 0; i < 8; i++) {
      g.beginPath();
      g.moveTo(0, (i * h) / 8);
      g.lineTo(w, (i * h) / 8);
      g.stroke();
    }
  });
}

export function makeScreenTexture(hue: number): THREE.CanvasTexture {
  return canvasTex(128, 80, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, `hsl(${hue},85%,62%)`);
    gr.addColorStop(1, `hsl(${(hue + 60) % 360},85%,68%)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,0.8)";
    g.fillRect(12, 14, 50, 6);
    g.fillRect(12, 28, 80, 4);
    g.fillRect(12, 38, 64, 4);
    g.fillStyle = "rgba(255,255,255,0.5)";
    g.fillRect(12, 52, 30, 14);
    g.fillRect(48, 52, 30, 14);
  });
}

export function makeBeamTexture(): THREE.CanvasTexture {
  return canvasTex(64, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "rgba(255,245,210,0.55)");
    gr.addColorStop(1, "rgba(255,245,210,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    const gx = g.createLinearGradient(0, 0, w, 0);
    gx.addColorStop(0, "rgba(0,0,0,1)");
    gx.addColorStop(0.5, "rgba(0,0,0,0)");
    gx.addColorStop(1, "rgba(0,0,0,1)");
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = gx;
    g.fillRect(0, 0, w, h);
  }, undefined, true);
}

let softTex: THREE.CanvasTexture | null = null;
export function getSoftDot(): THREE.CanvasTexture {
  if (softTex) return softTex;
  softTex = canvasTex(64, 64, (g, w, h) => {
    const rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    rg.addColorStop(0, "rgba(255,255,255,1)");
    rg.addColorStop(0.4, "rgba(255,255,255,0.55)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, w, h);
  });
  return softTex;
}

let aoTex: THREE.CanvasTexture | null = null;
/** Soft tinted contact-shadow blob (fake AO). */
export function getAOTexture(): THREE.CanvasTexture {
  if (aoTex) return aoTex;
  aoTex = canvasTex(128, 128, (g, w, h) => {
    const rg = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    rg.addColorStop(0, "rgba(70,40,120,0.55)");
    rg.addColorStop(0.6, "rgba(70,40,120,0.22)");
    rg.addColorStop(1, "rgba(70,40,120,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, w, h);
  });
  return aoTex;
}

export function makeToonGradient(steps = 4): THREE.DataTexture {
  const data = new Uint8Array(steps * 4);
  for (let i = 0; i < steps; i++) {
    const v = Math.round(150 + (105 * i) / (steps - 1));
    data.set([v, Math.min(255, v + 6), 255, 255], i * 4);
  }
  const t = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

export interface BoardData {
  names: string[];
  score: number[];
  targetWins: number;
  round: number;
}

function neon(g: Ctx, text: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "left", glow = 14) {
  g.font = `${size}px ${CHALK_FONT}`;
  g.textAlign = align;
  g.textBaseline = "alphabetic";
  g.save();
  g.shadowColor = color;
  g.shadowBlur = glow;
  g.fillStyle = color;
  g.fillText(text, x, y);
  g.shadowBlur = 0;
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.fillText(text, x, y);
  g.restore();
  g.fillStyle = color;
  g.fillText(text, x, y);
}

function line(g: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, w = 4) {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.lineCap = "round";
  g.shadowColor = color;
  g.shadowBlur = 10;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
  g.shadowBlur = 0;
}

const tint = (hex: string, k = 0.42) => new THREE.Color(hex).lerp(new THREE.Color("#ffffff"), k).getStyle();

export const BOARD_W = 1200;
export const BOARD_H = 560;

export function drawBoard(g: Ctx, d: BoardData) {
  const w = BOARD_W;
  const h = BOARD_H;
  g.clearRect(0, 0, w, h);
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#0f5560");
  bg.addColorStop(1, "#0a3a4d");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const rg = g.createRadialGradient(w * 0.45, h * 0.4, 20, w * 0.45, h * 0.4, w * 0.7);
  rg.addColorStop(0, "rgba(120,240,230,0.20)");
  rg.addColorStop(1, "rgba(120,240,230,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, w, h);

  const now = new Date();
  const dateStr = `${now.getDate()}/${now.getMonth() + 1}`;
  const short = (s: string) => (s.length > 11 ? s.slice(0, 10) + "…" : s);

  neon(g, "Std. 9 - A", 40, 62, 36, "#f4fbff", "left", 6);
  neon(g, "Sub : Maths", 40, 106, 34, "#9ff0e4", "left", 6);
  neon(g, `Date : ${dateStr}`, w - 40, 62, 32, "#f4fbff", "right", 6);
  neon(g, "Thought for the Day :", 560, 70, 38, "#ffe27a", "center", 8);
  neon(g, "“ Practice makes a man perfect ”", 560, 120, 34, "#f4fbff", "center", 6);

  const n = Math.max(2, Math.min(4, d.names.length || 2));
  const compact = n > 2;
  neon(g, "PEN FIGHT", 60, compact ? 196 : 238, compact ? 72 : 86, "#ffe27a", "left", 22);
  line(g, 55, compact ? 208 : 254, 450, compact ? 208 : 254, "#ff9ec7", 5);
  if (d.targetWins >= 1) neon(g, `best of ${2 * d.targetWins - 1}`, 62, compact ? 244 : 296, compact ? 28 : 32, "#9ff0e4", "left", 6);
  neon(g, `Round ${d.round}`, 330, compact ? 244 : 296, compact ? 28 : 32, "#9ff0e4", "left", 6);

  const rowY = (i: number) => (compact ? 306 + i * (n === 3 ? 74 : 62) : [376, 456][i]);
  const nameSize = compact ? (n === 4 ? 42 : 48) : 54;
  const scoreSize = compact ? 52 : 70;
  const bx = compact ? 34 : 42;
  for (let i = 0; i < n; i++) {
    const y = rowY(i);
    const col = tint(SEAT_COLORS[i] ?? "#ffffff");
    neon(g, short(d.names[i] || `Player ${i + 1}`), 60, y, nameSize, col, "left", 10);
    neon(g, String(d.score[i] ?? 0), 420, y, scoreSize, "#f4fbff", "center", 8);
    const boxes = Math.max(1, Math.min(d.targetWins, 7));
    for (let b = 0; b < boxes; b++) {
      const x0 = 480 + b * (bx + 12);
      g.strokeStyle = col;
      g.lineWidth = 4;
      g.shadowColor = col;
      g.shadowBlur = 8;
      g.strokeRect(x0, y - bx, bx, bx);
      g.shadowBlur = 0;
      if (b < (d.score[i] ?? 0)) {
        g.fillStyle = col;
        g.globalAlpha = 0.35;
        g.fillRect(x0, y - bx, bx, bx);
        g.globalAlpha = 1;
        line(g, x0 + 7, y - bx + 7, x0 + bx - 7, y - 7, "#ffffff", 5);
        line(g, x0 + bx - 7, y - bx + 7, x0 + 7, y - 7, "#ffffff", 5);
      }
    }
  }
  g.strokeStyle = "rgba(244,251,255,0.3)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(780, 330);
  g.lineTo(880, 250);
  g.lineTo(960, 330);
  g.closePath();
  g.stroke();
  neon(g, "♥", 880, 478, 54, "#ff9ec7", "center", 12);

  line(g, 900, 150, 900, 520, "rgba(159,240,228,0.6)", 3);
  neon(g, "H.W.", 930, 200, 46, "#ffe27a", "left", 10);
  line(g, 925, 214, 1010, 214, "#ffe27a", 3);
  neon(g, "Ch.4  Q.1 - 5", 930, 262, 31, "#f4fbff", "left", 4);
  neon(g, "Map of India", 930, 306, 31, "#f4fbff", "left", 4);
  g.globalAlpha = 0.5;
  neon(g, "Essay - rain", 930, 350, 28, "#f4fbff", "left", 2);
  g.globalAlpha = 1;
  line(g, 925, 340, 1100, 340, "rgba(244,251,255,0.5)", 3);
  neon(g, "Monitor : Rinku", w - 40, 520, 29, "#9ff0e4", "right", 6);
}

let blobTex: THREE.CanvasTexture | null = null;
export function getBlobTexture(): THREE.CanvasTexture {
  if (blobTex) return blobTex;
  blobTex = canvasTex(128, 64, (g, w, h) => {
    const rg = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    rg.addColorStop(0, "rgba(60,30,110,0.6)");
    rg.addColorStop(1, "rgba(60,30,110,0)");
    g.save();
    g.translate(w / 2, h / 2);
    g.scale(1, h / w);
    g.translate(-w / 2, -w / 2);
    g.fillStyle = rg;
    g.fillRect(0, 0, w, w);
    g.restore();
  });
  return blobTex;
}
