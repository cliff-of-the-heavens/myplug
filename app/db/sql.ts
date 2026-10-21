import { getTableName, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * A column with its table name, e.g. "users"."id". Drizzle leaves columns
 * unqualified in single-table selects, which is ambiguous (or silently wrong)
 * inside correlated subqueries.
 */
export function qualified(column: AnyPgColumn) {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}
