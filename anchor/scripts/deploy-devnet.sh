#!/bin/bash
# Deploy the pen-fight program to Solana devnet.
#
#   WALLET=~/.config/solana/id.json ./scripts/deploy-devnet.sh
#
# The wallet pays ~3 SOL of rent and becomes the upgrade authority, so use a wallet
# you control. Get devnet SOL from https://faucet.solana.com if needed.
# After deploying, nothing else is required: the web app talks to the program id baked
# into web/lib/game.ts (matches target/deploy/pen_fight-keypair.json).
set -e
cd "$(dirname "$0")/.."
WALLET="${WALLET:-$HOME/.config/solana/id.json}"
ANCHOR="${ANCHOR:-$HOME/.avm/bin/anchor-1.0.2}"
RPC="${RPC:-https://api.devnet.solana.com}"

echo "Wallet:  $(solana-keygen pubkey "$WALLET")"
echo "Program: $(solana-keygen pubkey target/deploy/pen_fight-keypair.json)"
echo "Balance: $(solana balance --url "$RPC" -k "$WALLET")"
read -r -p "Deploy to $RPC? [y/N] " ok
[ "$ok" = "y" ] || exit 1

"$ANCHOR" build
solana program deploy target/deploy/pen_fight.so \
  --program-id target/deploy/pen_fight-keypair.json \
  --url "$RPC" -k "$WALLET"
echo "Deployed. Program id: $(solana-keygen pubkey target/deploy/pen_fight-keypair.json)"
