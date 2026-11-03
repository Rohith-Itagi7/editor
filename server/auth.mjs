// Sign-in for the server, which is off unless it is started with { auth: true } (or EDITOR_AUTH=1 for
// serve.mjs). Accounts are kept by the server: an email, a name and a password hashed with scrypt, and a
// signed cookie that says who is asking. Nothing is sent anywhere else.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const COOKIE = "editor_session";
const DAY = 24 * 60 * 60 * 1000;
const SESSION_LENGTH = 30 * DAY;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const scrypt = (password, salt) => new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key))));

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function createAuth({ dataDir }) {
  // Beside the files, not among them: the file list reads every .json in the data folder.
  const folder = path.join(dataDir, "account");
  const usersFile = path.join(folder, "users.json");
  const secretFile = path.join(folder, "secret");
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  // The key that signs the cookies: made once, kept beside the data, readable by this user only.
  let secret;
  try {
    secret = await fs.readFile(secretFile);
  } catch {
    secret = crypto.randomBytes(32);
    await fs.writeFile(secretFile, secret, { mode: 0o600 });
  }
  const readUsers = async () => JSON.parse(await fs.readFile(usersFile, "utf8").catch(() => "[]"));
  const writeUsers = (users) => fs.writeFile(usersFile, JSON.stringify(users), { mode: 0o600 });
  const sign = (text) => crypto.createHmac("sha256", secret).update(text).digest("hex");
  const publicUser = ({ id, email, name }) => ({ id, email, name });

  // Failed sign-ins slow down: five misses on one email in ten minutes and it waits.
  const misses = new Map();
  const tooMany = (email) => (misses.get(email) ?? []).filter((t) => Date.now() - t < 10 * 60 * 1000).length >= 5;
  const miss = (email) => misses.set(email, [...(misses.get(email) ?? []).filter((t) => Date.now() - t < 10 * 60 * 1000), Date.now()]);

  const token = (user) => {
    const body = `${user.id}.${Date.now() + SESSION_LENGTH}`;
    return `${body}.${sign(body)}`;
  };
  const cookie = (user, secure) => `${COOKIE}=${token(user)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_LENGTH / 1000}${secure ? "; Secure" : ""}`;

  return {
    publicUser,
    cookie,
    clearCookie: () => `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,

    /** The user a request comes from, or null. Works for a plain request and for a WebSocket upgrade. */
    async userOf(req) {
      const raw = /(?:^|;\s*)editor_session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
      const [id, expires, mac] = (raw ?? "").split(".");
      if (!mac || Number(expires) < Date.now()) return null;
      const good = Buffer.from(sign(`${id}.${expires}`));
      const given = Buffer.from(mac);
      if (good.length !== given.length || !crypto.timingSafeEqual(good, given)) return null;
      return (await readUsers()).find((u) => u.id === id) ?? null;
    },

    /** Makes an account. The first one also takes the files that had no owner (the ones made before sign-in). */
    async signUp({ email, password, name }) {
      email = String(email ?? "").trim().toLowerCase();
      if (!EMAIL.test(email)) throw new AuthError("That is not an email address");
      if (typeof password !== "string" || password.length < 8) throw new AuthError("The password needs at least 8 characters");
      if (password.length > 200) throw new AuthError("The password is too long");
      const users = await readUsers();
      if (users.some((u) => u.email === email)) throw new AuthError("There is already an account with that email", 409);
      const salt = crypto.randomBytes(16);
      const user = { id: crypto.randomBytes(8).toString("hex"), email, name: String(name ?? "").trim().slice(0, 60) || email.split("@")[0], salt: salt.toString("hex"), hash: (await scrypt(password, salt)).toString("hex") };
      await writeUsers([...users, user]);
      return { user, first: users.length === 0 };
    },

    async signIn({ email, password }) {
      email = String(email ?? "").trim().toLowerCase();
      if (tooMany(email)) throw new AuthError("Too many tries. Wait ten minutes and try again", 429);
      const user = (await readUsers()).find((u) => u.email === email);
      const salt = Buffer.from(user?.salt ?? "00".repeat(16), "hex");
      const hash = await scrypt(String(password ?? ""), salt); // always computed, so a missing account takes as long as a wrong password
      if (!user || !crypto.timingSafeEqual(hash, Buffer.from(user.hash, "hex"))) {
        miss(email);
        throw new AuthError("The email or the password is wrong", 401);
      }
      return user;
    },
  };
}
