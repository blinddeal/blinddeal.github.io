import { registerHooks } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sdk = pathToFileURL(path.resolve(import.meta.dirname, "../sdk/dist/index.js")).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "blinddeal-sdk") {
      return { url: sdk, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL) {
      const base = path.dirname(fileURLToPath(context.parentURL));
      const raw = path.resolve(base, specifier);
      for (const candidate of [raw, raw + ".ts", raw + ".tsx", raw + ".js", path.join(raw, "index.ts")]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
