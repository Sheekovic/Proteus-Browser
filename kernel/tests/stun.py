"""Minimal STUN server for tests. Answers binding requests with the address it saw the
request come from, and keeps a running count of received packets in a file, so a test
can tell whether a browser sent any UDP at all.
usage: stun.py <bind-ip> <port> <count-file>"""
import socket
import struct
import sys

MAGIC = 0x2112A442
bind_ip, port, count_file = sys.argv[1], int(sys.argv[2]), sys.argv[3]

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind((bind_ip, port))
count = 0
with open(count_file, "w") as f:
    f.write("0")

while True:
    data, (ip, src_port) = sock.recvfrom(2048)
    count += 1
    with open(count_file, "w") as f:
        f.write(str(count))
    if len(data) < 20:
        continue
    msg_type, _, cookie = struct.unpack("!HHI", data[:8])
    if msg_type != 0x0001 or cookie != MAGIC:
        continue
    # XOR-MAPPED-ADDRESS (0x0020): family IPv4, port and address XORed with the cookie.
    xport = src_port ^ (MAGIC >> 16)
    xaddr = struct.unpack("!I", socket.inet_aton(ip))[0] ^ MAGIC
    attr = struct.pack("!HHBBHI", 0x0020, 8, 0, 1, xport, xaddr)
    header = struct.pack("!HHI", 0x0101, len(attr), MAGIC) + data[8:20]
    sock.sendto(header + attr, (ip, src_port))
