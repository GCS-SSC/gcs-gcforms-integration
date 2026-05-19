import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { patchGcFormsCredential } from '../credentials'

export default defineGcsExtensionRouteHandler(async context => await patchGcFormsCredential(context))
