import fp from "fastify-plugin";
import type { FastifyError } from "fastify";
import { AuthError } from "../lib/auth.js";
import { LoginRateLimitError } from "../lib/loginThrottle.js";

/**
 * One error envelope for the whole API: { error: { code, message, details? } }.
 *
 * The contract declares this shape, so clients can render a failure beside the
 * action that caused it instead of guessing from a status code alone.
 */
export default fp(async (fastify) => {
  fastify.setErrorHandler((rawError, request, reply) => {
    const err = rawError as FastifyError;

    if (err instanceof AuthError) {
      return reply.status(err.status).send({
        error: {
          code: err.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN",
          message: err.message,
        },
      });
    }

    if (err instanceof LoginRateLimitError) {
      return reply
        .header("Retry-After", String(err.retryAfterSeconds))
        .status(429)
        .send({
          error: {
            code: "TOO_MANY_ATTEMPTS",
            message: err.message,
          },
        });
    }

    // Fastify's schema validation failures carry a `validation` array. These are
    // contract violations, so they are reported as such rather than as 500s.
    if (err.validation) {
      return reply.status(422).send({
        error: {
          code: "REQUEST_DOES_NOT_MATCH_CONTRACT",
          message: err.message,
          details: { validation: err.validation },
        },
      });
    }

    const status = err.statusCode ?? 500;
    if (status >= 500) request.log.error({ err }, "unhandled error");

    return reply.status(status).send({
      error: {
        code: status >= 500 ? "INTERNAL" : (err.code ?? "REQUEST_FAILED"),
        message: status >= 500 ? "Something went wrong." : err.message,
      },
    });
  });

  fastify.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: "No such endpoint." },
    }),
  );
}, { name: "errors" });
