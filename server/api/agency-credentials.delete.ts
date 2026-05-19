import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { deleteGcFormsCredential } from '../credentials'

export default defineGcsExtensionRouteHandler(async context => await deleteGcFormsCredential(context))
