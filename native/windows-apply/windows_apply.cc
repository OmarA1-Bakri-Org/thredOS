#include <node_api.h>
#include <windows.h>
#include <winternl.h>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <cwctype>
#include <memory>
#include <string>
#include <vector>

namespace {

struct Handle {
  HANDLE value = INVALID_HANDLE_VALUE;
  Handle() = default;
  explicit Handle(HANDLE h) : value(h) {}
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
  Handle(Handle&& other) noexcept : value(other.value) { other.value = INVALID_HANDLE_VALUE; }
  Handle& operator=(Handle&& other) noexcept {
    if (this != &other) {
      reset();
      value = other.value;
      other.value = INVALID_HANDLE_VALUE;
    }
    return *this;
  }
  ~Handle() { reset(); }
  void reset() {
    if (value != INVALID_HANDLE_VALUE) CloseHandle(value);
    value = INVALID_HANDLE_VALUE;
  }
  bool valid() const { return value != INVALID_HANDLE_VALUE; }
};

struct Prepared {
  std::vector<Handle> ancestors;
  Handle root;
  Handle sourceParent;
  Handle destinationParent;
  Handle source;
  std::wstring destinationName;
  bool deletion = false;
  bool finished = false;
};

void fail(napi_env env, const char* code, const char* message, DWORD win32 = 0) {
  std::string detail(message);
  if (win32 != 0) detail += " (Win32 " + std::to_string(win32) + ")";
  bool pending = false;
  if (napi_is_exception_pending(env, &pending) == napi_ok && pending) return;
  napi_value value = nullptr, error = nullptr, key = nullptr;
  if (napi_create_string_utf8(env, detail.c_str(), NAPI_AUTO_LENGTH, &value) != napi_ok ||
      napi_create_error(env, nullptr, value, &error) != napi_ok ||
      napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &key) != napi_ok ||
      napi_set_named_property(env, error, "code", key) != napi_ok ||
      napi_throw(env, error) != napi_ok) {
    napi_throw_error(env, code, detail.c_str());
  }
}

bool read_string(napi_env env, napi_value value, std::wstring& out) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string) {
    fail(env, "INVALID_ARGUMENT", "Expected a string");
    return false;
  }
  size_t length = 0;
  if (napi_get_value_string_utf16(env, value, nullptr, 0, &length) != napi_ok || length > 32767) {
    fail(env, "INVALID_ARGUMENT", "Invalid or oversized string");
    return false;
  }
  std::vector<char16_t> buffer(length + 1);
  if (napi_get_value_string_utf16(env, value, buffer.data(), buffer.size(), &length) != napi_ok) {
    fail(env, "INVALID_ARGUMENT", "Could not read string");
    return false;
  }
  out.clear();
  out.reserve(length);
  for (size_t i = 0; i < length; ++i) out.push_back(static_cast<wchar_t>(buffer[i]));
  if (out.find(L'\0') != std::wstring::npos) {
    fail(env, "INVALID_PATH", "NUL in path");
    return false;
  }
  return true;
}

bool valid_part(const std::wstring& part) {
  if (part.empty() || part == L"." || part == L".." || part.size() > 255 ||
      part.back() == L'.' || part.back() == L' ') return false;
  for (wchar_t ch : part) {
    if (ch < 32 || ch == L':' || ch == L'\\' || ch == L'/' || ch == L'<' ||
        ch == L'>' || ch == L'"' || ch == L'|' || ch == L'?' || ch == L'*') return false;
  }
  std::wstring stem = part.substr(0, part.find(L'.'));
  std::transform(stem.begin(), stem.end(), stem.begin(), [](wchar_t ch) {
    return static_cast<wchar_t>(towupper(ch));
  });
  if (stem == L"CON" || stem == L"PRN" || stem == L"AUX" || stem == L"NUL" ||
      stem == L"CONIN$" || stem == L"CONOUT$" || stem == L"CLOCK$") return false;
  if (stem.size() == 4 && (stem.substr(0, 3) == L"COM" || stem.substr(0, 3) == L"LPT") &&
      ((stem[3] >= L'0' && stem[3] <= L'9') || stem[3] == 0x00B9 ||
       stem[3] == 0x00B2 || stem[3] == 0x00B3)) return false;
  return true;
}

bool split_relative(napi_env env, const std::wstring& path, std::vector<std::wstring>& parts) {
  if (path.empty() || path.size() > 30000 || path.front() == L'/' || path.front() == L'\\') {
    fail(env, "INVALID_PATH", "Expected a nonempty relative path");
    return false;
  }
  size_t from = 0;
  while (from <= path.size()) {
    size_t end = path.find(L'/', from);
    std::wstring part = path.substr(from, end == std::wstring::npos ? end : end - from);
    if (!valid_part(part)) {
      fail(env, "INVALID_PATH", "Unsafe relative path component");
      return false;
    }
    parts.push_back(part);
    if (end == std::wstring::npos) break;
    from = end + 1;
  }
  return true;
}

bool valid_root(napi_env env, const std::wstring& root) {
  if (root.size() < 4 || root.size() > 30000 || !iswalpha(root[0]) || root[1] != L':' ||
      root[2] != L'\\' || root[3] == L'\\' || root.back() == L'.' || root.back() == L' ') {
    fail(env, "INVALID_PATH", "Root must be an absolute local drive path");
    return false;
  }
  size_t from = 3;
  while (from < root.size()) {
    size_t end = root.find(L'\\', from);
    if (end == std::wstring::npos) end = root.size();
    if (!valid_part(root.substr(from, end - from))) {
      fail(env, "INVALID_PATH", "Unsafe root component");
      return false;
    }
    from = end + 1;
  }
  return true;
}

bool inspect_handle(napi_env env, HANDLE handle, bool directory, std::string& id) {
  FILE_ATTRIBUTE_TAG_INFO attributes{};
  FILE_STANDARD_INFO standard{};
  FILE_ID_INFO identity{};
  if (!GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &attributes, sizeof(attributes)) ||
      !GetFileInformationByHandleEx(handle, FileStandardInfo, &standard, sizeof(standard)) ||
      !GetFileInformationByHandleEx(handle, FileIdInfo, &identity, sizeof(identity))) {
    fail(env, "INSPECT_FAILED", "Could not inspect file handle", GetLastError());
    return false;
  }
  if ((attributes.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ||
      static_cast<bool>(standard.Directory) != directory ||
      (!directory && standard.NumberOfLinks != 1)) {
    fail(env, "UNSAFE_OBJECT", "Reparse point, wrong object type, or hard-linked file");
    return false;
  }
  char hex[49];
  std::snprintf(hex, sizeof(hex), "%016llx", static_cast<unsigned long long>(identity.VolumeSerialNumber));
  id.assign(hex);
  for (unsigned char byte : identity.FileId.Identifier) {
    std::snprintf(hex, sizeof(hex), "%02x", byte);
    id += hex;
  }
  return true;
}

bool open_checked(napi_env env, const std::wstring& path, bool directory, bool mutation,
                  Handle& result, std::string& id) {
  DWORD access = mutation ? DELETE | FILE_READ_ATTRIBUTES | SYNCHRONIZE :
      FILE_READ_ATTRIBUTES | (directory ? FILE_TRAVERSE : 0);
  DWORD sharing = mutation ? FILE_SHARE_READ : FILE_SHARE_READ | FILE_SHARE_WRITE;
  DWORD flags = FILE_FLAG_OPEN_REPARSE_POINT | (directory ? FILE_FLAG_BACKUP_SEMANTICS : 0);
  result = Handle(CreateFileW(path.c_str(), access, sharing, nullptr, OPEN_EXISTING, flags, nullptr));
  if (!result.valid()) {
    fail(env, "OPEN_FAILED", "Could not pin the path", GetLastError());
    return false;
  }
  return inspect_handle(env, result.value, directory, id);
}

bool open_root(napi_env env, const std::wstring& rootPath, const std::string* expected,
               Handle& root, std::string& id, std::vector<Handle>& ancestors) {
  if (!valid_root(env, rootPath)) return false;
  std::wstring path = rootPath.substr(0, 3);
  if (rootPath.size() == 3) return false;
  Handle drive;
  if (!open_checked(env, path, true, false, drive, id)) return false;
  ancestors.push_back(std::move(drive));
  size_t from = 3;
  while (from < rootPath.size()) {
    size_t end = rootPath.find(L'\\', from);
    if (end == std::wstring::npos) end = rootPath.size();
    if (path.back() != L'\\') path += L'\\';
    path += rootPath.substr(from, end - from);
    Handle next;
    if (!open_checked(env, path, true, false, next, id)) return false;
    if (end == rootPath.size()) root = std::move(next);
    else ancestors.push_back(std::move(next));
    from = end + 1;
  }
  if (expected && id != *expected) {
    fail(env, "STALE_IDENTITY", "Root identity changed");
    return false;
  }
  return true;
}

bool open_path(napi_env env, const std::wstring& rootPath,
               const std::vector<std::wstring>& parts, size_t count,
               bool finalDirectory, bool finalMutation,
               Handle& final, std::string& id, std::vector<Handle>& ancestors) {
  std::wstring path = rootPath;
  for (size_t i = 0; i < count; ++i) {
    if (path.back() != L'\\') path += L'\\';
    path += parts[i];
    Handle next;
    const bool directory = i + 1 < count || finalDirectory;
    if (!open_checked(env, path, directory, i + 1 == count && finalMutation, next, id)) return false;
    if (i + 1 < count) ancestors.push_back(std::move(next));
    else final = std::move(next);
  }
  return true;
}

bool read_ascii(napi_env env, napi_value value, std::string& out) {
  std::wstring input;
  if (!read_string(env, value, input)) return false;
  if (input.empty() || input.size() > 100 ||
      std::any_of(input.begin(), input.end(), [](wchar_t ch) { return ch < 33 || ch > 126; })) {
    fail(env, "INVALID_ARGUMENT", "Expected a bounded ASCII token");
    return false;
  }
  out.assign(input.begin(), input.end());
  return true;
}

void finalize(napi_env, void* pointer, void*) { delete static_cast<Prepared*>(pointer); }

napi_value identity(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok) {
    fail(env, "NAPI_FAILED", "Could not read identity arguments"); return nullptr;
  }
  if (argc != 3) { fail(env, "INVALID_ARGUMENT", "identity(root, relativeOrEmpty, directory) expected"); return nullptr; }
  bool directory = false;
  if (napi_get_value_bool(env, args[2], &directory) != napi_ok) {
    fail(env, "INVALID_ARGUMENT", "Expected directory boolean"); return nullptr;
  }
  std::wstring rootPath, relative;
  if (!read_string(env, args[0], rootPath) || !read_string(env, args[1], relative)) return nullptr;
  Handle root;
  std::string id;
  std::vector<Handle> ancestors;
  if (!open_root(env, rootPath, nullptr, root, id, ancestors)) return nullptr;
  if (!relative.empty()) {
    std::vector<std::wstring> parts;
    Handle target;
    if (!split_relative(env, relative, parts) ||
        !open_path(env, rootPath, parts, parts.size(), directory, false, target, id, ancestors)) return nullptr;
  }
  napi_value output;
  if (napi_create_string_utf8(env, id.c_str(), id.size(), &output) != napi_ok) {
    fail(env, "NAPI_FAILED", "Could not return identity"); return nullptr;
  }
  return output;
}

napi_value pin_directory(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value args[4];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 4) {
    fail(env, "INVALID_ARGUMENT", "pinDirectory(root, rootId, relativeOrEmpty, directoryId) expected"); return nullptr;
  }
  std::wstring rootPath, relative;
  std::string rootId, directoryId, actual;
  if (!read_string(env, args[0], rootPath) || !read_ascii(env, args[1], rootId) ||
      !read_string(env, args[2], relative) || !read_ascii(env, args[3], directoryId)) return nullptr;
  auto token = std::make_unique<Prepared>();
  if (!open_root(env, rootPath, &rootId, token->root, actual, token->ancestors)) return nullptr;
  if (!relative.empty()) {
    std::vector<std::wstring> parts;
    if (!split_relative(env, relative, parts) || !open_path(env, rootPath, parts, parts.size(),
        true, false, token->destinationParent, actual, token->ancestors)) return nullptr;
  }
  if (actual != directoryId) { fail(env, "STALE_IDENTITY", "Directory identity changed"); return nullptr; }
  // This is only a custody token; commit must never accept it as a mutation.
  token->finished = true;
  napi_value output;
  if (napi_create_external(env, token.get(), finalize, nullptr, &output) != napi_ok) {
    fail(env, "NAPI_FAILED", "Could not create directory pin"); return nullptr;
  }
  token.release();
  return output;
}

napi_value prepare(napi_env env, napi_callback_info info) {
  size_t argc = 7;
  napi_value args[7];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok) {
    fail(env, "NAPI_FAILED", "Could not read prepare arguments"); return nullptr;
  }
  if (argc != 7) {
    fail(env, "INVALID_ARGUMENT", "prepare(root, rootId, source, sourceId, destinationOrEmpty, destinationParentId, kind) expected");
    return nullptr;
  }
  std::wstring rootPath, sourcePath, destinationPath;
  if (!read_string(env, args[0], rootPath) || !read_string(env, args[2], sourcePath) ||
      !read_string(env, args[4], destinationPath)) return nullptr;
  std::string rootId, sourceId, destinationParentId, kind;
  if (!read_ascii(env, args[1], rootId) || !read_ascii(env, args[3], sourceId) ||
      !read_ascii(env, args[6], kind)) return nullptr;
  if (kind == "rename") {
    if (!read_ascii(env, args[5], destinationParentId)) return nullptr;
  } else {
    std::wstring unused;
    if (!read_string(env, args[5], unused)) return nullptr;
    if (!unused.empty()) {
      fail(env, "INVALID_ARGUMENT", "Delete has no destination parent");
      return nullptr;
    }
  }
  if (rootId.empty() || sourceId.empty() || (kind != "rename" && kind != "delete")) {
    fail(env, "INVALID_ARGUMENT", "Invalid expected identities or operation");
    return nullptr;
  }
  if (kind == "delete" && !destinationPath.empty()) {
    fail(env, "INVALID_ARGUMENT", "Delete has no destination path");
    return nullptr;
  }
  std::vector<std::wstring> sourceParts, destinationParts;
  if (!split_relative(env, sourcePath, sourceParts)) return nullptr;
  if (kind == "rename" && (!split_relative(env, destinationPath, destinationParts) ||
                            destinationParentId.empty())) return nullptr;
  auto token = std::make_unique<Prepared>();
  token->deletion = kind == "delete";
  std::string actual;
  if (!open_root(env, rootPath, &rootId, token->root, actual, token->ancestors)) return nullptr;
  if (sourceParts.size() > 1 &&
      !open_path(env, rootPath, sourceParts, sourceParts.size() - 1, true, false,
                 token->sourceParent, actual, token->ancestors)) return nullptr;
  if (!open_path(env, rootPath, sourceParts, sourceParts.size(), false, true,
                 token->source, actual, token->ancestors)) return nullptr;
  if (actual != sourceId) { fail(env, "STALE_IDENTITY", "Source identity changed"); return nullptr; }
  if (!token->deletion) {
    token->destinationName = destinationParts.back();
    if (destinationParts.size() > 1 &&
        !open_path(env, rootPath, destinationParts, destinationParts.size() - 1,
                   true, false, token->destinationParent, actual, token->ancestors)) return nullptr;
    if (destinationParts.size() == 1) actual = rootId;
    if (actual != destinationParentId) {
      fail(env, "STALE_IDENTITY", "Destination parent identity changed");
      return nullptr;
    }
  }
  napi_value output;
  if (napi_create_external(env, token.get(), finalize, nullptr, &output) != napi_ok) {
    fail(env, "NAPI_FAILED", "Could not create prepared operation");
    return nullptr;
  }
  token.release();
  return output;
}

napi_value commit(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok) {
    fail(env, "NAPI_FAILED", "Could not read commit argument"); return nullptr;
  }
  void* raw = nullptr;
  if (argc != 1 || napi_get_value_external(env, args[0], &raw) != napi_ok || raw == nullptr) {
    fail(env, "INVALID_TOKEN", "Prepared operation is unavailable or already consumed");
    return nullptr;
  }
  auto* token = static_cast<Prepared*>(raw);
  if (token->finished) {
    fail(env, "INVALID_TOKEN", "Prepared operation is unavailable or already consumed");
    return nullptr;
  }
  // A commit cannot be retried by reusing stale pinned handles after any attempt.
  token->finished = true;
  BOOL ok = FALSE;
  if (token->deletion) {
    FILE_DISPOSITION_INFO disposition{};
    disposition.DeleteFile = TRUE;
    ok = SetFileInformationByHandle(token->source.value, FileDispositionInfo,
                                    &disposition, sizeof(disposition));
  } else {
    const size_t bytes = sizeof(FILE_RENAME_INFO) +
                         (token->destinationName.size() + 1) * sizeof(wchar_t);
    std::vector<unsigned char> buffer(bytes, 0);
    auto* rename = reinterpret_cast<FILE_RENAME_INFO*>(buffer.data());
    rename->ReplaceIfExists = FALSE;
    rename->RootDirectory = token->destinationParent.valid() ?
        token->destinationParent.value : token->root.value;
    rename->FileNameLength = static_cast<DWORD>(token->destinationName.size() * sizeof(wchar_t));
    std::copy(token->destinationName.begin(), token->destinationName.end(), rename->FileName);
    using NtSetInformationFileFn = NTSTATUS(NTAPI*)(HANDLE, PIO_STATUS_BLOCK, PVOID, ULONG, INT);
    HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
    auto ntSet = ntdll ? reinterpret_cast<NtSetInformationFileFn>(
        GetProcAddress(ntdll, "NtSetInformationFile")) : nullptr;
    if (ntSet) {
      IO_STATUS_BLOCK statusBlock{};
      constexpr NTSTATUS kStatusPending = 0x00000103L;
      statusBlock.Status = kStatusPending;
      NTSTATUS status = ntSet(token->source.value, &statusBlock, rename,
                              static_cast<ULONG>(bytes), 10 /* FileRenameInformation */);
      if (status == kStatusPending) {
        // CreateFileW omitted FILE_FLAG_OVERLAPPED. If a provider still returns
        // pending, retain both input buffers until its I/O reaches a terminal state.
        // Abandoning them after a timeout would allow a late rename and a UAF.
        if (WaitForSingleObject(token->source.value, INFINITE) != WAIT_OBJECT_0) {
          napi_fatal_error("windows_apply", NAPI_AUTO_LENGTH,
                           "Pending rename could not reach a terminal state", NAPI_AUTO_LENGTH);
          std::abort();
        }
        status = statusBlock.Status;
        if (status == kStatusPending) {
          napi_fatal_error("windows_apply", NAPI_AUTO_LENGTH,
                           "Pending rename signaled without terminal I/O status", NAPI_AUTO_LENGTH);
          std::abort();
        }
      }
      ok = status == 0;
      if (!ok) {
        using ConvertFn = ULONG(WINAPI*)(NTSTATUS);
        auto convert = reinterpret_cast<ConvertFn>(
            GetProcAddress(ntdll, "RtlNtStatusToDosError"));
        SetLastError(convert ? convert(status) : ERROR_GEN_FAILURE);
      }
    } else {
      SetLastError(ERROR_PROC_NOT_FOUND);
    }
  }
  const DWORD error = ok ? 0 : GetLastError();
  token->source.reset();
  token->destinationParent.reset();
  token->sourceParent.reset();
  token->root.reset();
  token->ancestors.clear();
  if (!ok) { fail(env, "MUTATION_FAILED", "Handle-bound mutation failed", error); return nullptr; }
  napi_value result;
  if (napi_get_boolean(env, true, &result) != napi_ok) {
    fail(env, "NAPI_FAILED", "Could not return commit result"); return nullptr;
  }
  return result;
}

napi_value close_prepared(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok) {
    fail(env, "NAPI_FAILED", "Could not read close argument"); return nullptr;
  }
  void* raw = nullptr;
  if (argc != 1 || napi_get_value_external(env, args[0], &raw) != napi_ok || raw == nullptr) {
    fail(env, "INVALID_TOKEN", "Expected a prepared operation");
    return nullptr;
  }
  auto* token = static_cast<Prepared*>(raw);
  token->finished = true;
  token->source.reset();
  token->destinationParent.reset();
  token->sourceParent.reset();
  token->root.reset();
  token->ancestors.clear();
  napi_value result;
  if (napi_get_undefined(env, &result) != napi_ok) {
    fail(env, "NAPI_FAILED", "Could not return close result"); return nullptr;
  }
  return result;
}

napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor functions[] = {
      {"pinDirectory", nullptr, pin_directory, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"identity", nullptr, identity, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"prepare", nullptr, prepare, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"commit", nullptr, commit, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"close", nullptr, close_prepared, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  if (napi_define_properties(env, exports, sizeof(functions) / sizeof(functions[0]), functions) != napi_ok) {
    fail(env, "NAPI_FAILED", "Could not register native functions"); return nullptr;
  }
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
