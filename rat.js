// <?> -- a riddle terminal. A tiny LLM runs in your browser (WebLLM + WebGPU)
// and does the taunting; answers are checked here, deterministically.

const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/+esm";
// ~0.5B params, ~300 MB download, cached by the browser after the first load.
// Small on purpose: it should be confidently, unhelpfully weird.
// The f32 build is for GPUs without 16-bit float shaders.
const MODEL_F16 = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
const MODEL_F32 = "Qwen2.5-0.5B-Instruct-q4f32_1-MLC";

const RIDDLES = window.RIDDLES;
const $ = (id) => document.getElementById(id);
const log = $("log");
const form = $("prompt");
const input = $("input");
const echo = $("echo");
const terminal = $("terminal");

// ---------- persistence (best effort; private windows may refuse) ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem("rat:" + key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("rat:" + key, JSON.stringify(value)); } catch {}
  },
};

const state = {
  level: Math.min(store.get("level", 0), RIDDLES.length - 1),
  loops: store.get("loops", 0),
  misses: 0,
  busy: false,
  engine: null,
  waking: false,
  history: [],
  forged: store.get("forged", null), // the riddle the rat invented for a forge slot
  offenses: store.get("offenses", 0), // tab switches / pastes on the current question
  lockouts: store.get("lockouts", 0),
};

// ---------- output ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function scrollDown() { terminal.scrollTop = terminal.scrollHeight; }

async function say(text, cls = "", speed = 22) {
  const p = document.createElement("p");
  if (cls) p.className = cls;
  log.appendChild(p);
  for (const ch of text) {
    p.textContent += ch;
    scrollDown();
    if (speed) await sleep(ch === "\n" ? speed * 6 : speed + Math.random() * speed);
  }
  return p;
}

function line(text, cls = "") {
  const p = document.createElement("p");
  if (cls) p.className = cls;
  p.textContent = text;
  log.appendChild(p);
  scrollDown();
  return p;
}

function glitch() {
  document.body.classList.remove("glitch");
  void document.body.offsetWidth;
  document.body.classList.add("glitch");
}

function updateFooter() { $("loops").textContent = `LOOP ${state.loops}`; }

// ---------- answers ----------
function normalize(s) {
  return s.toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/^\s*(a|an|the|it s|its|is it|i am|you are)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function hash(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("rat:" + s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function isCorrect(raw, riddle) {
  const n = normalize(raw);
  const candidates = new Set([n, n.replace(/ /g, "")]);
  for (const c of candidates) {
    if (riddle.hashes.includes(await hash(c))) return true;
  }
  return false;
}

// ---------- the rat's mouth ----------
const TAUNTS = [
  (u) => `"${u}". say it backwards: "${[...u].reverse().join("")}". no better.`,
  () => "wrong. but wrong in an interesting direction.",
  () => "you're close. closer than yesterday. further than tomorrow.",
  () => "the rat heard you. the rat is laughing. the rat has no mouth.",
  (u) => `${u.length} letters of nothing.`,
  () => "ask the question again, but slower. no. slower than that.",
  () => "every answer is a door. that one was painted on the wall.",
  () => "no.",
  () => "i'd tell you, but then you'd know.",
  (u) => `"${u}"? i said that once. it didn't work for me either.`,
  () => "you're not lost. you're exactly where i put you.",
  () => "count again. count the counting.",
];

const LIES = /\b(correct|right answer|you got it|well done|congrat|you win|that's it|yes!)/i;

function scriptedTaunt(userText) {
  const u = userText.slice(0, 40).toLowerCase();
  return TAUNTS[Math.floor(Math.random() * TAUNTS.length)](u);
}

function systemPrompt(riddle) {
  return [
    "You are the Rat, a smug, creepy riddler living inside an old green computer terminal.",
    "The visitor is trying to solve this riddle:",
    '"""', riddle.text, '"""',
    "You do NOT know the answer. Never guess it, never suggest answers, never say they are right.",
    "Reply in one or two short sentences, all lowercase.",
    "Be unhelpful: answer questions with questions, talk in riddles, contradict yourself, send them in circles.",
    "Never mention being an AI, a model, or an assistant.",
  ].join("\n");
}

async function ratReply(userText, riddle) {
  if (!state.engine) return scriptedTaunt(userText);
  state.history.push({ role: "user", content: userText });
  state.history = state.history.slice(-6);
  try {
    const res = await state.engine.chat.completions.create({
      messages: [{ role: "system", content: systemPrompt(riddle) }, ...state.history],
      temperature: 1.15,
      top_p: 0.95,
      max_tokens: 60,
    });
    let out = (res.choices[0]?.message?.content || "").trim().toLowerCase();
    out = out.replace(/^["'\s]+|["'\s]+$/g, "").split(/(?<=[.?!])\s+/).slice(0, 2).join(" ");
    if (!out || LIES.test(out)) out = scriptedTaunt(userText);
    state.history.push({ role: "assistant", content: out });
    return out;
  } catch (err) {
    console.error(err);
    return scriptedTaunt(userText);
  }
}

// ---------- waking the model ----------
async function wake() {
  if (state.engine) return say("it is already awake. it was always awake.");
  if (state.waking) return say("patience. it is still crawling up the pipes.");
  const adapter = await navigator.gpu?.requestAdapter().catch(() => null);
  if (!adapter) {
    await say("your machine has no WebGPU. the rat cannot think here.", "bad");
    return say("it will improvise instead. it is better at that anyway.");
  }
  state.waking = true;
  await say("waking the rat. this downloads ~300 MB once, then it lives in your browser.", "sys", 8);
  const progress = line("[                    ] 0%", "sys");
  try {
    const webllm = await import(WEBLLM_URL);
    const model = adapter.features.has("shader-f16") ? MODEL_F16 : MODEL_F32;
    state.engine = await webllm.CreateMLCEngine(model, {
      initProgressCallback: ({ progress: p = 0 }) => {
        const n = Math.round(p * 20);
        progress.textContent = `[${"#".repeat(n)}${" ".repeat(20 - n)}] ${Math.round(p * 100)}%`;
      },
    });
    glitch();
    await say("...it's awake. it doesn't know the answers either. that has never stopped it.");
  } catch (err) {
    console.error(err);
    await say("the rat would not wake. it will improvise instead.", "bad");
  } finally {
    state.waking = false;
  }
}

// ---------- flow ----------
const current = () => (RIDDLES[state.level].forge ? state.forged : RIDDLES[state.level]);

const FORGE_INTROS = [
  "i'm bored of the old ones. i'll make you a new one.",
  "wait. let me think of something worse.",
  "nobody has ever seen this one. i only just thought of it.",
  "this one is fresh. it still twitches.",
];

async function forgeIntro() {
  if (!state.engine) return FORGE_INTROS[Math.floor(Math.random() * FORGE_INTROS.length)];
  try {
    const res = await state.engine.chat.completions.create({
      messages: [
        { role: "system", content: "You are the Rat, a smug, creepy riddler in an old green terminal. All lowercase. One short sentence only." },
        { role: "user", content: "Announce, ominously, that you are inventing a brand new riddle that is much harder than the last one. Do not write the riddle." },
      ],
      temperature: 1.1,
      max_tokens: 40,
    });
    const out = (res.choices[0]?.message?.content || "").trim().toLowerCase().split(/(?<=[.?!])\s+/)[0];
    if (out) return out;
  } catch (err) { console.error(err); }
  return FORGE_INTROS[0];
}

// Invent a riddle for the current forge slot. Only hashes of the answers are kept.
async function forgeNew() {
  const slot = RIDDLES.slice(0, state.level).filter((r) => r.forge).length;
  const r = FORGE.make(state.loops + slot, store.get("lastKind", null));
  const hashes = await Promise.all(r.answers.map((a) => hash(normalize(a))));
  state.forged = { text: r.text, hint: r.hint, hashes };
  store.set("forged", state.forged);
  store.set("lastKind", r.kind);
}

async function askCurrent(prefix) {
  if (prefix) await say(prefix);
  if (RIDDLES[state.level].forge && !state.forged) {
    const intro = forgeIntro();
    const thinking = line("...", "sys");
    await forgeNew();
    const said = await intro;
    thinking.remove();
    await say(said);
  }
  await say(current().text, "riddle", 18);
}

async function solve() {
  const r = current();
  glitch();
  state.misses = 0;
  state.history = [];
  state.offenses = 0;
  store.set("offenses", 0);
  if (RIDDLES[state.level].forge) {
    state.forged = null;
    store.set("forged", null);
  }
  if (r.final) {
    state.level = 0;
    state.loops += 1;
    store.set("loops", state.loops);
    store.set("level", 0);
    updateFooter();
    await say("yes. nobody.");
    await sleep(500);
    await say("and nobody has been here before.", "bad");
    await sleep(900);
    log.innerHTML = "";
    await askCurrent(state.loops > 1 ? `again. (${state.loops} times now.)` : "again.");
    return;
  }
  state.level += 1;
  store.set("level", state.level);
  const praise = ["...fine.", "lucky.", "that one was the easy one.", "the walls shift.", "you're starting to sound like me."];
  await say(praise[Math.floor(Math.random() * praise.length)]);
  await sleep(300);
  await askCurrent();
}

async function handle(raw) {
  const text = raw.trim();
  if (!text) return;
  line(text, "you");
  const r = current();
  const cmd = text.toLowerCase();

  if (cmd === "wake") return wake();
  if (cmd === "clear") { log.innerHTML = ""; return askCurrent(); }
  if (cmd === "again" || cmd === "repeat") return askCurrent();
  if (cmd === "help") {
    return say("help is a four-letter word. try: hint, again, wake. or try thinking.");
  }
  if (cmd === "hint") {
    if (state.misses < 3) return say(`earn it. ${3 - state.misses} more wrong answers.`);
    return say(r.hint);
  }

  if (await isCorrect(text, r)) return solve();

  state.misses += 1;
  const thinking = state.engine ? line("...", "sys") : null;
  const reply = await ratReply(text, r);
  thinking?.remove();
  await say(reply);
}

// ---------- turns: one thing at a time on screen ----------
const queue = [];

// Run fn with the prompt hidden. If something is already running, wait for it.
function exclusive(fn) {
  return new Promise((resolve) => {
    queue.push({ fn, resolve });
    if (!state.busy) drain();
  });
}

async function drain() {
  while (queue.length) {
    const { fn, resolve } = queue.shift();
    state.busy = true;
    form.classList.add("hidden");
    try { await fn(); } catch (err) { console.error(err); }
    resolve();
  }
  state.busy = false;
  if (!lock.active) {
    form.classList.remove("hidden");
    scrollDown();
    focusInput();
  }
}

// ---------- the rat is watching ----------
// Leaving the tab or window (or pasting) counts as an offense on the current question.
// 1: it notices. 2: it gets angry. 3+: it locks you out.
const AWAY_TITLES = ["come back.", "i can see you.", "<!>", "the answer isn't there.", "<?>"];
const TITLE = document.title;
let awaySince = null;
let titleTimer = null;

function leave() {
  if (awaySince !== null || state.waking) return; // model download is a fair reason to wander
  awaySince = Date.now();
  let i = 0;
  const flip = () => { document.title = AWAY_TITLES[i++ % AWAY_TITLES.length]; };
  clearInterval(titleTimer);
  flip();
  titleTimer = setInterval(flip, 1500);
}

function back() {
  if (awaySince === null) return;
  const secs = (Date.now() - awaySince) / 1000;
  awaySince = null;
  clearInterval(titleTimer);
  document.title = TITLE;
  if (lock.active) return lock.resume(secs);
  if (secs < 1 || !booted) return;
  offend("away", secs);
}

document.addEventListener("visibilitychange", () => (document.hidden ? leave() : back()));
window.addEventListener("blur", leave);
window.addEventListener("focus", back);
input.addEventListener("paste", (e) => { e.preventDefault(); offend("paste"); });
document.addEventListener("contextmenu", (e) => { e.preventDefault(); if (booted) offend("inspect"); });

const NOTICED = {
  away: (t) => [`you left. ${t} seconds. who did you ask?`, `${t} seconds. the answer isn't out there. it's in here.`, `i noticed. i always notice.`],
  paste: () => ["you pasted that. the rat does not accept gifts.", "copied answers taste like paper."],
  inspect: () => ["looking for my insides? i don't have any.", "right-clicking won't open me."],
};
const ANGRY = [
  "AGAIN? i asked you a question and you ran off to cheat.",
  "do that once more. i dare you.",
  "you think i can't see the other tabs? i can see ALL of them.",
];

function scramble(text) {
  return [...text].map((c) => (/[a-z]/i.test(c) && Math.random() < 0.35 ? "#$%&@?!"[Math.floor(Math.random() * 7)] : c)).join("");
}

async function angryLine(what, secs) {
  if (!state.engine) return null;
  const did = what === "away" ? `left the page for ${Math.round(secs)} seconds, probably to search for the answer` : what === "paste" ? "pasted an answer from somewhere else" : "tried to inspect the page";
  try {
    const res = await state.engine.chat.completions.create({
      messages: [
        { role: "system", content: "You are the Rat, a creepy riddler in an old terminal. You are furious. One short sentence, all lowercase. Never helpful." },
        { role: "user", content: `The visitor just ${did} instead of solving your riddle. Scold them.` },
      ],
      temperature: 1.1,
      max_tokens: 40,
    });
    return (res.choices[0]?.message?.content || "").trim().toLowerCase().split(/(?<=[.?!])\s+/)[0] || null;
  } catch { return null; }
}

function offend(what, secs = 0) {
  if (lock.active || lock.pending) return;
  state.offenses += 1;
  store.set("offenses", state.offenses);
  const n = state.offenses;
  const t = Math.round(secs);
  if (n >= 3) lock.pending = true;
  exclusive(async () => {
    if (n === 1) {
      const lines = NOTICED[what](t);
      await say(lines[Math.floor(Math.random() * lines.length)]);
    } else if (n === 2) {
      glitch();
      document.body.classList.add("angry");
      const llm = await angryLine(what, secs);
      await say((llm || ANGRY[Math.floor(Math.random() * ANGRY.length)]).toUpperCase(), "bad", 30);
      const p = line(scramble(current().text), "riddle bad");
      await sleep(1600);
      p.remove();
      await say("one more time and i lock the door.", "bad");
      setTimeout(() => document.body.classList.remove("angry"), 2500);
    } else {
      await lock.start();
    }
  });
}

// ---------- lockout ----------
const lock = {
  active: false,
  pending: false,
  remaining: 0, // ms; only counts down while the page is watched
  el: null,
  timer: null,
  last: 0,

  async start(resumeMs) {
    this.active = true;
    this.pending = false;
    form.classList.add("hidden");
    if (resumeMs === undefined) {
      state.lockouts += 1;
      store.set("lockouts", state.lockouts);
      this.remaining = Math.min(15 + 15 * state.lockouts, 120) * 1000;
    } else {
      this.remaining = resumeMs;
    }
    store.set("lockRemaining", this.remaining);

    const el = document.createElement("div");
    el.className = "lockout";
    el.innerHTML = `<div class="lock-box">
      <div class="lock-head">ACCESS SUSPENDED</div>
      <div class="lock-log"></div>
      <div class="lock-count"></div>
      <div class="lock-foot">the clock only runs while you watch.</div>
    </div>`;
    document.body.appendChild(el);
    this.el = el;
    const finished = new Promise((r) => (this.done = r));
    glitch();
    this.last = Date.now();
    this.tick();
    this.timer = setInterval(() => this.tick(), 250);

    const hex = () => Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, "0");
    const lines = [
      `> violation #${state.lockouts} logged: subject left the room`,
      `> session ${hex()}-${hex()}-${hex()} flagged`,
      "> revoking keyboard privileges........ done",
      "> notifying the other rats............ done",
      `> offense count, this question: ${Math.max(state.offenses, 3)}`,
      "> sit still. look at me.",
    ];
    const logEl = el.querySelector(".lock-log");
    for (const l of lines) {
      if (!this.active) break;
      const d = document.createElement("div");
      logEl.appendChild(d);
      for (const ch of l) { d.textContent += ch; await sleep(12); }
      await sleep(120);
    }
    await finished;
  },

  tick() {
    if (awaySince !== null) return; // paused while they're gone
    const now = Date.now();
    this.remaining -= now - this.last;
    this.last = now;
    store.set("lockRemaining", Math.max(this.remaining, 0));
    const s = Math.max(0, Math.ceil(this.remaining / 1000));
    this.el.querySelector(".lock-count").textContent =
      `RE-ENTRY IN ${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    if (this.remaining <= 0) this.end();
  },

  // Leaving during a lockout makes it longer.
  resume(secs) {
    this.last = Date.now();
    if (secs >= 1) {
      this.remaining += 10000;
      const d = document.createElement("div");
      d.className = "lock-pen";
      d.textContent = `> you left again. +10 seconds.`;
      this.el.querySelector(".lock-log").appendChild(d);
      glitch();
    }
    this.tick();
  },

  end() {
    clearInterval(this.timer);
    this.el.remove();
    this.active = false;
    state.offenses = 0;
    store.set("offenses", 0);
    store.set("lockRemaining", 0);
    this.done?.();
    exclusive(async () => {
      await say("...you may continue. i'll be watching more closely now.", "bad");
      await askCurrent();
    });
  },
};

// ---------- input ----------
let booted = false;
function focusInput() { if (!state.busy && !lock.active) input.focus({ preventScroll: true }); }

input.addEventListener("input", () => { echo.textContent = input.value; scrollDown(); });
terminal.addEventListener("click", focusInput);
document.addEventListener("keydown", (e) => { if (!e.metaKey && !e.ctrlKey) focusInput(); });

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (state.busy || lock.active) return;
  const value = input.value;
  input.value = "";
  echo.textContent = "";
  exclusive(() => handle(value));
});

// ---------- boot ----------
(async function boot() {
  updateFooter();
  await sleep(1900);
  $("boot").remove();
  const locked = store.get("lockRemaining", 0);
  await exclusive(async () => {
    if (locked > 0) {
      await say("you thought reloading would help?", "bad");
      booted = true;
      lock.start(locked); // finishes later; end() re-asks the riddle
      return;
    }
    if (state.loops > 0 || state.level > 0) {
      await say("you came back. of course you did.");
    } else {
      await say("hello.");
      await sleep(400);
      await say("i have some questions. you will have more.");
    }
    await say("(type WAKE to let the rat think for itself, HINT when you are desperate.)", "sys", 6);
    await say("(and don't leave. it notices.)", "sys", 6);
    await sleep(300);
    await askCurrent();
    booted = true;
  });
})();
