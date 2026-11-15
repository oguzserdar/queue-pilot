/**
 * Every other /v1/ address: the flat not_found error, so an agent that tries a call this server does not offer (yet)
 * reads a next step instead of an HTML page. /auth.md lists the calls that exist.
 */
import { fail } from "@/lib/agent-signup/http";

const notFound = async () => fail("not_found");

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
