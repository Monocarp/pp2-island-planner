# Production parsing — open questions

Tracker for game-accurate save/UI production math. **Work through one item at a time**; update this file when a question is answered or superseded.

**Context:** Footprints + `inputs` + nameplate rates come from planner data; boosts (rickyard/paddock) apply to computed building output. Usable tile counts must come from save-derived geometry + rules—not hardcoded UI numbers.

---

## 1. Universal linear model?

**Question:** Does **every** building with spatial tile inputs use the same **linear** scaling  
`output ≈ nameplate × (utilizedTiles / inputs[resId])` **per spatial input** (then combine multi-input buildings somehow), or do some use **steps**, **floors**, **shared pools** between buildings, or other formulas?

**Status:** Open

**Notes:**

---

## 2. “Off limits” cells inside a footprint

**Question:** What is the **complete** rule set for a footprint cell **not** counting toward an input? (e.g. water, mountain, another building’s **anchor**, silo/paddock footprint consuming the cell, roads, etc.) Does it vary **by building** or **by input type**?

**Status:** Open

**Notes:** Example: horse ranch — `inputs.grass` cap stays 20; footprint may have 21 cells; **usable** grass can be lower (e.g. 18 when 2 cells are water).

---

## 3. Multi-input spatial buildings (bottleneck semantics)

**Question:** When a building has **multiple** spatial inputs (e.g. grass + deposit, or grass + river), how does the game combine them into one effective output multiplier? **Minimum** of per-input ratios? **Product**? Something else?

**Status:** Open

**Notes:**

---

## 4. Deposits and field tiles

**Question:** Do deposits / painted fields follow the **same** utilized/need ratio pattern as grass, or different rules (e.g. binary “has deposit anchor,” fractional ripeness, etc.)?

**Status:** Open

**Notes:**

---

## 5. Shared grass (or other tiles) between buildings

**Question:** When two+ buildings’ **footprints overlap** on the same grass (or other tile input), does the game **split** effective supply (e.g. 50/50), use a **single pool** with a shared cap (sum of needs), or **duplicate** count for each building? Does this differ for **pig/cattle/sheep vs horse**?

**Status:** Open

**Notes:** Parser previously used 1/n per contested cell for some types and island-wide pools for others—needs game confirmation.

---

## 6. Rickyard / paddock interaction with partial utilization

**Question:** For **each** boosted building type, does rickyard ×2 apply only at **full** spatial utilization, or also when **partial** (e.g. horse at 16/20 grass in silo — user example doubled the **linear-scaled** output)?

**Status:** Open

**Notes:** Horses may differ from pigs/cattle/sheep; document per category once confirmed.

---

## 7. `OutputResources.balance` vs UI production

**Question:** When should the parser prefer **timer + nameplate/fallback** vs **save output balances** so totals match **in-game production UI** (excluding warehouse pending, etc.)?

**Status:** Open

**Notes:**

---

## How to use this doc

1. Pick **one** numbered question.
2. Answer in **Notes** (or link to issue/commit).
3. Set **Status** to `Answered` and add a one-line **Conclusion** under Notes.
4. Implement parser changes only when that conclusion is recorded (or explicitly scoped).
