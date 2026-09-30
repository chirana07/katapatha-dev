import path from "node:path";
import { defineConfig } from "prisma/config";

// Declaring a Prisma config file turns off Prisma's own .env loading, so we do
// it ourselves. Node has done this natively since 20.12. In Docker the vars
// come from the environment and there is no .env file, hence the try/catch.
try {
  process.loadEnvFile(path.join(import.meta.dirname, ".env"));
} catch {
  // No .env file — environment variables are expected to be set already.
}

export default defineConfig({
  earlyAccess: true,
  // A schema FOLDER, not a file. Multi-file schema is GA from Prisma 6.6.
  // Split by ownership so three backend developers never edit one file.
  schema: path.join("prisma", "schema"),
});
