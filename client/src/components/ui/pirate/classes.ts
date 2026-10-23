/**
 * Class strings for themed shadcn/Radix parts that we style in place rather than wrap.
 *
 * shadcn's DialogContent ships `border bg-background p-6 sm:rounded-lg`. The parchment material
 * lives in background-image layers, so `bg-background` can't wipe it; `border-0` drops the stray
 * 1px border, which a torn mask would cut up anyway.
 */
export const ptwDialog = "ptw-parchment border-0 shadow-none";
/** Same, with deckled torn edges (mask). */
export const ptwDialogTorn = "ptw-parchment ptw-torn border-0 shadow-none sm:rounded-none";
