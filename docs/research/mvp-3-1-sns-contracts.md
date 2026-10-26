# SES → SNS HTTPS feedback contracts

Research checked 2026-10-25. Scope: local signed-feedback emulators; no AWS calls or provider changes. **Recommendation** below means application policy, not an AWS protocol requirement.

## Authentication and canonical bytes

SNS requires signature verification before processing notifications or confirmation messages. Version `2` uses SHA-256; AWS recommends it over version `1`. AWS also requires rejecting unexpected topic ARNs and recommends checking the signing certificate issuer and chain trust. Parsing a certificate, checking dates, and verifying a message signature do **not** independently validate its certificate chain. [AWS verification guidance](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html)

After JSON unescaping, concatenate each selected name, newline, value, newline, in these exact orders:

- `Notification`: `Message`, `MessageId`, optional `Subject`, `Timestamp`, `TopicArn`, `Type`.
- `SubscriptionConfirmation` / `UnsubscribeConfirmation`: `Message`, `MessageId`, `SubscribeURL`, `Timestamp`, `Token`, `TopicArn`, `Type`.

Include `Subject` only when present. The final `Type` value gets exactly one terminating newline. Do not sign reserialized JSON, escaped text, or unsigned headers. Base64-decode `Signature`; verify the canonical bytes using RSA PKCS#1 v1.5/SHA-256 for version `2`. [AWS canonicalization contract](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message-verify-message-signature.html)

**Recommendation:** configure one exact topic ARN and regional SNS host. Before any fetch, require HTTPS, exact `sns.<configured-region>.amazonaws.com`, no credentials, nondefault port, query or fragment, and a single `/SimpleNotificationService-….pem` certificate path; disable redirects and bound timeout/body size. These narrow restrictions are this app's commercial-region policy, not a universal AWS URL grammar. AWS documents HTTPS and trusted SNS certificate URLs. Fetching from that pinned HTTPS origin with normal TLS is an explicit trust decision; it must not be described as X.509 path validation. [AWS certificate URL guidance](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message-verify-message-signature.html)

SNS confirms subscriptions through a GET to `SubscribeURL`. **Recommendation:** authenticate first; permit confirmation only on the configured regional SNS origin, root path, with `Action=ConfirmSubscription`, matching decoded `TopicArn`, and the signed `Token`; reject duplicate/unexpected query parameters and redirects. Treat unsubscribe confirmation as informational. Never follow arbitrary callback URLs. [AWS confirmation procedure](https://docs.aws.amazon.com/sns/latest/dg/SendMessageToHttp.confirm.html), [documented URL example](https://docs.aws.amazon.com/sns/latest/dg/SendMessageToHttp.prepare.html)

## Rust implementation APIs

Choose stable `x509-cert = "0.3.0"` (Rust ≥1.85; default `pem`/`std`), paired with existing `aws-lc-rs 1.18.2`. Version 0.3 uses accessors, unlike 0.2's public certificate fields. [Release manifest](https://raw.githubusercontent.com/RustCrypto/formats/x509-cert/v0.3.0/x509-cert/Cargo.toml), [certificate source](https://raw.githubusercontent.com/RustCrypto/formats/x509-cert/v0.3.0/x509-cert/src/certificate.rs)

```rust
use x509_cert::{Certificate, der::DecodePem};
use aws_lc_rs::signature;

let cert = Certificate::from_pem(pem_bytes)?;
let tbs = cert.tbs_certificate();
let validity = tbs.validity();
let not_before = validity.not_before.to_unix_duration().as_secs();
let not_after = validity.not_after.to_unix_duration().as_secs();
let spki = tbs.subject_public_key_info();
// Check spki.algorithm.oid is rsaEncryption (1.2.840.113549.1.1.1).
let rsa_der = spki.subject_public_key.as_bytes().ok_or(invalid_key)?;
signature::UnparsedPublicKey::new(
    &signature::RSA_PKCS1_2048_8192_SHA256, rsa_der,
).verify(canonical_bytes, decoded_signature)?;
```

Check `not_before <= now <= not_after`; cache no later than expiry. `as_bytes()` rejects non-byte-aligned BIT STRINGs. The verifier expects DER `RSAPublicKey` contained **inside** SPKI's BIT STRING, not the entire SPKI; pass the full canonical message, because verification hashes it. Error conversion is omitted above. [Time API](https://raw.githubusercontent.com/RustCrypto/formats/x509-cert/v0.3.0/x509-cert/src/time.rs), [SPKI fields](https://raw.githubusercontent.com/RustCrypto/formats/spki/v0.8.0/spki/src/spki.rs), [BIT STRING API](https://docs.rs/der/0.8.1/der/asn1/struct.BitString.html), [aws-lc-rs exact-version source](https://raw.githubusercontent.com/aws/aws-lc-rs/v1.18.2/aws-lc-rs/src/signature.rs)

## Correlation and idempotency

Parse the authenticated SNS `Message` string as SES event JSON. Configuration-set events use `eventType`; `mail.messageId` identifies SES's send, while `mail.tags` maps tag names to arrays. Identity-level feedback notifications omit tags: use configuration-set publishing. `Delivery` contains `delivery.recipients`; `Bounce` contains `bounce.bounceType` and `bounce.bouncedRecipients[].emailAddress`; `Complaint` contains `complaint.complainedRecipients[].emailAddress`. Suppress permanent bounces and complaints, not every bounce. [SES event shapes](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-examples.html)

SES can accept a send despite returning an error; retries may create another message ID. AWS recommends tags for reliable correlation. Complaint recipient arrays can identify possible complainants rather than the actual person. **Recommendation:** tag each persisted send attempt/generation, validate its expected destination and provider ID when known, and send invitations individually. Never interpret Delivery as account enrollment. Authenticate retries before deduplication; transactionally persist `(TopicArn, MessageId)` with effects before returning success. Stale attempts must not overwrite current delivery state or undo a later operator suppression reset. These transactional rules are application policy. [SES sending uncertainty and complaints](https://docs.aws.amazon.com/ses/latest/dg/send-email-concepts-process.html)

## HTTP behavior and cold starts

SNS's JSON body defaults to `text/plain; charset=UTF-8`; accept bounded bytes rather than requiring Axum's JSON content type. Requests time out after approximately fifteen seconds. Default HTTP delivery retries up to three times, twenty seconds apart, after the initial failure; after a timeout, attempts are approximately thirty-five seconds apart. [Endpoint preparation](https://docs.aws.amazon.com/sns/latest/dg/SendMessageToHttp.prepare.html), [default retries](https://docs.aws.amazon.com/sns/latest/dg/SendMessageToHttp.retry.html)

Only HTTP 5xx and 429 are retryable; other errors are permanent. Custom HTTP retry duration cannot exceed 3,600 seconds. Exhausted messages are discarded unless a subscription DLQ is configured. **Recommendation:** explicit retry policy plus an SQS subscription DLQ and monitoring for cold Render outages; return 503 for transient certificate/database failures, 4xx for invalid messages, and 2xx only after durable effects or an authenticated duplicate. The documentation's fifty-attempt policy is an example, not the default. [SNS retry/DLQ contract](https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html)

## First-party validator trust choices

AWS's PHP validator `validateUrl()` requires HTTPS, an SNS host pattern, and a `.pem` suffix (lines 185–198). `validate()` downloads that URL, calls `openssl_get_publickey()`, then `openssl_verify()` (lines 88–118); it performs no separate certificate-chain validation. Its default downloader is `file_get_contents()` (lines 60–67). This implementation treats SNS HTTPS distribution as its key trust boundary. [AWS PHP validator source](https://github.com/aws/aws-php-sns-message-validator/blob/master/src/MessageValidator.php#L60)

Java's `SigningCertUrlVerifier.verifyCertUrl()` requires HTTPS and the exact configured regional endpoint (lines 35–56). `SignatureVerifier.downloadCert()` uses that check before its HTTP fetch (151–166); `createPublicKey()` parses the certificate, and `validateCertificate()` checks the expected certificate hostname and validity dates (189–223). These functions do not build or validate a separate signing-certificate trust path. [Java URL verifier](https://github.com/aws/aws-sdk-java/blob/master/aws-java-sdk-sns/src/main/java/com/amazonaws/services/sns/message/SigningCertUrlVerifier.java#L35), [Java signature verifier](https://github.com/aws/aws-sdk-java/blob/master/aws-java-sdk-sns/src/main/java/com/amazonaws/services/sns/message/SignatureVerifier.java#L151)

**Recommendation:** explicitly document this app's authenticated SNS HTTPS key-distribution model, normal TLS validation, exact topic/host restrictions, certificate dates, and RSA signature checks. This has first-party implementation precedent; it is not an assertion that the downloaded signing certificate's independent X.509 chain was validated. Java additionally checks signing-certificate hostname; the earlier general AWS guidance recommends chain trust, so record the deliberate distinction.
