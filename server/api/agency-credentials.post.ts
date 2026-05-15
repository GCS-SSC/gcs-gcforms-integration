import type { H3Event } from 'h3'
import { saveGcFormsCredential } from '../credentials'

export default async (event: H3Event) => await saveGcFormsCredential(event as never)
