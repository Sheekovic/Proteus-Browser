"""Records how a browser opens a TLS connection: its ClientHello as it came off the
wire and the first bytes it sends once the connection is up (the opening of HTTP/2).
Accepts connections until one has given both, prints one line of JSON and exits.
GREASE values (RFC 8701), which differ from one hello to the next, are named "GREASE".
usage: tlsrec.py <certificate> <key> <port>"""
import json
import socket
import ssl
import struct
import sys

CERT, KEY, PORT = sys.argv[1], sys.argv[2], int(sys.argv[3])


def grease(value):
    return (value & 0x0F0F) == 0x0A0A and (value >> 8) == (value & 0xFF)


def name(value):
    return "GREASE" if grease(value) else "%04x" % value


def read_hello(conn):
    """The whole first record, read without taking it from the socket."""
    data = b""
    for _ in range(200):
        data = conn.recv(16384, socket.MSG_PEEK)
        if len(data) >= 5 and len(data) >= 5 + struct.unpack(">H", data[3:5])[0]:
            return data[: 5 + struct.unpack(">H", data[3:5])[0]]
        if not data:
            return None
    return None


def parse_hello(b):
    p = 5 + 4 + 2 + 32
    p += 1 + b[p]
    n = struct.unpack(">H", b[p:p + 2])[0]
    p += 2
    ciphers = [name(struct.unpack(">H", b[p + i:p + i + 2])[0]) for i in range(0, n, 2)]
    p += n
    p += 1 + b[p]
    end = p + 2 + struct.unpack(">H", b[p:p + 2])[0]
    p += 2
    extensions = []
    while p < end:
        kind, size = struct.unpack(">HH", b[p:p + 4])
        body = b[p + 4:p + 4 + size]
        if kind == 0x0033:
            parts, q = [], 2
            while q < len(body):
                group, length = struct.unpack(">HH", body[q:q + 4])
                parts.append("%s:%d" % (name(group), length))
                q += 4 + length
            shown = " ".join(parts)
        elif kind in (0x000A, 0x000D, 0x002B):
            start = 1 if kind == 0x002B else 2
            shown = " ".join(name(struct.unpack(">H", body[q:q + 2])[0]) for q in range(start, len(body) - 1, 2))
        elif kind == 0x0015:
            shown = "padding"
        elif grease(kind):
            shown = "%d:%s" % (size, body.hex())
        else:
            shown = body.hex()
        extensions.append((name(kind) + " " + shown).strip())
        p += 4 + size
    return {"ciphers": ciphers, "extensions": extensions}


def parse_opening(b):
    """The frames after the connection preface, up to the first HEADERS frame."""
    preface = b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"
    if not b.startswith(preface):
        return None
    p, out = len(preface), {"settings": [], "windowUpdate": None, "headersFlags": None, "headersStart": None, "headers": None}
    while p + 9 <= len(b):
        size = int.from_bytes(b[p:p + 3], "big")
        kind, flags = b[p + 3], b[p + 4]
        body = b[p + 9:p + 9 + size]
        if kind == 4 and not flags & 1:
            out["settings"] = ["%d:%d" % struct.unpack(">HI", body[i:i + 6]) for i in range(0, len(body), 6)]
        elif kind == 8 and out["windowUpdate"] is None:
            out["windowUpdate"] = struct.unpack(">I", body[:4])[0] & 0x7FFFFFFF
        elif kind == 1:
            out["headersFlags"] = "%02x" % flags
            # With a priority (flag 0x20) five bytes come before the header block.
            block = body[5:] if flags & 0x20 else body
            # :method GET is 82 and :scheme https is 87 in HPACK's static table;
            # :authority and :path, which have values of their own, start with 41 and 04/44/84.
            out["headersStart"] = block[:3].hex()
            # The whole block, as HPACK wrote it: a test looks for a header in it by
            # the bytes that header is written as.
            out["headers"] = block.hex()
            return out
        p += 9 + size
    return None


context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(CERT, KEY)
context.set_alpn_protocols(["h2"])
server = socket.socket()
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("127.0.0.1", PORT))
server.listen(8)
server.settimeout(60)
while True:
    try:
        conn, _ = server.accept()
    except socket.timeout:
        print(json.dumps({"error": "nothing connected"}))
        break
    conn.settimeout(10)
    try:
        raw = read_hello(conn)
        if raw is None:
            continue
        hello = parse_hello(raw)
        tls = context.wrap_socket(conn, server_side=True)
        opening = b""
        parsed = None
        while parsed is None and len(opening) < 8192:
            chunk = tls.recv(4096)
            if not chunk:
                break
            opening += chunk
            parsed = parse_opening(opening)
        if parsed is None:
            continue
        print(json.dumps({"hello": hello, "http2": parsed, "protocol": tls.version()}))
        break
    except (OSError, ssl.SSLError):
        continue
    finally:
        try:
            conn.close()
        except OSError:
            pass
