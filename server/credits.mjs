// Credits for the agent panel: a turn of its conversation costs one, and it does not run when none are left. Each
// account (or this machine, with sign-in off) has an allowance that is whole again each month, kept in a file beside
// the account data. It is a guard on what the provider key can spend, not a payment; EDITOR_CREDITS=unlimited turns
// it off.
import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_ALLOWANCE = 100;
export const DEFAULT_COSTS = { agent: 1 }; // for each turn of the agent's conversation

const monthOf = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

/** The credits an account gets each month: EDITOR_CREDITS as a number, "unlimited" (Infinity), or the default. */
export function allowanceFrom(env = process.env) {
  const setting = String(env.EDITOR_CREDITS ?? "").trim().toLowerCase();
  if (setting === "unlimited") return Infinity;
  const amount = Number(setting);
  return setting && Number.isFinite(amount) && amount >= 0 ? amount : DEFAULT_ALLOWANCE;
}

/** What one use of `kind` costs: EDITOR_COST_<KIND> in the environment, or the default. */
export function costFrom(kind, env = process.env) {
  const amount = Number(env[`EDITOR_COST_${kind.toUpperCase()}`]);
  return Number.isFinite(amount) && amount >= 0 ? amount : DEFAULT_COSTS[kind];
}

export function createCredits({ dataDir, now = () => new Date(), env = process.env }) {
  const file = path.join(dataDir, "account", "usage.json");

  // usage.json: { <account>: { month: "2026-11", spent: 3 } }
  const load = async () => JSON.parse(await fs.readFile(file, "utf8").catch(() => "{}"));
  const store = async (usage) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(usage));
  };

  /** What an account has used this month and what is left (null when there is no limit). */
  function standing(usage, who) {
    const month = monthOf(now());
    const spent = usage[who]?.month === month ? usage[who].spent : 0;
    const allowance = allowanceFrom(env);
    const limited = Number.isFinite(allowance);
    return { allowance: limited ? allowance : null, spent, remaining: limited ? Math.max(0, allowance - spent) : null, month };
  }

  // One change at a time, so two requests can never both spend the last credits.
  let line = Promise.resolve();
  const alone = (job) => (line = line.then(job, job));

  return {
    balance: (who) => alone(async () => standing(await load(), who)),

    /** Takes `cost` credits, or throws (status 402) saying how many are left. */
    spend: (who, cost) => alone(async () => {
      const usage = await load();
      const { remaining, month, spent } = standing(usage, who);
      if (remaining !== null && cost > remaining) {
        throw Object.assign(new Error(`That costs ${cost} credits and ${remaining} are left this month`), { status: 402 });
      }
      usage[who] = { month, spent: spent + cost };
      await store(usage);
    }),

    /** Gives credits back, when what was paid for did not happen. */
    refund: (who, cost) => alone(async () => {
      const usage = await load();
      const { month, spent } = standing(usage, who);
      usage[who] = { month, spent: Math.max(0, spent - cost) };
      await store(usage);
    }),
  };
}
