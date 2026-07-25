import { sql, type RawBuilder } from 'kysely'
import type { JsonValue } from '@gcs-ssc/extensions'
import { normalizeGcFormsJsonValue } from '../shared/gcforms'

/** Builds a PostgreSQL-safe JSONB value while preserving undefined as SQL NULL. */
export const gcFormsJsonbValue = (value: unknown): RawBuilder<JsonValue> | null =>
  value === undefined
    ? null
    : sql<JsonValue>`${JSON.stringify(normalizeGcFormsJsonValue(value))}::jsonb`
