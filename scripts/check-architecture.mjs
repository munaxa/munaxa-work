#!/usr/bin/env node
/**
 * Architecture gate — docs/MASTER_INSTRUCTIONS.md.
 *
 * Checks the Prisma schema against the rules that outlive every phase: PostgreSQL, tenant-first,
 * UUID identifiers, audit, soft delete, optimistic concurrency and snake_case mapping. A model
 * that is genuinely global opts out with a `/// @global <reason>` doc comment.
 *
 * It is a no-op until prisma/schema.prisma exists, so it is in force from the commit that adds
 * the first model rather than from the commit that remembers to turn it on. Dependency-free by
 * design — like the standards gate, it runs on a bare checkout.
 *
 * Usage: node scripts/check-architecture.mjs
 */

import { readFileSync, existsSync } from 'node:fs';

const SCHEMA = 'prisma/schema.prisma';

const REQUIRED_FIELDS = [
  ['id', 'the primary key'],
  ['created_at', 'audit'],
  ['created_by', 'audit'],
  ['updated_at', 'audit'],
  ['updated_by', 'audit'],
  ['deleted_at', 'soft delete'],
  ['deleted_by', 'soft delete'],
  ['version', 'optimistic concurrency'],
];

const TENANT_FIELD = 'tenant_id';
const GLOBAL_OPT_OUT = /^\s*\/\/\/\s*@global\s+\S+/;
const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

const violations = [];
const fail = (model, message) => violations.push({ model, message });

/** The column name a field maps to: `@map("x")` when present, otherwise the field name. */
const columnOf = (line) => {
  const mapped = /@map\(\s*"([^"]+)"\s*\)/.exec(line);
  return mapped ? mapped[1] : (line.trim().split(/\s+/)[0] ?? '');
};

const isFieldLine = (line) => {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('@@')) return false;
  return /^[A-Za-z_][A-Za-z0-9_]*\s+\S/.test(trimmed);
};

/** Splits the schema into `model` blocks, carrying the doc comments that precede each one. */
const parseModels = (source) => {
  const models = [];
  const lines = source.split('\n');
  let current = null;
  let comments = [];

  for (const line of lines) {
    const opening = /^\s*model\s+([A-Za-z0-9_]+)\s*\{/.exec(line);
    if (opening) {
      current = { name: opening[1], body: [], comments };
      comments = [];
      continue;
    }
    if (current === null) {
      if (line.trim().startsWith('///')) comments.push(line);
      else if (line.trim() !== '') comments = [];
      continue;
    }
    if (/^\s*\}/.test(line)) {
      models.push(current);
      current = null;
      continue;
    }
    current.body.push(line);
  }
  return models;
};

const checkDatasource = (source) => {
  const provider = /datasource\s+\w+\s*\{[^}]*provider\s*=\s*"([^"]+)"/s.exec(source);
  if (provider !== null && provider[1] !== 'postgresql') {
    fail('datasource', `provider is "${provider[1]}". The database is PostgreSQL.`);
  }
};

const checkFields = (model, columns) => {
  const isGlobal = model.comments.some((comment) => GLOBAL_OPT_OUT.test(comment));

  for (const [field, purpose] of REQUIRED_FIELDS) {
    if (!columns.includes(field)) fail(model.name, `is missing "${field}" (${purpose}).`);
  }
  if (!isGlobal && !columns.includes(TENANT_FIELD)) {
    fail(
      model.name,
      `is missing "${TENANT_FIELD}". Every business entity belongs to exactly one tenant; a genuinely global model declares "/// @global <reason>".`,
    );
  }
  for (const column of columns) {
    if (!SNAKE_CASE.test(column)) {
      fail(model.name, `column "${column}" is not snake_case. Map it with @map("...").`);
    }
  }
};

const checkIdentifier = (model, fieldLines) => {
  const idLine = fieldLines.find((line) => columnOf(line) === 'id');
  if (idLine === undefined) return;
  if (!/\bString\b/.test(idLine) || !/@default\(/.test(idLine)) {
    fail(model.name, 'identifier must be a String UUIDv7 with a @default(...).');
  }
};

const checkMapping = (model) => {
  const mapped = model.body.some((line) => /@@map\(\s*"([^"]+)"\s*\)/.test(line));
  const tableName = model.name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  if (!mapped)
    fail(model.name, `has no @@map. Database naming is snake_case: @@map("${tableName}").`);
};

if (!existsSync(SCHEMA)) {
  console.log(`Architecture: no ${SCHEMA} yet — nothing to check.`);
  process.exit(0);
}

const source = readFileSync(SCHEMA, 'utf8');
checkDatasource(source);

const models = parseModels(source);
for (const model of models) {
  const fieldLines = model.body.filter(isFieldLine);
  checkFields(model, fieldLines.map(columnOf));
  checkIdentifier(model, fieldLines);
  checkMapping(model);
}

if (violations.length > 0) {
  console.error(`Architecture: ${violations.length} violation(s).\n`);
  for (const { model, message } of violations) {
    console.error(`  ${SCHEMA}  ${model} ${message}`);
  }
  console.error('\nSee docs/MASTER_INSTRUCTIONS.md. Changing a rule requires an ADR.');
  process.exit(1);
}

console.log(`Architecture: ${models.length} model(s) checked, no violations.`);
