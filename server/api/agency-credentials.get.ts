import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { listGcFormsCredentials } from '../credentials.ts'

export default defineGcsExtensionRouteHandler(async context => await listGcFormsCredentials(context))
