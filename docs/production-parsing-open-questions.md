# Production parsing — open questions

Tracker for game-accurate save/UI production math. **Work through one item at a time**; update this file when a question is answered or superseded.

**Context:** Footprints + `inputs` + nameplate rates come from planner data; boosts (rickyard/paddock) apply to computed building output. Usable tile counts must come from save-derived geometry + rules—not hardcoded UI numbers.

---

## 1. How spatial inputs map to production rate (split into clear sub-questions)

These are **separate**; the game might answer “yes” to one and “no” to another. We need answers **per sub-question**, ideally with examples.

### 1a — One formula family vs many

**Question:** Is there a **single** rule family for “spatial input → production multiplier” that applies to **all** producers with tile/deposit-style `inputs` (grass, forest, water_tile, deposits, fields, river counts, etc.)?

Or does the game use **different** rules **by building category** (e.g. livestock gatherers vs crop harvesters vs mines vs fishers), even if each category is internally consistent?

**Status:** Open

**Notes:**

### 1b — Linear vs stepped / threshold

Fix **one** spatial input with need **N** from `inputs` and nameplate **R** at full satisfaction.

**Question:** Is effective output always **R × (U / N)** where **U** = number of **usable** cells that count for that input (0 ≤ U ≤ N), **continuous** in U?

Or does output change in **steps** (only certain U values matter), use **ceil/floor**, or hit a **hard cap** below R even when U ≥ N?

**Status:** Open

**Notes:**

### 1c — Independence vs shared supply (overlap between buildings)

Consider two buildings whose **footprints overlap** on the same map cell that counts as a valid tile for **both** (e.g. same grass cell inside two ranches).

**Question:** Does each building **independently** count that cell toward its own U (so the cell “counts twice” for world supply), or does the game **split** or **share** that cell between buildings (so combined grass use is capped), or something else?

Does the answer **differ** for **horse vs pig vs cattle vs sheep** or for **non-livestock** spatial producers?

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
