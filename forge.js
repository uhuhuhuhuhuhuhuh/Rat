// The forge: generates new riddles with exact answers, so they are always solvable
// (by someone very clever) and can be checked without trusting the LLM.
// FORGE.make(difficulty) -> { text, answers: [..], hint }. Higher difficulty stacks more layers.
(function () {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rint = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

  const WORDS = [
    ["labyrinth", "a place built so that you cannot leave"],
    ["palimpsest", "a page that remembers what was scraped away"],
    ["ouroboros", "a serpent that eats its own ending"],
    ["obsidian", "glass a volcano dreamed"],
    ["vertigo", "the floor's opinion of you, from above"],
    ["nocturne", "music for those who should be asleep"],
    ["cipher", "a lock with no door"],
    ["eclipse", "light hidden by its own neighbor"],
    ["quarantine", "forty days of loneliness"],
    ["whisper", "a scream that lost its nerve"],
    ["silhouette", "a person reduced to their edges"],
    ["penumbra", "the shadow that cannot commit"],
    ["paradox", "a truth that bites its own tail"],
    ["enigma", "everything here"],
    ["hourglass", "time, strangled at the waist"],
    ["catacomb", "a city for the very quiet"],
    ["sphinx", "the first to ask riddles, and eat the losers"],
    ["gargoyle", "a stone that spits rain"],
    ["lantern", "a cage for fire"],
    ["plague", "what rats carried before they carried riddles"],
    ["mnemonic", "a trick for forgetting less"],
    ["requiem", "a song for someone who cannot hear it"],
  ];

  const A = "abcdefghijklmnopqrstuvwxyz";
  const shiftChar = (c, k) => A[(A.indexOf(c) + k + 26) % 26];
  const vigenere = (w, key) => [...w].map((c, i) => shiftChar(c, A.indexOf(key[i % key.length]))).join("");
  const atbash = (w) => [...w].map((c) => A[25 - A.indexOf(c)]).join("");
  const rev = (s) => [...s].reverse().join("");
  const spaced = (s) => s.toUpperCase().split("").join(" ");

  // --- 1. layered cipher. The key is the answer to the very first riddle.
  function cipher(d) {
    const [word] = pick(WORDS);
    let c = vigenere(word, "nobody");
    const steps = ["First I locked it with the name of the one who flies me, letter by letter, A meaning stay."];
    if (d >= 1) { c = rev(c); steps.push("Then I read it from the end."); }
    if (d >= 2) { c = atbash(c); steps.push("Then I showed it to the mirror."); }
    if (d >= 3) {
      const k = rint(3, 11);
      c = [...c].map((ch) => shiftChar(ch, k)).join("");
      steps.push(`Then I let every letter walk ${["three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"][k - 3]} steps forward.`);
    }
    return {
      text: `I hid a word.\n${steps.join("\n")}\n\n        ${spaced(c)}\n\nGive me the word.`,
      answers: [word],
      hint: "Undo me backwards. The key is a nobody.",
    };
  }

  // --- 2. remainders (Chinese remainder theorem), told as a rat census.
  function census(d) {
    const sets = [[3, 5, 7], [4, 7, 9], [5, 7, 11], [7, 11, 13], [3, 7, 11, 13], [8, 11, 13, 17]];
    const mods = sets[Math.min(d, sets.length - 1)];
    const total = mods.reduce((a, b) => a * b, 1);
    const n = rint(Math.floor(total / 4), total - 1);
    const lines = mods.map((m) => `In rows of ${m}, ${n % m === 0 ? "none" : n % m} ${n % m === 1 ? "is" : "are"} left over.`);
    return {
      text: `The rats line up in the dark.\n${lines.join("\n")}\nThere are more than ${Math.floor(total / 4) - 1}, and fewer than ${total}.\n\nHow many rats?`,
      answers: [String(n)],
      hint: "An old Chinese general counted his soldiers this way.",
    };
  }

  // --- 3. sequences with hidden rules
  const isPrime = (n) => { if (n < 2) return false; for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
  const primesFrom = (k, count) => { const out = []; let n = 2, seen = 0; while (out.length < count) { if (isPrime(n)) { if (seen >= k) out.push(n); seen++; } n++; } return out; };
  const digitSum = (n) => [...String(n)].reduce((a, b) => a + Number(b), 0);
  const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const words = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + ONES[n % 10]);

  const RULES = [
    { name: "sum", hint: "Indivisible things, holding hands in pairs.",
      gen: (len) => { const k = rint(0, 12); const p = primesFrom(k, len + 1); return p.slice(0, len).map((x, i) => x + p[i + 1]); } },
    { name: "walk", hint: "Each number feeds on its own digits.",
      gen: (len) => { const out = [rint(11, 99)]; while (out.length < len) out.push(out.at(-1) + digitSum(out.at(-1))); return out; } },
    { name: "spell", hint: "Say them out loud. Then count what you said.",
      gen: (len) => { const s = rint(1, 60); return Array.from({ length: len }, (_, i) => words(s + i).length); } },
    { name: "pow", hint: "Double, double. Then add up the crumbs.",
      gen: (len) => { const s = rint(5, 20); return Array.from({ length: len }, (_, i) => digitSum(2n ** BigInt(s + i))); } },
    { name: "bits", hint: "Indivisible things, undressed down to ones and zeros. Count the ones.",
      gen: (len) => primesFrom(rint(3, 20), len).map((p) => p.toString(2).split("1").length - 1) },
  ];

  function sequence(d) {
    if (d < 3) {
      const rule = pick(d === 0 ? [RULES[0], RULES[1]] : RULES);
      const seq = rule.gen(7);
      return {
        text: `The rat scratches numbers into the wall:\n\n        ${seq.slice(0, 6).join(", ")}, ?\n\nWhat comes next?`,
        answers: [String(seq[6])],
        hint: rule.hint,
      };
    }
    // two rules braided together: odd places follow one, even places the other
    const [r1, r2] = [...RULES].sort(() => Math.random() - 0.5);
    const a = r1.gen(5), b = r2.gen(4);
    const braid = [a[0], b[0], a[1], b[1], a[2], b[2], a[3], b[3], a[4]];
    return {
      text: `Two rats scratch into the same wall, taking turns:\n\n        ${braid.slice(0, 8).join(", ")}, ?\n\nWhat comes next?`,
      answers: [String(braid[8])],
      hint: `Ignore the second rat. The first one: ${r1.hint.toLowerCase()}`,
    };
  }

  // --- 4. letters as numbers in a strange base
  function bones(d) {
    const [word, def] = pick(WORDS.filter(([w]) => w.length >= 5 && w.length <= 9));
    const base = word.length;
    const backwards = d >= 2;
    const nums = [...word].map((c) => (backwards ? 26 - A.indexOf(c) : A.indexOf(c) + 1).toString(base));
    const baseLine = d === 0
      ? `I count on ${base} fingers.`
      : "I count on as many fingers as I have letters.";
    const order = backwards ? "Z is one, and A is the last." : "A is one.";
    return {
      text: `Each of my letters is a number.\n${baseLine} ${order}\n\n        ${nums.join("  ")}\n\nWhat am I?`,
      answers: [word],
      hint: d === 0 ? `You have ten fingers. I have ${base}. I am ${def}.` : `Count the numbers. That is how many fingers. I am ${def}.`,
    };
  }

  // --- 5. anagram with a cryptic definition
  function scramble(d) {
    const [word, def] = pick(WORDS);
    let s;
    do { s = [...word].sort(() => Math.random() - 0.5).join(""); } while (s === word);
    if (d >= 2) s = atbash(s);
    const extra = d >= 2 ? "\nThe mirror got to them first." : "";
    return {
      text: `My letters fell out of order:\n\n        ${spaced(s)}\n${extra}\nI am ${def}.`,
      answers: [word],
      hint: d >= 2 ? "Mirror first. Then rearrange." : "Same letters. Different word.",
    };
  }

  const KINDS = [cipher, census, sequence, bones, scramble];

  window.FORGE = {
    make(difficulty, avoid) {
      const kinds = KINDS.filter((k) => k.name !== avoid);
      const kind = pick(kinds);
      return { ...kind(difficulty), kind: kind.name };
    },
  };
})();
