// Default content seeded into the Challenge Builder for new sessions
export const DEFAULT_STORY = `The Last Message of Room 407 (Extended Version)

Mia walked through the empty corridor of the abandoned school. Dust covered the floor and broken windows let cold air slip inside. Most rooms were silent — but Room 407 wasn't.

When she pushed the door open, sunlight cut across an old desk. On it lay a folded piece of paper. The handwriting was rushed, almost frightened. The note read: "If you find this, please listen. The numbers are real. They tried to warn us, but no one believed."

Below the words were four numbers, scribbled with care: 3 — 1 — 4 — 2.

Mia frowned. She remembered the rumors: a student years ago had found something strange in this room and disappeared shortly after leaving a single message. The school had quickly abandoned the wing. Most people called it superstition. But the note in her hand felt heavier than rumor.

She read the message again. She saw the numbers. Slowly, the meaning began to take shape — the order in which events had happened, a sequence someone had wanted the next person to follow. She understood: this wasn't a prank. It was a warning passed down, hoping someone would finally listen.

Mia tightened her grip on the paper. Truth matters, she thought. And sometimes, the only way to honor it is to follow the message — and to make sure the next person hears it too.`;

export const DEFAULT_CHALLENGES = [
  {
    level: 1,
    type: "sequence",
    question_text:
      "Arrange these events in the correct order. Use the order to unlock Compartment 2.\n\n1. She reads the message\n2. She understands the meaning\n3. Mia finds the note\n4. She sees the numbers\n\nEnter the 4-digit code (the order numbers).",
    correct_answer_code: "3142",
    compartment_code: "3142",
    reveal_message: "Code Accepted! Open Physical Compartment 2. Scan the QR code inside to continue.",
    options: null,
    keywords: null,
  },
  {
    level: 2,
    type: "short_answer",
    question_text:
      "Why did the previous student leave the message? Answer in a sentence (mention 'warn' or 'truth').",
    correct_answer_code: null,
    keywords: ["warn", "warning", "truth", "listen"],
    compartment_code: "2539",
    reveal_message: "Great answer! Compartment 3 unlocked. Code for next padlock: 2 5 3 9.",
    options: null,
  },
  {
    level: 3,
    type: "multiple_choice",
    question_text:
      "Choose the best meaning of the word 'abandoned' in this story.",
    options: [
      { label: "A. Left Empty", code: "4718", is_correct: true },
      { label: "B. Left Destroyed", code: "1923", is_correct: false },
      { label: "C. Dangerous", code: "4417", is_correct: false },
    ],
    correct_answer_code: "A",
    compartment_code: "4718",
    reveal_message: "Correct! Code for Compartment 4: 4 7 1 8.",
    keywords: null,
  },
  {
    level: 4,
    type: "long_text",
    question_text:
      "Reflect on the lesson of the story. Why does the message matter? Mention 'truth' and the importance of listening to warnings.",
    correct_answer_code: null,
    keywords: ["truth", "listen", "warning", "matter"],
    compartment_code: "4971",
    reveal_message: "Beautiful reflection! Final code: 4 9 7 1.",
    options: null,
  },
  {
    level: 5,
    type: "final_riddle",
    question_text:
      "Final Riddle: I travel from one student to the next, never spoken aloud, but always heard by those who care. What am I?",
    correct_answer_code: "message",
    keywords: ["message"],
    compartment_code: "DONE",
    reveal_message: "You did it, Investigators!",
    options: null,
  },
];

export function genJoinCode() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}
