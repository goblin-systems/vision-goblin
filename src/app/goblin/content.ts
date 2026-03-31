export type GoblinEasterEggFamily = "layer-chaos" | "undo-spam" | "colour-picker-hesitation" | "hidden-ui-discovery";

export interface GoblinToastContent {
  message: string;
  icon: string;
}

export interface HiddenUiTargetConfig {
  id: string;
  selector: string;
}

export const GOBLIN_SLOGANS = [
  "Goblin note: smudging, scribbling, overpainting, and “just one more tweak” all count as artistic genius in this establishment.",
  "Goblin note: accidental masterpieces, aggressive undo spam, and suspiciously large brush sizes are fully encouraged here.",
  "Goblin note: 73 layers, zero organisation, and vibes-based editing are not only allowed—they’re respected.",
  "Goblin note: if it looks wrong, add more paint until it looks intentional.",
  "Goblin note: zooming to 800% to fix a single pixel is a completely rational and healthy behaviour.",
  "Goblin note: if you haven’t flipped the canvas 12 times, you’re not done yet.",
  "Goblin note: every piece starts as “just a quick edit” and ends as a life decision.",
  "Goblin note: the blur tool is not a mistake—it’s a lifestyle.",
  "Goblin note: colour picking from other people’s art is called research.",
  "Goblin note: trust the process. the process is chaos, but trust it anyway.",
  "Goblin note: nothing is ruined. it is merely evolving into something else.",
  "Goblin note: you don’t make mistakes. you discover alternate outcomes.",
  "Goblin note: that wasn’t a slip. that was a bold artistic decision.",
  "Goblin note: subtlety is optional. drama is encouraged.",
  "Goblin note: art is just controlled accidents with confidence.",
  "Goblin note: the line between “finished” and “ruined” is negotiable.",
  "Goblin note: bold strokes now, consequences later.",
  "Goblin note: every great piece contains at least one regrettable decision.",
  "Goblin note: if it’s slightly off, it’s called character.",
  "Goblin note: that looks terrible. keep going.",
  "Goblin note: if you zoom out far enough, it’s incredible.",
  "Goblin note: we are 3 brush strokes away from greatness. probably.",
  "Goblin note: this is fine. everything is fine. keep painting.",
  "Goblin note: one wrong click away from a breakthrough.",
] as const;

export const GOBLIN_AMBIENT_COMMENTARY = [
  "Goblin note: that was a risky move. we respect it.",
  "Goblin note: you’ve made it worse in a very interesting way.",
  "Goblin note: oh, we’re committing to that. alright.",
  "Goblin note: bold. confusing, but bold.",
  "Goblin note: that didn’t go how you expected, did it.",
  "Goblin note: we’re learning things. unclear what, but still.",
  "Goblin note: that choice will have consequences. probably.",
  "Goblin note: hmm. not what we would’ve done. fascinating.",
  "Goblin note: you’re doubling down. admirable.",
  "Goblin note: we see the vision. it is faint, but it’s there.",
  "Goblin note: that was either intentional or very confident.",
  "Goblin note: interesting direction. unexpected. possibly dangerous.",
  "Goblin note: we’re not stopping. that’s the spirit.",
  "Goblin note: something just happened. we’re processing it.",
  "Goblin note: you seem sure about this. that helps.",
  "Goblin note: that’s one way to approach it. not a common one.",
  "Goblin note: we’ve crossed a line. unclear which one.",
  "Goblin note: yes. keep doing… whatever this is.",
  "Goblin note: this is getting harder to explain. good.",
  "Goblin note: we are witnessing a sequence of decisions.",
] as const;

export const GOBLIN_EASTER_EGG_MESSAGES: Record<GoblinEasterEggFamily, readonly GoblinToastContent[]> = {
  "layer-chaos": [
    { message: "Ah yes, the ancient technique: more layers will fix it. Bold.", icon: "layers" },
    { message: "Magnificent. A towering monument of layers. Surely this will end well.", icon: "layers" },
    { message: "One more layer ought to do it. It never is, but we respect the optimism.", icon: "layers" },
  ],
  "undo-spam": [
    { message: "Fascinating. We call this time travel with commitment issues.", icon: "undo-2" },
    { message: "Rewriting history again? Brave.", icon: "undo-2" },
    { message: "Undo harder. Reality will eventually comply.", icon: "undo-2" },
  ],
  "colour-picker-hesitation": [
    { message: "Planning something devious, or just afraid of commitment?", icon: "pipette" },
    { message: "That colour isn’t going anywhere. Take your time.", icon: "pipette" },
    { message: "Careful. Too much thinking leads to decisions.", icon: "pipette" },
  ],
  "hidden-ui-discovery": [
    { message: "Well look at that—tiny art goblin discovered a secret.", icon: "search" },
    { message: "Oh? A curious one. We like that.", icon: "search" },
    { message: "Careful now. Poking strange things tends to reveal more strange things.", icon: "search" },
  ],
};

export const GOBLIN_AMBIENT_ICON = "sparkles";

export const GOBLIN_TRIGGER_RULES = {
  layerChaos: { threshold: 5, windowMs: 10_000 },
  undoSpam: { threshold: 5, windowMs: 2_000 },
  colourPickerSampleBurst: { threshold: 4, windowMs: 6_000 },
  colourPickerHoldMs: 800,
  ambient: {
    minDelayMs: 20_000,
    maxDelayMs: 60_000,
    cooldownMs: 15_000,
    idleThresholdMs: 8_000,
  },
} as const;

export const GOBLIN_HIDDEN_UI_TARGETS: readonly HiddenUiTargetConfig[] = [
  { id: "checkerboard-nav", selector: "#checkerboard-nav" },
  { id: "grid-nav", selector: "#grid-nav" },
  { id: "canvas-stage", selector: "#canvas-stage" },
  { id: "window-title-wrap", selector: ".window-title-wrap" },
] as const;

export function pickRandomItem<T>(items: readonly T[], random: () => number): T {
  const index = Math.min(items.length - 1, Math.floor(random() * items.length));
  return items[index] as T;
}
