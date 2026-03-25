# Production parsing — open questions

Tracker for game-accurate save/UI production math. **Work through one item at a time**; update this file when a question is answered or superseded.

**Context:** Footprints + `inputs` + nameplate rates come from planner data; boosts (rickyard/paddock) apply to computed building output. Usable tile counts must come from save-derived geometry + rules—not hardcoded UI numbers.

---

## 1. How spatial inputs map to production rate (split into clear sub-questions)

These are **separate**; the game might answer “yes” to one and “no” to another. We need answers **per sub-question**, ideally with examples.

### 1a — One formula family vs many

**Question (clarified):** By “multiplier story” we meant **the shape of the rule**, not the numeric rates. Example: “always `R × (U/N)`” vs “binary: full R if U ≥ 1 else 0” would be two different *stories* even if both use `data.js`.

**Question:** Aside from different nameplate **R** and need **N** per building, is the **same pipeline** used everywhere (count usable tiles → form ratio to need → scale output → boosts), or are there buildings you believe use a **fundamentally different** pipeline?

**Status:** Answered (pending counterexamples)

**Conclusion:** Same **general logic** everywhere; cows vs sheep etc. differ in **constants** (R, N, footprint), not in replacing linearity with a different shape. If the codebase finds a case that looks like a different pipeline, surface it for review.

**Notes:** User: “if you have instances of what you think are different multiplier stories I’d be happy to look into it.”

### 1b — Linear vs stepped / threshold

Fix **one** spatial input with need **N** from `inputs` and nameplate **R** at full satisfaction.

**Question:** Is effective output always **R × (U / N)** where **U** = number of **usable** cells that count for that input (0 ≤ U ≤ N), **continuous** in U?

Or does output change in **steps** (only certain U values matter), use **ceil/floor**, or hit a **hard cap** below R even when U ≥ N?

**Status:** Answered (pending counterexamples)

**Conclusion:** **Linear** in U/N to the best of your knowledge. Parser should assume linear until a specific in-game counterexample is documented here.

**Notes:** User: “if you have a specific example you think challenges that notion, let me know.”

### 1c — Independence vs shared supply (overlap between buildings)

Consider two buildings whose **footprints overlap** on the same map cell that counts as a valid tile for **both** (e.g. same grass cell inside two ranches).

**Question:** Does each building **independently** count that cell toward its own U (so the cell “counts twice” for world supply), or does the game **split** or **share** that cell between buildings (so combined grass use is capped), or something else?

Does the answer **differ** for **horse vs pig vs cattle vs sheep** or for **non-livestock** spatial producers?

**Status:** Answered (with follow-up: compatibility groups)

**Conclusion:**

- When **two footprints can both use** the same cell for their spatial input (e.g. pigs and sheep on **grass**), each building gets **1/n** of that cell toward its effective supply when **n** buildings share it (two → **50% each**).
- Some pairs **cannot** share: the cell is **one crop or the other** (e.g. **strawberry farm vs coffee field** — strawberries **or** coffee beans, not split 50/50). Those exclusions should be **explicitly marked** in data (or an adjunct table), not inferred only by heuristics.

**Follow-up for implementation:** Define **compatibility groups** (or pairwise exclusions) for tile-resource / deposit types so the parser knows when to apply **1/n** vs **exclusive claim**.

**Notes:** User answered 1c directly; overlaps with old §5 — see §5 status below.

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

**Status:** Superseded by **§1c** + **compatibility follow-up**

**Notes:** Answer: **1/n** on cells that **can** be shared; **mutually exclusive** tile types (strawberry vs coffee) must be **data-driven**, not 50/50. Horse vs other livestock: no separate rule stated in 1c answer; revisit if UI disagrees.

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
