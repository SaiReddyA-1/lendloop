import { httpAction } from "./_generated/server";

// AUTH: bearer token
export const open = httpAction(async () => new Response("data"));
