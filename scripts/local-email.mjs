import { readFile } from "node:fs/promises";
import { createPrivateKey, createSign } from "node:crypto";
// Development/test provider only. Never deployed or used with real addresses.
import { createServer } from "node:http";
let messages = [];
let fault = "";
let confirmations = 0;
createServer(async (request, response) => {
  const reply = (status, body = {}) => {
    response.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify(body));
  };
  if (request.url === "/health" && request.method === "GET")
    return reply(200, { ready: true });
  if (request.url?.startsWith("/confirm?") && request.method === "GET") {
    confirmations++;
    return reply(200);
  }
  if (request.url === "/mailbox" && request.method === "GET") {
    const escape = (value) =>
      String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    });
    response.end(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fake development mailbox</title><style>body{font:16px system-ui;max-width:48rem;margin:2rem auto;padding:1rem;color:#1b302c;background:#f4f5f1}article{background:white;border:1px solid #ccd8ce;padding:1rem;margin:1rem 0;overflow-wrap:anywhere}pre{white-space:pre-wrap;font:inherit}a{color:#185e52}</style><h1>Fake development mailbox</h1><p>Local review only. Messages are never sent to real inboxes; this in-memory mailbox clears on restart. Use Send again in the app to replace a lost fake email.</p><p><a href="/mailbox">Refresh inbox</a> · <a href="http://127.0.0.1:4322/">Open local app</a></p>${
        messages
          .map((m) => {
            const link = m.text.match(
              /http:\/\/127\.0\.0\.1:4322\/#invite=[a-f0-9]{64}/,
            )?.[0];
            return `<article><h2>To ${escape(m.recipient)}</h2><pre>${escape(m.text)}</pre>${link ? `<p><a href="${escape(link)}">Review fake invitation</a></p>` : ""}</article>`;
          })
          .join("") || "<p>No fake messages yet.</p>"
      }</html>`,
    );
    return;
  }
  if (
    request.url === "/SimpleNotificationService-local.pem" &&
    request.method === "GET"
  ) {
    response.writeHead(200, { "content-type": "application/x-pem-file" });
    response.end(
      await readFile(
        new URL(
          "../server/tests/fixtures/sns-signing-cert.pem",
          import.meta.url,
        ),
      ),
    );
    return;
  }
  if (request.headers.authorization !== "Bearer local-email-only")
    return reply(404);
  if (request.url === "/confirmations" && request.method === "GET")
    return reply(200, { confirmations });
  if (request.url === "/messages" && request.method === "GET")
    return reply(200, { messages });
  let bytes = "";
  for await (const chunk of request) {
    bytes += chunk;
    if (Buffer.byteLength(bytes) > 65536) return reply(413);
  }
  try {
    const body = JSON.parse(bytes);
    if (request.url === "/fault" && request.method === "POST") {
      if (!["", "before", "after", "feedback", "hold"].includes(body.fail_next))
        return reply(400);
      fault = body.fail_next;
      if (body.reset) messages = [];
      return reply(200);
    }
    if (request.url !== "/send" || request.method !== "POST") return reply(404);
    const recipient = body.Destination?.ToAddresses?.[0];
    const text = body.Content?.Simple?.Body?.Text?.Data;
    const html = body.Content?.Simple?.Body?.Html?.Data;
    if (
      typeof recipient !== "string" ||
      !recipient.endsWith("@example.invalid") ||
      typeof text !== "string"
    )
      return reply(400);
    const failure = fault;
    fault = "";
    if (failure === "before") return reply(503);
    const MessageId = crypto.randomUUID();
    messages.push({
      id: MessageId,
      recipient,
      text,
      html,
      tags: body.EmailTags ?? [],
    });
    if (failure === "hold") {
      setTimeout(() => reply(503), 15000);
      return;
    }
    if (failure === "feedback") {
      // Provider callback deliberately races the still-pending send acknowledgment.
      const envelope = {
        Type: "Notification",
        MessageId: crypto.randomUUID(),
        TopicArn: "arn:aws:sns:us-west-2:000000000000:local-email-feedback",
        Timestamp: new Date().toISOString(),
        SignatureVersion: "2",
        SigningCertURL:
          "http://127.0.0.1:8793/SimpleNotificationService-local.pem",
        Message: JSON.stringify({
          eventType: "Bounce",
          mail: {
            messageId: MessageId,
            destination: [recipient],
            tags: Object.fromEntries(
              (body.EmailTags ?? []).map((t) => [t.Name, [t.Value]]),
            ),
          },
          bounce: {
            bounceType: "Permanent",
            bouncedRecipients: [{ emailAddress: recipient }],
          },
        }),
      };
      const canonical = [
        "Message",
        "MessageId",
        "Timestamp",
        "TopicArn",
        "Type",
      ]
        .map((k) => `${k}\n${envelope[k]}\n`)
        .join("");
      const key = createPrivateKey({
        key: await readFile(
          new URL("../server/tests/fixtures/signing-key.der", import.meta.url),
        ),
        format: "der",
        type: "pkcs1",
      });
      envelope.Signature = createSign("RSA-SHA256")
        .update(canonical)
        .sign(key, "base64");
      const callback = await fetch("http://127.0.0.1:8788/email/feedback", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify(envelope),
      });
      if (callback.status !== 204) return reply(503);
    }
    if (failure === "after") return reply(503);
    reply(200, { MessageId });
  } catch {
    return reply(400);
  }
}).listen(8793, "127.0.0.1", () =>
  console.log("Development-only email provider ready on 127.0.0.1:8793."),
);
