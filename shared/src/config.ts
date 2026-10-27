import { readFileSync } from "node:fs";
export function secret(name: string): string {
  const file = process.env[name + "_FILE"];
  const value = file
    ? readFileSync(file, "utf8").trim()
    : process.env.NODE_ENV === "production"
      ? ""
      : process.env[name] || "";
  if (!value) throw new Error(`Configure ${name}_FILE`);
  return value;
}
export function publicOrigin() {
  const value = process.env.PUBLIC_ORIGIN || "http://localhost:8080";
  const url = new URL(value);
  if (url.origin !== value || !["http:", "https:"].includes(url.protocol))
    throw new Error("PUBLIC_ORIGIN must be an exact HTTP(S) origin");
  if (
    process.env.NODE_ENV === "production" &&
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("Public deployments require HTTPS");
  if (url.protocol === "https:" && process.env.COOKIE_SECURE !== "true")
    throw new Error("HTTPS deployments require secure cookies");
  if (process.env.COOKIE_SECURE === "true" && url.protocol !== "https:")
    throw new Error("Secure cookies require HTTPS PUBLIC_ORIGIN");
  return value;
}
