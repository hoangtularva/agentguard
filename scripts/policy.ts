/**
 * Policy as code.
 *   npm run policy -- test <policy.yaml> <cases.yaml> [...]   run policy unit tests (pure, no DB; CI-friendly)
 *   npm run policy -- export <policyId> [file.yaml]          active version → YAML
 *   npm run policy -- import <policyId> <file.yaml> [--activate] [--note "…"]   new immutable version
 *   npm run policy -- starter [file.yaml]                     the tool-agnostic starter policy as YAML
 * export/import use DATABASE_URL or the local PGlite (stop `npm run dev` first).
 */
import fs from "node:fs";
import { parse, stringify } from "yaml";
import { type PolicyTestCase, runPolicyTests } from "../packages/core/src/policy-test";
import { STARTER_POLICY } from "../packages/core/src/starter-policy";
import { PolicyDocumentSchema } from "@/server/core/policy-schema";

const [cmd, ...rest] = process.argv.slice(2);
const readYaml = (f: string) => parse(fs.readFileSync(f, "utf8"));
const out = (text: string, file?: string) => (file ? fs.writeFileSync(file, text) : process.stdout.write(text));

async function main() {
  switch (cmd) {
    case "test": {
      const [policyFile, ...caseFiles] = rest;
      const doc = PolicyDocumentSchema.parse(readYaml(policyFile));
      let failed = 0;
      for (const f of caseFiles) {
        const { cases } = readYaml(f) as { cases: PolicyTestCase[] };
        for (const r of runPolicyTests(doc, cases)) {
          if (!r.pass) failed++;
          console.log(`${r.pass ? "✓" : "✗"} ${r.name}  →  ${r.actual}${r.pass ? "" : ` (expected ${r.expected}; ${r.reasons.join(", ")})`}`);
        }
      }
      if (failed) {
        console.error(`${failed} case(s) failed`);
        process.exit(1);
      }
      break;
    }
    case "starter":
      out(`# Tool-agnostic starter policy (what every new app gets).\n${stringify(STARTER_POLICY)}`, rest[0]);
      break;
    case "export": {
      const { createDatabase } = await import("@/server/db/client");
      const { getActivePolicy } = await import("@/server/enforcement/policy-store");
      const p = await getActivePolicy(await createDatabase(), rest[0]);
      out(`# ${p.policyId} v${p.version}\n${stringify(p.document)}`, rest[1]);
      break;
    }
    case "import": {
      const [policyId, file] = rest;
      const note = rest.includes("--note") ? rest[rest.indexOf("--note") + 1] : `imported from ${file}`;
      const document = PolicyDocumentSchema.parse(readYaml(file));
      const { createDatabase } = await import("@/server/db/client");
      const { createPolicyVersion } = await import("@/server/enforcement/policy-store");
      const v = await createPolicyVersion(await createDatabase(), {
        policyId,
        name: policyId,
        document,
        changeNote: note,
        actorId: "policy-cli",
        activate: rest.includes("--activate"),
      });
      console.log(`${policyId} v${v.version} created${rest.includes("--activate") ? " and activated" : " (not active: use --activate)"}`);
      break;
    }
    default:
      console.log("Commands: test <policy.yaml> <cases.yaml>... | export <policyId> [file] | import <policyId> <file> [--activate] [--note …] | starter [file]");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
