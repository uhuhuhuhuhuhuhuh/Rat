// The riddles. Answers are stored only as salted SHA-256 prefixes
// (sha256("rat:" + answer), first 16 hex chars) so view-source doesn't spoil them.
// The LLM never sees the answers either -- it only gets the riddle text.
window.RIDDLES = [
  {
    text:
      "Who flies the winged rat?\n" +
      "Do not answer me. Answer my reflection,\n" +
      "where A looks back as Z and nothing faces forward:\n\n" +
      "        M L Y L W B",
    hashes: ["ae966875a2a3d204"],
    hint: "Hold the alphabet up to a mirror. The first letter sees the last.",
  },
  {
    text:
      "Three pairs of twins stand in a row, holding hands,\n" +
      "not one stranger between them.\n" +
      "They count what others spend, yet are no number.\n" +
      "Name the one who keeps them.",
    hashes: ["9f450aad357e5ed4", "bc7d7775464703a4"],
    hint: "oo. kk. ee. A ledger has a guardian.",
  },
  {
    text:
      "Count upward, and watch your letters misbehave.\n" +
      "Only one count keeps its letters in perfect order,\n" +
      "A before Z, never once stepping back.\n" +
      "What am I?",
    hashes: ["82ec0f3b600f9201", "d2f769b75e6328a5"],
    hint: "Spell them. All of them. You'll find me before you're old.",
  },
  {
    text:
      "I am three letters.\n" +
      "Give me two more, and I become less of myself.",
    hashes: ["042b4184cf7e2469"],
    hint: "Compare me to myself and I shrink.",
  },
  {
    text:
      "The rat reads aloud only what it sees.\n\n" +
      "        1\n        11\n        21\n        1211\n        111221\n\n" +
      "What does it read next?",
    hashes: ["d7e5e896ac2fb7e2"],
    hint: "Not math. Speech. 'One one.' 'Two ones.'",
  },
  {
    text:
      "Listen closely, little mouse.\n" +
      "Our walls are thin, and every room repeats.\n" +
      "Only the patient notice the door is a wall.\n" +
      "Point to the shape this place makes.",
    hashes: ["7bc8d5ccd4922c60"],
    hint: "Read me the way a poet hides a name: by my edges.",
  },
  {
    text:
      "You have walked very far.\n" +
      "So tell me again, and this time mean it:\n" +
      "who flies the winged rat?",
    hashes: ["ae966875a2a3d204"],
    hint: "You already know. You told me at the very beginning.",
    final: true,
  },
];
