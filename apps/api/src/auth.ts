import type { FastifyRequest } from 'fastify';
import type { Actor } from './service.js';
import { AppError } from './service.js';
import { z } from 'zod';
import { authenticateCognito } from './cognito-auth.js';

const VerifiedUser=z.object({
  id:z.string().min(1).max(200),email:z.email().max(320),
  email_confirmed_at:z.string().min(1).nullable().optional(),
  user_metadata:z.object({full_name:z.string().max(200).optional(),name:z.string().max(200).optional()}).nullable().optional()
});

const demoActors:Record<string,Actor>={
  'demo-organizer':{id:'demo-organizer',email:'alex@example.test',displayName:'Alex Morgan'},
  'demo-helper-1':{id:'demo-helper-1',email:'sam@example.test',displayName:'Sam Morgan'},
  'demo-helper-2':{id:'demo-helper-2',email:'jordan@example.test',displayName:'Jordan Lee'},
  'demo-helper-3':{id:'demo-helper-3',email:'riley@example.test',displayName:'Riley Chen'}
};

export async function authenticate(request:FastifyRequest):Promise<Actor> {
  const demoId=request.headers['x-demo-user'];
  if (process.env.DEMO_MODE==='true' && typeof demoId==='string' && demoActors[demoId]) return demoActors[demoId];
  const bearer=request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (!bearer) throw new AppError(401,'Sign in to continue.');
  if(process.env.AUTH_PROVIDER==='cognito')return authenticateCognito(bearer);
  if(process.env.AUTH_PROVIDER&&process.env.AUTH_PROVIDER!=='supabase')throw new AppError(503,'Authentication is not configured.');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) throw new AppError(503,'Authentication is not configured.');
  let response:Response;
  try {
    response=await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`,{
      headers:{ Authorization:`Bearer ${bearer}`,apikey:process.env.SUPABASE_ANON_KEY },
      signal:AbortSignal.timeout(5000)
    });
  } catch {
    throw new AppError(503,'Authentication is temporarily unavailable. Try again.');
  }
  if (response.status===401 || response.status===403) throw new AppError(401,'Your session expired. Sign in again.');
  if (!response.ok) throw new AppError(503,'Authentication is temporarily unavailable. Try again.');
  let payload:unknown;
  try { payload=await response.json(); }
  catch { throw new AppError(503,'Authentication is temporarily unavailable. Try again.'); }
  const parsed=VerifiedUser.safeParse(payload);
  if (!parsed.success) throw new AppError(503,'Authentication is temporarily unavailable. Try again.');
  const user=parsed.data;
  if (!user.email_confirmed_at) throw new AppError(401,'A verified email is required.');
  return {id:user.id,email:user.email.toLowerCase(),displayName:user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0]};
}

export function demoEnabled():boolean { return process.env.DEMO_MODE==='true'; }
