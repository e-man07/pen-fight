use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::{
    anchor::{commit, delegate, ephemeral, vrf, vrf_callback},
    cpi::DelegateConfig,
    ephem::MagicIntentBundleBuilder,
    vrf::{
        instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
        types::SerializableAccountMeta,
    },
};
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};

pub mod sim;
pub mod trig;

use sim::{Pen, MAX_PLAYERS, MAX_POWER};

declare_id!("FYd5yQ5ntHDUsmjrSbkm3EaxnzNpadtfjYHTQSnaNPM");

pub const GAME_SEED: &[u8] = b"game";
pub const VAULT_SEED: &[u8] = b"vault";

/// Flicks per player in a round before it is decided on edge margin.
pub const FLICKS_PER_PLAYER: u8 = 6;
/// Seconds a player may stall on their turn.
pub const TURN_TIMEOUT: i64 = 45;
/// Seconds to wait for the VRF oracle before the match can be aborted (draw).
pub const SEED_TIMEOUT: i64 = 40;

// Game phases.
pub const PHASE_OPEN: u8 = 0; // lobby: waiting for players to join (base layer)
pub const PHASE_READY: u8 = 1; // lobby full, waiting for delegation / first seed
pub const PHASE_NEED_SEED: u8 = 2; // delegated, round needs a VRF seed
pub const PHASE_SEED_PENDING: u8 = 3; // VRF requested, waiting for the oracle callback
pub const PHASE_PLAYING: u8 = 4; // pens on the desk, players flick in turn
pub const PHASE_ROUND_OVER: u8 = 5; // round decided, match continues
pub const PHASE_FINISHED: u8 = 6; // match decided; commit + undelegate, then claim

// Winner / round result codes: 1..=4 = that player (seat + 1), DRAW = no winner.
pub const NONE: u8 = 0;
pub const DRAW: u8 = 5;

#[ephemeral]
#[program]
pub mod pen_fight {
    use super::*;

    /// Base layer. Create a lobby for `max_players` (2..=4) and lock the creator's stake.
    pub fn create_game(
        ctx: Context<CreateGame>,
        game_id: u64,
        stake: u64,
        target_wins: u8,
        max_players: u8,
    ) -> Result<()> {
        require!(
            (1..=5).contains(&target_wins),
            PenFightError::InvalidTargetWins
        );
        require!(
            (2..=MAX_PLAYERS as u8).contains(&max_players),
            PenFightError::InvalidPlayerCount
        );
        if stake > 0 {
            transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    Transfer {
                        from: ctx.accounts.player1.to_account_info(),
                        to: ctx.accounts.vault.to_account_info(),
                    },
                ),
                stake,
            )?;
        }

        let game = &mut ctx.accounts.game;
        game.game_id = game_id;
        game.players = [Pubkey::default(); MAX_PLAYERS];
        game.players[0] = ctx.accounts.player1.key();
        game.player_count = 1;
        game.max_players = max_players;
        game.stake = stake;
        game.target_wins = target_wins;
        game.phase = PHASE_OPEN;
        game.winner = NONE;
        game.paid = false;
        game.round = 1;
        game.last_action_at = Clock::get()?.unix_timestamp;
        msg!(
            "Game {} created by {} ({} players, stake {})",
            game_id,
            game.players[0],
            max_players,
            stake
        );
        Ok(())
    }

    /// Base layer. Join an open lobby by matching the stake. The last player to join
    /// fills the lobby, which becomes READY (and should delegate in the same transaction).
    pub fn join_game(ctx: Context<JoinGame>, _game_id: u64) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.phase == PHASE_OPEN, PenFightError::GameFull);
        let player = ctx.accounts.player.key();
        require!(!game.is_player(&player), PenFightError::AlreadyJoined);

        if game.stake > 0 {
            transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    Transfer {
                        from: ctx.accounts.player.to_account_info(),
                        to: ctx.accounts.vault.to_account_info(),
                    },
                ),
                game.stake,
            )?;
        }
        let slot = game.player_count as usize;
        game.players[slot] = player;
        game.player_count += 1;
        if game.player_count == game.max_players {
            game.phase = PHASE_READY;
        }
        game.last_action_at = Clock::get()?.unix_timestamp;
        msg!(
            "{} joined game {} ({}/{})",
            player,
            game.game_id,
            game.player_count,
            game.max_players
        );
        Ok(())
    }

    /// Base layer. A joined player (not the creator) leaves an unfilled lobby and gets
    /// their stake back; later players shift down a seat.
    pub fn leave_game(ctx: Context<LeaveGame>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.phase == PHASE_OPEN, PenFightError::CannotLeaveStarted);
        let player = ctx.accounts.player.key();
        let idx = game.index_of(&player).ok_or(PenFightError::NotAPlayer)?;
        require!(idx != 0, PenFightError::CreatorMustCancel);

        let count = game.player_count as usize;
        for i in idx..count - 1 {
            game.players[i] = game.players[i + 1];
        }
        game.players[count - 1] = Pubkey::default();
        game.player_count -= 1;

        if game.stake > 0 {
            let id = game.game_id.to_le_bytes();
            let seeds: &[&[&[u8]]] = &[&[VAULT_SEED, &id, &[ctx.bumps.vault]]];
            pay_from_vault(
                &ctx.accounts.vault,
                &ctx.accounts.player.to_account_info(),
                game.stake,
                &ctx.accounts.system_program,
                seeds,
            )?;
        }
        Ok(())
    }

    /// Base layer. The creator cancels an unfilled lobby and every joined player is
    /// refunded. Pass the other joined players (seat order) as player2..player4.
    pub fn cancel_game(ctx: Context<CancelGame>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(
            ctx.accounts.player1.key() == game.players[0],
            PenFightError::NotAPlayer
        );
        require!(game.phase == PHASE_OPEN, PenFightError::CannotCancelStarted);
        require!(!game.paid, PenFightError::AlreadyPaid);
        let others = seat_accounts([
            ctx.accounts.player2.as_ref(),
            ctx.accounts.player3.as_ref(),
            ctx.accounts.player4.as_ref(),
        ]);
        // Seats 1..player_count must be supplied, in order; later seats must be absent.
        require!(
            others.len() == game.player_count as usize - 1,
            PenFightError::WrongPlayerAccount
        );
        for (i, acc) in others.iter().enumerate() {
            require!(
                acc.key() == game.players[i + 1],
                PenFightError::WrongPlayerAccount
            );
        }
        game.paid = true;
        game.phase = PHASE_FINISHED;
        game.winner = DRAW;

        if game.stake > 0 {
            let id = game.game_id.to_le_bytes();
            let seeds: &[&[&[u8]]] = &[&[VAULT_SEED, &id, &[ctx.bumps.vault]]];
            pay_from_vault(
                &ctx.accounts.vault,
                &ctx.accounts.player1.to_account_info(),
                game.stake,
                &ctx.accounts.system_program,
                seeds,
            )?;
            for acc in others.iter() {
                pay_from_vault(
                    &ctx.accounts.vault,
                    acc,
                    game.stake,
                    &ctx.accounts.system_program,
                    seeds,
                )?;
            }
        }
        Ok(())
    }

    /// Base layer. Move the match account onto the Ephemeral Rollup once the lobby is
    /// full. Set a specific validator via the first remaining account.
    pub fn delegate_game(ctx: Context<DelegateGame>) -> Result<()> {
        // Read from raw data: `pda` is an UncheckedAccount because its ownership flips
        // to the delegation program during the CPI below.
        let (game_id, joined, phase) = {
            let data = ctx.accounts.pda.try_borrow_data()?;
            let g = Game::try_deserialize(&mut &data[..])?;
            (g.game_id, g.is_player(&ctx.accounts.payer.key()), g.phase)
        };
        require!(phase == PHASE_READY, PenFightError::NotReady);
        require!(joined, PenFightError::NotAPlayer);

        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[GAME_SEED, &game_id.to_le_bytes()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|a| a.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// ER. Ask the VRF oracle for this round's seed (spawn jitter + who flicks first).
    /// Also advances out of ROUND_OVER into the next round. Callable by anyone.
    pub fn request_seed(ctx: Context<RequestSeed>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let game = &mut ctx.accounts.game;
        match game.phase {
            PHASE_READY | PHASE_NEED_SEED => {}
            PHASE_ROUND_OVER => game.round = game.round.saturating_add(1),
            _ => return err!(PenFightError::WrongPhase),
        }
        game.phase = PHASE_SEED_PENDING;
        game.seed_requested_at = now;
        game.last_action_at = now;
        game.flick_count = 0;

        let game_key = game.key();
        let round = game.round;
        let mut caller_seed = [0u8; 32];
        caller_seed[..8].copy_from_slice(&game.game_id.to_le_bytes());
        caller_seed[8] = round;

        let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::CallbackSeed::DISCRIMINATOR.to_vec(),
            caller_seed,
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: game_key,
                is_signer: false,
                is_writable: true,
            }]),
            callback_args: None,
            ..Default::default()
        });
        // Persist the phase change before the CPI hands control to the VRF program.
        ctx.accounts.game.exit(&ID)?;
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    /// ER. VRF oracle callback: set the seed, spawn the pens, pick who starts.
    pub fn callback_seed(ctx: Context<CallbackSeed>, randomness: [u8; 32]) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(
            game.phase == PHASE_SEED_PENDING,
            PenFightError::WrongPhase
        );
        let mut s = [0u8; 8];
        s.copy_from_slice(&randomness[..8]);
        game.seed = u64::from_le_bytes(s);
        game.turn = randomness[8] % game.max_players;
        game.pens = sim::spawn(game.seed, game.max_players as usize);
        game.pre_pens = game.pens;
        game.flick_count = 0;
        game.last_flick_player = 0;
        game.last_flick_angle = 0;
        game.last_flick_power = 0;
        game.round_result = NONE;
        game.phase = PHASE_PLAYING;
        game.last_action_at = Clock::get()?.unix_timestamp;
        msg!("Round {} seed set; player {} starts", game.round, game.turn + 1);
        Ok(())
    }

    /// ER. Flick your pen. `angle` is in half-degrees (0..720), `power` 1..=100.
    /// The program simulates the whole flick (see sim.rs) and settles the round when at
    /// most one pen is left on the desk. Signed by the player's wallet or a session key.
    #[session_auth_or(
        ctx.accounts.game.current_player() == ctx.accounts.payer.key(),
        PenFightError::NotYourTurn
    )]
    pub fn play_flick(ctx: Context<PlayFlick>, angle: u16, power: u8) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.phase == PHASE_PLAYING, PenFightError::WrongPhase);
        require!(
            (angle as usize) < trig::ANGLE_STEPS && (1..=MAX_POWER).contains(&power),
            PenFightError::InvalidFlick
        );

        let who = game.turn as usize;
        game.pre_pens = game.pens;
        sim::apply_flick(&mut game.pens[who], angle, power);
        sim::run_to_rest(&mut game.pens);

        game.last_flick_player = game.turn;
        game.last_flick_angle = angle;
        game.last_flick_power = power;
        game.flick_count += 1;
        game.last_action_at = Clock::get()?.unix_timestamp;

        let alive = sim::alive_count(&game.pens);
        let result = if alive == 0 {
            Some(DRAW)
        } else if alive == 1 {
            Some(game.last_alive() + 1)
        } else if game.flick_count >= FLICKS_PER_PLAYER * game.max_players {
            // Nobody settled it: the pen furthest from the edge takes the round.
            Some(game.margin_winner())
        } else {
            None
        };

        match result {
            Some(r) => game.finish_round(r),
            None => game.advance_turn(),
        }
        Ok(())
    }

    /// ER. Deal with a stalled player. Anyone (e.g. a session key) may trigger it once
    /// the deadline has passed; the outcome depends only on on-chain state.
    ///  - 2 players: the staller forfeits the match.
    ///  - 3-4 players: the staller's pen is removed for the round and play continues.
    ///  - waiting on the VRF oracle too long: the match aborts as a draw (refunds).
    pub fn claim_timeout(ctx: Context<ClaimTimeout>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let game = &mut ctx.accounts.game;

        match game.phase {
            PHASE_PLAYING => {
                require!(
                    now - game.last_action_at > TURN_TIMEOUT,
                    PenFightError::TooEarly
                );
                let staller = game.turn as usize;
                if game.max_players == 2 {
                    game.winner = (1 - staller as u8) + 1;
                    game.phase = PHASE_FINISHED;
                } else {
                    game.pens[staller].out = true;
                    game.pens[staller].vx = 0;
                    game.pens[staller].vz = 0;
                    game.last_action_at = now;
                    if sim::alive_count(&game.pens) == 1 {
                        let w = game.last_alive() + 1;
                        game.finish_round(w);
                    } else {
                        game.advance_turn();
                    }
                }
            }
            PHASE_SEED_PENDING => {
                require!(
                    now - game.seed_requested_at > SEED_TIMEOUT,
                    PenFightError::TooEarly
                );
                game.winner = DRAW;
                game.phase = PHASE_FINISHED;
            }
            _ => return err!(PenFightError::WrongPhase),
        }
        Ok(())
    }

    /// ER -> base. Commit the final state and release the account from the ER.
    /// Callable by anyone once the match is decided.
    pub fn finish_game(ctx: Context<FinishGame>) -> Result<()> {
        require!(
            ctx.accounts.game.phase == PHASE_FINISHED,
            PenFightError::MatchNotDecided
        );
        ctx.accounts.game.exit(&ID)?;
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.game.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Base layer. Pay out the pot after the match has been committed back. The winner
    /// takes every stake; a draw refunds each player. Pass all players (seat order) as
    /// player1..player4. Anyone can trigger it.
    pub fn claim_pot(ctx: Context<ClaimPot>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.phase == PHASE_FINISHED, PenFightError::MatchNotDecided);
        require!(!game.paid, PenFightError::AlreadyPaid);
        let count = game.player_count as usize;
        let mut accs = vec![ctx.accounts.player1.to_account_info()];
        accs.extend(seat_accounts([
            ctx.accounts.player2.as_ref(),
            ctx.accounts.player3.as_ref(),
            ctx.accounts.player4.as_ref(),
        ]));
        require!(accs.len() == count, PenFightError::WrongPlayerAccount);
        for (i, acc) in accs.iter().enumerate() {
            require!(
                acc.key() == game.players[i],
                PenFightError::WrongPlayerAccount
            );
        }
        game.paid = true;
        if game.stake == 0 {
            return Ok(());
        }

        let id = game.game_id.to_le_bytes();
        let seeds: &[&[&[u8]]] = &[&[VAULT_SEED, &id, &[ctx.bumps.vault]]];
        if (1..=count as u8).contains(&game.winner) {
            let to = &accs[game.winner as usize - 1];
            let pot = game
                .stake
                .checked_mul(count as u64)
                .ok_or(PenFightError::MathOverflow)?;
            pay_from_vault(&ctx.accounts.vault, to, pot, &ctx.accounts.system_program, seeds)?;
            msg!("Paid pot of {} lamports to {}", pot, to.key());
        } else {
            for to in accs.iter() {
                pay_from_vault(
                    &ctx.accounts.vault,
                    to,
                    game.stake,
                    &ctx.accounts.system_program,
                    seeds,
                )?;
            }
            msg!("Draw: refunded {} lamports to each player", game.stake);
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreateGame<'info> {
    #[account(
        init,
        payer = player1,
        space = 8 + Game::LEN,
        seeds = [GAME_SEED, &game_id.to_le_bytes()],
        bump
    )]
    pub game: Account<'info, Game>,
    /// CHECK: system-owned SOL escrow PDA that holds the pot. Validated by seeds.
    #[account(mut, seeds = [VAULT_SEED, &game_id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub player1: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct JoinGame<'info> {
    #[account(mut, seeds = [GAME_SEED, &game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
    /// CHECK: system-owned SOL escrow PDA that holds the pot. Validated by seeds.
    #[account(mut, seeds = [VAULT_SEED, &game_id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LeaveGame<'info> {
    #[account(mut, seeds = [GAME_SEED, &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
    /// CHECK: system-owned SOL escrow PDA. Validated by seeds.
    #[account(mut, seeds = [VAULT_SEED, &game.game_id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateGame<'info> {
    pub payer: Signer<'info>,
    /// CHECK: the match PDA; deserialized manually, seeds verified by the delegate CPI.
    #[account(mut, del)]
    pub pda: UncheckedAccount<'info>,
}

#[vrf]
#[derive(Accounts)]
pub struct RequestSeed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [GAME_SEED, &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
    /// CHECK: validated by the ephemeral VRF program when it processes the request
    #[account(mut)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackSeed<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
}

#[derive(Accounts, Session)]
pub struct PlayFlick<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [GAME_SEED, &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
    #[session(signer = payer, authority = game.current_player())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
}

#[derive(Accounts)]
pub struct ClaimTimeout<'info> {
    pub payer: Signer<'info>,
    #[account(mut, seeds = [GAME_SEED, &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
}

#[commit]
#[derive(Accounts)]
pub struct FinishGame<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [GAME_SEED, &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
}

#[derive(Accounts)]
pub struct ClaimPot<'info> {
    #[account(mut, seeds = [GAME_SEED, &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
    /// CHECK: system-owned SOL escrow PDA. Validated by seeds.
    #[account(mut, seeds = [VAULT_SEED, &game.game_id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: seat-0 payout recipient, verified against game.players[0] in the handler.
    #[account(mut)]
    pub player1: UncheckedAccount<'info>,
    /// CHECK: seat-1 payout recipient, verified in the handler.
    #[account(mut)]
    pub player2: Option<UncheckedAccount<'info>>,
    /// CHECK: seat-2 payout recipient, verified in the handler.
    #[account(mut)]
    pub player3: Option<UncheckedAccount<'info>>,
    /// CHECK: seat-3 payout recipient, verified in the handler.
    #[account(mut)]
    pub player4: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelGame<'info> {
    #[account(mut, seeds = [GAME_SEED, &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
    /// CHECK: system-owned SOL escrow PDA. Validated by seeds.
    #[account(mut, seeds = [VAULT_SEED, &game.game_id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub player1: Signer<'info>,
    /// CHECK: seat-1 refund recipient, verified in the handler.
    #[account(mut)]
    pub player2: Option<UncheckedAccount<'info>>,
    /// CHECK: seat-2 refund recipient, verified in the handler.
    #[account(mut)]
    pub player3: Option<UncheckedAccount<'info>>,
    /// CHECK: seat-3 refund recipient, verified in the handler.
    #[account(mut)]
    pub player4: Option<UncheckedAccount<'info>>,
    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
pub struct Game {
    pub game_id: u64,
    /// Seats 0..player_count are filled (seat 0 is the creator); the rest are default.
    pub players: [Pubkey; MAX_PLAYERS],
    pub player_count: u8,
    pub max_players: u8,
    /// Per-player wager in lamports (0 = free game).
    pub stake: u64,
    pub target_wins: u8,
    pub phase: u8,
    /// 0 none, 1..=4 = that seat won, 5 = draw.
    pub winner: u8,
    pub paid: bool,
    pub wins: [u8; MAX_PLAYERS],
    /// Current round, 1-based.
    pub round: u8,
    /// Seat whose flick it is.
    pub turn: u8,
    /// Result of the most recently decided round (same codes as `winner`).
    pub round_result: u8,
    pub flick_count: u8,
    pub seed: u64,
    pub seed_requested_at: i64,
    pub last_action_at: i64,
    /// Live pen state (index = seat; seats beyond `max_players` are marked `out`).
    pub pens: [Pen; MAX_PLAYERS],
    /// Pen state right before the latest flick, so any client can replay it.
    pub pre_pens: [Pen; MAX_PLAYERS],
    pub last_flick_player: u8,
    pub last_flick_angle: u16,
    pub last_flick_power: u8,
}

impl Game {
    pub const LEN: usize = 8      // game_id
        + 32 * MAX_PLAYERS        // players
        + 1 + 1                   // player_count, max_players
        + 8                       // stake
        + 1 + 1 + 1 + 1           // target_wins, phase, winner, paid
        + MAX_PLAYERS             // wins
        + 1 + 1 + 1 + 1           // round, turn, round_result, flick_count
        + 8 + 8 + 8               // seed, seed_requested_at, last_action_at
        + Pen::LEN * MAX_PLAYERS * 2 // pens, pre_pens
        + 1 + 2 + 1; // last flick

    pub fn current_player(&self) -> Pubkey {
        self.players[(self.turn as usize).min(MAX_PLAYERS - 1)]
    }

    pub fn index_of(&self, key: &Pubkey) -> Option<usize> {
        self.players[..self.player_count as usize]
            .iter()
            .position(|p| p == key)
    }

    pub fn is_player(&self, key: &Pubkey) -> bool {
        self.index_of(key).is_some()
    }

    /// Seat of the only pen left on the desk (call when exactly one remains).
    fn last_alive(&self) -> u8 {
        self.pens.iter().position(|p| !p.out).unwrap_or(0) as u8
    }

    /// Round winner by edge margin among surviving pens; ties are a draw.
    fn margin_winner(&self) -> u8 {
        let mut best: i32 = i32::MIN;
        let mut winner = DRAW;
        let mut tied = false;
        for (i, p) in self.pens.iter().enumerate() {
            if p.out {
                continue;
            }
            let m = p.edge_margin();
            if m > best {
                best = m;
                winner = i as u8 + 1;
                tied = false;
            } else if m == best {
                tied = true;
            }
        }
        if tied {
            DRAW
        } else {
            winner
        }
    }

    /// Pass the flick to the next player whose pen is still on the desk.
    fn advance_turn(&mut self) {
        for step in 1..=self.max_players {
            let t = (self.turn + step) % self.max_players;
            if !self.pens[t as usize].out {
                self.turn = t;
                return;
            }
        }
    }

    /// Record a decided round and move to ROUND_OVER, or FINISHED if the match is won.
    fn finish_round(&mut self, result: u8) {
        self.round_result = result;
        if (1..=MAX_PLAYERS as u8).contains(&result) {
            let i = result as usize - 1;
            self.wins[i] += 1;
            if self.wins[i] >= self.target_wins {
                self.winner = result;
                self.phase = PHASE_FINISHED;
                return;
            }
        }
        self.phase = PHASE_ROUND_OVER;
    }
}

#[error_code]
pub enum PenFightError {
    #[msg("Target wins must be between 1 and 5.")]
    InvalidTargetWins,
    #[msg("Player count must be between 2 and 4.")]
    InvalidPlayerCount,
    #[msg("This lobby is already full.")]
    GameFull,
    #[msg("You are already in this match.")]
    AlreadyJoined,
    #[msg("The game is not ready for this.")]
    NotReady,
    #[msg("Only a player of this game can do this.")]
    NotAPlayer,
    #[msg("Not allowed in the current phase.")]
    WrongPhase,
    #[msg("It is not your turn.")]
    NotYourTurn,
    #[msg("Invalid flick angle or power.")]
    InvalidFlick,
    #[msg("Too early to claim a timeout.")]
    TooEarly,
    #[msg("The match is not decided yet.")]
    MatchNotDecided,
    #[msg("The pot has already been paid out.")]
    AlreadyPaid,
    #[msg("Wrong player accounts for this game.")]
    WrongPlayerAccount,
    #[msg("Cannot cancel a game that has already started.")]
    CannotCancelStarted,
    #[msg("Cannot leave a game that has already started.")]
    CannotLeaveStarted,
    #[msg("The creator must cancel the lobby instead of leaving.")]
    CreatorMustCancel,
    #[msg("Arithmetic overflow.")]
    MathOverflow,
}

/// Collect the supplied optional seat accounts, stopping at the first gap so a later
/// seat can never be passed without the earlier ones.
fn seat_accounts<'info>(
    seats: [Option<&UncheckedAccount<'info>>; 3],
) -> Vec<AccountInfo<'info>> {
    seats
        .into_iter()
        .map_while(|a| a.map(|a| a.to_account_info()))
        .collect()
}

/// Transfer `amount` lamports out of the system-owned vault PDA, which signs for
/// itself via `signer_seeds`.
fn pay_from_vault<'info>(
    vault: &SystemAccount<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
    system_program: &Program<'info, System>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    transfer(
        CpiContext::new_with_signer(
            system_program.key(),
            Transfer {
                from: vault.to_account_info(),
                to: to.clone(),
            },
            signer_seeds,
        ),
        amount,
    )
}
