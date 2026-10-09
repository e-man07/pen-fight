/** Shared per-seat look for the HUD and the 3D scene. Seats: 0 bottom, 1 top, 2 left, 3 right. */
export const SEAT_NAMES = ["Alice", "Bob", "Carol", "Dave"] as const;

export const SEAT_COLORS = ["#2f6bff", "#ff4d5e", "#19b67a", "#9b5cf6"] as const;

export const seatName = (idx: number): string => SEAT_NAMES[idx] ?? `Player ${idx + 1}`;
export const seatColor = (idx: number): string => SEAT_COLORS[idx] ?? "#ffffff";

export const MAX_SEATS = 4;
