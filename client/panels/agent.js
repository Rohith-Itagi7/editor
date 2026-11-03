// The Agent tab of the left panel: ask for a design and a model makes it on the canvas. Up to ten agents work at once, each its
// own conversation and its own color (a chip for each along the top; + starts another). Each turn of a conversation goes to
// the server (POST /api/agent, server/agent.mjs), which asks the model; the tools it calls (the same ones an agent has over MCP)
// run here through `run`, on this page's own store, so every step is an undo step that saves and syncs, and the agent's pointer
// follows it (collab/agent-cursor.js). The conversations are kept while the page is open.
import { toast } from "../ui/toast.js";
import { MAX_AGENTS, agentColor } from "../ui/agent-colors.js";

const MAX_TURNS = 40; // model turns for one request: a stop for a loop that does not end
const MAX_TEXT = 30000;

const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** A tool's answer as the content of its result: pictures as pictures, the rest as text. */
function resultContent(answer) {
  const text = (value) => ({ type: "text", text: (typeof value === "string" ? value : JSON.stringify(value)).slice(0, MAX_TEXT) });
  if (answer === undefined || answer === null) return [text("Done.")];
  if (typeof answer !== "object" || !answer.images) return [text(answer)];
  return [...answer.images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mimeType, data: i.data } })), ...(answer.text !== undefined ? [text(answer.text)] : [])];
}

/** The conversation for the model: only the latest pictures stay, the earlier ones would be sent again each turn for nothing. */
function withoutOldPictures(messages) {
  const lastWithPictures = messages.findLastIndex((m) => Array.isArray(m.content) && m.content.some((b) => Array.isArray(b.content) && b.content.some((c) => c.type === "image")));
  return messages.map((m, i) => {
    if (i === lastWithPictures || !Array.isArray(m.content)) return m;
    return { ...m, content: m.content.map((b) => (Array.isArray(b.content) ? { ...b, content: b.content.map((c) => (c.type === "image" ? { type: "text", text: "(an earlier screenshot)" } : c)) } : b)) };
  });
}

/** `run(method, args, agentName)` runs one editor tool on the open file as that agent and answers what it answered. */
export function mountAgent({ left, run }) {
  const tabs = left.querySelector(".tabs");
  const tab = Object.assign(document.createElement("button"), { type: "button", textContent: "Agent" });
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-selected", "false");
  tabs.append(tab);

  const panel = Object.assign(document.createElement("section"), { className: "agent", hidden: true });
  panel.innerHTML = `<div class="agent-chips" role="tablist" aria-label="Agents"></div>
    <div class="agent-threads"></div>
    <form class="agent-form"><textarea name="prompt" rows="2" placeholder="Ask the agent…" aria-label="Message the agent"></textarea>
      <div class="agent-row"><label class="agent-count" title="More than one: they split the request between them and work at the same time">Agents
        <select name="count" aria-label="How many agents work on this">${[...Array(MAX_AGENTS).keys()].map((i) => `<option>${i + 1}</option>`).join("")}</select></label>
      <button type="submit" class="agent-send">Send</button></div></form>`;
  tabs.after(panel);
  const chips = panel.querySelector(".agent-chips");
  const threads = panel.querySelector(".agent-threads");
  const form = panel.querySelector(".agent-form");
  const input = form.elements.prompt;
  const send = form.querySelector(".agent-send");

  // The other two tabs are the Theme panel's (theme.js); this one hides what they show.
  const others = [...tabs.querySelectorAll("[role=tab]")].filter((b) => b !== tab);
  tabs.addEventListener("click", (event) => {
    const clicked = event.target.closest("[role=tab]");
    if (!clicked) return;
    const here = clicked === tab;
    left.toggleAttribute("data-agent", here);
    tab.setAttribute("aria-selected", String(here));
    panel.hidden = !here;
    if (here) { others.forEach((b) => b.setAttribute("aria-selected", "false")); left.querySelector(".theme")?.setAttribute("hidden", ""); input.focus(); }
  });

  // ---------- The agents: up to ten, each with a conversation, a name and a color ----------
  const agents = []; // { n, name, messages, thread, working }
  let active = null;

  function paintChips() {
    chips.replaceChildren(...agents.map((agent) => {
      const chip = Object.assign(document.createElement("button"), { type: "button", className: "agent-chip", title: agent.name });
      chip.setAttribute("role", "tab");
      chip.setAttribute("aria-selected", String(agent === active));
      chip.style.setProperty("--c", agentColor(agent.name));
      if (agent.working) chip.dataset.working = "";
      chip.innerHTML = `<i></i>${agent.n}`;
      chip.addEventListener("click", () => show(agent));
      return chip;
    }));
    if (agents.length < MAX_AGENTS) {
      const add = Object.assign(document.createElement("button"), { type: "button", className: "agent-add", title: "Another agent, working at the same time", textContent: "+" });
      add.setAttribute("aria-label", "Add an agent");
      add.addEventListener("click", () => { show(add_()); input.focus(); });
      chips.append(add);
    }
    if (agents.length > 1 && active && !active.working) {
      const close = Object.assign(document.createElement("button"), { type: "button", className: "agent-close", title: `Remove ${active.name}`, textContent: "×" });
      close.setAttribute("aria-label", `Remove ${active.name}`);
      close.addEventListener("click", () => remove(active));
      chips.append(close);
    }
  }

  function add_() {
    // The lowest number not taken: a removed agent's number and color are used again.
    const n = [...Array(MAX_AGENTS).keys()].map((i) => i + 1).find((i) => !agents.some((a) => a.n === i));
    const thread = Object.assign(document.createElement("div"), { className: "agent-thread", hidden: true });
    thread.setAttribute("aria-live", "polite");
    thread.innerHTML = `<p class="agent-empty">Ask for a design: “a pricing section with three cards”.</p>`;
    threads.append(thread);
    const agent = { n, name: `Agent ${n}`, messages: [], thread, working: null };
    agents.push(agent);
    agents.sort((a, b) => a.n - b.n);
    return agent;
  }

  function show(agent) {
    active = agent;
    panel.style.setProperty("--agent", agentColor(agent.name));
    agents.forEach((a) => { a.thread.hidden = a !== agent; });
    paintChips();
    paintForm();
    agent.thread.scrollTop = agent.thread.scrollHeight;
  }

  function remove(agent) {
    agent.thread.remove();
    agents.splice(agents.indexOf(agent), 1);
    show(agents[0]);
  }

  /** The box asks the agent in front; while that one works its button stops it. */
  function paintForm() {
    form.classList.toggle("busy", Boolean(active.working));
    send.textContent = active.working ? "Stop" : "Send";
  }

  const line = (agent, className, html) => {
    agent.thread.querySelector(".agent-empty")?.remove();
    const el = Object.assign(document.createElement("p"), { className: `agent-line ${className}`, innerHTML: html });
    agent.thread.append(el);
    agent.thread.scrollTop = agent.thread.scrollHeight;
    return el;
  };

  async function turn(agent, signal) {
    const response = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: withoutOldPictures(agent.messages) }), signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? `The agent answered ${response.status}`);
    return data;
  }

  /** Runs one request to the end in one agent's conversation. Answers what the agent said last, or null when it stopped or failed. */
  async function work(agent, text, shown = text) {
    const { messages } = agent;
    let said = "";
    messages.push({ role: "user", content: text });
    line(agent, "you", escape(shown));
    const controller = (agent.working = new AbortController());
    paintChips();
    paintForm();
    try {
      for (let i = 0; i < MAX_TURNS; i++) {
        const { content, stop_reason } = await turn(agent, controller.signal);
        messages.push({ role: "assistant", content });
        said = content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
        for (const block of content) if (block.type === "text" && block.text.trim()) line(agent, "reply", escape(block.text.trim()));
        const calls = content.filter((b) => b.type === "tool_use");
        if (stop_reason !== "tool_use" || !calls.length) return said;
        const results = [];
        for (const call of calls) {
          if (controller.signal.aborted) throw new DOMException("Stopped", "AbortError");
          const step = line(agent, "step", escape(call.name.replace(/_/g, " ")));
          try {
            results.push({ type: "tool_result", tool_use_id: call.id, content: resultContent(await run(call.name, call.input, agent.name)) });
          } catch (error) {
            step.classList.add("failed");
            step.title = error.message;
            results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: [{ type: "text", text: error.message }] });
          }
        }
        messages.push({ role: "user", content: results });
      }
      line(agent, "reply", "I stopped here after many steps. Tell me to go on if there is more to do.");
      return said;
    } catch (error) {
      if (error.name === "AbortError") line(agent, "reply", "Stopped.");
      else line(agent, "error", escape(error.message));
      // A conversation that ends on a tool call the model never saw answered cannot go on, so it starts over from the last whole turn.
      while (messages.length && messages.at(-1).role === "assistant" && messages.at(-1).content.some?.((b) => b.type === "tool_use")) messages.pop();
      return null;
    } finally {
      agent.working = null;
      paintChips();
      if (active === agent) paintForm();
    }
  }

  // ---------- A team: one request, several agents ----------
  const planPrompt = (request, n) => `You lead a team of ${n} designers who will work at the same time on this request: "${request}"

Do not design the parts yourself. With the tools: (1) decide the shared design language in a short paragraph (typeface, colors as hex, corner radius, spacing); (2) split the request into ${n} parts that can be built independently of each other; (3) create the shared frame they will all work in: one artboard (for a page: 1440px wide, a vertical flex column, height fit-content, with a background) holding ${n} frames, one for each part, in reading order, each named "<number> <part name>", width 100%, a vertical flex column, padding 96px 120px, gap 48px, align-items center, min-height 360px. Empty elements cannot be written with write_html, so write one frame with a placeholder text in it, duplicate it, then rename the copies and delete the placeholder text. Then answer with ONLY this JSON and nothing else: {"style": "<the design language>", "parts": [{"id": "<node ID of the part's frame>", "name": "<part name>", "brief": "<what this part holds, concretely, with the copy it needs>"}]}`;
  const partPrompt = (request, style, part, n) => `You are one of ${n} designers building this at the same time: "${request}"

Shared design language: ${style}

Your part is "${part.name}" (frame ID ${part.id}): ${part.brief}

Work ONLY inside your own frame: never edit the artboard or the other parts, the other designers are working in them right now. Put white-space: nowrap on buttons, nav links and short labels so they never break onto two lines. Real copy only, no lorem ipsum. Build the whole part in as few write_html calls as you can, check it with one screenshot, fix what is wrong, and finish.`;

  /** The plan out of the lead's last answer: { style, parts: [{ id, name, brief }] }, or null. */
  function planOf(text) {
    try {
      const plan = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      return Array.isArray(plan.parts) && plan.parts.length && plan.parts.every((p) => typeof p.id === "string" && typeof p.brief === "string") ? plan : null;
    } catch {
      return null;
    }
  }

  /** The agent in front leads: it sets up the shared frame and splits the request, then each part goes to an agent of its own. */
  async function team(lead, request, n) {
    lead.group = [lead];
    const said = await work(lead, planPrompt(request, n), request);
    if (said === null) return; // stopped, or it failed and said so
    const plan = planOf(said);
    if (!plan) return void line(lead, "error", "The plan did not come back as a list, so I could not split the work between agents. Try again.");
    const parts = plan.parts.slice(0, n);
    const members = parts.map((_, i) => (i === 0 ? lead : add_()));
    members.forEach((agent) => { agent.group = members; });
    line(lead, "reply", `Split between ${members.length} agents: ${parts.map((p, i) => `${members[i].n} ${p.name}`).join(", ")}.`);
    paintChips();
    await Promise.all(members.map((agent, i) => work(agent, partPrompt(request, plan.style, parts[i], parts.length), `Your part: ${parts[i].name}`)));
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    // Stop stops the whole team the agent in front belongs to.
    if (active.working) return (active.group ?? [active]).forEach((a) => a.working?.abort());
    const text = input.value.trim();
    if (!text) return;
    // As many agents as asked, as long as there are numbers left for them.
    const n = Math.min(Number(form.elements.count.value), MAX_AGENTS - agents.length + 1);
    if (n < Number(form.elements.count.value)) toast(`Only ${n} agents fit: ${MAX_AGENTS} at most`);
    input.value = "";
    (n > 1 ? team(active, text, n) : work(active, text)).catch((error) => toast(error.message));
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    event.stopPropagation(); // typing here is not a shortcut of the editor
  });

  show(add_());
}
