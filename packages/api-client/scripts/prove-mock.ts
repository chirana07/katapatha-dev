import { createKatapathaClient } from "../src/client.ts";

const client = createKatapathaClient({
  baseUrl: process.env.MOCK_API_BASE_URL ?? "http://127.0.0.1:4010",
  getToken: () => "contract-smoke-test",
});

const health = await client.GET("/health");
const vocabularies = await client.GET("/reference/vocabularies");
const orders = await client.GET("/orders");

if (health.error || vocabularies.error || orders.error) {
  console.error("Mock contract proof failed", {
    health: health.error,
    vocabularies: vocabularies.error,
    orders: orders.error,
  });
  process.exitCode = 1;
} else {
  console.log("Mock contract proof passed", {
    health: health.data?.ok,
    deferralReasons: vocabularies.data?.deferralReasons.length,
    orders: orders.data?.length,
    firstOrder: orders.data?.[0]?.ref,
  });
}
