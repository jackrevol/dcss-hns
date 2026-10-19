#pragma once

#if __cplusplus >= 201703L

#include "contrib/hns-native/json.hpp"
#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace hns
{
namespace fs = std::filesystem;
using Json = nlohmann::ordered_json;
using Bytes = std::string;
constexpr size_t max_bytes = 32 * 1024 * 1024;
struct File
{
    std::string path;
    double mtime = 0;
    Bytes data;
};
struct Snapshot
{
    std::map<std::string, File> files;
    std::map<std::string, std::string> hashes;
    std::string hash, build;
};
std::string digest(const Bytes &bytes);
std::string to_base64(const Bytes &bytes);
Bytes from_base64(const std::string &text);
double now_ms();
Bytes read(const fs::path &path, size_t limit = max_bytes);
void atomic_write(const fs::path &path, const Bytes &data);
Snapshot snapshot(const std::vector<File> &files, const std::string &build = "");
Bytes encode(const Snapshot &value);
Snapshot decode(const Bytes &bytes, bool allow_empty = false);
Snapshot local_snapshot(const fs::path &root, const std::string &build);
Snapshot merge(const Snapshot *base, const Snapshot &local, const Snapshot &remote);
void replace_files(const fs::path &home, const Snapshot &value);
// Read-only migration of one origin's key, including LevelDB WAL and SST/Snappy.
std::string legacy_login(const fs::path &directory, const std::string &url);

class Backend
{
public:
    using Rpc = std::function<Json(const std::string&, const Json&)>;
    Backend(fs::path profile, std::string build, Rpc rpc = {}, Json project = Json::object());
    ~Backend();
    Backend(const Backend&) = delete;
    Backend &operator=(const Backend&) = delete;
    Json action(const std::string &kind, const Json &values = Json::object());
    void start(std::function<bool(const std::string&)> compatible);
    bool checkpoint_due(bool background);
    void saved();
    void finish();
    const fs::path &home() const;
private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};
}
#endif
