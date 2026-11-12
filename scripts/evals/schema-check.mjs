// The JSON Schema subset the agents' output schemas use (AI-6, ADR-0086): type, properties,
// required, items, enum, description. A schema using any other keyword is refused, so an
// unsupported rule can never pass silently. No dependency: the live job installs nothing.

const KEYWORDS = new Set(["type", "properties", "required", "items", "enum", "description"]);
const TYPES = {
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  array: Array.isArray,
  string: (v) => typeof v === "string",
  integer: Number.isInteger,
  number: (v) => typeof v === "number" && Number.isFinite(v),
  boolean: (v) => typeof v === "boolean",
};

/** Throws when `schema` uses anything outside the subset. */
export function assertSupportedSchema(schema, path = "$") {
  if (!TYPES.object(schema)) throw new Error(`${path}: schema must be an object`);
  for (const k of Object.keys(schema)) {
    if (!KEYWORDS.has(k)) throw new Error(`${path}: unsupported schema keyword "${k}"`);
  }
  if (schema.type !== undefined && !Object.hasOwn(TYPES, schema.type)) {
    throw new Error(`${path}: unsupported type`);
  }
  for (const [k, sub] of Object.entries(schema.properties ?? {})) {
    assertSupportedSchema(sub, `${path}.${k}`);
  }
  if (schema.items !== undefined) assertSupportedSchema(schema.items, `${path}[]`);
}

/**
 * Where `value` breaks `schema`, as paths and rule names only (never values, so model text can't
 * reach a log). An empty list means it matches.
 */
export function schemaProblems(value, schema, path = "$") {
  if (schema.type && !TYPES[schema.type](value)) return [`${path}: not ${schema.type}`];
  if (schema.enum && !schema.enum.includes(value)) return [`${path}: not an allowed value`];
  const problems = [];
  if (TYPES.object(value)) {
    for (const k of schema.required ?? []) {
      if (!Object.hasOwn(value, k)) problems.push(`${path}.${k}: missing`);
    }
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, k)) problems.push(...schemaProblems(value[k], sub, `${path}.${k}`));
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((v, i) => problems.push(...schemaProblems(v, schema.items, `${path}[${i}]`)));
  }
  return problems;
}
