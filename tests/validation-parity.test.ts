import { describe, expect, test } from "vite-plus/test";
import { ValidationFailed } from "../src/errors.ts";
import { assertSchemaObject, validateValue } from "../src/validation/json-schema.ts";
import { run, runEither } from "./helpers.ts";

type Verdict = "pass" | "ValidationFailed" | "SchemaInvalid";

interface ParityCase {
  readonly name: string;
  readonly schema: unknown;
  readonly value: unknown;
  readonly want: Verdict;
}

const cases: Array<ParityCase> = [
  { name: "minLength ignores numbers", schema: { minLength: 2 }, value: 5, want: "pass" },
  { name: "maxLength ignores arrays", schema: { maxLength: 1 }, value: [1, 2, 3], want: "pass" },
  { name: "pattern ignores numbers", schema: { pattern: "^a" }, value: 42, want: "pass" },
  { name: "minimum ignores strings", schema: { minimum: 10 }, value: "hi", want: "pass" },
  { name: "maximum ignores booleans", schema: { maximum: 10 }, value: true, want: "pass" },
  {
    name: "exclusiveMinimum ignores strings",
    schema: { exclusiveMinimum: 5 },
    value: "x",
    want: "pass",
  },
  {
    name: "exclusiveMaximum ignores null",
    schema: { exclusiveMaximum: 5 },
    value: null,
    want: "pass",
  },
  { name: "minItems ignores strings", schema: { minItems: 2 }, value: "hi", want: "pass" },
  { name: "maxItems ignores numbers", schema: { maxItems: 1 }, value: 7, want: "pass" },
  {
    name: "uniqueItems ignores strings",
    schema: { uniqueItems: true },
    value: "aa",
    want: "pass",
  },
  {
    name: "items ignores non-arrays",
    schema: { items: { type: "string" } },
    value: "hi",
    want: "pass",
  },
  {
    name: "required ignores non-objects",
    schema: { required: ["a"] },
    value: 5,
    want: "pass",
  },
  {
    name: "properties ignores non-objects",
    schema: { properties: { a: { type: "string" } } },
    value: 5,
    want: "pass",
  },
  {
    name: "typed minLength still rejects wrong type",
    schema: { type: "string", minLength: 3 },
    value: 5,
    want: "ValidationFailed",
  },
  {
    name: "typed object rejects non-objects",
    schema: { type: "object", required: ["a"] },
    value: 5,
    want: "ValidationFailed",
  },
  {
    name: "typed required rejects missing key",
    schema: { type: "object", required: ["a"] },
    value: {},
    want: "ValidationFailed",
  },
  {
    name: "const matches structured object",
    schema: { const: { a: [1, 2] } },
    value: { a: [1, 2] },
    want: "pass",
  },
  {
    name: "const rejects different structure",
    schema: { const: { a: [1, 2] } },
    value: { a: [1, 3] },
    want: "ValidationFailed",
  },
  {
    name: "const matches structured array",
    schema: { const: [1, { b: 2 }] },
    value: [1, { b: 2 }],
    want: "pass",
  },
  {
    name: "const rejects different array",
    schema: { const: [1, { b: 2 }] },
    value: [1, { b: 3 }],
    want: "ValidationFailed",
  },
  { name: "const null passes", schema: { const: null }, value: null, want: "pass" },
  { name: "const null rejects zero", schema: { const: null }, value: 0, want: "ValidationFailed" },
  {
    name: "enum matches structured object option",
    schema: { enum: [{ a: 1 }, [2], null, "x"] },
    value: { a: 1 },
    want: "pass",
  },
  {
    name: "enum matches structured array option",
    schema: { enum: [{ a: 1 }, [2], null, "x"] },
    value: [2],
    want: "pass",
  },
  {
    name: "enum matches null option",
    schema: { enum: [{ a: 1 }, [2], null, "x"] },
    value: null,
    want: "pass",
  },
  {
    name: "enum rejects other structure",
    schema: { enum: [{ a: 1 }, [2], null, "x"] },
    value: { a: 2 },
    want: "ValidationFailed",
  },
  {
    name: "non-array enum rejects everything",
    schema: { enum: "x" },
    value: "x",
    want: "ValidationFailed",
  },
  {
    name: "const plus type passes together",
    schema: { type: "number", const: 5 },
    value: 5,
    want: "pass",
  },
  {
    name: "const plus type rejects other number",
    schema: { type: "number", const: 5 },
    value: 6,
    want: "ValidationFailed",
  },
  {
    name: "const plus type rejects wrong type",
    schema: { type: "number", const: 5 },
    value: "5",
    want: "ValidationFailed",
  },
  {
    name: "prefixItems passes matching tuple",
    schema: { prefixItems: [{ type: "string" }, { type: "number" }] },
    value: ["a", 1],
    want: "pass",
  },
  {
    name: "prefixItems rejects wrong position",
    schema: { prefixItems: [{ type: "string" }, { type: "number" }] },
    value: ["a", "b"],
    want: "ValidationFailed",
  },
  {
    name: "prefixItems allows short arrays",
    schema: { prefixItems: [{ type: "string" }, { type: "number" }] },
    value: ["a"],
    want: "pass",
  },
  {
    name: "prefixItems allows empty arrays",
    schema: { prefixItems: [{ type: "string" }, { type: "number" }] },
    value: [],
    want: "pass",
  },
  {
    name: "prefixItems ignores non-arrays",
    schema: { prefixItems: [{ type: "string" }, { type: "number" }] },
    value: "hi",
    want: "pass",
  },
  {
    name: "prefixItems plus items passes rest",
    schema: { prefixItems: [{ type: "string" }], items: { type: "number" } },
    value: ["a", 1, 2],
    want: "pass",
  },
  {
    name: "prefixItems plus items rejects bad rest",
    schema: { prefixItems: [{ type: "string" }], items: { type: "number" } },
    value: ["a", 1, "b"],
    want: "ValidationFailed",
  },
  {
    name: "prefixItems plus items rejects bad prefix",
    schema: { prefixItems: [{ type: "string" }], items: { type: "number" } },
    value: [1, 2],
    want: "ValidationFailed",
  },
  {
    name: "items alone passes",
    schema: { items: { type: "string" } },
    value: ["a", "b"],
    want: "pass",
  },
  {
    name: "items alone rejects bad element",
    schema: { items: { type: "string" } },
    value: ["a", 1],
    want: "ValidationFailed",
  },
  {
    name: "anyOf passes first branch",
    schema: { anyOf: [{ type: "string" }, { type: "number", minimum: 5 }] },
    value: "a",
    want: "pass",
  },
  {
    name: "anyOf passes second branch",
    schema: { anyOf: [{ type: "string" }, { type: "number", minimum: 5 }] },
    value: 7,
    want: "pass",
  },
  {
    name: "anyOf rejects matching neither",
    schema: { anyOf: [{ type: "string" }, { type: "number", minimum: 5 }] },
    value: 3,
    want: "ValidationFailed",
  },
  {
    name: "anyOf rejects other types",
    schema: { anyOf: [{ type: "string" }, { type: "number", minimum: 5 }] },
    value: true,
    want: "ValidationFailed",
  },
  { name: "empty anyOf rejects", schema: { anyOf: [] }, value: 1, want: "ValidationFailed" },
  { name: "non-array anyOf rejects", schema: { anyOf: "x" }, value: 1, want: "ValidationFailed" },
  {
    name: "oneOf passes low branch only",
    schema: {
      oneOf: [
        { type: "number", minimum: 5 },
        { type: "number", maximum: 10 },
      ],
    },
    value: 3,
    want: "pass",
  },
  {
    name: "oneOf passes high branch only",
    schema: {
      oneOf: [
        { type: "number", minimum: 5 },
        { type: "number", maximum: 10 },
      ],
    },
    value: 20,
    want: "pass",
  },
  {
    name: "oneOf rejects matching both",
    schema: {
      oneOf: [
        { type: "number", minimum: 5 },
        { type: "number", maximum: 10 },
      ],
    },
    value: 7,
    want: "ValidationFailed",
  },
  {
    name: "oneOf rejects matching neither",
    schema: {
      oneOf: [
        { type: "number", minimum: 5 },
        { type: "number", maximum: 10 },
      ],
    },
    value: "x",
    want: "ValidationFailed",
  },
  { name: "empty oneOf rejects", schema: { oneOf: [] }, value: 1, want: "ValidationFailed" },
  {
    name: "allOf passes every branch",
    schema: { allOf: [{ type: "number" }, { minimum: 5 }] },
    value: 7,
    want: "pass",
  },
  {
    name: "allOf rejects failing branch",
    schema: { allOf: [{ type: "number" }, { minimum: 5 }] },
    value: 3,
    want: "ValidationFailed",
  },
  {
    name: "allOf rejects wrong type",
    schema: { allOf: [{ type: "number" }, { minimum: 5 }] },
    value: "x",
    want: "ValidationFailed",
  },
  {
    name: "not passes outside forbidden",
    schema: { not: { type: "string" } },
    value: 5,
    want: "pass",
  },
  {
    name: "not rejects forbidden match",
    schema: { not: { type: "string" } },
    value: "a",
    want: "ValidationFailed",
  },
  {
    name: "top-level $ref is schema_invalid",
    schema: { $ref: "#/$defs/x" },
    value: 1,
    want: "SchemaInvalid",
  },
  {
    name: "nested $ref rejects values",
    schema: { properties: { a: { $ref: "#/$defs/x" } } },
    value: { a: 1 },
    want: "ValidationFailed",
  },
  {
    name: "nested $ref passes when key absent",
    schema: { properties: { a: { $ref: "#/$defs/x" } } },
    value: {},
    want: "pass",
  },
  {
    name: "nested $ref in items rejects elements",
    schema: { items: { $ref: "#/$defs/x" } },
    value: [1],
    want: "ValidationFailed",
  },
  {
    name: "nested $ref in items passes empty",
    schema: { items: { $ref: "#/$defs/x" } },
    value: [],
    want: "pass",
  },
  { name: "true schema passes objects", schema: true, value: { a: 1 }, want: "pass" },
  { name: "true schema passes null", schema: true, value: null, want: "pass" },
  { name: "false schema rejects numbers", schema: false, value: 1, want: "ValidationFailed" },
  { name: "false schema rejects null", schema: false, value: null, want: "ValidationFailed" },
  {
    name: "type array passes listed string",
    schema: { type: ["string", "null"] },
    value: "a",
    want: "pass",
  },
  {
    name: "type array passes listed null",
    schema: { type: ["string", "null"] },
    value: null,
    want: "pass",
  },
  {
    name: "type array rejects unlisted",
    schema: { type: ["string", "null"] },
    value: 1,
    want: "ValidationFailed",
  },
  { name: "unknown type rejects", schema: { type: "weird" }, value: 1, want: "ValidationFailed" },
  { name: "empty type array rejects", schema: { type: [] }, value: 1, want: "ValidationFailed" },
  { name: "integer passes whole numbers", schema: { type: "integer" }, value: 1, want: "pass" },
  {
    name: "integer rejects fractions",
    schema: { type: "integer" },
    value: 1.5,
    want: "ValidationFailed",
  },
  { name: "boolean type passes", schema: { type: "boolean" }, value: true, want: "pass" },
  {
    name: "boolean type rejects strings",
    schema: { type: "boolean" },
    value: "x",
    want: "ValidationFailed",
  },
  {
    name: "additionalProperties false passes known keys",
    schema: {
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: false,
    },
    value: { a: "x" },
    want: "pass",
  },
  {
    name: "additionalProperties false rejects extras",
    schema: {
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: false,
    },
    value: { a: "x", b: 1 },
    want: "ValidationFailed",
  },
  {
    name: "additionalProperties false without properties passes empty",
    schema: { type: "object", additionalProperties: false },
    value: {},
    want: "pass",
  },
  {
    name: "additionalProperties false without properties rejects extras",
    schema: { type: "object", additionalProperties: false },
    value: { a: 1 },
    want: "ValidationFailed",
  },
  {
    name: "record additionalProperties passes matching extras",
    schema: {
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: { type: "number" },
    },
    value: { a: "x", b: 1 },
    want: "pass",
  },
  {
    name: "record additionalProperties rejects bad extras",
    schema: {
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: { type: "number" },
    },
    value: { a: "x", b: "y" },
    want: "ValidationFailed",
  },
  {
    name: "record additionalProperties skips known keys",
    schema: {
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: { type: "number" },
    },
    value: { a: "x", b: 2 },
    want: "pass",
  },
  {
    name: "exclusiveMinimum rejects the boundary",
    schema: { exclusiveMinimum: 5 },
    value: 5,
    want: "ValidationFailed",
  },
  {
    name: "exclusiveMinimum passes above",
    schema: { exclusiveMinimum: 5 },
    value: 6,
    want: "pass",
  },
  {
    name: "exclusiveMaximum rejects the boundary",
    schema: { exclusiveMaximum: 5 },
    value: 5,
    want: "ValidationFailed",
  },
  {
    name: "exclusiveMaximum passes below",
    schema: { exclusiveMaximum: 5 },
    value: 4,
    want: "pass",
  },
  {
    name: "minItems rejects short arrays",
    schema: { type: "array", minItems: 2 },
    value: [1],
    want: "ValidationFailed",
  },
  {
    name: "minItems passes exact arrays",
    schema: { type: "array", minItems: 2 },
    value: [1, 2],
    want: "pass",
  },
  {
    name: "maxItems rejects long arrays",
    schema: { type: "array", maxItems: 1 },
    value: [1, 2],
    want: "ValidationFailed",
  },
  {
    name: "uniqueItems rejects duplicates",
    schema: { type: "array", uniqueItems: true },
    value: [1, 1],
    want: "ValidationFailed",
  },
  {
    name: "uniqueItems passes distinct",
    schema: { type: "array", uniqueItems: true },
    value: [1, 2],
    want: "pass",
  },
  {
    name: "string bounds pass inside range",
    schema: { type: "string", minLength: 2, maxLength: 3 },
    value: "ab",
    want: "pass",
  },
  {
    name: "string bounds reject short",
    schema: { type: "string", minLength: 2, maxLength: 3 },
    value: "a",
    want: "ValidationFailed",
  },
  {
    name: "string bounds reject long",
    schema: { type: "string", minLength: 2, maxLength: 3 },
    value: "abcd",
    want: "ValidationFailed",
  },
  {
    name: "pattern passes matching strings",
    schema: { type: "string", pattern: "^a+$" },
    value: "aaa",
    want: "pass",
  },
  {
    name: "pattern rejects other strings",
    schema: { type: "string", pattern: "^a+$" },
    value: "aab",
    want: "ValidationFailed",
  },
  {
    name: "invalid pattern rejects",
    schema: { type: "string", pattern: "([" },
    value: "x",
    want: "ValidationFailed",
  },
  { name: "empty schema passes numbers", schema: {}, value: 1, want: "pass" },
  { name: "empty schema passes structures", schema: {}, value: { a: [1] }, want: "pass" },
];

describe("validation parity (exotic subset)", () => {
  for (const { name, schema, value, want } of cases) {
    test(name, async () => {
      const outcome = await runEither(validateValue(schema as never, value as never));
      if (want === "pass") {
        expect(outcome.ok).toBe(true);
        return;
      }
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error._tag).toBe(want);
    });
  }

  test("assertSchemaObject accepts empty, true, and false schemas", async () => {
    await run(assertSchemaObject({}));
    await run(assertSchemaObject(true));
    await run(assertSchemaObject(false));
  });

  test("assertSchemaObject rejects non-objects and top-level $ref", async () => {
    for (const bad of ["nope", 1, { $ref: "#/$defs/x" }]) {
      const outcome = await runEither(assertSchemaObject(bad));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error._tag).toBe("SchemaInvalid");
    }
  });
});

describe("validation per-path errors", () => {
  const nameAge = {
    type: "object",
    properties: { name: { type: "string" }, age: { type: "number", minimum: 0 } },
    required: ["name", "age"],
  };

  test("missing name plus below-minimum age returns two issues", async () => {
    const outcome = await runEither(validateValue(nameAge as never, { age: -1 } as never));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(ValidationFailed);
      if (!(outcome.error instanceof ValidationFailed)) return;
      const errors = outcome.error.errors;
      expect(errors).toHaveLength(2);
      expect(errors).toContainEqual({ path: "$.name", message: "Missing key" });
      expect(errors).toContainEqual({ path: "$.age", message: "Number is less than minimum 0" });
      expect(outcome.error.message).toContain("$.name");
      expect(outcome.error.message).toContain("$.age");
    }
  });

  test("a single failure stays a single issue", async () => {
    const outcome = await runEither(
      validateValue(nameAge as never, { name: "x", age: -1 } as never),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(ValidationFailed);
      if (!(outcome.error instanceof ValidationFailed)) return;
      const errors = outcome.error.errors;
      expect(errors).toEqual([{ path: "$.age", message: "Number is less than minimum 0" }]);
    }
  });

  test("nested objects report every failing leaf", async () => {
    const schema = {
      type: "object",
      properties: {
        a: {
          type: "object",
          properties: { x: { type: "number", minimum: 0 }, y: { type: "number", minimum: 0 } },
          required: ["x", "y"],
        },
      },
      required: ["a"],
    };
    const outcome = await runEither(
      validateValue(schema as never, { a: { x: -1, y: -2 } } as never),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(ValidationFailed);
      if (!(outcome.error instanceof ValidationFailed)) return;
      const errors = outcome.error.errors;
      expect(errors).toHaveLength(2);
      expect(errors.map((entry) => entry.path).sort()).toEqual(["$.a.x", "$.a.y"]);
    }
  });

  test("arrays report every failing index", async () => {
    const outcome = await runEither(
      validateValue(
        { type: "array", items: { type: "number", minimum: 0 } } as never,
        [-1, 5, -2] as never,
      ),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(ValidationFailed);
      if (!(outcome.error instanceof ValidationFailed)) return;
      const errors = outcome.error.errors;
      expect(errors.map((entry) => entry.path).sort()).toEqual(["$[0]", "$[2]"]);
    }
  });

  test("every issue carries a $-rooted path plus message", async () => {
    const bad = [
      validateValue(nameAge as never, { age: -1 } as never),
      validateValue({ type: "array", items: { type: "string" } } as never, [1, 2] as never),
      validateValue({ anyOf: [{ type: "string" }] } as never, 1 as never),
    ];
    for (const effect of bad) {
      const outcome = await runEither(effect);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toBeInstanceOf(ValidationFailed);
        if (!(outcome.error instanceof ValidationFailed)) return;
        const errors = outcome.error.errors;
        expect(errors.length).toBeGreaterThan(0);
        for (const entry of errors) {
          expect(entry.path.startsWith("$")).toBe(true);
          expect(entry.message.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
