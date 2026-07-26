import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { deleteGcFormsCredential } from '../credentials.ts'

export default defineGcsExtensionRouteHandler(async context => await deleteGcFormsCredential(context))
