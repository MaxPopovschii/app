import { createFetchApp } from "./app";
import { secret } from "@launchcheck/shared";
createFetchApp(secret("FETCHER_TOKEN")).listen(8081, "0.0.0.0", () =>
  console.log(JSON.stringify({ event: "fetcher_ready" })),
);
