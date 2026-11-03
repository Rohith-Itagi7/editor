// The agent panel's model: one turn of a conversation goes to the Messages API with the editor's page tools
// (mcp/tools.mjs) as its tools, and the answer comes back as it is. The page runs the tool calls it asks for
// and sends the results with the next turn, so the loop lives where the document is. The key is the server's:
//
//   ANTHROPIC_API_KEY  ANTHROPIC_MODELS (comma list, the first is used, default claude-sonnet-5-5)  ANTHROPIC_BASE_URL
import { GUIDE, TOOLS } from "./mcp/tools.mjs";
import { ModelError, ask } from "./model.mjs";

export const MAX_MESSAGES = 200;
export const MAX_AGENT_BYTES = 6 * 1024 * 1024; // one turn's conversation, pictures included

const SYSTEM = `You are the design agent inside the editor, working live on the file the user has open: they watch every step on the canvas and can undo it. Make what they ask for, then say in a sentence or two what you made.

How to work, fast and to a good standard:
- Orient once: get_basic_info (it has the fonts and tokens). Do not call it again, and skip tools you do not need.
- Create the artboard with its size in px ("1440px", not "1440") and its background, then add one section per write_html call, each a whole block with all its text, buttons and layout, not an element at a time.
- Take get_screenshot once when the design is whole, fix what is wrong in one pass with update_styles, and call it once more only if you changed something large. Then finish_working_on_nodes.
- Design: one typeface (Inter unless the file uses another), a clear scale (for a hero 56 to 72px headline, 18 to 20px body, 14 to 16px small text), spacing in multiples of 8, generous whitespace, a single accent color, text that reads on its background, and one primary action. Write real copy that fits the product, never lorem ipsum. Use the file's tokens as var(--color-name) when it has them.
- Sizes and spacing are px; set explicit widths on text blocks so lines wrap where you mean them to.

${GUIDE}`;

// The tools that answer with a document are left out; the file tools need no page and are the user's to use.
const LEFT_OUT = new Set(["export_combined_pdf"]);
const tools = TOOLS.filter((t) => t.where === "page" && !LEFT_OUT.has(t.name)).map((t) => {
  const { fileId, ...properties } = t.inputSchema.properties ?? {};
  return { name: t.name, description: t.description, input_schema: { ...t.inputSchema, properties } };
});

export const agentModel = (env = process.env) => (env.ANTHROPIC_MODELS ?? "claude-sonnet-5-5").split(",")[0].trim();

/** One turn: the conversation so far in, the model's `{ content, stop_reason }` out. */
export async function agentTurn(messages, env = process.env) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw new ModelError("The agent needs ANTHROPIC_API_KEY set where the server runs", 503);
  const data = await ask(`${env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: agentModel(env), max_tokens: 8192, system: SYSTEM, tools, messages }),
  }, "the agent model");
  return { content: data.content ?? [], stop_reason: data.stop_reason };
}
