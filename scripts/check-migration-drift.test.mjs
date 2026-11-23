/**
 * The drift ratchet's counting and comparison (MW-008). Run with: node --test scripts/
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { compareWithBaseline, countDrift, KINDS } from './check-migration-drift.mjs';

const SAMPLE = `-- DropForeignKey
ALTER TABLE "asset" DROP CONSTRAINT "asset_category_fk";

-- DropIndex
DROP INDEX "leave_request_no_overlap";

-- AlterTable
ALTER TABLE "asset" ALTER COLUMN "metadata" DROP DEFAULT,
ALTER COLUMN "status" SET DEFAULT 'active',
ALTER COLUMN "notes" SET DATA TYPE TEXT,
ALTER COLUMN "tag" DROP NOT NULL,
ADD COLUMN "extra" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "person_email_key" ON "person"("email");

-- RenameIndex
ALTER INDEX "a_idx" RENAME TO "b_idx";

-- AddForeignKey
ALTER TABLE "asset_custody" ADD CONSTRAINT "c_fk" FOREIGN KEY ("asset_id") REFERENCES "asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
`;

describe('countDrift', () => {
  it('counts each kind of change and the tables it touches', () => {
    const counts = countDrift(SAMPLE);
    assert.equal(counts.statements, 6);
    assert.equal(counts.tablesAffected, 3);
    assert.equal(counts.dropConstraint, 1);
    assert.equal(counts.dropIndex, 1);
    assert.equal(counts.columnDefault, 2);
    assert.equal(counts.columnType, 1);
    assert.equal(counts.columnNullability, 1);
    assert.equal(counts.addColumn, 1);
    assert.equal(counts.createIndex, 1);
    assert.equal(counts.renameIndex, 1);
    assert.equal(counts.addForeignKey, 1);
    assert.equal(counts.other, 0);
  });

  it('reports no drift for an empty diff', () => {
    const counts = countDrift('-- This is an empty migration.\n');
    assert.ok(KINDS.every((kind) => counts[kind] === 0));
  });

  it('reads the committed baseline as a complete set of counts', () => {
    const baseline = JSON.parse(
      readFileSync(new URL('../prisma/drift-baseline.json', import.meta.url), 'utf8'),
    );
    assert.deepEqual(Object.keys(baseline), KINDS);
  });
});

describe('compareWithBaseline', () => {
  const baseline = countDrift(SAMPLE);

  it('passes the same drift', () => {
    assert.deepEqual(compareWithBaseline(countDrift(SAMPLE), baseline), { grown: [], shrunk: [] });
  });

  it('fails a migration that adds drift', () => {
    const more = `${SAMPLE}\n-- DropIndex\nDROP INDEX "attendance_no_overlap";\n`;
    const { grown } = compareWithBaseline(countDrift(more), baseline);
    assert.deepEqual(grown, ['statements: 6 -> 7', 'dropIndex: 1 -> 2']);
  });

  it('reports a kind missing from the baseline as growth from zero', () => {
    const { grown } = compareWithBaseline({ dropTable: 1 }, {});
    assert.deepEqual(grown, ['dropTable: 0 -> 1']);
  });

  it('notices drift that shrank', () => {
    const fewer = SAMPLE.split('-- CreateIndex')[0];
    const { grown, shrunk } = compareWithBaseline(countDrift(fewer), baseline);
    assert.deepEqual(grown, []);
    assert.ok(shrunk.includes('createIndex: 1 -> 0'));
  });
});
