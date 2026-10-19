import path from "node:path";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 3001);
const app = await createApp({
  dataDirectory: process.env.CATALYST_DATA_DIR ?? path.resolve(".data"),
  ...(process.env.NODE_ENV === "production"
    ? { staticDirectory: path.resolve("dist") }
    : {}),
});
const server = app.listen(
  port,
  process.env.HOST ??
    (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1"),
  () => {
    const address = server.address();
    console.log(
      `Catalyst Foundry local service: http://localhost:${typeof address === "object" ? address?.port : port}`,
    );
  },
);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  try {
    // Stop owned translation/slicer work before the process can leave children behind.
    await app.locals.shutdown?.();
    server.closeIdleConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    clearTimeout(deadline);
    process.exitCode = 0;
  } catch (error) {
    console.error("Local service shutdown failed:", (error as Error).message);
    process.exitCode = 1;
  }
}
process.once("SIGINT", () => {
  void close();
});
process.once("SIGTERM", () => {
  void close();
});
