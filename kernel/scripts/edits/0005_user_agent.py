"""Applies the in-place edits of patch 0005 (user agent, client hints, navigator.platform)
to a Chromium checkout.
usage: 0005_user_agent.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
UA = "components/embedder_support/user_agent_utils.cc"
NAV = "third_party/blink/renderer/core/execution_context/navigator_base.cc"


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


# 1. User-Agent string. The browser process is the single source: it hands the
#    value to renderers and to the network stack.
edit(
    UA,
    "std::string GetUserAgent() {\n"
    "  std::optional<std::string> custom_ua = GetUserAgentFromCommandLine();\n",
    "// Proteus: builds client hints from the active profile, if it defines them.\n"
    "static std::optional<blink::UserAgentMetadata> ProteusUserAgentMetadata(\n"
    "    bool only_low_entropy_ch) {\n"
    "  const std::optional<base::proteus::UaData>& data =\n"
    "      base::proteus::GetConfig().ua_data;\n"
    "  if (!data) {\n"
    "    return std::nullopt;\n"
    "  }\n"
    "  blink::UserAgentMetadata metadata;\n"
    "  for (const base::proteus::UaBrand& brand : data->brands) {\n"
    "    metadata.brand_version_list.emplace_back(brand.brand, brand.version);\n"
    "  }\n"
    "  metadata.mobile = data->mobile;\n"
    "  metadata.platform = data->platform;\n"
    "  if (only_low_entropy_ch) {\n"
    "    return metadata;\n"
    "  }\n"
    "  for (const base::proteus::UaBrand& brand : data->full_version_list) {\n"
    "    metadata.brand_full_version_list.emplace_back(brand.brand,\n"
    "                                                  brand.version);\n"
    "  }\n"
    "  metadata.full_version = data->full_version;\n"
    "  metadata.platform_version = data->platform_version;\n"
    "  metadata.architecture = data->architecture;\n"
    "  metadata.bitness = data->bitness;\n"
    "  metadata.model = data->model;\n"
    "  metadata.wow64 = data->wow64;\n"
    '  metadata.form_factors = {data->mobile ? "Mobile" : "Desktop"};\n'
    "  return metadata;\n"
    "}\n"
    "\n"
    "std::string GetUserAgent() {\n"
    "  if (const std::string& forced = base::proteus::GetConfig().user_agent;\n"
    "      !forced.empty()) {\n"
    "    return forced;\n"
    "  }\n"
    "  std::optional<std::string> custom_ua = GetUserAgentFromCommandLine();\n",
)

# 2. User-Agent Client Hints.
edit(
    UA,
    "blink::UserAgentMetadata GetUserAgentMetadata(bool only_low_entropy_ch) {\n"
    "  blink::UserAgentMetadata metadata;\n",
    "blink::UserAgentMetadata GetUserAgentMetadata(bool only_low_entropy_ch) {\n"
    "  if (std::optional<blink::UserAgentMetadata> forced =\n"
    "          ProteusUserAgentMetadata(only_low_entropy_ch)) {\n"
    "    return *forced;\n"
    "  }\n"
    "  blink::UserAgentMetadata metadata;\n",
)
edit(
    UA,
    '#include "base/no_destructor.h"\n',
    '#include "base/no_destructor.h"\n#include "base/proteus/proteus_config.h"\n',
)

# 3. navigator.platform (window and workers share this implementation).
edit(
    NAV,
    "String NavigatorBase::platform() const {\n#if BUILDFLAG(IS_ANDROID)\n",
    "String NavigatorBase::platform() const {\n"
    "  if (const std::string& forced =\n"
    "          base::proteus::GetConfig().navigator_platform;\n"
    "      !forced.empty()) {\n"
    "    return String::FromUtf8(base::as_byte_span(forced));\n"
    "  }\n"
    "#if BUILDFLAG(IS_ANDROID)\n",
)
edit(
    NAV,
    '#include "base/feature_list.h"\n',
    '#include <string>\n'
    "\n"
    '#include "base/containers/span.h"\n'
    '#include "base/feature_list.h"\n'
    '#include "base/proteus/proteus_config.h"\n',
)
