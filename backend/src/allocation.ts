// Balanced group assignment for the A/B study ("permuted blocks").
//
// Study participants are numbered 1, 2, 3, … in the order they join. Every run
// of BLOCK_SIZE numbers is one block holding equally many adaptive and control
// slots in random order, so:
//   - the groups never differ by more than BLOCK_SIZE / 2 (after any number of
//     participants), unlike a coin flip, which easily gives 13 vs 7 out of 20;
//   - the next assignment can't be predicted, unlike strict alternation.
// A block's order is drawn once, when its first participant joins, and stored
// in MongoDB (`allocationblocks`), so it survives restarts and can be audited.
// Test runs (ST-codes) use their own blocks and never use up a real slot.
import { AllocationBlock } from "./models";
import type { AbGroup } from "./store";

export const BLOCK_SIZE = 4;

/** BLOCK_SIZE / 2 adaptive + BLOCK_SIZE / 2 control, Fisher–Yates shuffled. */
export function shuffledBlock(random: () => number = Math.random): AbGroup[] {
  const block: AbGroup[] = Array.from({ length: BLOCK_SIZE }, (_, i) =>
    i < BLOCK_SIZE / 2 ? "adaptive" : "control",
  );
  for (let i = block.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [block[i], block[j]] = [block[j], block[i]];
  }
  return block;
}

/** The group of the seq-th (1-based) participant of the real or the test series. */
export async function assignGroup(
  seq: number,
  test: boolean,
): Promise<{ abGroup: AbGroup; block: number }> {
  if (!Number.isInteger(seq) || seq < 1) throw new Error(`invalid participant number ${seq}`);
  const block = Math.floor((seq - 1) / BLOCK_SIZE);
  const id = `${test ? "study-test" : "study"}-${block}`;
  const groups = await blockGroups(id);
  const abGroup = groups[(seq - 1) % BLOCK_SIZE];
  if (abGroup !== "adaptive" && abGroup !== "control") {
    throw new Error(`allocation block ${id} is malformed: ${JSON.stringify(groups)}`);
  }
  return { abGroup, block };
}

/** The stored order of a block, drawing and storing it if this is the block's first participant. */
async function blockGroups(id: string): Promise<string[]> {
  // Two participants joining at the same moment can both try to create the
  // block; MongoDB lets one insert win and the other fails with a duplicate-key
  // error, so the loser just reads the winner's order on its second try.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const doc = await AllocationBlock.findOneAndUpdate(
        { _id: id },
        { $setOnInsert: { groups: shuffledBlock() } },
        { upsert: true, new: true },
      ).lean();
      if (doc) return doc.groups;
    } catch (err) {
      if ((err as { code?: number }).code !== 11000 || attempt > 0) throw err;
    }
  }
  throw new Error(`allocation block ${id} could not be read`);
}
