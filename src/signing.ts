import { createHmac } from "node:crypto";


export function sign(secret: string, timestamp: string, body: string): string {
  const signedContent = `${timestamp}.${body}`;
  return createHmac("sha256", secret).update(signedContent).digest("hex");
}
