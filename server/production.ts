// Cross-platform production entry: works under Windows PowerShell and POSIX shells.
process.env.NODE_ENV = "production";
await import("./index");
export {};
