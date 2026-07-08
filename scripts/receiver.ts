import { createServer } from "node:http";
import { sign } from "../src/signing.js";

const PORT = Number(process.env.PORT ?? 4000);
const SECRET = process.env.SECRET ?? "testsecret";
const FAIL_RATE = Number(process.env.FAIL_RATE ?? 0); // 0..1 chance of a 500

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });

  req.on("end", () => {
    const id = req.headers["x-webhook-id"];
    const timestamp = req.headers["x-webhook-timestamp"];
    const signature = req.headers["x-webhook-signature"];

    const expected =
      typeof timestamp === "string" ? sign(SECRET, timestamp, body) : "";
    const valid = signature === expected;

    if (Math.random() < FAIL_RATE) {
      console.log(`✗ id=${id} sig=${valid ? "valid" : "INVALID"} -> 500 (simulated failure)`);
      res.writeHead(500);
      res.end("simulated failure");
      return;
    }

    console.log(`✓ id=${id} sig=${valid ? "valid" : "INVALID"} -> 200`);
    res.writeHead(200);
    res.end("ok");
  });
});

server.listen(PORT, () => {
  console.log(`receiver listening on :${PORT} (FAIL_RATE=${FAIL_RATE})`);
});
