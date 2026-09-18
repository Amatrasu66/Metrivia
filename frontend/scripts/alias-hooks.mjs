// Node module customization hooks for the haptics audit script.
// Resolves the Vite "@" alias ("@/...") to frontend/src so the audit can
// import the real application modules without a bundler or test runner.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC_URL = new URL("../src/", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@" || specifier.startsWith("@/")) {
    const sub = specifier === "@" ? "" : specifier.slice(2);
    if (sub && !sub.endsWith("/") && !/\.[a-zA-Z0-9]+$/.test(sub)) {
      for (const ext of [".js", ".jsx"]) {
        const candidate = new URL(`${sub}${ext}`, SRC_URL);
        try {
          if (existsSync(fileURLToPath(candidate))) {
            return { url: String(candidate), shortCircuit: true };
          }
        } catch {
          // fall through to default resolution
        }
      }
    }
    return { url: String(new URL(sub, SRC_URL)), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
