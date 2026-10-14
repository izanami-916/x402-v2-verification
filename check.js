// check.js — keyless end-to-end verification of a live x402 v2 offer.
// No key, token, or wallet is read or sent. Node 18+ (uses fetch and
// Buffer base64url).
//
// What it does:
//   1. POST {} to the ask rail and require HTTP 402.
//   2. Decode the payment-required envelope; require x402Version 2,
//      scheme "exact", the Solana mainnet network, and a non-empty
//      payTo; compare the envelope with the JSON body (they must
//      agree).
//   3. Query a public Solana RPC for the payTo balance.
//   4. Exit 0 only if every check passed.

const RAIL = "https://izanami.tail0750b9.ts.net/api/ask";
const RPC = "https://solana-rpc.publicnode.com";
const SOLANA_MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

let failures = 0;

function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures += 1;
}

async function main() {
  // 1. The offer must be a 402.
  const res = await fetch(RAIL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  check("rail answers 402 Payment Required", res.status === 402, `got ${res.status}`);

  // 2. The envelope.
  const header = res.headers.get("payment-required");
  check("payment-required header present", !!header);
  let env = null;
  if (header) {
    try {
      env = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
      check("envelope is valid JSON", true);
    } catch {
      check("envelope is valid JSON", false);
    }
  }
  const body = await res.json().catch(() => null);
  check("body is valid JSON", body !== null);

  if (env) {
    check("envelope says x402Version 2", env.x402Version === 2, `got ${env.x402Version}`);
    const row = Array.isArray(env.accepts) ? env.accepts[0] : null;
    check("envelope carries an accepts[] row", !!row);
    if (row) {
      check("scheme is exact", row.scheme === "exact", `got ${row.scheme}`);
      check(
        "network is Solana mainnet",
        typeof row.network === "string" && row.network === `solana:${SOLANA_MAINNET_GENESIS}`,
        row.network,
      );
      check("payTo present", typeof row.payTo === "string" && row.payTo.length > 0, row.payTo);
      check("amount present and positive", /^[0-9]+$/.test(row.amount || "") && BigInt(row.amount) > 0n, row.amount);
      if (row.payTo) {
        // The envelope must agree with the body the server sent.
        check(
          "header envelope == body offer",
          body && body.x402Version === env.x402Version && body.accepts?.[0]?.payTo === row.payTo,
          "version and payTo compared",
        );
        // 3. Settlement leg: the payTo balance is an on-chain fact.
        try {
          const r = await fetch(RPC, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "getBalance",
              params: [row.payTo],
            }),
          });
          const j = await r.json();
          const lamports = j?.result?.value;
          if (typeof lamports === "number") {
            const sol = (lamports / 1_000_000_000).toFixed(9);
            console.log(`INFO  payTo ${row.payTo} balance ${sol} SOL on-chain (public RPC)`);
          } else {
            check("on-chain balance readable via public RPC", false, JSON.stringify(j?.error || j).slice(0, 120));
          }
        } catch (e) {
          check("on-chain balance readable via public RPC", false, String(e).slice(0, 120));
        }
      }
    }
  }

  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("check crashed:", e);
  process.exit(1);
});
