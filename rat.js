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

// ---------- input ----------
function focusInput() { if (!state.busy) input.focus({ preventScroll: true }); }

input.addEventListener("input", () => { echo.textContent = input.value; scrollDown(); });
terminal.addEventListener("click", focusInput);
document.addEventListener("keydown", (e) => { if (!e.metaKey && !e.ctrlKey) focusInput(); });

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.busy) return;
  const value = input.value;
  input.value = "";
  echo.textContent = "";
  state.busy = true;
  form.classList.add("hidden");
  try { await handle(value); }
  finally {
    state.busy = false;
    form.classList.remove("hidden");
    scrollDown();
    focusInput();
  }
});

// ---------- boot ----------
(async function boot() {
  updateFooter();
  await sleep(1900);
  $("boot").remove();
  state.busy = true;
  if (state.loops > 0 || state.level > 0) {
    await say("you came back. of course you did.");
  } else {
    await say("hello.");
    await sleep(400);
    await say("i have some questions. you will have more.");
  }
  await say("(type WAKE to let the rat think for itself, HINT when you are desperate.)", "sys", 6);
  await sleep(300);
  await askCurrent();
  state.busy = false;
  form.classList.remove("hidden");
  focusInput();
})();
