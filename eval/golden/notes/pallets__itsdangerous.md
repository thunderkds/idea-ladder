# pallets/itsdangerous

- Pinned SHA: `672971d66a2ef9f85151e53283113f33d642dabd`
- Tier: medium · Language: Python · Expected confidence: high
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `src/itsdangerous/signer.py` — Signer and the HMAC/None signing algorithms: key derivation, sign, unsign, validate.
- `src/itsdangerous/serializer.py` — Serializer: dumps/loads of a payload together with a signature and salt.
- `src/itsdangerous/timed.py` — TimestampSigner and TimedSerializer: signatures that expire (max_age).
- `src/itsdangerous/url_safe.py` — URL-safe serializer mixin: zlib-compressed, base64-encoded payload.
- `src/itsdangerous/encoding.py` — Base64 and integer encoding helpers.
- `src/itsdangerous/exc.py` — BadSignature family of exceptions.

## Concepts

- data signing
- hmac
- serializer
- timestamped signatures
- url safe encoding
- key derivation

Provenance: the README, the file listing and the declarations (class, function and type names) of the files named above were read at this SHA. The files were not read line by line.
