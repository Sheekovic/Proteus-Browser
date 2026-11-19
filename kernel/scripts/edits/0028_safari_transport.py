"""Applies the in-place edits of patch 0028 to a Chromium checkout: a profile of Safari
shakes hands as Safari does. With "transport": "safari" in the profile the TLS
ClientHello and the opening of an HTTP/2 connection are the ones measured from Safari
on an iPhone (iPhone 17 Pro Max, Safari 27.2), not Chrome's.
usage: 0028_safari_transport.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
BSSL = "third_party/boringssl/src/"
SSL_H = BSSL + "include/openssl/ssl.h"
INTERNAL_H = BSSL + "ssl/internal.h"
SSL_LIB = BSSL + "ssl/ssl_lib.cc"
HANDSHAKE = BSSL + "ssl/handshake_client.cc"
EXTENSIONS = BSSL + "ssl/extensions.cc"
SOCKET = "net/socket/ssl_client_socket_impl.cc"
COMPRESSION = "net/ssl/cert_compression.cc"
SESSION_PARAMS = "net/http/http_network_session.cc"
SPDY_SESSION = "net/spdy/spdy_session.cc"
SPDY_UTILS = "net/spdy/spdy_http_utils.cc"
CONFIG = '#include "base/proteus/proteus_config.h"\n'


def edit(rel, old, new):
    path = SRC / rel
    text = path.read_text(encoding="utf-8")
    if new in text:
        print("already applied:", rel)
        return
    if text.count(old) != 1:
        sys.exit("anchor not found exactly once in %s: %r" % (rel, old))
    path.write_text(text.replace(old, new), encoding="utf-8", newline="\n")
    print("edited:", rel)


# --- BoringSSL -------------------------------------------------------------------
# Safari's TLS library descends from the same code, so most of its hello is a matter
# of configuration. Two things are not: it lists cipher suites this library does not
# have (and TLS 1.3 suites in another order), and it names one signature algorithm
# twice. Both lists can be given as they go on the wire.

# 1. The call.
edit(
    SSL_H,
    "// SSL_set_permute_extensions configures whether sockets on `ssl` should\n"
    "// permute extensions. For now, this is only implemented for the ClientHello.\n"
    "OPENSSL_EXPORT void SSL_set_permute_extensions(SSL *ssl, int enabled);\n",
    "// SSL_set_permute_extensions configures whether sockets on `ssl` should\n"
    "// permute extensions. For now, this is only implemented for the ClientHello.\n"
    "OPENSSL_EXPORT void SSL_set_permute_extensions(SSL *ssl, int enabled);\n"
    "\n"
    "// Proteus: SSL_set_proteus_client_hello gives the cipher suites and the\n"
    "// signature algorithms that `ssl` lists in its ClientHello, as they go on the\n"
    "// wire (a GREASE cipher suite is still put first when GREASE is enabled). It\n"
    "// changes what is announced, not what is accepted: the cipher list and the\n"
    "// verify preferences still decide that, so a server choosing something only\n"
    "// announced fails the handshake. An empty list leaves that part alone. It\n"
    "// returns one on success and zero on allocation failure.\n"
    "OPENSSL_EXPORT int SSL_set_proteus_client_hello(SSL *ssl,\n"
    "                                                const uint16_t *ciphers,\n"
    "                                                size_t num_ciphers,\n"
    "                                                const uint16_t *sigalgs,\n"
    "                                                size_t num_sigalgs);\n",
)

# 2. Where it is kept: with the rest of a connection's handshake configuration.
edit(
    INTERNAL_H,
    "  // shed_handshake_config indicates that the handshake config (this object!)\n"
    "  // should be freed after the handshake completes.\n"
    "  bool shed_handshake_config : 1;\n",
    "  // shed_handshake_config indicates that the handshake config (this object!)\n"
    "  // should be freed after the handshake completes.\n"
    "  bool shed_handshake_config : 1;\n"
    "\n"
    "  // Proteus: when not empty, what the ClientHello lists as cipher suites and\n"
    "  // as signature algorithms (SSL_set_proteus_client_hello).\n"
    "  Array<uint16_t> proteus_hello_ciphers;\n"
    "  Array<uint16_t> proteus_hello_sigalgs;\n",
)
edit(
    SSL_LIB,
    "void SSL_set_permute_extensions(SSL *ssl, int enabled) {\n"
    "  auto *ssl_impl = FromOpaque(ssl);\n"
    "  if (!ssl_impl->config) {\n"
    "    return;\n"
    "  }\n"
    "  ssl_impl->config->permute_extensions = !!enabled;\n"
    "}\n",
    "void SSL_set_permute_extensions(SSL *ssl, int enabled) {\n"
    "  auto *ssl_impl = FromOpaque(ssl);\n"
    "  if (!ssl_impl->config) {\n"
    "    return;\n"
    "  }\n"
    "  ssl_impl->config->permute_extensions = !!enabled;\n"
    "}\n"
    "\n"
    "int SSL_set_proteus_client_hello(SSL *ssl, const uint16_t *ciphers,\n"
    "                                 size_t num_ciphers, const uint16_t *sigalgs,\n"
    "                                 size_t num_sigalgs) {\n"
    "  auto *ssl_impl = FromOpaque(ssl);\n"
    "  if (!ssl_impl->config) {\n"
    "    return 0;\n"
    "  }\n"
    "  return ssl_impl->config->proteus_hello_ciphers.CopyFrom(\n"
    "             Span(ciphers, num_ciphers)) &&\n"
    "         ssl_impl->config->proteus_hello_sigalgs.CopyFrom(\n"
    "             Span(sigalgs, num_sigalgs));\n"
    "}\n",
)

# 3. The cipher suites of the hello.
edit(
    HANDSHAKE,
    "  // Add TLS 1.3 ciphers in configured preference order.\n"
    "  if (hs->max_version >= TLS1_3_VERSION) {\n",
    "  // Proteus: the list as given, in place of the one made from what is enabled.\n"
    "  if (!hs->config->proteus_hello_ciphers.empty()) {\n"
    "    for (uint16_t id : hs->config->proteus_hello_ciphers) {\n"
    "      if (!CBB_add_u16(&child, id)) {\n"
    "        return false;\n"
    "      }\n"
    "    }\n"
    "    return CBB_flush(out);\n"
    "  }\n"
    "\n"
    "  // Add TLS 1.3 ciphers in configured preference order.\n"
    "  if (hs->max_version >= TLS1_3_VERSION) {\n",
)

# 4. Its signature algorithms.
edit(
    EXTENSIONS,
    "  if (!tls12_add_verify_sigalgs(hs, &sigalgs_cbb) ||\n"
    "      !CBB_flush(out_compressible)) {\n"
    "    return false;\n"
    "  }\n",
    "  // Proteus: the list as given, in place of the verify preferences.\n"
    "  if (!hs->config->proteus_hello_sigalgs.empty()) {\n"
    "    for (uint16_t sigalg : hs->config->proteus_hello_sigalgs) {\n"
    "      if (!CBB_add_u16(&sigalgs_cbb, sigalg)) {\n"
    "        return false;\n"
    "      }\n"
    "    }\n"
    "    return CBB_flush(out_compressible);\n"
    "  }\n"
    "  if (!tls12_add_verify_sigalgs(hs, &sigalgs_cbb) ||\n"
    "      !CBB_flush(out_compressible)) {\n"
    "    return false;\n"
    "  }\n",
)

# --- The TLS connection -------------------------------------------------------------
edit(SOCKET, '#include "base/feature_list.h"\n', '#include "base/feature_list.h"\n' + CONFIG)

# 5. No made-up signature algorithm: Safari has none.
edit(
    SOCKET,
    "    if (base::FeatureList::IsEnabled(features::kTlsGreaseSigalgs)) {\n",
    "    if (base::FeatureList::IsEnabled(features::kTlsGreaseSigalgs) &&\n"
    "        !base::proteus::GetConfig().safari_transport) {\n",
)

# 6. The groups: Safari also offers P-521. The key shares sent are the same two.
edit(
    SOCKET,
    "  const std::vector<uint16_t> supported_groups =\n"
    "      context_->config().GetSupportedGroups();\n",
    "  // Proteus: a Safari profile shakes hands as Safari does (measured from Safari\n"
    "  // 27.2 on an iPhone). Read once: the profile does not change while running.\n"
    "  const bool safari_transport = base::proteus::GetConfig().safari_transport;\n"
    "  std::vector<uint16_t> supported_groups =\n"
    "      context_->config().GetSupportedGroups();\n"
    "  if (safari_transport) {\n"
    "    supported_groups = {SSL_GROUP_X25519_MLKEM768, SSL_GROUP_X25519,\n"
    "                        SSL_GROUP_SECP256R1, SSL_GROUP_SECP384R1,\n"
    "                        SSL_GROUP_SECP521R1};\n"
    "  }\n",
)

# 7. The cipher suites. Everything this library has of Safari's list is enabled, so
#    that a server choosing it is answered; the hello lists all of Safari's, in its
#    order, including the two this library does not have (ECDHE with 3DES), which
#    no current server picks.
edit(
    SOCKET,
    '  std::string command("ALL:!aPSK:!ECDSA+SHA1:!3DES");\n',
    '  std::string command(safari_transport ? "ALL:!aPSK"\n'
    '                                       : "ALL:!aPSK:!ECDSA+SHA1:!3DES");\n',
)
edit(
    SOCKET,
    "  if (!SSL_set_verify_algorithm_prefs(ssl_.get(), kVerifyPrefs,\n"
    "                                      std::size(kVerifyPrefs))) {\n"
    "    return ERR_UNEXPECTED;\n"
    "  }\n",
    "  if (!SSL_set_verify_algorithm_prefs(ssl_.get(), kVerifyPrefs,\n"
    "                                      std::size(kVerifyPrefs))) {\n"
    "    return ERR_UNEXPECTED;\n"
    "  }\n"
    "  if (safari_transport) {\n"
    "    // Accepted: Safari's algorithms, without SHA-1. Announced: its list as it\n"
    "    // is, which names rsa_pss_rsae_sha384 twice and ends with SHA-1.\n"
    "    static const uint16_t kSafariVerifyPrefs[] = {\n"
    "        SSL_SIGN_ECDSA_SECP256R1_SHA256, SSL_SIGN_RSA_PSS_RSAE_SHA256,\n"
    "        SSL_SIGN_RSA_PKCS1_SHA256,       SSL_SIGN_ECDSA_SECP384R1_SHA384,\n"
    "        SSL_SIGN_RSA_PSS_RSAE_SHA384,    SSL_SIGN_RSA_PKCS1_SHA384,\n"
    "        SSL_SIGN_RSA_PSS_RSAE_SHA512,    SSL_SIGN_RSA_PKCS1_SHA512,\n"
    "    };\n"
    "    static const uint16_t kSafariHelloSigalgs[] = {\n"
    "        0x0403, 0x0804, 0x0401, 0x0503, 0x0805,\n"
    "        0x0805, 0x0501, 0x0806, 0x0601, 0x0201,\n"
    "    };\n"
    "    static const uint16_t kSafariHelloCiphers[] = {\n"
    "        0x1302, 0x1303, 0x1301, 0xc02c, 0xc02b, 0xcca9, 0xc030,\n"
    "        0xc02f, 0xcca8, 0xc00a, 0xc009, 0xc014, 0xc013, 0x009d,\n"
    "        0x009c, 0x0035, 0x002f, 0xc008, 0xc012, 0x000a,\n"
    "    };\n"
    "    if (!SSL_set_verify_algorithm_prefs(ssl_.get(), kSafariVerifyPrefs,\n"
    "                                        std::size(kSafariVerifyPrefs)) ||\n"
    "        !SSL_set_proteus_client_hello(\n"
    "            ssl_.get(), kSafariHelloCiphers, std::size(kSafariHelloCiphers),\n"
    "            kSafariHelloSigalgs, std::size(kSafariHelloSigalgs))) {\n"
    "      return ERR_UNEXPECTED;\n"
    "    }\n"
    "    // Safari sends no session ticket extension.\n"
    "    SSL_set_options(ssl_.get(), SSL_OP_NO_TICKET);\n"
    "  }\n",
)

# 8. No application settings extension (ALPS): that one is Chrome's alone.
edit(
    SOCKET,
    "    for (NextProto proto : ssl_config_.alpn_protos) {\n"
    "      auto iter = ssl_config_.application_settings.find(proto);\n"
    "      if (iter != ssl_config_.application_settings.end()) {\n",
    "    for (NextProto proto : ssl_config_.alpn_protos) {\n"
    "      auto iter = ssl_config_.application_settings.find(proto);\n"
    "      if (iter != ssl_config_.application_settings.end() &&\n"
    "          !safari_transport) {\n",
)

# 9. Extensions in the library's own order, which is Safari's; Chrome shuffles them.
edit(
    SOCKET,
    "  SSL_set_permute_extensions(ssl_.get(), 1);\n",
    "  SSL_set_permute_extensions(ssl_.get(), safari_transport ? 0 : 1);\n",
)

#    Nor does Safari name the trust anchors it has (extension 0xca34).
edit(
    SOCKET,
    "  if (ssl_config_.trust_anchor_ids.has_value()) {\n",
    "  if (ssl_config_.trust_anchor_ids.has_value() && !safari_transport) {\n",
)

#    Nor ask the server to pad its handshake (extension 0x12e0), an experiment of
#    Chromium's that the manager also switches off by name.
edit(
    SOCKET,
    "  if (ssl_config_.server_padding_to_request.has_value()) {\n",
    "  if (ssl_config_.server_padding_to_request.has_value() &&\n"
    "      !safari_transport) {\n",
)

# 10. No encrypted client hello, real or made up.
edit(
    SOCKET,
    "int SSLClientSocketImpl::ConfigureEch() {\n"
    "  EchMode ech_mode = context_->GetEchMode(host_and_port_.host());\n",
    "int SSLClientSocketImpl::ConfigureEch() {\n"
    "  if (base::proteus::GetConfig().safari_transport) {\n"
    "    return OK;\n"
    "  }\n"
    "  EchMode ech_mode = context_->GetEchMode(host_and_port_.host());\n",
)

# 11. Compressed certificates: Safari takes zlib where Chrome takes Brotli.
edit(
    COMPRESSION,
    '#include "third_party/boringssl/src/include/openssl/ssl.h"\n',
    CONFIG + '#include "third_party/boringssl/src/include/openssl/ssl.h"\n'
    '#include "third_party/zlib/zlib.h"\n',
)
edit(
    COMPRESSION,
    "void ConfigureCertificateCompression(SSL_CTX* ctx) {\n",
    "// Proteus: the zlib form (RFC 8879), which is the one Safari offers.\n"
    "int DecompressZlibCert(SSL* ssl,\n"
    "                       CRYPTO_BUFFER** out,\n"
    "                       size_t uncompressed_len,\n"
    "                       const uint8_t* in,\n"
    "                       size_t in_len) {\n"
    "  uint8_t* data;\n"
    "  bssl::UniquePtr<CRYPTO_BUFFER> decompressed(\n"
    "      CRYPTO_BUFFER_alloc(&data, uncompressed_len));\n"
    "  if (!decompressed) {\n"
    "    return 0;\n"
    "  }\n"
    "  uLongf output_size = static_cast<uLongf>(uncompressed_len);\n"
    "  if (uncompress(data, &output_size, in, static_cast<uLong>(in_len)) !=\n"
    "          Z_OK ||\n"
    "      output_size != uncompressed_len) {\n"
    "    return 0;\n"
    "  }\n"
    "  *out = decompressed.release();\n"
    "  return 1;\n"
    "}\n"
    "\n"
    "}  // namespace\n"
    "\n"
    "void ConfigureCertificateCompression(SSL_CTX* ctx) {\n"
    "  if (base::proteus::GetConfig().safari_transport) {\n"
    "    SSL_CTX_add_cert_compression_alg(ctx, TLSEXT_cert_compression_zlib,\n"
    "                                     nullptr /* compression not supported */,\n"
    "                                     DecompressZlibCert);\n"
    "    return;\n"
    "  }\n",
)
# The function above moved the end of the unnamed namespace up; drop the old one.
edit(
    COMPRESSION,
    "#endif\n"
    "\n"
    "}  // namespace\n"
    "\n"
    "// Proteus: the zlib form",
    "#endif\n"
    "\n"
    "// Proteus: the zlib form",
)

# --- HTTP/2 -------------------------------------------------------------------------
edit(SESSION_PARAMS, '#include "base/feature_list.h"\n', '#include "base/feature_list.h"\n' + CONFIG)

# 12. The settings Safari opens a connection with: 100 concurrent streams, a 2 MB
#     stream window and "no RFC 7540 priorities"; no header table size (so the
#     protocol's default, which is never sent) and no header list limit (kept here,
#     because the session reads it, and left out of what is sent, below).
edit(
    SESSION_PARAMS,
    "spdy::SettingsMap AddDefaultHttp2Settings(spdy::SettingsMap http2_settings) {\n",
    "spdy::SettingsMap AddDefaultHttp2Settings(spdy::SettingsMap http2_settings) {\n"
    "  if (base::proteus::GetConfig().safari_transport) {\n"
    "    spdy::SettingsMap safari;\n"
    "    safari[spdy::SETTINGS_HEADER_TABLE_SIZE] = 4096;\n"
    "    safari[spdy::SETTINGS_ENABLE_PUSH] = kSpdyDisablePush;\n"
    "    safari[spdy::SETTINGS_MAX_CONCURRENT_STREAMS] = 100;\n"
    "    safari[spdy::SETTINGS_INITIAL_WINDOW_SIZE] = 2 * 1024 * 1024;\n"
    "    safari[spdy::SETTINGS_MAX_HEADER_LIST_SIZE] = kSpdyMaxHeaderListSize;\n"
    "    safari[spdy::SETTINGS_DEPRECATE_HTTP2_PRIORITIES] = 1;\n"
    "    return safari;\n"
    "  }\n"
    "\n",
)
# 13. Its connection window: 10 MB, which makes the first WINDOW_UPDATE 10420225.
edit(
    SESSION_PARAMS,
    "    : spdy_session_max_recv_window_size(kSpdySessionMaxRecvWindowSize),\n",
    "    : spdy_session_max_recv_window_size(\n"
    "          base::proteus::GetConfig().safari_transport\n"
    "              ? 10 * 1024 * 1024\n"
    "              : kSpdySessionMaxRecvWindowSize),\n",
)

# 14. A request without a priority in its HEADERS frame.
edit(SPDY_SESSION, '#include "net/spdy/spdy_session.h"\n', '#include "net/spdy/spdy_session.h"\n\n' + CONFIG)
edit(
    SPDY_SESSION,
    "  headers.set_has_priority(has_priority);\n"
    "  headers.set_weight(weight);\n",
    "  // Proteus: Safari's HEADERS frames carry no priority.\n"
    "  if (base::proteus::GetConfig().safari_transport) {\n"
    "    has_priority = false;\n"
    "  }\n"
    "  headers.set_has_priority(has_priority);\n"
    "  headers.set_weight(weight);\n",
)

edit(
    SPDY_SESSION,
    "  if (enable_http2_settings_grease_) {\n"
    "    spdy::SpdySettingsId greased_id = 0x0a0a +\n",
    "  // Proteus: Safari announces no header list limit, and no made-up setting.\n"
    "  const bool safari_transport = base::proteus::GetConfig().safari_transport;\n"
    "  if (safari_transport) {\n"
    "    settings_map.erase(spdy::SETTINGS_MAX_HEADER_LIST_SIZE);\n"
    "  }\n"
    "  if (enable_http2_settings_grease_ && !safari_transport) {\n"
    "    spdy::SpdySettingsId greased_id = 0x0a0a +\n",
)

# 15. The order of a request's headers: :method, :scheme, :authority, :path, then the
#     ones a Safari navigation was seen to send in the order it sent them. Others
#     follow in the order they had.
edit(SPDY_UTILS, "#include <string>\n#include <string_view>\n",
     "#include <algorithm>\n#include <string>\n#include <string_view>\n#include <utility>\n")
edit(SPDY_UTILS, '#include "base/check_op.h"\n', '#include "base/check_op.h"\n' + CONFIG)
edit(
    SPDY_UTILS,
    "void CreateSpdyHeadersFromHttpRequest(const HttpRequestInfo& info,\n"
    "                                      std::optional<RequestPriority> priority,\n"
    "                                      const HttpRequestHeaders& request_headers,\n"
    "                                      quiche::HttpHeaderBlock* headers) {\n",
    "namespace {\n"
    "\n"
    "// Proteus: makes |headers| those of Safari. Its order; for a page load its\n"
    "// Accept, not Chrome's; and without the two headers Chrome adds to a page load\n"
    "// and Safari does not send.\n"
    "void OrderHeadersAsSafari(quiche::HttpHeaderBlock* headers) {\n"
    "  static constexpr std::string_view kOrder[] = {\n"
    '      ":method",        ":scheme",        ":authority",      ":path",\n'
    '      ":protocol",      "sec-fetch-dest", "user-agent",      "accept",\n'
    '      "sec-fetch-site", "sec-fetch-mode", "accept-language", "priority",\n'
    '      "accept-encoding",\n'
    "  };\n"
    "  std::vector<std::pair<std::string, std::string>> all;\n"
    "  for (const auto& [name, value] : *headers) {\n"
    '    if (name == "upgrade-insecure-requests" || name == "sec-fetch-user") {\n'
    "      continue;\n"
    "    }\n"
    '    if (name == "accept" && value.starts_with("text/html,")) {\n'
    "      all.emplace_back(\n"
    "          std::string(name),\n"
    '          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");\n'
    "      continue;\n"
    "    }\n"
    "    all.emplace_back(std::string(name), std::string(value));\n"
    "  }\n"
    "  headers->clear();\n"
    "  for (std::string_view wanted : kOrder) {\n"
    "    for (const auto& [name, value] : all) {\n"
    "      if (name == wanted) {\n"
    "        headers->insert({name, value});\n"
    "      }\n"
    "    }\n"
    "  }\n"
    "  for (const auto& [name, value] : all) {\n"
    "    if (std::ranges::find(kOrder, std::string_view(name)) ==\n"
    "        std::ranges::end(kOrder)) {\n"
    "      headers->insert({name, value});\n"
    "    }\n"
    "  }\n"
    "}\n"
    "\n"
    "}  // namespace\n"
    "\n"
    "void CreateSpdyHeadersFromHttpRequest(const HttpRequestInfo& info,\n"
    "                                      std::optional<RequestPriority> priority,\n"
    "                                      const HttpRequestHeaders& request_headers,\n"
    "                                      quiche::HttpHeaderBlock* headers) {\n",
)
edit(
    SPDY_UTILS,
    "    if (!serialized_priority.empty()) {\n"
    "      AddUniqueSpdyHeader(kHttp2PriorityHeader, serialized_priority, headers);\n"
    "    }\n"
    "  }\n"
    "}\n",
    "    if (!serialized_priority.empty()) {\n"
    "      AddUniqueSpdyHeader(kHttp2PriorityHeader, serialized_priority, headers);\n"
    "    }\n"
    "  }\n"
    "  if (base::proteus::GetConfig().safari_transport) {\n"
    "    OrderHeadersAsSafari(headers);\n"
    "  }\n"
    "}\n",
)
