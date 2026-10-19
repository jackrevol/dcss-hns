#include "hns-native.h"
#include "hns-native-core.h"
#include <cstdlib>
#include <iostream>
#ifdef __APPLE__
#include <mach-o/dyld.h>
#elif defined(_WIN32)
#include <windows.h>
#else
#include <unistd.h>
#endif

namespace
{
std::unique_ptr<hns::Backend> backend;
hns::fs::path executable_path(const char *fallback)
{
#ifdef __APPLE__
    uint32_t size = 0;
    _NSGetExecutablePath(nullptr, &size);
    std::vector<char> path(size);
    if (!_NSGetExecutablePath(path.data(), &size))
        return hns::fs::canonical(hns::fs::u8path(path.data()));
#elif defined(_WIN32)
    std::vector<wchar_t> path(32768);
    const auto size = GetModuleFileNameW(nullptr, path.data(), DWORD(path.size()));
    if (size && size < path.size())
        return hns::fs::path(std::wstring(path.data(), size));
#else
    std::vector<char> path(65536);
    const auto size = readlink("/proc/self/exe", path.data(), path.size());
    if (size > 0 && size_t(size) < path.size())
        return hns::fs::u8path(std::string(path.data(), size));
#endif
    return hns::fs::absolute(hns::fs::u8path(fallback));
}
}
std::string hns_native_prepare(int argc, char **argv, const std::string &version)
{
    // Command-line tools/headless verification keep their explicit profiles.
    // A legacy bridge can still use this engine while upgrading an old package.
    if (getenv("HNS_DESKTOP_MANAGE"))
        return "";
    for (int i = 1; i < argc; ++i)
    {
        const std::string arg(argv[i]);
        if (arg.rfind("-psn_", 0) != 0)
            return "";
    }
    hns::fs::path profile;
#ifdef _WIN32
    if (const wchar_t *override = _wgetenv(L"HNS_DESKTOP_DATA"))
        profile = hns::fs::path(override);
#else
    if (const char *override = getenv("HNS_DESKTOP_DATA"))
        profile = hns::fs::u8path(override);
#endif
    else
    {
#ifdef _WIN32
        const wchar_t *base = _wgetenv(L"APPDATA");
        if (!base) throw std::runtime_error("APPDATA is unavailable.");
        profile = hns::fs::path(base) / "DCSS HNS";
#else
        const char *home = getenv("HOME");
        if (!home) throw std::runtime_error("HOME is unavailable.");
#ifdef __APPLE__
        profile = hns::fs::u8path(home) / "Library/Application Support/DCSS HNS";
#else
        const char *config = getenv("XDG_CONFIG_HOME");
        profile = (config ? hns::fs::u8path(config) : hns::fs::u8path(home) / ".config") / "DCSS HNS";
#endif
#endif
    }
    const auto executable = executable_path(argv[0]);
    auto data = executable.parent_path();
#ifdef __APPLE__
    data = executable.parent_path().parent_path() / "Resources";
#elif !defined(_WIN32)
    if (data.filename() == "bin") data = data.parent_path();
#endif
    std::string build = "native-" + version;
    hns::Json project = hns::Json::object();
    if (hns::fs::exists(data / "hns-native.json"))
    {
        const auto metadata = hns::Json::parse(hns::read(data / "hns-native.json", 16384));
        build = metadata.value("build", build);
        project = metadata.value("cloud", project);
    }
    if (hns::fs::exists(data / "hns-ca-bundle.crt"))
        project["caFile"] = (data / "hns-ca-bundle.crt").u8string();
    if (hns::fs::is_directory(data / "dat"))
        hns::fs::current_path(data);
    backend.reset(new hns::Backend(hns::fs::absolute(profile), build, {}, project));
    const auto crawl = (backend->home() / "crawl").u8string();
#ifdef _WIN32
    _putenv_s("CRAWL_DIR", crawl.c_str());
#else
    setenv("CRAWL_DIR", crawl.c_str(), 1);
#endif
    return crawl;
}
bool hns_native_enabled() { return bool(backend); }
std::string hns_native_action(const std::string &kind, const std::string &values)
{
    if (!backend)
        return "{}";
    return backend->action(kind, hns::Json::parse(values)).dump();
}
void hns_native_start(std::function<bool(const std::string&)> compatible)
{
    if (backend) backend->start(std::move(compatible));
}
bool hns_native_checkpoint_due(bool background)
{
    return backend && backend->checkpoint_due(background);
}
void hns_native_saved()
{
    try { if (backend) backend->saved(); }
    catch (...) { /* A failed cloud snapshot never prevents the engine's local save. */ }
}
void hns_native_finish()
{
    try { if (backend) backend->finish(); }
    catch (...) { /* The canonical local save and recovery copies remain on disk. */ }
}
std::vector<std::string> hns_native_files(const std::string &path)
{
    std::vector<std::string> result;
    std::error_code error;
    for (const auto &entry : hns::fs::directory_iterator(hns::fs::u8path(path), error))
    {
        if (entry.is_symlink()) continue;
        if (entry.is_directory()) result.push_back(entry.path().u8string() + "/");
        else if (entry.is_regular_file()) result.push_back(entry.path().u8string());
    }
    std::sort(result.begin(), result.end(), [](const auto &a, const auto &b) {
        return (a.back() == '/') != (b.back() == '/') ? a.back() == '/' : a < b;
    });
    return result;
}
