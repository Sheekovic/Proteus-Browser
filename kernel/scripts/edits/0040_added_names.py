"""Applies the in-place edits of patch 0040 to a Chromium checkout: a page finds the names
the profile's browser has and the kernel does not.

Patches 0022, 0029 and 0031 take away what the profile's browser lacks. The other side
was left: Safari has interfaces and functions that Chrome has not (ApplePaySession,
GestureEvent, openDatabase, ...), and a page that asks whether one is there got "no"
from a profile that says it is Safari.

The profile now lists them, each with what kind of thing it is, as the browser was
read to have them (the manager's tools/surface-page.html), and every page gets them
as soon as its script context exists:
 - an interface is a constructor of that name, inheriting from the interface it
   inherits from in the real browser, with its methods, values and constants. There
   are no objects of it: constructing one throws, as constructing a real one a page
   may not make throws, and its members throw when used on anything else, as real
   ones do;
 - a function of the global object is a function that does nothing;
 - an event handler of the global object keeps what it is given;
 - another name for something the kernel has is that thing.
What a page can do with a real one, it cannot do with these: they answer the question
whether they are there.
usage: 0040_added_names.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
PROXY = "third_party/blink/renderer/bindings/core/v8/local_window_proxy.cc"


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


ADD = r'''// Proteus: the names the profile's browser has and the kernel does not (patch 0040).
namespace {

void ProteusThrow(const v8::FunctionCallbackInfo<v8::Value>& info,
                  const char* message) {
  v8::Isolate* isolate = info.GetIsolate();
  isolate->ThrowException(v8::Exception::TypeError(
      v8::String::NewFromUtf8(isolate, message).ToLocalChecked()));
}

void ProteusIllegalConstructor(const v8::FunctionCallbackInfo<v8::Value>& info) {
  ProteusThrow(info, "Illegal constructor");
}

void ProteusIllegalInvocation(const v8::FunctionCallbackInfo<v8::Value>& info) {
  ProteusThrow(info, "Illegal invocation");
}

void ProteusNothing(const v8::FunctionCallbackInfo<v8::Value>& info) {}

// An event handler of the global object: what it was given, or null. The name of
// the handler is the callback's data; the value is kept on the global object under
// a key no script can reach.
void ProteusHandlerGet(const v8::FunctionCallbackInfo<v8::Value>& info) {
  v8::Isolate* isolate = info.GetIsolate();
  v8::Local<v8::Context> context = isolate->GetCurrentContext();
  v8::Local<v8::Value> kept;
  if (info.Data()->IsString() &&
      context->Global()
          ->GetPrivate(context,
                       v8::Private::ForApi(isolate, info.Data().As<v8::String>()))
          .ToLocal(&kept) &&
      (kept->IsFunction() || kept->IsObject())) {
    info.GetReturnValue().Set(kept);
    return;
  }
  info.GetReturnValue().SetNull();
}

void ProteusHandlerSet(const v8::FunctionCallbackInfo<v8::Value>& info) {
  v8::Isolate* isolate = info.GetIsolate();
  v8::Local<v8::Context> context = isolate->GetCurrentContext();
  if (!info.Data()->IsString()) {
    return;
  }
  v8::Local<v8::Value> given = info.Length() > 0 ? info[0] : v8::Local<v8::Value>();
  if (given.IsEmpty() || !(given->IsFunction() || given->IsObject())) {
    given = v8::Null(isolate);
  }
  std::ignore = context->Global()->SetPrivate(
      context, v8::Private::ForApi(isolate, info.Data().As<v8::String>()), given);
}

int ProteusNumberOf(const std::string& shape) {
  return shape.size() > 1 ? atoi(shape.c_str() + 1) : 0;
}

v8::Local<v8::String> ProteusName(v8::Isolate* isolate, const std::string& name) {
  return v8::String::NewFromUtf8(isolate, name.c_str(),
                                 v8::NewStringType::kInternalized)
      .ToLocalChecked();
}

// A function a page finds and cannot construct with, named and with as many named
// arguments as the real one.
v8::MaybeLocal<v8::Function> ProteusFunction(v8::Isolate* isolate,
                                            v8::Local<v8::Context> context,
                                            v8::FunctionCallback callback,
                                            const std::string& name,
                                            int length,
                                            v8::Local<v8::Value> data = {}) {
  v8::Local<v8::FunctionTemplate> made = v8::FunctionTemplate::New(
      isolate, callback, data, v8::Local<v8::Signature>(), length,
      v8::ConstructorBehavior::kThrow);
  made->SetClassName(ProteusName(isolate, name));
  return made->GetFunction(context);
}

// The members of an interface's prototype, or of the interface itself.
void ProteusAddMembers(v8::Isolate* isolate,
                       v8::Local<v8::Context> context,
                       v8::Local<v8::Object> holder,
                       const std::vector<base::proteus::AddedMember>& members,
                       v8::FunctionCallback method) {
  for (const auto& member : members) {
    v8::Local<v8::String> key = ProteusName(isolate, member.name);
    v8::Local<v8::Function> function;
    switch (member.shape[0]) {
      case 'm':
        if (ProteusFunction(isolate, context, method, member.name,
                            ProteusNumberOf(member.shape))
                .ToLocal(&function)) {
          std::ignore = holder->CreateDataProperty(context, key, function);
        }
        break;
      case 'a':
      case 'A': {
        v8::Local<v8::Function> setter;
        if (!ProteusFunction(isolate, context, ProteusIllegalInvocation,
                             "get " + member.name, 0)
                 .ToLocal(&function)) {
          break;
        }
        if (member.shape[0] == 'A') {
          std::ignore = ProteusFunction(isolate, context,
                                        ProteusIllegalInvocation,
                                        "set " + member.name, 1)
                            .ToLocal(&setter);
        }
        holder->SetAccessorProperty(key, function, setter, v8::None);
        break;
      }
      case 'c':
        std::ignore = holder->DefineOwnProperty(
            context, key,
            v8::Number::New(isolate, strtod(member.shape.c_str() + 1, nullptr)),
            static_cast<v8::PropertyAttribute>(v8::ReadOnly | v8::DontDelete));
        break;
      default:
        break;
    }
  }
}

void ProteusAddWindowNames(v8::Isolate* isolate, v8::Local<v8::Context> context) {
  const base::proteus::Config& config = base::proteus::GetConfig();
  if (config.added_interfaces.empty() && config.added_globals.empty()) {
    return;
  }
  v8::HandleScope handle_scope(isolate);
  v8::Context::Scope context_scope(context);
  v8::TryCatch try_catch(isolate);
  v8::Local<v8::Object> global = context->Global();
  v8::Local<v8::String> prototype_key = ProteusName(isolate, "prototype");

  for (const auto& entry : config.added_interfaces) {
    v8::Local<v8::String> name = ProteusName(isolate, entry.name);
    if (global->HasRealNamedProperty(context, name).FromMaybe(true)) {
      continue;  // The kernel has it after all.
    }
    v8::Local<v8::FunctionTemplate> made =
        v8::FunctionTemplate::New(isolate, ProteusIllegalConstructor);
    made->SetClassName(name);
    made->SetLength(entry.length);
    v8::Local<v8::Function> constructor;
    v8::Local<v8::Value> prototype_value;
    if (!made->GetFunction(context).ToLocal(&constructor) ||
        !constructor->Get(context, prototype_key).ToLocal(&prototype_value) ||
        !prototype_value->IsObject()) {
      continue;
    }
    v8::Local<v8::Object> prototype = prototype_value.As<v8::Object>();
    // It inherits from what the real one inherits from, when that is here
    // (an added one before it in the list, or one of the kernel's own).
    v8::Local<v8::Value> parent;
    v8::Local<v8::Value> parent_prototype;
    if (!entry.parent.empty() && entry.parent != "Object" &&
        global->Get(context, ProteusName(isolate, entry.parent)).ToLocal(&parent) &&
        parent->IsFunction() &&
        parent.As<v8::Object>()->Get(context, prototype_key).ToLocal(&parent_prototype) &&
        parent_prototype->IsObject()) {
      std::ignore = prototype->SetPrototype(context, parent_prototype);
      std::ignore = constructor->SetPrototype(context, parent);
    }
    ProteusAddMembers(isolate, context, prototype, entry.members,
                      ProteusIllegalInvocation);
    ProteusAddMembers(isolate, context, constructor, entry.statics,
                      ProteusNothing);
    if (!entry.tag.empty()) {
      std::ignore = prototype->DefineOwnProperty(
          context, v8::Symbol::GetToStringTag(isolate),
          ProteusName(isolate, entry.tag),
          static_cast<v8::PropertyAttribute>(v8::ReadOnly | v8::DontEnum));
    }
    std::ignore =
        global->DefineOwnProperty(context, name, constructor, v8::DontEnum);
  }

  for (const auto& member : config.added_globals) {
    v8::Local<v8::String> key = ProteusName(isolate, member.name);
    if (global->HasRealNamedProperty(context, key).FromMaybe(true)) {
      continue;
    }
    v8::Local<v8::Function> function;
    v8::Local<v8::Value> other;
    switch (member.shape[0]) {
      case 'm':
        if (ProteusFunction(isolate, context, ProteusNothing, member.name,
                            ProteusNumberOf(member.shape))
                .ToLocal(&function)) {
          std::ignore = global->CreateDataProperty(context, key, function);
        }
        break;
      case 'A': {
        v8::Local<v8::Function> setter;
        if (ProteusFunction(isolate, context, ProteusHandlerGet,
                            "get " + member.name, 0, key)
                .ToLocal(&function) &&
            ProteusFunction(isolate, context, ProteusHandlerSet,
                            "set " + member.name, 1, key)
                .ToLocal(&setter)) {
          global->SetAccessorProperty(key, function, setter, v8::None);
        }
        break;
      }
      case '=':
        if (global->Get(context, ProteusName(isolate, member.shape.substr(1)))
                .ToLocal(&other) &&
            !other->IsUndefined()) {
          std::ignore = global->CreateDataProperty(context, key, other);
        }
        break;
      default:
        break;
    }
  }
}

}  // namespace

'''

HIDE_HEAD = "// Proteus: removes the members the profile's browser does not have.\n"
edit(PROXY, HIDE_HEAD, ADD + HIDE_HEAD)
edit(
    PROXY,
    "    ProteusHideWindowMembers(script_state_->GetIsolate(), context);\n",
    "    ProteusHideWindowMembers(script_state_->GetIsolate(), context);\n"
    "    ProteusAddWindowNames(script_state_->GetIsolate(), context);\n",
)
