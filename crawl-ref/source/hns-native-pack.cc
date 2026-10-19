#include "hns-native-core.h"
#include "contrib/hns-native/picosha2.h"
#include <chrono>
#include <cmath>
#include <fstream>
#include <set>
#include <random>
#include <stdexcept>
#ifdef _WIN32
#include <windows.h>
#else
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace hns
{
double now_ms()
{
    return std::chrono::duration<double, std::milli>(
        std::chrono::system_clock::now().time_since_epoch()).count();
}
std::string digest(const Bytes &bytes)
{
    return picosha2::hash256_hex_string(bytes);
}
Bytes read(const fs::path &path, size_t limit)
{
    if (fs::is_symlink(fs::symlink_status(path)))
        throw std::runtime_error("Symbolic links are not allowed in saved files.");
    const auto size = fs::file_size(path);
    if (size > limit)
        throw std::runtime_error("File exceeds the allowed size.");
    std::ifstream file(path, std::ios::binary);
    Bytes data(static_cast<size_t>(size), '\0');
    if (!file || (size && !file.read(&data[0], size)))
        throw std::runtime_error("Could not read saved file.");
    return data;
}
void atomic_write(const fs::path &path, const Bytes &data)
{
    fs::create_directories(path.parent_path());
    std::random_device random;
    const auto temporary = path.u8string() + ".hns-tmp-" + std::to_string(random()) + "-" + std::to_string(random());
    if (fs::is_symlink(fs::symlink_status(path)) || fs::exists(temporary))
        throw std::runtime_error("Unsafe saved file or unfinished write; original data is preserved.");
    // The profile/staging directories are private. Never chmod the user's
    // existing export destination (Downloads, an external disk, etc.).
    try
    {
        std::ofstream file(fs::u8path(temporary), std::ios::binary | std::ios::trunc);
        if (!file || !file.write(data.data(), data.size()) || !(file.flush()))
            throw std::runtime_error("Could not write saved file. Check free disk space.");
        file.close();
        fs::permissions(fs::u8path(temporary), fs::perms::owner_read | fs::perms::owner_write,
                        fs::perm_options::replace);
#ifdef _WIN32
        if (!MoveFileExW(fs::u8path(temporary).c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
            throw std::runtime_error("Could not commit saved file.");
#else
        fs::rename(fs::u8path(temporary), path);
#endif
    }
    catch (...)
    {
        std::error_code error;
        fs::remove(fs::u8path(temporary), error);
        throw;
    }
}
static bool valid_path(const std::string &path)
{
    if (path.rfind("/crawl/", 0) != 0 || path.find('\0') != path.npos
        || path.find('\\') != path.npos || path.size() > 4096 || path.back() == '/')
    {
        return false;
    }
    for (const auto &part : fs::u8path(path.substr(7)))
        if (part == "." || part == ".." || part.empty() || part.u8string().find(':') != std::string::npos)
            return false;
    return path.find("//") == path.npos;
}
static bool cache(const std::string &path)
{
    return path.find(".hns-tmp-") != std::string::npos
        || path == "/crawl/.pocketzot-prewarm" || path == "/crawl/saves/db"
        || path == "/crawl/saves/des" || path.rfind("/crawl/saves/db/", 0) == 0
        || path.rfind("/crawl/saves/des/", 0) == 0;
}
Snapshot snapshot(const std::vector<File> &files, const std::string &build)
{
    Snapshot result;
    result.build = build;
    size_t size = 0;
    if (files.size() > 20000)
        throw std::runtime_error("Too many saved files.");
    for (const auto &file : files)
    {
        if (!valid_path(file.path) || cache(file.path) || !result.files.emplace(file.path, file).second)
            throw std::runtime_error("Invalid, cached, or duplicate path in save backup.");
        size += file.data.size();
        if (size > max_bytes)
            throw std::runtime_error("Saved files exceed 32 MiB.");
        result.hashes[file.path] = digest(file.data);
    }
    Json entries = Json::array();
    for (const auto &entry : result.hashes)
        entries.push_back(Json::array({entry.first, entry.second}));
    result.hash = digest(entries.dump(-1, ' ', false, Json::error_handler_t::strict));
    return result;
}
static uint32_t little32(const Bytes &data, size_t offset)
{
    if (offset + 4 > data.size())
        throw std::runtime_error("Truncated save backup.");
    uint32_t value = 0;
    for (int i = 0; i < 4; ++i)
        value |= uint32_t(static_cast<unsigned char>(data[offset + i])) << (8 * i);
    return value;
}
Bytes encode(const Snapshot &value)
{
    Json manifest = {{"exportedAt", ""}, {"build", value.build}, {"files", Json::array()}};
    Bytes data;
    for (const auto &entry : value.files)
    {
        const auto &file = entry.second;
        manifest["files"].push_back({{"path", file.path}, {"mode", 0100664},
            {"mtimeMs", file.mtime}, {"offset", data.size()}, {"size", file.data.size()}});
        data += file.data;
    }
    const Bytes header = manifest.dump();
    if (header.size() + data.size() + 12 > max_bytes)
        throw std::runtime_error("Save backup exceeds 32 MiB.");
    Bytes result = "PZSAVE1\n";
    for (int i = 0; i < 4; ++i)
        result += char((header.size() >> (i * 8)) & 255);
    return result + header + data;
}
Snapshot decode(const Bytes &bytes, bool allow_empty)
{
    if (bytes.empty() && allow_empty)
        return snapshot({});
    if (bytes.size() < 12 || bytes.size() > max_bytes || bytes.substr(0, 8) != "PZSAVE1\n")
        throw std::runtime_error("Invalid save backup.");
    const size_t header_size = little32(bytes, 8), start = 12 + header_size;
    if (header_size > 4 * 1024 * 1024 || start > bytes.size())
        throw std::runtime_error("Truncated save manifest.");
    const auto manifest = Json::parse(bytes.substr(12, header_size),
        [](int depth, Json::parse_event_t, Json&) {
            if (depth > 16)
                throw std::runtime_error("Save manifest is too deeply nested.");
            return true;
        });
    if (!manifest.contains("files") || !manifest["files"].is_array() || manifest["files"].size() > 20000)
        throw std::runtime_error("Invalid save manifest.");
    std::vector<File> files;
    size_t total = 0;
    for (const auto &entry : manifest["files"])
    {
        const auto offset = entry.at("offset"), size = entry.at("size");
        if (!offset.is_number_unsigned() || !size.is_number_unsigned()
            || offset.get<uint64_t>() > bytes.size() - start
            || size.get<uint64_t>() > bytes.size() - start - offset.get<uint64_t>())
        {
            throw std::runtime_error("Truncated saved file.");
        }
        if (size.get<uint64_t>() > max_bytes - total)
            throw std::runtime_error("Saved files exceed 32 MiB.");
        total += size.get<size_t>();
        files.push_back({entry.at("path").get<std::string>(), entry.value("mtimeMs", 0.0),
            bytes.substr(start + offset.get<size_t>(), size.get<size_t>())});
    }
    return snapshot(files, manifest.value("build", std::string()));
}
static double file_mtime(const fs::path &path)
{
    return std::chrono::duration<double, std::milli>(
        (fs::last_write_time(path) - fs::file_time_type::clock::now()
         + std::chrono::system_clock::now()).time_since_epoch()).count();
}
Snapshot local_snapshot(const fs::path &root, const std::string &build)
{
    std::vector<File> files;
    size_t total = 0;
    for (auto it = fs::recursive_directory_iterator(root); it != fs::recursive_directory_iterator(); ++it)
    {
        const auto &entry = *it;
        const std::string path = "/crawl/" + entry.path().lexically_relative(root).generic_u8string();
        if (cache(path))
        {
            if (entry.is_directory())
                it.disable_recursion_pending();
            continue;
        }
        if (entry.is_symlink())
            throw std::runtime_error("Symbolic links are not synchronized.");
        if (entry.is_regular_file())
        {
            const auto size = entry.file_size();
            if (files.size() >= 20000 || size > max_bytes - total)
                throw std::runtime_error("Saved files exceed the allowed size.");
            total += size;
            files.push_back({path, file_mtime(entry.path()), read(entry.path())});
        }
    }
    return snapshot(files, build);
}
void replace_files(const fs::path &home, const Snapshot &value)
{
    const auto root = home / "crawl", previous = home / "crawl.previous", staged = home / "crawl.staging";
    if (fs::exists(staged))
        fs::remove_all(staged);
    fs::create_directories(staged);
    fs::permissions(staged, fs::perms::owner_all, fs::perm_options::replace);
    try
    {
        for (const auto &entry : value.files)
        {
            const auto &file = entry.second;
            if (!valid_path(file.path) || cache(file.path))
                throw std::runtime_error("Unsafe save path.");
            const auto path = staged / fs::u8path(file.path.substr(7));
            atomic_write(path, file.data);
            const double mtime = std::isfinite(file.mtime) && file.mtime >= 0
                && file.mtime <= now_ms() + 300000 ? file.mtime : 0;
            const auto system_time = std::chrono::system_clock::time_point(std::chrono::milliseconds(static_cast<int64_t>(mtime)));
            fs::last_write_time(path, fs::file_time_type::clock::now()
                + std::chrono::duration_cast<fs::file_time_type::duration>(system_time - std::chrono::system_clock::now()));
        }
        // Databases may still be open in the SDL engine: preserve these exact directories.
        for (const auto *name : {"db", "des"})
            if (fs::exists(root / "saves" / name))
            {
                fs::create_directories(staged / "saves");
                fs::rename(root / "saves" / name, staged / "saves" / name);
            }
        if (fs::exists(previous))
            fs::remove_all(previous);
        fs::rename(root, previous);
        try { fs::rename(staged, root); }
        catch (...) { fs::rename(previous, root); throw; }
    }
    catch (...)
    {
        // Recover any cache directory moved before the atomic swap.
        for (const auto *name : {"db", "des"})
            if (fs::exists(staged / "saves" / name) && !fs::exists(root / "saves" / name))
            {
                fs::create_directories(root / "saves");
                fs::rename(staged / "saves" / name, root / "saves" / name);
            }
        std::error_code error;
        fs::remove_all(staged, error);
        throw;
    }
}
Snapshot merge(const Snapshot *base, const Snapshot &local, const Snapshot &remote)
{
    std::set<std::string> paths;
    for (const auto *value : {base, &local, &remote})
        if (value)
            for (const auto &entry : value->files)
                paths.insert(entry.first);
    std::vector<File> files;
    const auto hash = [](const Snapshot *s, const std::string &p) {
        return s && s->hashes.count(p) ? s->hashes.at(p) : std::string();
    };
    for (const auto &path : paths)
    {
        const auto b = hash(base, path), l = hash(&local, path), r = hash(&remote, path);
        const Snapshot *source = nullptr;
        if (l == r || r == b)
            source = &local;
        else if (l == b)
            source = &remote;
        else if (local.files.count(path) && remote.files.count(path))
        {
            const auto &left = local.files.at(path), &right = remote.files.at(path);
            if (path == "/crawl/saves/logfile")
            {
                const auto before = base && base->files.count(path) ? base->files.at(path).data : Bytes();
                if (left.data.rfind(before, 0) == 0 && right.data.rfind(before, 0) == 0
                    && (before.empty() || before.back() == '\n')
                    && (left.data.empty() || left.data.back() == '\n')
                    && (right.data.empty() || right.data.back() == '\n'))
                {
                    std::set<std::string> seen;
                    Bytes combined = before;
                    for (const auto *file : {&left, &right})
                    {
                        std::istringstream stream(file->data.substr(before.size()));
                        std::string line;
                        while (std::getline(stream, line))
                            if (!line.empty() && seen.insert(line).second)
                                combined += line + "\n";
                    }
                    files.push_back({path, std::max(left.mtime, right.mtime), combined});
                    continue;
                }
            }
            if (!(left.mtime > 0 && right.mtime > 0 && std::isfinite(left.mtime)
                && std::isfinite(right.mtime) && left.mtime <= now_ms() + 300000
                && right.mtime <= now_ms() + 300000 && std::abs(left.mtime - right.mtime) >= 1))
            {
                throw std::runtime_error("Both copies are kept. Choose Local -> Cloud or Cloud -> Local.");
            }
            source = left.mtime > right.mtime ? &local : &remote;
        }
        else
            throw std::runtime_error("A deletion conflicts with saved progress. Both copies are kept; choose a direction.");
        if (source->files.count(path))
            files.push_back(source->files.at(path));
    }
    return snapshot(files, local.build);
}
}
