import { GOBLIN_SLOGANS, pickRandomItem, type GoblinEasterEggFamily } from "./content";

export interface GoblinSessionState {
  getSlogan: () => string;
  markEasterEggSeen: (family: GoblinEasterEggFamily) => boolean;
  hasSeenEasterEgg: (family: GoblinEasterEggFamily) => boolean;
}

export function createGoblinSessionState(random: () => number): GoblinSessionState {
  const slogan = pickRandomItem(GOBLIN_SLOGANS, random);
  const seenFamilies = new Set<GoblinEasterEggFamily>();

  return {
    getSlogan: () => slogan,
    markEasterEggSeen: (family) => {
      if (seenFamilies.has(family)) {
        return false;
      }

      seenFamilies.add(family);
      return true;
    },
    hasSeenEasterEgg: (family) => seenFamilies.has(family),
  };
}
