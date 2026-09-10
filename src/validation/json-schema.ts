import { Effect, Option, Schema, SchemaAST, SchemaIssue } from "effect";
import { SchemaInvalid, ValidationFailed, type ValidationIssue } from "../errors.ts";

type Translated = Schema.ConstraintDecoder<unknown, never>;

type Domain = "null" | "boolean" | "object" | "array" | "number" | "string" | "integer";

const isJsonObject = Schema.is(Schema.Record(Schema.String, Schema.Unknown));

const isDomain = (value: unknown): value is Domain =>
  value === "null" ||
  value === "boolean" ||
  value === "object" ||
  value === "array" ||
  value === "number" ||
  value === "string" ||
  value === "integer";

const jsonEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => jsonEqual(item, b[index]));
  }
  if (isJsonObject(a) && isJsonObject(b)) {
    const keysA = Object.keys(a);
    if (keysA.length !== Object.keys(b).length) return false;
    return keysA.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]));
  }
  return false;
};

const checkThat = (
  base: Translated,
  test: (value: unknown) => boolean,
  message: string,
): Translated =>
  Schema.refine<Translated, unknown>((current: unknown): current is unknown => test(current), {
    message,
  })(base);

const failSchema = (message: string): Translated => checkThat(Schema.Unknown, () => false, message);

const passes =
  (member: Translated, strict: boolean) =>
  (value: unknown): boolean => {
    const decode = strict
      ? Schema.decodeUnknownOption(member, { onExcessProperty: "error" })
      : Schema.decodeUnknownOption(member);
    return Option.isSome(decode(value));
  };

const withConst = (base: Translated, value: unknown): Translated =>
  checkThat(
    base,
    (current) => jsonEqual(current, value),
    `Value does not match const ${JSON.stringify(value)}`,
  );

const withEnum = (base: Translated, options: ReadonlyArray<unknown>): Translated =>
  checkThat(
    base,
    (current) => options.some((option) => jsonEqual(option, current)),
    "Value is not one of the allowed enum options",
  );

const withAnyOf = (
  base: Translated,
  members: ReadonlyArray<Translated>,
  strict: boolean,
): Translated =>
  checkThat(
    base,
    (current) => members.some((member) => passes(member, strict)(current)),
    "Value does not match any anyOf branch",
  );

const withOneOf = (
  base: Translated,
  members: ReadonlyArray<Translated>,
  strict: boolean,
): Translated =>
  checkThat(
    base,
    (current) => members.filter((member) => passes(member, strict)(current)).length === 1,
    "Value must match exactly one oneOf branch",
  );

const withAllOf = (
  base: Translated,
  members: ReadonlyArray<Translated>,
  strict: boolean,
): Translated =>
  checkThat(
    base,
    (current) => members.every((member) => passes(member, strict)(current)),
    "Value does not match allOf schema",
  );

const withNot = (base: Translated, member: Translated, strict: boolean): Translated =>
  checkThat(
    base,
    (current) => !passes(member, strict)(current),
    "Value matches the forbidden 'not' schema",
  );

const withStringBounds = (base: Translated, schema: Record<string, unknown>): Translated => {
  const min = schema["minLength"];
  const below =
    typeof min === "number"
      ? checkThat(
          base,
          (current) => typeof current !== "string" || current.length >= min,
          `String is shorter than minLength ${String(min)}`,
        )
      : base;
  const max = schema["maxLength"];
  const above =
    typeof max === "number"
      ? checkThat(
          below,
          (current) => typeof current !== "string" || current.length <= max,
          `String is longer than maxLength ${String(max)}`,
        )
      : below;
  const pattern = schema["pattern"];
  if (typeof pattern !== "string") return above;
  try {
    const expression = new RegExp(pattern);
    return checkThat(
      above,
      (current) => typeof current !== "string" || expression.test(current),
      `String does not match pattern ${pattern}`,
    );
  } catch {
    return failSchema(`Invalid pattern ${pattern}`);
  }
};

const withNumberBounds = (
  base: Translated,
  schema: Record<string, unknown>,
  mode: "integer" | "finite" | "open",
): Translated => {
  const gated =
    mode === "integer"
      ? checkThat(
          base,
          (current) => typeof current !== "number" || Number.isInteger(current),
          'Expected type "integer" but found number',
        )
      : mode === "finite"
        ? checkThat(
            base,
            (current) => typeof current !== "number" || Number.isFinite(current),
            'Expected type "number" but found number',
          )
        : base;
  const min = schema["minimum"];
  const aboveMin =
    typeof min === "number" && Number.isFinite(min)
      ? checkThat(
          gated,
          (current) => typeof current !== "number" || !Number.isFinite(current) || current >= min,
          `Number is less than minimum ${String(min)}`,
        )
      : gated;
  const max = schema["maximum"];
  const belowMax =
    typeof max === "number" && Number.isFinite(max)
      ? checkThat(
          aboveMin,
          (current) => typeof current !== "number" || !Number.isFinite(current) || current <= max,
          `Number is greater than maximum ${String(max)}`,
        )
      : aboveMin;
  const exclusiveMin = schema["exclusiveMinimum"];
  const aboveExclusive =
    typeof exclusiveMin === "number" && Number.isFinite(exclusiveMin)
      ? checkThat(
          belowMax,
          (current) =>
            typeof current !== "number" || !Number.isFinite(current) || current > exclusiveMin,
          `Number must be greater than ${String(exclusiveMin)}`,
        )
      : belowMax;
  const exclusiveMax = schema["exclusiveMaximum"];
  return typeof exclusiveMax === "number" && Number.isFinite(exclusiveMax)
    ? checkThat(
        aboveExclusive,
        (current) =>
          typeof current !== "number" || !Number.isFinite(current) || current < exclusiveMax,
        `Number must be less than ${String(exclusiveMax)}`,
      )
    : aboveExclusive;
};

const withArrayBounds = (base: Translated, schema: Record<string, unknown>): Translated => {
  const min = schema["minItems"];
  const aboveMin =
    typeof min === "number"
      ? checkThat(
          base,
          (current) => !Array.isArray(current) || current.length >= min,
          `Array has fewer items than minItems ${String(min)}`,
        )
      : base;
  const max = schema["maxItems"];
  const belowMax =
    typeof max === "number"
      ? checkThat(
          aboveMin,
          (current) => !Array.isArray(current) || current.length <= max,
          `Array has more items than maxItems ${String(max)}`,
        )
      : aboveMin;
  return schema["uniqueItems"] === true
    ? checkThat(
        belowMax,
        (current) => {
          if (!Array.isArray(current)) return true;
          const seen = new Set<string>();
          return current.every((item) => {
            const key = JSON.stringify(item);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        },
        "Array items must be unique",
      )
    : belowMax;
};

const buildString = (schema: Record<string, unknown>): Translated =>
  withStringBounds(Schema.String, schema);

const buildArray = (schema: Record<string, unknown>, strict: boolean): Translated => {
  const rawPrefix = schema["prefixItems"];
  const prefix = Array.isArray(rawPrefix) ? rawPrefix : undefined;
  const rest =
    "items" in schema && schema["items"] !== undefined
      ? translate(schema["items"], strict)
      : undefined;
  if (prefix === undefined) {
    const element: Translated = rest ?? Schema.Json;
    return withArrayBounds(Schema.Array(element), schema);
  }
  const prefixMembers = prefix.map((sub) => translate(sub, strict));
  const sized = withArrayBounds(Schema.Array(Schema.Json), schema);
  return checkThat(
    sized,
    (current) => {
      if (!Array.isArray(current)) return true;
      return (
        current.slice(0, prefixMembers.length).every((item, index) => {
          const member = prefixMembers[index];
          return member !== undefined && passes(member, strict)(item);
        }) &&
        (rest === undefined ||
          current.slice(prefixMembers.length).every((item) => passes(rest, strict)(item)))
      );
    },
    "Array element does not match its schema",
  );
};

const buildObject = (schema: Record<string, unknown>, strict: boolean): Translated => {
  const rawProperties = schema["properties"];
  const properties = isJsonObject(rawProperties) ? rawProperties : {};
  const rawRequired = schema["required"];
  const required = Array.isArray(rawRequired)
    ? rawRequired.filter((key): key is string => typeof key === "string")
    : [];
  const entries: Array<[string, Translated]> = [];
  for (const name of new Set([...Object.keys(properties), ...required])) {
    const sub: Translated = Object.hasOwn(properties, name)
      ? translate(properties[name], strict)
      : Schema.Unknown;
    entries.push([name, required.includes(name) ? sub : Schema.optional(sub)]);
  }
  const struct = Schema.Struct(Object.fromEntries(entries));
  const openBase = Schema.StructWithRest(struct, [Schema.Record(Schema.String, Schema.Json)]);
  const additional = schema["additionalProperties"];
  if (additional === false) {
    if (isJsonObject(schema["properties"])) {
      if (Object.keys(schema["properties"]).length === 0) {
        return Schema.StructWithRest(struct, [
          Schema.Record(Schema.String, failSchema("Additional property is not allowed")),
        ]);
      }
      return struct;
    }
    return Schema.StructWithRest(struct, [
      Schema.Record(Schema.String, failSchema("Schema forbids any value (false schema)")),
    ]);
  }
  if (isJsonObject(additional)) {
    const knownKeys = new Set(Object.keys(properties));
    const extra = translate(additional, strict);
    return checkThat(
      openBase,
      (current) => {
        if (!isJsonObject(current)) return true;
        return Object.entries(current).every(
          ([key, value]) => knownKeys.has(key) || passes(extra, strict)(value),
        );
      },
      "Additional property does not match additionalProperties schema",
    );
  }
  return openBase;
};

const buildDomain = (
  domain: Exclude<Domain, "integer" | "number">,
  schema: Record<string, unknown>,
  strict: boolean,
): Translated => {
  switch (domain) {
    case "null":
      return Schema.Null;
    case "boolean":
      return Schema.Boolean;
    case "string":
      return buildString(schema);
    case "array":
      return buildArray(schema, strict);
    case "object":
      return buildObject(schema, strict);
  }
};

const buildBase = (schema: Record<string, unknown>, strict: boolean): Translated => {
  const hasType = "type" in schema;
  const rawType: unknown = hasType ? schema["type"] : undefined;
  const listed = rawType === undefined ? undefined : Array.isArray(rawType) ? rawType : [rawType];
  const known = listed === undefined ? undefined : listed.filter(isDomain);
  if (known === undefined) {
    const constrained =
      "minLength" in schema ||
      "maxLength" in schema ||
      "pattern" in schema ||
      "minimum" in schema ||
      "maximum" in schema ||
      "exclusiveMinimum" in schema ||
      "exclusiveMaximum" in schema ||
      "minItems" in schema ||
      "maxItems" in schema ||
      "uniqueItems" in schema ||
      "items" in schema ||
      "prefixItems" in schema ||
      "required" in schema ||
      "properties" in schema ||
      "additionalProperties" in schema;
    if (!constrained) return Schema.Unknown;
    return Schema.Union([
      Schema.Null,
      Schema.Boolean,
      withStringBounds(Schema.String, schema),
      withNumberBounds(Schema.Number, schema, "open"),
      buildArray(schema, strict),
      buildObject(schema, strict),
    ]);
  }
  if (known.length === 0) return Schema.Never;
  const [only, ...rest] = known;
  if (only === undefined) return Schema.Never;
  if (rest.length === 0) {
    if (only === "integer") return withNumberBounds(Schema.Number, schema, "integer");
    if (only === "number") return withNumberBounds(Schema.Number, schema, "finite");
    return buildDomain(only, schema, strict);
  }
  return Schema.Union(
    known.map((domain) =>
      domain === "integer"
        ? withNumberBounds(Schema.Number, schema, "integer")
        : domain === "number"
          ? withNumberBounds(Schema.Number, schema, "finite")
          : buildDomain(domain, schema, strict),
    ),
  );
};

const translate = (schema: unknown, strict: boolean): Translated => {
  if (typeof schema === "boolean") return schema ? Schema.Unknown : Schema.Never;
  if (!isJsonObject(schema)) return failSchema("Schema must be an object or boolean");
  if ("$ref" in schema) return failSchema("$ref is not supported in DurMemo v1 schemas");
  const base = buildBase(schema, strict);
  const withConstant = "const" in schema ? withConst(base, schema["const"]) : base;
  const enumerated: unknown = schema["enum"];
  const withOptions =
    "enum" in schema
      ? Array.isArray(enumerated)
        ? withEnum(withConstant, enumerated)
        : checkThat(withConstant, () => false, "Value is not one of the allowed enum options")
      : withConstant;
  const applyBranches = (current: Translated, keyword: "anyOf" | "oneOf" | "allOf"): Translated => {
    const branches: unknown = schema[keyword];
    if (!Array.isArray(branches)) {
      return checkThat(current, () => false, `'${keyword}' must be an array of schemas`);
    }
    const members = branches.map((branch) => translate(branch, strict));
    if (keyword === "anyOf") {
      return members.length === 0 ? Schema.Never : withAnyOf(current, members, strict);
    }
    if (keyword === "oneOf") return withOneOf(current, members, strict);
    return withAllOf(current, members, strict);
  };
  let result: Translated = withOptions;
  if ("anyOf" in schema) result = applyBranches(result, "anyOf");
  if ("oneOf" in schema) result = applyBranches(result, "oneOf");
  if ("allOf" in schema) result = applyBranches(result, "allOf");
  if ("not" in schema && schema["not"] !== undefined) {
    return withNot(result, translate(schema["not"], strict), strict);
  }
  return result;
};

const usesStrictObjects = (schema: unknown): boolean => {
  if (!isJsonObject(schema)) return false;
  if (schema["additionalProperties"] === false && isJsonObject(schema["properties"])) return true;
  const nested: Array<unknown> = [
    ...(isJsonObject(schema["properties"]) ? Object.values(schema["properties"]) : []),
    ...(Array.isArray(schema["prefixItems"]) ? schema["prefixItems"] : []),
    ...(Array.isArray(schema["anyOf"]) ? schema["anyOf"] : []),
    ...(Array.isArray(schema["oneOf"]) ? schema["oneOf"] : []),
    ...(Array.isArray(schema["allOf"]) ? schema["allOf"] : []),
  ];
  if ("items" in schema && schema["items"] !== undefined) nested.push(schema["items"]);
  if ("not" in schema && schema["not"] !== undefined) nested.push(schema["not"]);
  if (isJsonObject(schema["additionalProperties"])) nested.push(schema["additionalProperties"]);
  return nested.some(usesStrictObjects);
};

const prepareSchema = (schema: unknown): Effect.Effect<Translated, SchemaInvalid> => {
  if (typeof schema === "boolean" || isJsonObject(schema)) {
    return Effect.try({
      try: () => {
        if (typeof schema !== "boolean" && "$ref" in schema) {
          throw new Error("$ref is not supported in DurMemo v1 schemas.");
        }
        return translate(schema, usesStrictObjects(schema));
      },
      catch: (cause) =>
        new SchemaInvalid({
          message: `Unsupported schema: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
  }
  return Effect.fail(
    new SchemaInvalid({ message: "Schema must be a JSON Schema object or boolean." }),
  );
};

export const assertSchemaObject = (schema: unknown): Effect.Effect<void, SchemaInvalid> =>
  Effect.asVoid(prepareSchema(schema));

const standardFormatter = SchemaIssue.makeFormatterStandardSchemaV1();

const formatIssuePath = (segments: ReadonlyArray<PropertyKey>): string => {
  let out = "$";
  for (const segment of segments) {
    if (typeof segment === "number") {
      out += `[${String(segment)}]`;
    } else if (typeof segment === "string" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
      out += `.${segment}`;
    } else if (typeof segment === "string") {
      out += `[${JSON.stringify(segment)}]`;
    } else {
      out += `[${String(segment)}]`;
    }
  }
  return out;
};

const toPathSegment = (segment: unknown): PropertyKey => {
  if (typeof segment === "string" || typeof segment === "number" || typeof segment === "symbol") {
    return segment;
  }
  if (typeof segment === "object" && segment !== null && "key" in segment) {
    return toPathSegment(segment.key);
  }
  return String(segment);
};

const flattenIssue = (
  issue: SchemaIssue.Issue,
  base: ReadonlyArray<PropertyKey>,
): Array<ValidationIssue> =>
  standardFormatter(issue).issues.map(({ path, message }) => ({
    path: formatIssuePath([...base, ...(path ?? []).map(toPathSegment)]),
    message,
  }));

const issueKey = (detail: ValidationIssue): string => `${detail.path}\n${detail.message}`;

const tryTranslate = (subschema: unknown, strict: boolean): Translated | undefined => {
  try {
    return translate(subschema, strict);
  } catch {
    return undefined;
  }
};

type DecodeOptions = SchemaAST.ParseOptions | undefined;

const collectDetail = (
  schemaNode: unknown,
  value: unknown,
  issue: SchemaIssue.Issue,
  basePath: ReadonlyArray<PropertyKey>,
  strict: boolean,
  options: DecodeOptions,
): Effect.Effect<Array<ValidationIssue>> =>
  Effect.gen(function* () {
    const here = flattenIssue(issue, basePath);
    const children = yield* collectChildDetails(schemaNode, value, basePath, strict, options);
    if (children.length === 0) return here;
    const seen = new Set(here.map(issueKey));
    const merged = [...here];
    for (const child of children) {
      const key = issueKey(child);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(child);
      }
    }
    return merged;
  });

const probeMember = (
  subschema: unknown,
  subvalue: unknown,
  basePath: ReadonlyArray<PropertyKey>,
  strict: boolean,
  options: DecodeOptions,
): Effect.Effect<Array<ValidationIssue>> =>
  Effect.gen(function* () {
    const member = tryTranslate(subschema, strict);
    if (member === undefined) return [];
    const outcome = yield* Schema.decodeUnknownEffect(member)(subvalue, options).pipe(
      Effect.map((decoded) => ({ ok: true as const, decoded })),
      Effect.catch((error: Schema.SchemaError) => Effect.succeed({ ok: false as const, error })),
    );
    if (outcome.ok) return [];
    return yield* collectDetail(
      subschema,
      subvalue,
      outcome.error.issue,
      basePath,
      strict,
      options,
    );
  }).pipe(Effect.catch(() => Effect.succeed([])));

const collectChildDetails = (
  schemaNode: unknown,
  value: unknown,
  basePath: ReadonlyArray<PropertyKey>,
  strict: boolean,
  options: DecodeOptions,
): Effect.Effect<Array<ValidationIssue>> =>
  Effect.gen(function* () {
    if (!isJsonObject(schemaNode)) return [];
    const out: Array<ValidationIssue> = [];
    if (isJsonObject(value)) {
      const rawProperties = schemaNode["properties"];
      const properties = isJsonObject(rawProperties) ? rawProperties : undefined;
      const rawRequired = schemaNode["required"];
      const required = new Set(
        Array.isArray(rawRequired)
          ? rawRequired.filter((key): key is string => typeof key === "string")
          : [],
      );
      if (properties !== undefined || required.size > 0) {
        for (const name of new Set([
          ...(properties === undefined ? [] : Object.keys(properties)),
          ...required,
        ])) {
          if (!Object.hasOwn(value, name)) {
            if (required.has(name)) {
              out.push({ path: formatIssuePath([...basePath, name]), message: "Missing key" });
            }
            continue;
          }
          const sub: unknown =
            properties !== undefined && Object.hasOwn(properties, name)
              ? properties[name]
              : undefined;
          if (sub === undefined) continue;
          out.push(...(yield* probeMember(sub, value[name], [...basePath, name], strict, options)));
        }
      }
      const additional: unknown = schemaNode["additionalProperties"];
      if (isJsonObject(additional)) {
        const knownKeys = new Set(properties === undefined ? [] : Object.keys(properties));
        for (const [key, subvalue] of Object.entries(value)) {
          if (knownKeys.has(key)) continue;
          out.push(
            ...(yield* probeMember(additional, subvalue, [...basePath, key], strict, options)),
          );
        }
      }
    } else if (Array.isArray(value)) {
      const rawPrefix = schemaNode["prefixItems"];
      const prefix = Array.isArray(rawPrefix) ? rawPrefix : undefined;
      const rest: unknown = schemaNode["items"];
      const hasRest = "items" in schemaNode && rest !== undefined;
      if (prefix !== undefined) {
        const shared = Math.min(prefix.length, value.length);
        for (let index = 0; index < shared; index += 1) {
          out.push(
            ...(yield* probeMember(
              prefix[index],
              value[index],
              [...basePath, index],
              strict,
              options,
            )),
          );
        }
        if (hasRest) {
          for (let index = prefix.length; index < value.length; index += 1) {
            out.push(
              ...(yield* probeMember(rest, value[index], [...basePath, index], strict, options)),
            );
          }
        }
      } else if (hasRest) {
        for (let index = 0; index < value.length; index += 1) {
          out.push(
            ...(yield* probeMember(rest, value[index], [...basePath, index], strict, options)),
          );
        }
      }
    }
    return out;
  });

export const validateValue = (
  schemaJson: Schema.Json,
  value: Schema.Json,
): Effect.Effect<void, SchemaInvalid | ValidationFailed> =>
  Effect.gen(function* () {
    if (typeof schemaJson === "boolean") {
      if (schemaJson) return yield* Effect.void;
      return yield* Effect.fail(
        new ValidationFailed({
          message: "Value does not match schema: false schema forbids any value.",
          errors: [{ path: "$", message: "Schema forbids any value (false schema)" }],
        }),
      );
    }
    if (!isJsonObject(schemaJson)) {
      return yield* Effect.fail(
        new SchemaInvalid({ message: "Schema must be a JSON Schema object or boolean." }),
      );
    }
    if ("$ref" in schemaJson) {
      return yield* Effect.fail(
        new SchemaInvalid({ message: "$ref is not supported in DurMemo v1 schemas." }),
      );
    }
    const strict = usesStrictObjects(schemaJson);
    const compiled = yield* prepareSchema(schemaJson);
    const decodeOptions: DecodeOptions = strict ? { onExcessProperty: "error" } : undefined;
    const outcome = yield* Schema.decodeUnknownEffect(compiled)(value, decodeOptions).pipe(
      Effect.map((decoded) => ({ ok: true as const, decoded })),
      Effect.catch((error: Schema.SchemaError) => Effect.succeed({ ok: false as const, error })),
    );
    if (outcome.ok) return;
    const errors = yield* collectDetail(
      schemaJson,
      value,
      outcome.error.issue,
      [],
      strict,
      decodeOptions,
    );
    const safe =
      errors.length > 0
        ? errors
        : [
            {
              path: "$",
              message: outcome.error.message.replace(/\n/g, " "),
            } satisfies ValidationIssue,
          ];
    return yield* Effect.fail(
      new ValidationFailed({
        message: `Value does not match schema: ${safe.map(({ path, message }) => `${path}: ${message}`).join("; ")}`,
        errors: safe,
      }),
    );
  });
