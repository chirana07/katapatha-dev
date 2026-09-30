import fp from "fastify-plugin";
import { prisma } from "../lib/db.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: typeof prisma;
  }
}

/** Exposes the shared Prisma client as `fastify.prisma`. */
export default fp(async (fastify) => {
  fastify.decorate("prisma", prisma);
  fastify.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
}, { name: "prisma" });
