import { sql } from 'kysely'
import { defineGcsExtensionMigration } from '@gcs-ssc/extensions/server'

export default defineGcsExtensionMigration({
  up: async db => {
    await sql`
      ALTER TABLE "Funding_Case_Agreement_Claim"
      ADD COLUMN IF NOT EXISTS "egcs_fc_gcformssubmissionuuid" varchar(80)
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS fc_idx_claim_gcforms_submission_uuid
      ON "Funding_Case_Agreement_Claim" ("egcs_fc_gcformssubmissionuuid")
      WHERE "_deleted" = false AND "egcs_fc_gcformssubmissionuuid" IS NOT NULL
    `.execute(db)
  }
})
