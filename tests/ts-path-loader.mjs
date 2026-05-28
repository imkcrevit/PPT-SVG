import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = withExtension(path.join(root, "src", specifier.slice(2)));

    if (target) {
      return nextResolve(pathToFileURL(target).href, context);
    }
  }

  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const target = withExtension(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));

    if (target) {
      return nextResolve(pathToFileURL(target).href, context);
    }
  }

  return nextResolve(specifier, context);
}

function withExtension(filePath) {
  if (path.extname(filePath)) {
    return filePath;
  }

  for (const extension of [".ts", ".tsx", ".mjs", ".js"]) {
    const candidate = `${filePath}${extension}`;

    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}
