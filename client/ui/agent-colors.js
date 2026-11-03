// One color for each agent, so who is doing what can be told apart on the canvas, in the panel and in the layer outlines.
// The panel's agents are "Agent 1" to "Agent 10" and keep their color; any other agent that works in the file (over MCP)
// takes the next color the first time it shows up.
export const MAX_AGENTS = 10;
export const AGENT_COLORS = ["#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#ec4899", "#14b8a6", "#f97316", "#84cc16", "#06b6d4"];

const others = new Map();

export function agentColor(name) {
  const n = /^Agent (\d+)$/.exec(name ?? "")?.[1];
  if (n) return AGENT_COLORS[(Number(n) - 1) % AGENT_COLORS.length];
  const key = name ?? "Agent";
  if (!others.has(key)) others.set(key, AGENT_COLORS[others.size % AGENT_COLORS.length]);
  return others.get(key);
}
