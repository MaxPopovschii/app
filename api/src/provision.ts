import mongoose from "mongoose";
import { provisionAccount, secret, UserModel } from "@launchcheck/shared";
async function main() {
  const args = process.argv.slice(2),
    get = (key: string) => {
      const index = args.indexOf(key);
      return index >= 0 ? args[index + 1] : undefined;
    };
  if (!args.includes("--email") || !args.includes("--password-stdin"))
    throw new Error(
      "Usage: --agency <name> --email <email> --name <name> [--agency-id <id>] [--role owner|member|viewer] --password-stdin",
    );
  let password = "";
  for await (const part of process.stdin) {
    password += part.toString();
    if (password.length > 1024) throw new Error("Password too long");
  }
  password = password.replace(/\r?\n$/, "");
  await mongoose.connect(secret("MONGO_URI"));
  try {
    if (args.includes("--reset-password"))
      throw new Error("Use the password reset command, not account creation");
    const role = args.includes("--role") ? get("--role") : undefined;
    if (role && !["owner", "member", "viewer"].includes(role))
      throw new Error("Invalid role");
    const result = await provisionAccount({
      agency: get("--agency") || "Agency",
      agencyId: args.includes("--agency-id") ? get("--agency-id") : undefined,
      email: get("--email")!,
      name: (args.includes("--name") ? get("--name") : get("--email"))!,
      role: role as any,
      password,
    });
    console.log(JSON.stringify(result));
  } finally {
    await mongoose.disconnect();
  }
}
main().catch((err) => {
  console.error(err.code === 11000 ? "Account already exists" : err.message);
  process.exit(1);
});
