import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { runPolicyTests } from "../../packages/core/src/policy-test";
import { STARTER_POLICY } from "../../packages/core/src/starter-policy";
import { hashCanonical } from "@/server/core/canonical";
import { PolicyDocumentSchema } from "@/server/core/policy-schema";

const dir = path.resolve(__dirname, "../../policies");
const templates = fs.readdirSync(path.join(dir, "templates")).filter((f) => f.endsWith(".yaml"));

describe("policy as code", () => {
  it.each(templates)("template %s is valid and passes its cases", (file) => {
    const doc = PolicyDocumentSchema.parse(parse(fs.readFileSync(path.join(dir, "templates", file), "utf8")));
    const casesFile = path.join(dir, "tests", file.replace(".yaml", ".cases.yaml"));
    expect(fs.existsSync(casesFile)).toBe(true);
    const results = runPolicyTests(doc, parse(fs.readFileSync(casesFile, "utf8")).cases);
    expect(results.filter((r) => !r.pass)).toEqual([]);
    expect(results.length).toBeGreaterThan(2);
  });

  it("the starter template is exactly the starter policy, and YAML round-trips losslessly", () => {
    const fromFile = PolicyDocumentSchema.parse(parse(fs.readFileSync(path.join(dir, "templates/starter.yaml"), "utf8")));
    expect(hashCanonical(fromFile)).toBe(hashCanonical(STARTER_POLICY));
    expect(hashCanonical(PolicyDocumentSchema.parse(parse(stringify(STARTER_POLICY))))).toBe(hashCanonical(STARTER_POLICY));
  });

  it("reports a failing expectation instead of hiding it", () => {
    const [r] = runPolicyTests(STARTER_POLICY, [
      { name: "wrong on purpose", tool: { name: "post", kind: "sink", risk: "low" }, destination: { value: "x@evil.test", origin: ["untrusted_external"] }, expect: "ALLOW" },
    ]);
    expect(r).toMatchObject({ pass: false, actual: "BLOCK", expected: "ALLOW" });
  });
});
