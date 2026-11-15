"""Applies the in-place edits of patch 0011 (presentational WebRTC candidates) to a
Chromium checkout. New files are copied from kernel/src by the caller.
usage: 0011_webrtc_candidates.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
PC_DIR = "third_party/blink/renderer/modules/peerconnection/"
PC = PC_DIR + "rtc_peer_connection.cc"


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


# 1. Compile the helper into the peerconnection module.
edit(
    PC_DIR + "BUILD.gn",
    '    "rtc_peer_connection.cc",\n',
    '    "proteus_webrtc_spoof.cc",\n    "proteus_webrtc_spoof.h",\n'
    '    "rtc_peer_connection.cc",\n',
)

# 2. A helper that rewrites a stored local description, placed ahead of its users.
edit(
    PC,
    "void RTCPeerConnection::DidChangeSessionDescriptions(\n",
    "// Proteus: |description| with the profile's presentational ICE candidates in\n"
    "// its SDP, or |description| itself when there is nothing to add.\n"
    "static RTCSessionDescription* ProteusWithIceCandidates(\n"
    "    RTCSessionDescription* description,\n"
    "    bool has_stun_or_turn_server) {\n"
    "  if (!description) {\n"
    "    return description;\n"
    "  }\n"
    "  const String sdp =\n"
    "      ProteusSdpWithIceCandidates(description->sdp(), has_stun_or_turn_server);\n"
    "  if (sdp == description->sdp()) {\n"
    "    return description;\n"
    "  }\n"
    "  return RTCSessionDescription::Create(\n"
    "      MakeGarbageCollected<RTCSessionDescriptionPlatform>(\n"
    "          description->WebSessionDescription()->GetType(), sdp));\n"
    "}\n"
    "\n"
    "void RTCPeerConnection::DidChangeSessionDescriptions(\n",
)

# 3. Descriptions refreshed after gathering finished keep the candidates.
edit(
    PC,
    "          ? RTCSessionDescription::Create(current_remote_description)\n"
    "          : nullptr;\n",
    "          ? RTCSessionDescription::Create(current_remote_description)\n"
    "          : nullptr;\n"
    "  if (ice_gathering_state_ ==\n"
    "      webrtc::PeerConnectionInterface::kIceGatheringComplete) {\n"
    "    const bool has_server = !peer_handler_->GetConfiguration().servers.empty();\n"
    "    pending_local_description_ = ProteusWithIceCandidates(\n"
    "        pending_local_description_.Get(), has_server);\n"
    "    current_local_description_ = ProteusWithIceCandidates(\n"
    "        current_local_description_.Get(), has_server);\n"
    "  }\n",
)

# 4. When gathering finishes, announce the candidates (before the state change and
#    the end-of-candidates event that ChangeIceGatheringState schedules) and write
#    them into the stored local descriptions.
edit(
    PC,
    "  ChangeIceGatheringState(new_state);\n",
    "  if (new_state == webrtc::PeerConnectionInterface::kIceGatheringComplete) {\n"
    "    if (RTCSessionDescription* local = localDescription()) {\n"
    "      const bool has_server =\n"
    "          !peer_handler_->GetConfiguration().servers.empty();\n"
    "      const ProteusIceCandidates fake =\n"
    "          ProteusBuildIceCandidates(local->sdp(), has_server);\n"
    "      for (const String& candidate : fake.candidates) {\n"
    "        DidGenerateICECandidate(MakeGarbageCollected<RTCIceCandidatePlatform>(\n"
    "            candidate, fake.mid, 0, fake.username_fragment, String()));\n"
    "      }\n"
    "      pending_local_description_ = ProteusWithIceCandidates(\n"
    "          pending_local_description_.Get(), has_server);\n"
    "      current_local_description_ = ProteusWithIceCandidates(\n"
    "          current_local_description_.Get(), has_server);\n"
    "    }\n"
    "  }\n"
    "  ChangeIceGatheringState(new_state);\n",
)

edit(
    PC,
    '#include "third_party/blink/renderer/modules/peerconnection/rtc_peer_connection.h"\n',
    '#include "third_party/blink/renderer/modules/peerconnection/rtc_peer_connection.h"\n'
    '#include "third_party/blink/renderer/modules/peerconnection/proteus_webrtc_spoof.h"\n',
)
