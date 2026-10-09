import { PublicKey } from "@solana/web3.js";

/**
 * Cluster configuration. Defaults target Solana devnet + the MagicBlock devnet
 * Ephemeral Rollup. Set NEXT_PUBLIC_CLUSTER=local to talk to the local cluster
 * started by `anchor/scripts/start-local.sh`.
 */
export type ClusterName = "devnet" | "local";

export const CLUSTER: ClusterName =
  process.env.NEXT_PUBLIC_CLUSTER === "local" ? "local" : "devnet";

const PRESETS = {
  devnet: {
    baseRpc: "https://api.devnet.solana.com",
    baseWs: "wss://api.devnet.solana.com",
    erRpc: "https://devnet-us.magicblock.app",
    erWs: "wss://devnet-us.magicblock.app",
    // US devnet ER validator identity.
    validator: "MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd",
    vrfQueue: "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc",
  },
  local: {
    baseRpc: "http://localhost:8899",
    baseWs: "ws://localhost:8900",
    erRpc: "http://localhost:7799",
    erWs: "ws://localhost:7800",
    validator: "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
    vrfQueue: "Sc9MJUngNbQXSXGP3F67KvKwVnhaYn6kcioxXNVowYT",
  },
} as const;

const preset = PRESETS[CLUSTER];

export const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC || preset.baseRpc;
export const BASE_WS = process.env.NEXT_PUBLIC_BASE_WS || preset.baseWs;
export const ER_RPC = process.env.NEXT_PUBLIC_ER_RPC || preset.erRpc;
export const ER_WS = process.env.NEXT_PUBLIC_ER_WS || preset.erWs;
export const ER_VALIDATOR = new PublicKey(
  process.env.NEXT_PUBLIC_ER_VALIDATOR || preset.validator,
);
export const VRF_QUEUE = new PublicKey(
  process.env.NEXT_PUBLIC_VRF_QUEUE || preset.vrfQueue,
);

export const EXPLORER_CLUSTER = CLUSTER === "local" ? "custom" : "devnet";
export const explorerTx = (sig: string) =>
  CLUSTER === "local"
    ? `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(BASE_RPC)}`
    : `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddress = (addr: string) =>
  CLUSTER === "local"
    ? `https://explorer.solana.com/address/${addr}?cluster=custom&customUrl=${encodeURIComponent(BASE_RPC)}`
    : `https://explorer.solana.com/address/${addr}?cluster=devnet`;
