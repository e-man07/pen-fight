import { Buffer } from "buffer";

// @solana/web3.js and Anchor expect a global Buffer in the browser.
if (typeof globalThis !== "undefined" && !(globalThis as { Buffer?: unknown }).Buffer) {
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
}
