import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { createGcFormsCredential } from '../credentials.ts'

export default defineGcsExtensionRouteHandler(async context => await createGcFormsCredential(context))
