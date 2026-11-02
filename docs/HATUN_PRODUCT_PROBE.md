# Hatun product transport probe

NEXUS observes the A11oy-hosted Hatun product gateway at
`https://szlholdings-a11oy.hf.space/mcp/`. A11oy's `/wires` and `/hatun-mcp`
product pages declare this MCP interface. The backend origin is the canonical
runtime declared by A11oy's `hf-sync.yml`; this is not a replacement deployment
of the retired standalone `SZLHOLDINGS/hatun-mcp` Space.

The probe sends only JSON-RPC `initialize`, with no credentials, tool execution,
or receipt signing. It requires a matching request ID, JSON-RPC 2.0, protocol
`2024-11-05`, server `szl-a11oy-mcp` version `1.1.0`, and the declared tools
capability as an object. Its optional `listChanged` field may be absent or a
boolean; arrays, null and other malformed capability declarations are rejected.
Error replies, unrelated JSON, malformed responses, timeouts and oversized
bodies remain unavailable.

Both runtimes accept bare JSON and `text/event-stream`. SSE message events are
read incrementally: comments and valid unrelated JSON-RPC IDs/notifications do
not qualify the probe, while CR, LF, CRLF, UTF-8 and multiline `data` fields are
handled across network chunks. A complete matching event finishes the probe and
closes the response immediately, even if the server leaves the stream open.
Malformed JSON-RPC events and error replies fail closed; EOF does not dispatch
an unfinished event. Other named events cannot qualify the handshake.

One total deadline covers headers and body. The 64 KiB byte budget covers all
JSON bytes, or all SSE bytes through the decisive complete event, including
comments and unrelated events. Unread bytes after that SSE event do not affect
the result; network chunk boundaries cannot alter the budget.
The MCP POST rejects redirects in both runtimes, including 307/308; only the
declared canonical endpoint can satisfy this handshake.

`LIVE — A11oy MCP transport; signing unverified` means this handshake succeeded.
It does not qualify the separate Python Hatun package, its tools, authentication,
receipt signer, upstream models, or approval gates. A11oy's public tool catalog
and the Python package have different tools; consumers must not substitute their
endpoints without checking the requested contract.

Authority inspected for this change:

- [A11oy MCP implementation](https://github.com/szl-holdings/a11oy/blob/deb1aa4f24252747b72edfe77905fe7567d11716/szl_agentic_loop.py)
- [A11oy Hatun product page](https://github.com/szl-holdings/a11oy/blob/deb1aa4f24252747b72edfe77905fe7567d11716/pages/hatun-mcp.html)
- [A11oy publication workflow](https://github.com/szl-holdings/a11oy/blob/deb1aa4f24252747b72edfe77905fe7567d11716/.github/workflows/hf-sync.yml)
- [Python Hatun surface contract](https://github.com/szl-holdings/hatun-mcp/blob/cfeb95b63f4349ba67f85d3a7cf02472b17a2586/docs/HATUN_SURFACE_CONTRACT.md)

The Python and TypeScript runtime tests exercise the same real HTTP handshake
fixtures, including omitted and incorrect protocol, identity and capability
fields. Deployed runtime readback remains a separate check after publication.
