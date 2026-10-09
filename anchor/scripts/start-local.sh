#!/bin/bash
# Boots a local MagicBlock cluster (base validator + Ephemeral Rollup + VRF oracles)
# with the pen-fight program preloaded. Leave it running, then run the tests or the
# web app against it. Requires:  npm i -g @magicblock-labs/ephemeral-validator
# and a prior `anchor build` (uses target/deploy/pen_fight.so).
set -e
cd "$(dirname "$0")/.."
WALLET="${PEN_FIGHT_WALLET:-$HOME/.config/solana/id.json}"
WALLET_PUBKEY=$(solana-keygen pubkey "$WALLET")
for bin in mb-stack vrf-oracle; do
  command -v $bin >/dev/null || { echo "missing $bin: npm i -g @magicblock-labs/ephemeral-validator"; exit 1; }
done
[ -f target/deploy/pen_fight.so ] || { echo "run: anchor build"; exit 1; }

cleanup() { kill $STACK_PID $VRF_PID $VRF_ER_PID 2>/dev/null || true; }
trap cleanup EXIT

rm -rf ./magicblock-test-storage
RUST_LOG=info mb-stack --reset \
  --account mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev scripts/mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev.json \
  --upgradeable-program target/deploy/pen_fight-keypair.json target/deploy/pen_fight.so "$WALLET_PUBKEY" \
  > mb-stack.log 2>&1 < /dev/null &
STACK_PID=$!
echo "Waiting for the MagicBlock stack..."
for i in $(seq 1 180); do
  grep -q "MagicBlock stack is ready" mb-stack.log 2>/dev/null && break
  kill -0 $STACK_PID 2>/dev/null || { tail -50 mb-stack.log; exit 1; }
  sleep 1
done

VRF_ORACLE_SKIP_PREFLIGHT=true RPC_URL=http://localhost:8899 WEBSOCKET_URL=ws://localhost:8900 \
  RUST_LOG=info vrf-oracle > vrf-oracle.log 2>&1 < /dev/null &
VRF_PID=$!
VRF_ORACLE_SKIP_PREFLIGHT=true RPC_URL=http://localhost:7799 WEBSOCKET_URL=ws://localhost:7800 \
  RUST_LOG=info vrf-oracle > vrf-oracle-er.log 2>&1 < /dev/null &
VRF_ER_PID=$!
sleep 3
echo "Local cluster up: base :8899, ER :7799. Ctrl-C to stop."
wait $STACK_PID
