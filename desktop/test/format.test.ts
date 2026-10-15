import assert from "node:assert/strict";
import test from "node:test";

import { dateTimeAttribute, formatDateTime } from "../src/shared/format";

test("desktop timestamps use locale-aware Intl formatting", () => {
  const at = Date.UTC(2026, 7, 25, 8, 5);
  assert.equal(formatDateTime(at, "en-US", "UTC"), "8/25/26, 8:05 AM");
  assert.match(formatDateTime(at, "zh-CN", "UTC"), /2026\/8\/25 08:05/);
});

test('unrepresentable timestamps use a neutral fallback in every shipped locale', () => {
  for (const locale of ['en', 'zh-CN', 'zh-TW']) {
    for (const value of [Number.MAX_SAFE_INTEGER, NaN, Infinity, new Date(NaN)]) {
      assert.equal(formatDateTime(value, locale), '—');
    }
    assert.ok(formatDateTime(0, locale) !== '—', 'the Unix epoch is a real date');
  }
});

test('machine-readable dates keep valid instants and omit values outside the calendar range', () => {
  assert.equal(dateTimeAttribute(0), '1970-01-01T00:00:00.000Z');
  assert.equal(dateTimeAttribute(new Date('2026-10-15T08:00:00Z')), '2026-10-15T08:00:00.000Z');
  assert.equal(dateTimeAttribute(8_640_000_000_000_000), '+275760-09-13T00:00:00.000Z');
  for (const value of [8_640_000_000_000_001, Number.MAX_SAFE_INTEGER, NaN, Infinity, new Date(NaN)]) {
    assert.equal(dateTimeAttribute(value), undefined);
  }
});
