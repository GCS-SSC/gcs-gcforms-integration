import type { H3Event } from 'h3'
import { deleteGcFormsCredential } from '../credentials'

export default async (event: H3Event) => await deleteGcFormsCredential(event as never)
