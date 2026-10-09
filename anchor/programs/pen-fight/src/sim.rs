//! Deterministic integer physics for a pen flick on a desk.
//!
//! Everything here is integer math (no floats) so the on-chain program and the
//! browser client (web/lib/sim.ts) reproduce *bit-identical* results. Keep the two
//! files in lock-step: any change here must be mirrored there, and the shared
//! test vectors (tests/vectors.json) must be regenerated.
//!
//! World units: 1024 = 1.0 "unit" (~10 cm). x runs across the desk, z along it.
//! Angle 0 = +x, 180 = +z, 360 = -x, 540 = -z. Angles are in half-degrees (0..720).

use anchor_lang::prelude::*;

use crate::trig::{ANGLE_STEPS, COS, SIN};

pub const UNIT: i64 = 1024;
/// Desk half extents.
pub const HALF_X: i32 = 3072;
pub const HALF_Z: i32 = 6144;
/// Collision radius of a pen (pens are modelled as discs for collisions).
pub const PEN_RADIUS: i64 = 717;
/// Per-tick velocity retention, out of 1024.
pub const FRICTION: i64 = 983;
/// Bounce energy retention, out of 1024.
pub const RESTITUTION: i64 = 870;
/// Below this |vx|+|vz| a pen is considered at rest.
pub const STOP_SPEED: i32 = 6;
pub const MAX_TICKS: u32 = 480;
pub const MAX_POWER: u8 = 100;
/// Initial speed per power point (per tick, in 1/1024 units), x100.
pub const SPEED_PER_100_POWER: i64 = 328;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq, Debug)]
pub struct Pen {
    pub x: i32,
    pub z: i32,
    pub vx: i32,
    pub vz: i32,
    /// True once the pen's centre has left the desk.
    pub out: bool,
}

impl Pen {
    pub const LEN: usize = 4 * 4 + 1;

    pub fn at(x: i32, z: i32) -> Self {
        Pen {
            x,
            z,
            vx: 0,
            vz: 0,
            out: false,
        }
    }

    /// Distance (in units/1024) from the pen centre to the nearest desk edge.
    pub fn edge_margin(&self) -> i32 {
        let mx = HALF_X - self.x.abs();
        let mz = HALF_Z - self.z.abs();
        mx.min(mz)
    }

    fn at_rest(&self) -> bool {
        self.vx == 0 && self.vz == 0
    }
}

/// Integer square root (floor), Newton's method. Matches `isqrt` in sim.ts.
fn isqrt(n: i64) -> i64 {
    if n <= 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// Give `pen` the velocity of a flick. `angle` is in half-degrees, `power` 1..=100.
pub fn apply_flick(pen: &mut Pen, angle: u16, power: u8) {
    let a = (angle as usize) % ANGLE_STEPS;
    let v0 = (power as i64) * SPEED_PER_100_POWER / 100;
    pen.vx = (v0 * COS[a] as i64 / UNIT) as i32;
    pen.vz = (v0 * SIN[a] as i64 / UNIT) as i32;
}

fn collide(a: &mut Pen, b: &mut Pen) {
    let dx = (b.x - a.x) as i64;
    let dz = (b.z - a.z) as i64;
    let dist2 = dx * dx + dz * dz;
    let min = 2 * PEN_RADIUS;
    if dist2 >= min * min {
        return;
    }
    let d = isqrt(dist2);
    let (nx, nz) = if d == 0 {
        (UNIT, 0)
    } else {
        (dx * UNIT / d, dz * UNIT / d)
    };

    // Push the discs apart along the normal.
    let overlap = min - d;
    let push_a = overlap / 2;
    let push_b = overlap - push_a;
    a.x -= (push_a * nx / UNIT) as i32;
    a.z -= (push_a * nz / UNIT) as i32;
    b.x += (push_b * nx / UNIT) as i32;
    b.z += (push_b * nz / UNIT) as i32;

    // Equal-mass impulse along the normal, only if the discs are approaching.
    let rvn = ((a.vx - b.vx) as i64 * nx + (a.vz - b.vz) as i64 * nz) / UNIT;
    if rvn > 0 {
        let j = rvn * (UNIT + RESTITUTION) / (2 * UNIT);
        a.vx -= (j * nx / UNIT) as i32;
        a.vz -= (j * nz / UNIT) as i32;
        b.vx += (j * nx / UNIT) as i32;
        b.vz += (j * nz / UNIT) as i32;
    }
}

pub const MAX_PLAYERS: usize = 4;

/// Number of pens still on the desk.
pub fn alive_count(pens: &[Pen; MAX_PLAYERS]) -> usize {
    pens.iter().filter(|p| !p.out).count()
}

/// Advance the world by one tick. Returns true when the simulation should stop
/// (at most one pen is left on the desk, or everything is at rest). Slots that are
/// not part of the match are marked `out` and ignored.
pub fn step(pens: &mut [Pen; MAX_PLAYERS]) -> bool {
    for p in pens.iter_mut() {
        if p.out {
            continue;
        }
        p.x += p.vx;
        p.z += p.vz;
        p.vx = (p.vx as i64 * FRICTION / UNIT) as i32;
        p.vz = (p.vz as i64 * FRICTION / UNIT) as i32;
        if p.vx.abs() + p.vz.abs() < STOP_SPEED {
            p.vx = 0;
            p.vz = 0;
        }
    }

    // Pairwise collisions in a fixed (i < j) order so every client agrees.
    for i in 0..MAX_PLAYERS {
        for j in (i + 1)..MAX_PLAYERS {
            if pens[i].out || pens[j].out {
                continue;
            }
            let (left, right) = pens.split_at_mut(j);
            collide(&mut left[i], &mut right[0]);
        }
    }

    for p in pens.iter_mut() {
        if !p.out && (p.x.abs() > HALF_X || p.z.abs() > HALF_Z) {
            p.out = true;
            p.vx = 0;
            p.vz = 0;
        }
    }

    alive_count(pens) <= 1 || pens.iter().all(|p| p.out || p.at_rest())
}

/// Run the world until it settles (or MAX_TICKS). Returns ticks simulated.
pub fn run_to_rest(pens: &mut [Pen; MAX_PLAYERS]) -> u32 {
    for t in 0..MAX_TICKS {
        if step(pens) {
            return t + 1;
        }
    }
    // Time limit: freeze everything where it is.
    for p in pens.iter_mut() {
        p.vx = 0;
        p.vz = 0;
    }
    MAX_TICKS
}

/// Starting positions for a round, derived from the VRF seed. Seats: 0 bottom, 1 top,
/// 2 left, 3 right; seats >= `n` are marked out.
pub fn spawn(seed: u64, n: usize) -> [Pen; MAX_PLAYERS] {
    let b = seed.to_le_bytes();
    let jx = |v: u8| (v as i32 - 128) * 12;
    let jz = |v: u8| (v as i32 - 128) * 8;
    let mut pens = [
        Pen::at(jx(b[0]), 3584),
        Pen::at(jx(b[1]), -3584),
        Pen::at(-1700, jz(b[2])),
        Pen::at(1700, jz(b[3])),
    ];
    for (i, p) in pens.iter_mut().enumerate() {
        if i >= n {
            p.out = true;
        }
    }
    pens
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flick(pens: &mut [Pen; MAX_PLAYERS], who: usize, angle: u16, power: u8) -> u32 {
        apply_flick(&mut pens[who], angle, power);
        run_to_rest(pens)
    }

    #[test]
    fn soft_flick_stays_on_desk() {
        let mut pens = spawn(0, 2);
        let ticks = flick(&mut pens, 0, 540, 10); // toward -z, weak
        assert!(!pens[0].out && !pens[1].out);
        assert!(ticks < MAX_TICKS);
    }

    #[test]
    fn flick_off_edge_falls() {
        let mut pens = spawn(0, 2);
        flick(&mut pens, 0, 180, 100); // +z, toward own edge, full power
        assert!(pens[0].out);
    }

    #[test]
    fn head_on_hit_transfers_momentum() {
        let mut pens = spawn(0, 2);
        pens[0] = Pen::at(0, 2000);
        pens[1] = Pen::at(0, -2000);
        flick(&mut pens, 0, 540, 60); // straight at opponent
        assert!(pens[1].z < -2000, "opponent should be pushed back");
    }

    #[test]
    fn deterministic() {
        let mut a = spawn(0xDEADBEEF, 3);
        let mut b = spawn(0xDEADBEEF, 3);
        flick(&mut a, 0, 500, 70);
        flick(&mut b, 0, 500, 70);
        assert_eq!(a, b);
    }

    #[test]
    fn unused_seats_are_out_and_ignored() {
        let pens = spawn(5, 2);
        assert!(pens[2].out && pens[3].out);
        assert_eq!(alive_count(&pens), 2);
        assert_eq!(alive_count(&spawn(5, 4)), 4);
    }

    #[test]
    fn four_player_fall_leaves_the_rest_settled() {
        // The left pen is flicked off its own edge (toward -x). Three pens remain, so the
        // round is not over and the sim must keep running until everything is at rest.
        let mut pens = spawn(7, 4);
        flick(&mut pens, 2, 360, 100);
        assert!(pens[2].out);
        assert_eq!(alive_count(&pens), 3);
        for p in pens.iter().filter(|p| !p.out) {
            assert_eq!((p.vx, p.vz), (0, 0));
        }
    }

    /// Prints vectors consumed by web/scripts/check-sim.ts. Run with
    /// `cargo test print_vectors -- --nocapture`.
    #[test]
    fn print_vectors() {
        // (seed, n, flicks as (who, angle, power))
        let cases: Vec<(u64, usize, Vec<(usize, u16, u8)>)> = vec![
            (0, 2, vec![(0, 540, 60)]),
            (1234567, 2, vec![(0, 530, 100)]),
            (0xDEADBEEF, 2, vec![(0, 500, 70)]),
            (42, 2, vec![(0, 190, 33)]),
            (99999, 2, vec![(1, 545, 85)]),
            (7, 2, vec![(1, 0, 50)]),
            (31337, 2, vec![(0, 360, 90)]),
            (8675309, 2, vec![(1, 700, 100)]),
            (11, 3, vec![(0, 540, 80), (1, 180, 70), (2, 0, 90)]),
            (222, 3, vec![(2, 0, 100), (0, 540, 100), (1, 180, 60)]),
            (3333, 4, vec![(0, 540, 90), (1, 180, 90), (2, 0, 100), (3, 360, 100)]),
            (44444, 4, vec![(3, 540, 70), (2, 180, 80), (0, 590, 100), (1, 120, 100), (2, 700, 60)]),
        ];
        let mut out = String::from("[");
        for (i, (seed, n, flicks)) in cases.iter().enumerate() {
            let mut pens = spawn(*seed, *n);
            let mut ticks = Vec::new();
            for (who, angle, power) in flicks {
                if pens[*who].out {
                    ticks.push(0);
                    continue;
                }
                ticks.push(flick(&mut pens, *who, *angle, *power));
            }
            if i > 0 {
                out.push(',');
            }
            out.push_str(&format!(
                "{{\"seed\":\"{}\",\"n\":{},\"flicks\":[{}],\"ticks\":[{}],\"pens\":[{}]}}",
                seed,
                n,
                flicks
                    .iter()
                    .map(|(w, a, p)| format!("{{\"who\":{},\"angle\":{},\"power\":{}}}", w, a, p))
                    .collect::<Vec<_>>()
                    .join(","),
                ticks.iter().map(|t| t.to_string()).collect::<Vec<_>>().join(","),
                pens.iter()
                    .take(*n)
                    .map(|p| format!(
                        "{{\"x\":{},\"z\":{},\"vx\":{},\"vz\":{},\"out\":{}}}",
                        p.x, p.z, p.vx, p.vz, p.out
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            ));
        }
        out.push(']');
        println!("VECTORS:{}", out);
    }
}
