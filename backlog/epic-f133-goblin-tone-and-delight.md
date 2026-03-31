# Goblin Tone And Delight

- Canonical IDs: `F1.33`
- Status: follow-up
- Summary or outcome: reinforce Vision Goblin personality through rotating subtitle copy, ambient commentary, and lightweight behaviour-triggered easter eggs that reward messy creative habits without interrupting editing.

## Scope

- Rotating slogan system: store approved slogan strings in a config-backed JSON array, select one slogan per app launch, and render it in the `window-subtitle` element with the exact prefix `Goblin note:`.
- Approved slogan set:
  1. Goblin note: smudging, scribbling, overpainting, and “just one more tweak” all count as artistic genius in this establishment.
  2. Goblin note: accidental masterpieces, aggressive undo spam, and suspiciously large brush sizes are fully encouraged here.
  3. Goblin note: 73 layers, zero organisation, and vibes-based editing are not only allowed—they’re respected.
  4. Goblin note: if it looks wrong, add more paint until it looks intentional.
  5. Goblin note: zooming to 800% to fix a single pixel is a completely rational and healthy behaviour.
  6. Goblin note: if you haven’t flipped the canvas 12 times, you’re not done yet.
  7. Goblin note: every piece starts as “just a quick edit” and ends as a life decision.
  8. Goblin note: the blur tool is not a mistake—it’s a lifestyle.
  9. Goblin note: colour picking from other people’s art is called research.
  10. Goblin note: trust the process. the process is chaos, but trust it anyway.
  11. Goblin note: nothing is ruined. it is merely evolving into something else.
  12. Goblin note: you don’t make mistakes. you discover alternate outcomes.
  13. Goblin note: that wasn’t a slip. that was a bold artistic decision.
  14. Goblin note: subtlety is optional. drama is encouraged.
  15. Goblin note: art is just controlled accidents with confidence.
  16. Goblin note: the line between “finished” and “ruined” is negotiable.
  17. Goblin note: bold strokes now, consequences later.
  18. Goblin note: every great piece contains at least one regrettable decision.
  19. Goblin note: if it’s slightly off, it’s called character.
  20. Goblin note: that looks terrible. keep going.
  21. Goblin note: if you zoom out far enough, it’s incredible.
  22. Goblin note: we are 3 brush strokes away from greatness. probably.
  23. Goblin note: this is fine. everything is fine. keep painting.
  24. Goblin note: one wrong click away from a breakthrough.
- Ambient random goblin commentary: add a third interaction layer of lightweight non-blocking toast or subtle overlay messages that appear periodically during active use without requiring specific discoverable triggers.
- Ambient commentary behaviour model:
  - Trigger model: time-and-activity based rather than event-specific.
  - Frequency: randomized between 20 and 60 seconds during active interaction.
  - Cooldown: minimum 15 seconds between commentary messages.
  - Eligibility: only while the user is actively editing through continuous actions such as brush use, repeated edits, or transforms.
  - Delivery: normal toast or subtle overlay that does not take focus or block input.
- Approved ambient commentary pool for initial launch:
  1. Goblin note: that was a risky move. we respect it.
  2. Goblin note: you’ve made it worse in a very interesting way.
  3. Goblin note: oh, we’re committing to that. alright.
  4. Goblin note: bold. confusing, but bold.
  5. Goblin note: that didn’t go how you expected, did it.
  6. Goblin note: we’re learning things. unclear what, but still.
  7. Goblin note: that choice will have consequences. probably.
  8. Goblin note: hmm. not what we would’ve done. fascinating.
  9. Goblin note: you’re doubling down. admirable.
  10. Goblin note: we see the vision. it is faint, but it’s there.
  11. Goblin note: that was either intentional or very confident.
  12. Goblin note: interesting direction. unexpected. possibly dangerous.
  13. Goblin note: we’re not stopping. that’s the spirit.
  14. Goblin note: something just happened. we’re processing it.
  15. Goblin note: you seem sure about this. that helps.
  16. Goblin note: that’s one way to approach it. not a common one.
  17. Goblin note: we’ve crossed a line. unclear which one.
  18. Goblin note: yes. keep doing… whatever this is.
  19. Goblin note: this is getting harder to explain. good.
  20. Goblin note: we are witnessing a sequence of decisions.
- Behaviour-triggered easter eggs: add normal non-blocking toasts or snackbars with icons for four initial trigger families, each firing at most once per session by default:
  - Layer chaos detection: trigger from rapid layer creation or stacking, with an initial product threshold of 5 new layers within 10 seconds.
  - Undo spam detection: trigger from rapid undo usage, with an initial product threshold of 5 undo actions within 2 seconds.
  - Colour picker hesitation: trigger from an extended hover or repeated sampling burst, with an initial product threshold of either an 800 ms hold or 4 samples within 6 seconds.
  - Hidden UI discovery: trigger from clicking predefined non-primary UI targets such as a canvas border, grid toggle, or decorative icon.
- Approved message pools for initial launch:
  - Layer chaos:
    - Ah yes, the ancient technique: more layers will fix it. Bold.
    - Magnificent. A towering monument of layers. Surely this will end well.
    - One more layer ought to do it. It never is, but we respect the optimism.
  - Undo spam:
    - Fascinating. We call this time travel with commitment issues.
    - Rewriting history again? Brave.
    - Undo harder. Reality will eventually comply.
  - Colour picker hesitation:
    - Planning something devious, or just afraid of commitment?
    - That colour isn’t going anywhere. Take your time.
    - Careful. Too much thinking leads to decisions.
  - Hidden UI discovery:
    - Well look at that—tiny art goblin discovered a secret.
    - Oh? A curious one. We like that.
    - Careful now. Poking strange things tends to reveal more strange things.
- Tone and UX guardrails: keep copy observational, slightly sarcastic, chaotic, playful, and validating rather than shaming; keep notifications non-blocking; show feedback within 300 ms of an eligible trigger; keep commentary context-aware in feel without pretending to be precise; do not persist trigger history beyond the current session.
- Extensibility: keep slogan, ambient commentary, trigger, and message content easy to extend without changing product behavior definitions each time new copy is added.

## Acceptance Criteria

- One approved slogan from the maintained slogan set appears in `window-subtitle` on app launch and remains stable for that session.
- Slogans are managed as config content rather than one-off hardcoded strings, so future additions do not require changing the rotation concept.
- Ambient commentary has a defined active-use eligibility model, randomized 20 to 60 second cadence, 15 second minimum cooldown, bounded message pool, and non-blocking delivery pattern.
- During active editing, the app can surface ambient commentary without requiring a specific easter-egg trigger and without interrupting editing input or appearing while the user is idle.
- Each easter egg trigger family has a defined default threshold, a bounded message pool, and a normal toast or snackbar pattern with icon support.
- When a user crosses an approved threshold for one of the four trigger families, the app shows a non-blocking toast within 300 ms and does not interrupt editing input.
- Each trigger family fires at most once per session unless product later approves a cooldown-based repeat model.
- Copy across slogans, ambient commentary, and easter eggs preserves the goblin tone of messy-creativity validation and does not read as error messaging or feature education.

## Related

- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
- Future index: `backlog/index-future.md`
- Follow-up note: rotating subtitle slogans, dedicated goblin toasts, once-per-session easter egg triggers, and activity-gated ambient commentary shipped for the initial desktop implementation. Follow-up should focus on tuning cadence, expanding hidden-target coverage carefully, and validating trigger feel against real editing sessions.
