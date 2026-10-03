/**
 * The AJV options that make the contract enforceable.
 *
 * This is the whole mechanism behind the claim in README.md that "a handler
 * cannot take a field the contract does not declare": Fastify's native AJV,
 * configured to reject unknown properties rather than quietly strip them.
 *
 * Extracted here because it was previously inline in server.ts, and the route
 * tests build a bare `Fastify()` — so every one of them ran against *default*
 * AJV options, where `removeAdditional` is on for querystrings. A test could
 * therefore pass an undeclared parameter and see a 200, which is the opposite
 * of what the test was written to prove. Tests must build their instance with
 * these options or they are not testing the contract.
 */
export const CONTRACT_AJV = {
  customOptions: {
    // The contract says additionalProperties:false on request bodies and we
    // want that enforced, not silently stripped.
    removeAdditional: false,
    // "120" is not 120. Coercion would let a client send the wrong type and
    // have the server quietly agree with it.
    coerceTypes: false,
    allErrors: true,
  },
} as const;
