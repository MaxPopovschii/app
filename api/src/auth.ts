import { Request, Response, NextFunction } from "express";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import {
  IdentityStore,
  User,
  Agency,
  Session,
  digest,
  verifyPassword,
  hashPassword,
  validPassword,
} from "@launchcheck/shared";
export interface Identity {
  user: User;
  agency: Agency;
  tokenHash: string;
  csrf: string;
}
export interface AuthOptions {
  identities: IdentityStore;
  secret: string;
  secureCookies: boolean;
  publicOrigin: string;
}
export const safeUser = (value: Identity) => ({
  id: value.user.id,
  email: value.user.email,
  name: value.user.name,
  role: value.user.role,
  agency: {
    id: value.agency.id,
    name: value.agency.name,
    retentionDays: value.agency.retentionDays,
    shareDays: value.agency.shareDays,
    dailyLimit: value.agency.dailyLimit,
    concurrencyLimit: value.agency.concurrencyLimit,
  },
});
export function authLayer(options: AuthOptions) {
  if (options.secret.length < 32)
    throw new Error("AUTH_SECRET deve contenere almeno 32 caratteri");
  const cookieName = options.secureCookies ? "__Host-lc_session" : "lc_session";
  const dummy = `scrypt$131072$8$1$${"00".repeat(16)}$${randomBytes(64).toString("hex")}`;
  const csrfFor = (token: string) =>
    createHmac("sha256", options.secret)
      .update("csrf:" + token)
      .digest("hex");
  const tokenFrom = (req: Request) => {
    const item = (req.headers.cookie || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(cookieName + "="));
    const value = item?.slice(cookieName.length + 1) || "";
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : "";
  };
  const cookie = (res: Response, value: string, expires?: Date) =>
    res.cookie(cookieName, value, {
      httpOnly: true,
      secure: options.secureCookies,
      sameSite: "strict",
      path: "/",
      expires: expires || new Date(0),
    });
  const originAllowed = (req: Request) =>
    req.get("Origin") === options.publicOrigin;
  const authenticate = async (req: Request): Promise<Identity | null> => {
    const token = tokenFrom(req);
    if (!token) return null;
    const session = await options.identities.session(digest(token));
    if (
      !session ||
      new Date(session.expiresAt).getTime() <= Date.now() ||
      new Date(session.idleExpiresAt).getTime() <= Date.now()
    )
      return null;
    const user = await options.identities.userById(session.userId);
    if (!user?.enabled || user.authVersion !== session.authVersion) return null;
    const agency = await options.identities.agency(user.agencyId);
    if (!agency?.enabled) return null;
    await options.identities.touchSession(
      session.tokenHash,
      new Date(Date.now() + 30 * 60_000),
    );
    return { user, agency, tokenHash: session.tokenHash, csrf: csrfFor(token) };
  };
  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    authenticate(req)
      .then((value) => {
        if (!value) {
          res.status(401).json({ error: "Accedi con il tuo account" });
          return;
        }
        res.locals.identity = value;
        if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
          if (
            !originAllowed(req) ||
            !timingSafeEqual(
              Buffer.from(digest(req.get("X-CSRF-Token") || "")),
              Buffer.from(digest(value.csrf)),
            )
          ) {
            res
              .status(403)
              .json({ error: "Verifica della richiesta non riuscita" });
            return;
          }
        }
        next();
      })
      .catch(next);
  };
  const requireEditor = (_req: Request, res: Response, next: NextFunction) => {
    if ((res.locals.identity as Identity).user.role === "viewer") {
      res.status(403).json({ error: "Account in sola lettura" });
      return;
    }
    next();
  };
  const startSession = async (user: User, res: Response) => {
    const token = randomBytes(32).toString("base64url"),
      expiresAt = new Date(Date.now() + 8 * 3600_000);
    const session: Session = {
      tokenHash: digest(token),
      userId: user.id,
      authVersion: user.authVersion,
      expiresAt,
      idleExpiresAt: new Date(Date.now() + 30 * 60_000),
    };
    await options.identities.saveSession(session);
    cookie(res, token, expiresAt);
    const agency = await options.identities.agency(user.agencyId);
    if (!agency) throw new Error("Agency unavailable");
    const value = {
      user,
      agency,
      tokenHash: session.tokenHash,
      csrf: csrfFor(token),
    };
    return { user: safeUser(value), csrfToken: value.csrf };
  };
  const login = async (req: Request, res: Response) => {
    if (!originAllowed(req))
      return res.status(403).json({ error: "Origine non consentita" });
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    const password = req.body?.password;
    if (
      email.length > 254 ||
      typeof password !== "string" ||
      [...password].length > 128
    )
      return res.status(400).json({ error: "Credenziali non valide" });
    const bucket = Math.floor(Date.now() / (15 * 60_000)),
      until = new Date(Date.now() + 3600_000);
    const hash = (value: string) =>
      createHmac("sha256", options.secret).update(value).digest("hex");
    const ipAllowed = await options.identities.consumeLimit(
      hash(`ip:${req.ip}:${bucket}`),
      until,
      10,
    );
    const accountAllowed = await options.identities.consumeLimit(
      hash(`email:${email}:${bucket}`),
      until,
      30,
    );
    if (!ipAllowed || !accountAllowed)
      return res
        .status(429)
        .json({ error: "Troppi tentativi. Riprova tra 15 minuti." });
    const user = await options.identities.userByEmail(email);
    const verified = await verifyPassword(
      password,
      user?.passwordHash || dummy,
    );
    const agency = user ? await options.identities.agency(user.agencyId) : null;
    if (!verified || !user?.enabled || !agency?.enabled) {
      await options.identities.event("login_failed", user?.agencyId, user?.id);
      return res.status(401).json({ error: "Email o password non valide" });
    }
    await options.identities.event("login", user.agencyId, user.id);
    return res.json(await startSession(user, res));
  };
  const logout = async (_req: Request, res: Response) => {
    const value = res.locals.identity as Identity;
    await options.identities.removeSession(value.tokenHash);
    cookie(res, "");
    await options.identities.event("logout", value.agency.id, value.user.id);
    return res.status(204).end();
  };
  const changePassword = async (req: Request, res: Response) => {
    const value = res.locals.identity as Identity;
    if (!validPassword(req.body?.newPassword))
      return res
        .status(400)
        .json({ error: "Usa una password da 15 a 128 caratteri" });
    if (
      !(await verifyPassword(
        req.body?.currentPassword,
        value.user.passwordHash,
      ))
    )
      return res.status(401).json({ error: "Password attuale non corretta" });
    await options.identities.changePassword(
      value.user.id,
      value.agency.id,
      await hashPassword(req.body.newPassword),
    );
    await options.identities.event(
      "password_changed",
      value.agency.id,
      value.user.id,
    );
    cookie(res, "");
    return res.status(204).end();
  };
  return { requireAuth, requireEditor, login, logout, changePassword };
}
