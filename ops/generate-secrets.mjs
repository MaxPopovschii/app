import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
const dir = path.resolve(process.argv[2] || ".secrets");
process.umask(0o077);
await mkdir(dir, { recursive: true, mode: 0o700 });
try {
  await access(path.join(dir, "mongo_root_password"));
  throw new Error("Secrets already exist; refusing to overwrite them.");
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}
const random = () => randomBytes(32).toString("hex");
const root = random(),
  app = random(),
  rabbit = random(),
  fetcher = random(),
  auth = random(),
  metrics = random();
const values = {
  mongo_root_password: root,
  mongo_app_password: app,
  mongo_key: randomBytes(64).toString("base64"),
  mongo_uri: `mongodb://launchcheck:${app}@mongo:27017/launchcheck?authSource=launchcheck&replicaSet=rs0`,
  mongo_init_uri: `mongodb://root:${root}@mongo:27017/admin?authSource=admin&directConnection=true`,
  mongo_backup_config: JSON.stringify({
    uri: `mongodb://root:${root}@mongo:27017/?authSource=admin&replicaSet=rs0`,
  }),
  rabbit_password: rabbit,
  rabbit_url: `amqp://launchcheck:${rabbit}@rabbit:5672`,
  fetcher_token: fetcher,
  auth_secret: auth,
  metrics_token: metrics,
};
for (const [name, value] of Object.entries(values))
  await writeFile(path.join(dir, name), value + "\n", {
    mode: 0o600,
    flag: "wx",
  });
console.log(
  "Secret files generated. Keep this directory outside Git and back it up in your secret manager. No secret values were printed.",
);
