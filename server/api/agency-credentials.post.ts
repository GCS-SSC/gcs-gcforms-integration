import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { createGcFormsCredential } from '../credentials'

export default defineGcsExtensionRouteHandler(async context => await createGcFormsCredential(context))
