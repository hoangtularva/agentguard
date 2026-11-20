/** Write docs/openapi.json from the live Zod schemas (npm run openapi). */
import fs from "node:fs";
import { openApiDocument } from "@/server/integration/openapi";

fs.writeFileSync("docs/openapi.json", `${JSON.stringify(openApiDocument(), null, 2)}\n`);
console.log("docs/openapi.json written");
