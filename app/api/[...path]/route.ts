import { env } from 'cloudflare:workers';
import { handleApi } from '../../../src/server/api.js';

export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handleApi(request, env);
export const POST = (request: Request) => handleApi(request, env);
export const PUT = (request: Request) => handleApi(request, env);
export const DELETE = (request: Request) => handleApi(request, env);
