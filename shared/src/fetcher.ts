import { SafeClient } from "./network";
export function createFetcherClient(
  endpoint: string,
  token: string,
): SafeClient {
  const trusted = new URL(endpoint);
  if (
    !["http:", "https:"].includes(trusted.protocol) ||
    trusted.username ||
    trusted.password ||
    trusted.pathname !== "/"
  )
    throw new Error("Invalid fetch service configuration");
  return async (url, options = {}) => {
    const response = await fetch(new URL("/fetch", trusted), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ url, options }),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (!response.body) throw new Error("Fetch service unavailable");
    const chunks: Uint8Array[] = [];
    let count = 0;
    for await (const chunk of response.body as any) {
      count += chunk.length;
      if (count > 7_000_000) throw new Error("Fetch response exceeded budget");
      chunks.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!response.ok)
      throw new Error(data.error || "Fetch service unavailable");
    if (
      !Number.isInteger(data.status) ||
      data.status < 100 ||
      data.status > 599 ||
      typeof data.body !== "string" ||
      typeof data.headers !== "object"
    )
      throw new Error("Invalid fetch response");
    return { ...data, body: Buffer.from(data.body, "base64") };
  };
}
