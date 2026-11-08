import { httpAction } from "./_generated/server";

async function authorizeInbound(request: Request) {
  const ok = await verifyBearer(request.headers.get("Authorization"), "x");
  return ok ? null : new Response("no", { status: 401 });
}

// AUTH: bearer token
export const health = httpAction(async (_ctx, request) => {
  const denied = await authorizeInbound(request);
  if (denied) return denied;
  return new Response("ok");
});

// AUTH: public (returns a bare 405)
export const methodNotAllowed = httpAction(async () => new Response("", { status: 405 }));

const router = {};
export default router;
