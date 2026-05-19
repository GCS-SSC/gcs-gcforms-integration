import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { saveGcFormsCredential } from '../credentials'

export default defineGcsExtensionRouteHandler(async context => await saveGcFormsCredential(context))
