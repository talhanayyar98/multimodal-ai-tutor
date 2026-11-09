// Balanced group assignment for the A/B study ("permuted blocks").
//
// Study participants are numbered 1, 2, 3, … in the order they join. Every run
// of BLOCK_SIZE numbers is one block holding one slot for each combination of
// group (adaptive / control) and test order (AB / BA: which pre-/post-test
// form comes first), in random order. So:
//   - the groups never differ by more than BLOCK_SIZE / 2 (after any number of
//     participants), unlike a coin flip, which easily gives 13 vs 7 out of 20;
//   - the next assignment can't be predicted, unlike strict alternation;
//   - within each group, half do form A first and half form B first, so a
//     slightly harder test form can't look like a group difference.
// A block's order is drawn once, when its first participant joins, and stored
// in MongoDB (`allocationblocks`), so it survives restarts and can be audited.
// Test runs (ST-codes) use their own blocks and never use up a real slot.
import { AllocationBlock, TEST_ORDERS, type TestOrder } from "./models";
import type { AbGroup } from "./store";

const GROUPS: AbGroup[] = ["adaptive", "control"];
/** One slot per group × test order. */
export const BLOCK_SIZE = GROUPS.length * TEST_ORDERS.length;

interface Slot {
  abGroup: AbGroup;
  testOrder: TestOrder;
}

/** Every group × test-order combination once, Fisher–Yates shuffled. */
export function shuffledBlock(random: () => number = Math.random): Slot[] {
  const block: Slot[] = GROUPS.flatMap((abGroup) => TEST_ORDERS.map((testOrder) => ({ abGroup, testOrder })));
  for (let i = block.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [block[i], block[j]] = [block[j], block[i]];
  }
  return block;
}

/** The group and test order of the seq-th (1-based) participant of the real or the test series. */
export async function assignGroup(
  seq: number,
  test: boolean,
): Promise<{ abGroup: AbGroup; testOrder: TestOrder; block: number }> {
  if (!Number.isInteger(seq) || seq < 1) throw new Error(`invalid participant number ${seq}`);
  const block = Math.floor((seq - 1) / BLOCK_SIZE);
  const id = `${test ? "study-test" : "study"}-${block}`;
  const { groups, testOrders } = await blockSlots(id);
  const i = (seq - 1) % BLOCK_SIZE;
  const abGroup = groups[i];
  const testOrder = testOrders[i];
  if (
    (abGroup !== "adaptive" && abGroup !== "control") ||
    !(TEST_ORDERS as readonly string[]).includes(testOrder)
  ) {
    throw new Error(`allocation block ${id} is malformed: ${JSON.stringify({ groups, testOrders })}`);
  }
  return { abGroup, testOrder: testOrder as TestOrder, block };
}

/** The stored slots of a block, drawing and storing them if this is the block's first participant. */
async function blockSlots(id: string): Promise<{ groups: string[]; testOrders: string[] }> {
  const slots = shuffledBlock();
  // Two participants joining at the same moment can both try to create the
  // block; MongoDB lets one insert win and the other fails with a duplicate-key
  // error, so the loser just reads the winner's order on its second try.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const doc = await AllocationBlock.findOneAndUpdate(
        { _id: id },
        {
          $setOnInsert: {
            groups: slots.map((s) => s.abGroup),
            testOrders: slots.map((s) => s.testOrder),
          },
        },
        { upsert: true, new: true },
      ).lean();
      if (doc) return { groups: doc.groups, testOrders: doc.testOrders ?? [] };
    } catch (err) {
      if ((err as { code?: number }).code !== 11000 || attempt > 0) throw err;
    }
  }
  throw new Error(`allocation block ${id} could not be read`);
}
