import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { listGcFormsCredentials } from '../credentials'

export default defineGcsExtensionRouteHandler(async context => await listGcFormsCredentials(context))
