import mongoose from "mongoose";
import {
  secret,
  UserModel,
  SessionModel,
  hashPassword,
} from "@launchcheck/shared";
async function main() {
  const [operation, email] = process.argv.slice(2);
  if (!["disable", "reset-password"].includes(operation) || !email)
    throw new Error(
      "Usage: disable <email> | reset-password <email> --password-stdin",
    );
  await mongoose.connect(secret("MONGO_URI"));
  try {
    const user = await UserModel.findOne({ email: email.toLowerCase() });
    if (!user) throw new Error("Account not found");
    if (operation === "disable") {
      if (
        user.role === "owner" &&
        (await UserModel.countDocuments({
          agencyId: user.agencyId,
          role: "owner",
          enabled: true,
        })) <= 1
      )
        throw new Error("Create another owner before disabling the last owner");
      await UserModel.updateOne(
        { id: user.id },
        { $set: { enabled: false }, $inc: { authVersion: 1 } },
      );
    } else {
      if (!process.argv.includes("--password-stdin"))
        throw new Error("Pass the new password through stdin");
      let password = "";
      for await (const part of process.stdin) {
        password += part.toString();
        if (password.length > 1024) throw new Error("Password too long");
      }
      await UserModel.updateOne(
        { id: user.id },
        {
          $set: {
            passwordHash: await hashPassword(password.replace(/\r?\n$/, "")),
          },
          $inc: { authVersion: 1 },
        },
      );
    }
    await SessionModel.deleteMany({ userId: user.id });
    console.log("Account updated; existing sessions revoked");
  } finally {
    await mongoose.disconnect();
  }
}
main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
