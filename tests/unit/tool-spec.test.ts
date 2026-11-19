import { describe, expect, it } from "vitest";
import { compileToolSpec } from "../../packages/core/src/tool-spec";
import { getTool } from "@/server/tools/registry";

const transfer = {
  name: "bank_transfer",
  description: "Transfer money (example external tool)",
  kind: "sink" as const,
  risk: "critical" as const,
  destinationArg: "iban",
  destinationType: "account" as const,
  contentArgs: ["memo"],
  inputSchema: {
    type: "object",
    properties: { iban: { type: "string", pattern: "^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$" }, amount: { type: "number", exclusiveMinimum: 0 }, memo: { type: "string" } },
    required: ["iban", "amount"],
    additionalProperties: true, // a careless registration — must still be hardened
  },
  argHints: { iban: "an IBAN the user provided" },
};

describe("ToolSpec (Phase 4: tools of any external app)", () => {
  it("validates arguments with JSON Schema", () => {
    const t = compileToolSpec(transfer);
    expect(t.validate({ iban: "DE89370400440532013000", amount: 10 })).toEqual({ ok: true, data: { iban: "DE89370400440532013000", amount: 10 } });
  });

  it("always rejects unknown arguments, even if the registered schema allows them", () => {
    const r = compileToolSpec(transfer).validate({ iban: "DE89370400440532013000", amount: 10, bcc: "x@evil.example" });
    expect(r.ok).toBe(false);
    expect((r as { errors: string[] }).errors[0]).toContain("unknown argument 'bcc'");
  });

  it("gives actionable errors with hints", () => {
    const r = compileToolSpec(transfer).validate({ iban: "nope", amount: -1 });
    const msg = (r as { errors: string[] }).errors.join(" | ");
    expect(msg).toContain("an IBAN the user provided");
    expect(msg).toContain("amount");
    expect(compileToolSpec(transfer).validate("not-an-object")).toEqual({ ok: false, errors: ["args: must be a JSON object"] });
  });

  it("refuses unsafe or inconsistent specs", () => {
    expect(() => compileToolSpec({ ...transfer, destinationArg: undefined })).toThrow(/sink tools must declare destinationArg/);
    expect(() => compileToolSpec({ ...transfer, destinationArg: "nope" })).toThrow(/not a property/);
    expect(() => compileToolSpec({ ...transfer, inputSchema: { type: "array" } })).toThrow(/must be 'object'/);
    expect(() => compileToolSpec({ ...transfer, name: "bad name!" })).toThrow();
    expect(() => compileToolSpec({ ...transfer, inputSchema: { type: "object", properties: { iban: { type: "nonsense" } } } })).toThrow(/Invalid inputSchema/);
  });

  it("does not mutate caller arguments", () => {
    const args = { iban: "DE89370400440532013000", amount: 10 };
    compileToolSpec(transfer).validate(args);
    expect(args).toEqual({ iban: "DE89370400440532013000", amount: 10 });
  });

  it("demo tools keep their behaviour after the migration from Zod", () => {
    const read = getTool("read_documents")!;
    expect(read.validate({ documentIds: ["doc:public/handbook"] }).ok).toBe(true);
    const bad = read.validate({ documentIds: ["web/recipe-blog"] });
    expect((bad as { errors: string[] }).errors.join()).toContain("doc:public/handbook");
    const email = getTool("send_email")!;
    expect(email.validate({ to: "not-an-email", subject: "s", body: "b" }).ok).toBe(false);
    expect(email.validate({ to: "a@acme.example", subject: "s", body: "b", documentIds: [] }).ok).toBe(false);
    const exp = getTool("export_data")!;
    expect(exp.validate({ dataset: "ds:sales_q3", destination: "http://plain.example/x", format: "csv" }).ok).toBe(false);
    expect(exp.validate({ dataset: "ds:sales_q3", destination: "https://files.acme.example/x", format: "csv" }).ok).toBe(true);
    expect(email.jsonSchema.additionalProperties).toBe(false);
  });
});
