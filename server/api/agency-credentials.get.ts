import type { H3Event } from 'h3'
import { listGcFormsCredentials } from '../credentials'

export default async (event: H3Event) => await listGcFormsCredentials(event as never)
