# Patch 0040: a page finds the names the profile's browser has and the kernel does not.
# Sourced by server-test.sh, which provides run/field/check/differ/show and $WORK.
#
# The names are made up, so that the test says nothing about any real browser: an
# interface with a method, two values, a constant and a parent, one that inherits from
# it, a function, an event handler, and another name for fetch.

cat > "$WORK/added.json" <<'EOF'
{"seed": "1", "add": {
  "interfaces": [
    {"n": "ProteusPaySession", "p": "EventTarget", "t": "ProteusPaySession", "l": 2,
     "m": {"begin": "m0", "complete": "m1", "oncancel": "A", "state": "a", "STATUS_FAILURE": "c1"},
     "s": {"STATUS_FAILURE": "c1", "supportsVersion": "m1"}},
    {"n": "ProteusGestureEvent", "p": "ProteusPaySession", "t": "ProteusGestureEvent", "l": 1, "m": {"scale": "a"}, "s": {}},
    {"n": "Screen", "p": "", "t": "Screen", "l": 0, "m": {"proteusNever": "m0"}, "s": {}}
  ],
  "globals": {"proteusOpenStore": "m4", "onproteusgesture": "A", "proteusOtherFetch": "=fetch", "fetch": "m9"}
}}
EOF
echo '{"seed": "1"}' > "$WORK/bare.json"

BARE=$(run added.html --proteus-config="$WORK/bare.json")
ADDED=$(run added.html --proteus-config="$WORK/added.json")
show "with the names" "$ADDED"

check "control: without them the page finds none"  "$(field "$BARE" has)" ""
check "the names are there, and only those"        "$(field "$ADDED" has)" "ProteusPaySession/ProteusGestureEvent/proteusOpenStore/onproteusgesture/proteusOtherFetch"
check "an interface is a function of its name and arguments" "$(field "$ADDED" kind)" "function/ProteusPaySession/2"
check "that reads as the browser's own"            "$(field "$ADDED" text)" "function%20ProteusPaySession()%20%7B%20%5Bnative%20code%5D%20%7D"
check "and cannot be constructed or called"        "$(field "$ADDED" construct)" "TypeError/TypeError"
check "it inherits from what the real one does"    "$(field "$ADDED" parent)" "true/true"
check "its objects would be tagged with its name"  "$(field "$ADDED" tag)" "%5Bobject%20ProteusPaySession%5D"
check "it has its members"                         "$(field "$ADDED" members)" "STATUS_FAILURE/begin/complete/oncancel/state"
check "and its static members"                     "$(field "$ADDED" statics)" "STATUS_FAILURE/supportsVersion"
check "a method is a function like any interface's" "$(field "$ADDED" method)" "function/begin/0/truetruetrue"
check "that throws on what is not its object, and is no constructor" "$(field "$ADDED" methodCall)" "TypeError/TypeError"
check "a value has a getter and a setter that throw on the prototype" "$(field "$ADDED" value)" "function/function/get%20oncancel/TypeError"
check "a read-only value has no setter"            "$(field "$ADDED" readOnly)" "function/undefined"
check "a constant is on the interface and its prototype, fixed" "$(field "$ADDED" constant)" "1/1/falsefalse"
check "an interface is not listed among the page's own names, as none is" "$(field "$ADDED" listed)" "false/false"
check "an added interface can inherit from an added one" "$(field "$ADDED" chain)" "true"
check "a function is there and does nothing"       "$(field "$ADDED" function)" "function/4/undefined/true"
check "an event handler is null, keeps a function, and drops what is none" "$(field "$ADDED" handler)" "null/true/null"
check "another name for something is that thing"   "$(field "$ADDED" alias)" "true"
check "what the kernel has is left as it is"       "$(field "$ADDED" own)" "true"
check "a frame's page has them too, its own"       "$(field "$ADDED" frame)" "true/true"
