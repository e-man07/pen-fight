# shellcheck shell=sh
# Local MagicBlock cluster endpoints (source this, don't execute it).
#   client -> base validator (8899) / ER validator (7799)
# Wallet: set PEN_FIGHT_WALLET to use a keypair other than ~/.config/solana/id.json.
export PROVIDER_ENDPOINT=http://localhost:8899
export WS_ENDPOINT=ws://localhost:8900
export EPHEMERAL_PROVIDER_ENDPOINT=http://localhost:7799
export EPHEMERAL_WS_ENDPOINT=ws://localhost:7800
export ANCHOR_PROVIDER_URL=$PROVIDER_ENDPOINT
export ANCHOR_WALLET="${PEN_FIGHT_WALLET:-$HOME/.config/solana/id.json}"
# Local ER validator identity (the `validator` arg when delegating).
export VALIDATOR=mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev
# VRF queues: local oracle index 0 on base, index 1 delegated on the ER.
export VRF_BASE_QUEUE="GKE6d7iv8kCBrsxr78W3xVdjGLLLJnxsGiuzrsZCGEvb"
export VRF_EPHEMERAL_QUEUE="Sc9MJUngNbQXSXGP3F67KvKwVnhaYn6kcioxXNVowYT"
