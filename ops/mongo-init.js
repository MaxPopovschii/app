const fs = require("fs");
const connection = new Mongo(
  fs.readFileSync("/run/launchcheck/mongo_init_uri", "utf8").trim(),
);
const admin = connection.getDB("admin");
let needsInitialization = false;
try {
  const status = admin.runCommand({ replSetGetStatus: 1 });
  needsInitialization = !status.ok && status.code === 94;
} catch (e) {
  if (e.code !== 94) throw e;
  needsInitialization = true;
}
if (needsInitialization) {
  const result = admin.runCommand({
    replSetInitiate: { _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] },
  });
  if (!result.ok) throw new Error("Replica set initialization failed");
}
let primary = false;
for (let n = 0; n < 60; n++) {
  if (admin.runCommand({ hello: 1 }).isWritablePrimary) {
    primary = true;
    break;
  }
  sleep(1000);
}
if (!primary) throw new Error("Replica set did not become primary");
const app = connection.getDB("launchcheck");
if (!app.getUser("launchcheck"))
  app.createUser({
    user: "launchcheck",
    pwd: fs.readFileSync("/run/launchcheck/mongo_app_password", "utf8").trim(),
    roles: [{ role: "readWrite", db: "launchcheck" }],
  });
print("MongoDB replica set and application user ready");
