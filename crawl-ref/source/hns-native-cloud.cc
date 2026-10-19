#include "hns-native-core.h"
#include <curl/curl.h>
#include <algorithm>
#include <chrono>
#include <future>
#include <regex>
#include <sstream>
#include <stdexcept>
#ifdef _WIN32
#include <windows.h>
#else
#include <csignal>
#include <unistd.h>
#endif

namespace hns
{
namespace
{
constexpr const char *project_url = "https://xviinjuhtvzgalqupddc.supabase.co";
constexpr const char *project_key = "sb_publishable_aSbsP4SQXpitqENyzmi2kg_VETbvi8M";
std::string encode64(const Bytes &bytes)
{
    static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string result;
    for (size_t i = 0; i < bytes.size(); i += 3)
    {
        const uint32_t bits = uint32_t(uint8_t(bytes[i])) << 16
            | (i + 1 < bytes.size() ? uint32_t(uint8_t(bytes[i + 1])) << 8 : 0)
            | (i + 2 < bytes.size() ? uint8_t(bytes[i + 2]) : 0);
        result += alphabet[(bits >> 18) & 63]; result += alphabet[(bits >> 12) & 63];
        result += i + 1 < bytes.size() ? alphabet[(bits >> 6) & 63] : '=';
        result += i + 2 < bytes.size() ? alphabet[bits & 63] : '=';
    }
    return result;
}
Bytes decode64(const std::string &encoded)
{
    std::string text;
    for (unsigned char c : encoded)
        if (c != ' ' && c != '\n' && c != '\r' && c != '\t' && c != '\f') text += c;
    if (text.size() > (max_bytes + 2) / 3 * 4)
        throw std::runtime_error("Cloud save exceeds 32 MiB.");
    static const std::string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    Bytes result;
    uint32_t bits = 0;
    int count = 0;
    unsigned padding = 0;
    for (unsigned char c : text)
    {
        if (c == '=') { ++padding; continue; }
        const auto value = alphabet.find(c);
        if (padding || value == std::string::npos)
            throw std::runtime_error("Invalid cloud save encoding.");
        bits = (bits << 6) | uint32_t(value);
        count += 6;
        if (count >= 8)
        {
            count -= 8;
            result += char((bits >> count) & 255);
        }
    }
    if (padding > 2 || text.size() % 4 == 1 || (padding && text.size() % 4) || result.size() > max_bytes)
        throw std::runtime_error("Cloud save exceeds 32 MiB.");
    return result;
}
bool valid_login(const Json &value)
{
    return value.is_object() && value.contains("id") && value["id"].is_string()
        && value.value("username", "") == value["id"] && value.contains("loginKey")
        && value["loginKey"].is_string()
        && std::regex_match(value["id"].get<std::string>(), std::regex("[a-z0-9_]{3,32}"))
        && std::regex_match(value["loginKey"].get<std::string>(), std::regex("[a-f0-9]{64}"));
}
bool alive(uint64_t pid)
{
    if (!pid)
        return false;
#ifdef _WIN32
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, DWORD(pid));
    if (!process)
        return GetLastError() == ERROR_ACCESS_DENIED;
    DWORD code = 0;
    const bool running = !GetExitCodeProcess(process, &code) || code == STILL_ACTIVE;
    CloseHandle(process);
    return running;
#else
    return kill(pid_t(pid), 0) == 0 || errno == EPERM;
#endif
}
uint64_t process_id()
{
#ifdef _WIN32
    return GetCurrentProcessId();
#else
    return getpid();
#endif
}
Json ok(const std::string &message = "") { return {{"ok", true}, {"message", message}}; }
std::string safe_error(const std::exception &error)
{
    // Never expose HTTP bodies, credentials or JSON parser excerpts in UI/logs.
    if (dynamic_cast<const nlohmann::json::exception*>(&error))
        return "Invalid saved data. Existing files are preserved.";
    return error.what();
}
Json xlog(const std::string &line)
{
    Json record = Json::object();
    std::string field;
    const auto commit = [&]() {
        const auto eq = field.find('=');
        if (eq != std::string::npos && eq)
            record[field.substr(0, eq)] = field.substr(eq + 1);
        field.clear();
    };
    for (size_t i = 0; i < line.size(); ++i)
        if (line[i] == ':' && i + 1 < line.size() && line[i + 1] == ':') { field += ':'; ++i; }
        else if (line[i] == ':') commit();
        else field += line[i];
    commit();
    return record;
}
std::string morgue_name(const Json &record)
{
    std::string name = record.value("name", ""), end = record.value("end", "");
    if (name.empty() || !std::regex_match(end, std::regex("[0-9]{14}[DS]?")))
        return "";
    name.erase(std::remove_if(name.begin(), name.end(), [](unsigned char c) {
        return c < 32 || std::string("/\\:*?\"<>|").find(c) != std::string::npos;
    }), name.end());
    const auto month = std::stoi(end.substr(4, 2)) + 1;
    if (month < 1 || month > 12)
        return "";
    return "morgue-" + name + "-" + end.substr(0, 4) + (month < 10 ? "0" : "")
        + std::to_string(month) + end.substr(6, 2) + "-" + end.substr(8, 6) + ".txt";
}
}

std::string to_base64(const Bytes &bytes) { return encode64(bytes); }
Bytes from_base64(const std::string &text) { return decode64(text); }

struct Backend::Impl
{
    fs::path profile, root, crawl, state, archives, lock;
    std::string build, url = project_url, key = project_key, ca_file, phase = "off", message;
    Json account = nullptr;
    Rpc rpc_override;
    std::function<bool(const std::string&)> compatible;
    std::future<void> pending;
    double next_checkpoint = now_ms() + 60000;
    bool finished = false, owns_lock = false;
    double deadline = 0;

    Impl(fs::path p, std::string b, Rpc rpc, const Json &project) : profile(std::move(p)), root(profile / "native"),
        crawl(root / "crawl"), state(root / "state"), archives(root / "archives"),
        lock(root / "active.lock"), build(std::move(b)), rpc_override(std::move(rpc))
    {
        url = project.value("url", std::string(project_url));
        key = project.value("key", std::string(project_key));
        ca_file = project.value("caFile", std::string());
        if (url.rfind("https://", 0) != 0)
            throw std::runtime_error("Cloud connections require HTTPS.");
        fs::create_directories(root);
        fs::permissions(root, fs::perms::owner_all, fs::perm_options::replace);
        if (fs::exists(root / "active.json"))
        {
            const auto previous = Json::parse(read(root / "active.json", 4096));
            if (alive(previous.value("pid", uint64_t(0))))
                throw std::runtime_error("Another PC game is running. Save and close it first.");
        }
        if (fs::exists(lock))
        {
            const auto owner = Json::parse(read(lock / "owner.json", 4096));
            if (alive(owner.value("pid", uint64_t(0))) || alive(owner.value("childPid", uint64_t(0))))
                throw std::runtime_error("Another game or sync is running. Save and close it first.");
            fs::remove_all(lock);
        }
        if (!fs::create_directory(lock))
            throw std::runtime_error("The profile is in use.");
        owns_lock = true;
        try
        {
            atomic_write(lock / "owner.json", Json({{"pid", process_id()}}).dump());
            if (!fs::exists(crawl) && fs::exists(root / "crawl.previous"))
                fs::rename(root / "crawl.previous", crawl);
            fs::create_directories(crawl / "saves");
            fs::create_directories(crawl / "morgue");
            fs::create_directories(state);
            fs::create_directories(archives);
            if (fs::exists(root / "menu.pzsave"))
            {
                archive("Before recovering the previous desktop session", local());
                replace_files(root, decode(read(root / "menu.pzsave")));
                fs::remove(root / "menu.pzsave");
            }
            fs::remove(root / "active.json");
            if (fs::exists(state / "account.json"))
                account = Json::parse(read(state / "account.json", 4096));
            else
            {
                try
                {
                    const auto old = legacy_login(profile / "Local Storage/leveldb", url);
                    if (!old.empty())
                    {
                        auto migrated = Json::parse(old);
                        if (valid_login(migrated))
                        {
                            account = migrated;
                            atomic_write(state / "account.json", account.dump());
                        }
                    }
                }
                catch (...) { message = "Previous login is preserved. Sign in here if it could not be migrated."; }
            }
            if (!account.is_null() && !valid_login(account))
                throw std::runtime_error("Invalid native account file. Existing data is preserved.");
            phase = account.is_null() ? "off" : "pending";
            // Tests can redirect a disposable profile only; production always uses HTTPS.
            if (getenv("HNS_DESKTOP_DATA") && getenv("HNS_DESKTOP_UI_TEST"))
                if (const char *test = getenv("HNS_NATIVE_TEST_CLOUD"))
                {
                    if (std::string(test).rfind("http://127.0.0.1:", 0) != 0)
                        throw std::runtime_error("Test cloud must use loopback.");
                    url = test;
                }
            if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK)
                throw std::runtime_error("Could not initialize HTTPS.");
        }
        catch (...)
        {
            fs::remove_all(lock);
            owns_lock = false;
            throw;
        }
    }
    ~Impl()
    {
        if (pending.valid())
            pending.wait();
        if (owns_lock)
        {
            std::error_code error;
            fs::remove_all(lock, error);
        }
    }
    Snapshot local() const { return local_snapshot(crawl, build); }
    void archive(const std::string &reason, const Snapshot &value)
    {
        if (value.files.empty())
            return;
        const auto path = archives / (value.hash + ".pzsave");
        if (!fs::exists(path))
        {
            atomic_write(path, encode(value));
            atomic_write(path.u8string() + ".json", Json({{"when", now_ms()}, {"reason", reason}}).dump());
        }
        std::vector<fs::path> copies;
        for (const auto &entry : fs::directory_iterator(archives))
            if (entry.path().extension() == ".pzsave")
                copies.push_back(entry.path());
        std::sort(copies.begin(), copies.end(), [](const auto &a, const auto &b) {
            return fs::last_write_time(a) > fs::last_write_time(b);
        });
        for (size_t i = 10; i < copies.size(); ++i)
        {
            fs::remove(copies[i]);
            fs::remove(copies[i].u8string() + ".json");
        }
    }
    Json rpc(const std::string &name, Json args = Json::object(), bool credentials = true)
    {
        if (credentials)
        {
            if (account.is_null())
                throw std::runtime_error("Sign in before copying cloud saves.");
            args["p_id"] = account["id"]; args["p_password"] = account["loginKey"];
        }
        if (rpc_override)
            return rpc_override(name, args);
        const double remaining = deadline - now_ms();
        if (remaining < 1)
            throw std::runtime_error("Cloud request timed out. Local saves are preserved.");
        const auto endpoint = url + "/rest/v1/rpc/" + name, body = args.dump();
        auto handle = std::unique_ptr<CURL, decltype(&curl_easy_cleanup)>(curl_easy_init(), curl_easy_cleanup);
        if (!handle)
            throw std::runtime_error("Could not initialize HTTPS.");
        curl_slist *headers = nullptr;
        headers = curl_slist_append(headers, ("apikey: " + key).c_str());
        headers = curl_slist_append(headers, "Content-Type: application/json");
        std::unique_ptr<curl_slist, decltype(&curl_slist_free_all)> cleanup(headers, curl_slist_free_all);
        Bytes response;
        curl_easy_setopt(handle.get(), CURLOPT_URL, endpoint.c_str());
        curl_easy_setopt(handle.get(), CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(handle.get(), CURLOPT_POSTFIELDS, body.c_str());
        curl_easy_setopt(handle.get(), CURLOPT_POSTFIELDSIZE_LARGE, curl_off_t(body.size()));
        curl_easy_setopt(handle.get(), CURLOPT_NOSIGNAL, 1L);
        curl_easy_setopt(handle.get(), CURLOPT_CONNECTTIMEOUT_MS, 2000L);
        curl_easy_setopt(handle.get(), CURLOPT_TIMEOUT_MS, long(std::min(10000.0, remaining)));
        curl_easy_setopt(handle.get(), CURLOPT_SSL_VERIFYPEER, 1L);
        curl_easy_setopt(handle.get(), CURLOPT_SSL_VERIFYHOST, 2L);
        if (!ca_file.empty())
            curl_easy_setopt(handle.get(), CURLOPT_CAINFO, ca_file.c_str());
        curl_easy_setopt(handle.get(), CURLOPT_FOLLOWLOCATION, 0L);
        curl_easy_setopt(handle.get(), CURLOPT_WRITEFUNCTION, +[](char *data, size_t size, size_t count, void *context) -> size_t {
            auto &output = *static_cast<Bytes*>(context);
            const size_t bytes = size * count;
            if (bytes > 45 * 1024 * 1024 - output.size())
                return 0;
            output.append(data, bytes);
            return bytes;
        });
        curl_easy_setopt(handle.get(), CURLOPT_WRITEDATA, &response);
        const auto result = curl_easy_perform(handle.get());
        if (result != CURLE_OK)
            throw std::runtime_error("Cloud is unavailable. Local saves are preserved.");
        long status = 0;
        curl_easy_getinfo(handle.get(), CURLINFO_RESPONSE_CODE, &status);
        Json value = response.empty() ? Json(nullptr) : Json::parse(response);
        if (status < 200 || status >= 300 || (value.is_object() && value.contains("error")))
        {
            const auto error = value.is_object() ? value.value("message", value.value("error", std::string())) : std::string();
            if (error.find("HNS_SAVE_CHANGED") != std::string::npos)
                throw std::runtime_error("Cloud saves changed on another device. Both copies are kept; try again.");
            if (error.find("HNS_USERNAME_TAKEN") != std::string::npos)
                throw std::runtime_error("This username is already taken.");
            if (error.find("HNS_INVALID_CREDENTIALS") != std::string::npos || error.find("HNS_SIGN_IN_REQUIRED") != std::string::npos)
                throw std::runtime_error("Check your username and password, or sign in again. Local saves are kept.");
            throw std::runtime_error("Cloud request failed. Local saves are preserved.");
        }
        return value;
    }
    Bytes remote() { return decode64(rpc("hns_read_save").get<std::string>()); }
    fs::path base_path() const { return state / ("base-" + digest(url + ":" + account["id"].get<std::string>()) + ".pzsave"); }
    void require_compatible(const Snapshot &remote)
    {
        for (const auto &entry : remote.files)
            if (fs::u8path(entry.first).extension() == ".cs")
            {
                const auto path = state / "compat.cs";
                atomic_write(path, entry.second.data);
                bool valid = false;
                try { valid = compatible && compatible(path.u8string()); }
                catch (...) { fs::remove(path); throw; }
                fs::remove(path);
                if (!valid)
                {
                    phase = "incompatible";
                    throw std::runtime_error("This engine cannot read the cloud character. Local saves are preserved.");
                }
            }
    }
    void sync(bool push_only, const Snapshot *captured = nullptr, const std::string &direction = "")
    {
        if (account.is_null())
        {
            if (!direction.empty())
                throw std::runtime_error("Sign in before copying cloud saves.");
            return;
        }
        phase = "syncing";
        const auto left = captured ? *captured : local();
        const Bytes raw = remote();
        const auto right = decode(raw, true);
        std::unique_ptr<Snapshot> base;
        if (fs::exists(base_path()))
            base.reset(new Snapshot(decode(read(base_path()))));
        if (direction.empty() && raw.empty() && base && !base->files.empty())
            throw std::runtime_error("Previous cloud saves are missing. Local saves and recovery copies are kept.");
        if (push_only && (!base || base->hash != right.hash))
        {
            phase = "pending";
            message = "Another device changed cloud saves. Save and close this game before downloading.";
            return;
        }
        if (!push_only && direction != "upload")
            require_compatible(right);
        if (direction.empty() && left.hash == right.hash)
        {
            atomic_write(base_path(), encode(left));
            phase = "ready";
            message.clear();
            return;
        }
        archive("Before copy: local saves", left); archive("Before copy: cloud saves", right);
        Snapshot next;
        if (direction == "upload" || direction == "download")
        {
            next = direction == "upload" ? left : right;
            next.build = build;
            if (next.files.empty())
                throw std::runtime_error("There are no saves to copy.");
        }
        else
        {
            try { next = merge(base.get(), left, right); }
            catch (...) { phase = "conflict"; throw; }
        }
        if (digest(remote()) != digest(raw))
            throw std::runtime_error("Cloud changed on another device. Both copies are kept; try again.");
        if (direction != "download" && (next.hash != right.hash || next.build != right.build))
        {
            rpc("hns_write_save", {{"p_data", encode64(encode(next))}, {"p_expected", digest(raw)}});
            if (decode(remote()).hash != next.hash)
                throw std::runtime_error("Cloud write could not be verified. Recovery copies are kept.");
        }
        if (!push_only && next.hash != left.hash)
            replace_files(root, next);
        atomic_write(base_path(), encode(next));
        phase = "ready"; message.clear();
    }
    void sync_safely(bool push_only, const Snapshot *captured = nullptr)
    {
        try { sync(push_only, captured); }
        catch (const std::exception &error)
        {
            if (phase == "syncing") phase = "error";
            message = safe_error(error);
        }
    }
    void join()
    {
        if (pending.valid())
            pending.get();
    }
};

Backend::Backend(fs::path profile, std::string build, Rpc rpc, Json project)
    : impl(new Impl(std::move(profile), std::move(build), std::move(rpc), project)) {}
Backend::~Backend() = default;
const fs::path &Backend::home() const { return impl->root; }
void Backend::start(std::function<bool(const std::string&)> compatible)
{
    impl->compatible = std::move(compatible);
    impl->deadline = now_ms() + 4000;
    impl->sync_safely(false);
}
bool Backend::checkpoint_due(bool background)
{
    if (impl->account.is_null() || impl->finished)
        return false;
    if (impl->pending.valid() && impl->pending.wait_for(std::chrono::seconds(0)) != std::future_status::ready)
        return false;
    impl->join();
    return background || now_ms() >= impl->next_checkpoint;
}
void Backend::saved()
{
    if (impl->account.is_null() || impl->finished)
        return;
    if (impl->pending.valid() && impl->pending.wait_for(std::chrono::seconds(0)) != std::future_status::ready)
        return;
    impl->join();
    auto captured = impl->local();
    impl->next_checkpoint = now_ms() + 60000;
    impl->pending = std::async(std::launch::async, [this, captured]() {
        impl->deadline = now_ms() + 8000;
        impl->sync_safely(true, &captured);
    });
}
void Backend::finish()
{
    if (impl->finished)
        return;
    impl->join();
    impl->deadline = now_ms() + 8000;
    impl->sync_safely(false);
    impl->finished = true;
}

Json Backend::action(const std::string &kind, const Json &values)
{
    impl->join();
    impl->deadline = now_ms() + 15000;
    try
    {
        if (kind == "file-start")
        {
#ifdef _WIN32
            const auto *home = _wgetenv(L"USERPROFILE");
            fs::path path = home ? fs::path(home) : fs::current_path();
#else
            const auto *home = getenv("HOME");
            fs::path path = home ? fs::u8path(home) : fs::current_path();
#endif
            if (fs::is_directory(path / "Downloads"))
                path /= "Downloads";
            return {{"ok", true}, {"path", path.generic_u8string()}};
        }
        const auto rc_path = impl->crawl / "init.txt";
        const auto rc = [&]() { return fs::exists(rc_path) ? read(rc_path, 4 * 1024 * 1024) : Bytes(); };
        if (kind == "rc-get") { auto result = ok(); result["text"] = rc(); return result; }
        if (kind == "rc-save")
        {
            const auto text = values.at("text").get<std::string>();
            if (text.size() > 4 * 1024 * 1024) throw std::runtime_error("Options file exceeds 4 MiB.");
            atomic_write(rc_path, text); return ok("Options saved.");
        }
        if (kind == "loot-get" || kind == "loot-save")
        {
            const std::vector<std::string> keys = {"hns_floor_item_rate", "hns_item_quality", "hns_item_min_level",
                "hns_good_item_chance", "hns_randart_chance", "hns_gold_amount", "hns_consumable_amount"};
            const int defaults[] = {300, 200, 0, 0, 0, 100, 100}, maximum[] = {1000, 1000, 50, 100, 100, 1000, 1000};
            auto settings = Json::object();
            for (size_t i = 0; i < keys.size(); ++i) settings[keys[i]] = defaults[i];
            std::istringstream stream(rc()); std::string line; bool lua = false;
            const std::regex assignment("\\s*(hns_\\w+)\\s*=\\s*([+-]?[0-9]+)\\s*(?:#.*)?");
            while (std::getline(stream, line))
            {
                if (std::regex_match(line, std::regex("\\s*(?:lua\\s*=\\s*)?\\{\\s*"))) { lua = true; continue; }
                if (lua) { if (std::regex_match(line, std::regex("\\s*}\\s*"))) lua = false; continue; }
                std::smatch match;
                if (std::regex_match(line, match, assignment))
                    for (size_t i = 0; i < keys.size(); ++i)
                        if (match[1] == keys[i])
                        {
                            const double value = std::stod(match[2]);
                            if (value >= (i >= 5 ? 1 : 0) && value <= maximum[i]) settings[keys[i]] = int(value);
                        }
            }
            if (kind == "loot-get") { auto result = ok(); result["values"] = settings; return result; }
            for (size_t i = 0; i < keys.size(); ++i)
                if (!values.contains(keys[i]) || !values[keys[i]].is_number_integer()
                    || values[keys[i]].get<int64_t>() < (i >= 5 ? 1 : 0) || values[keys[i]].get<int64_t>() > maximum[i])
                {
                    throw std::runtime_error("Invalid drop settings.");
                }
            const std::string begin = "# BEGIN HNS LOOT SETTINGS", end = "# END HNS LOOT SETTINGS";
            Bytes kept; std::istringstream old(rc()); bool block = false;
            while (std::getline(old, line))
            {
                if (line == begin || line == begin + "\r") { block = true; continue; }
                if (block && (line == end || line == end + "\r")) { block = false; continue; }
                if (!block) kept += line + "\n";
            }
            if (block) throw std::runtime_error("Incomplete drop settings block. Original options are preserved.");
            kept += begin + "\n";
            for (const auto &key : keys) kept += key + " = " + std::to_string(values[key].get<int>()) + "\n";
            atomic_write(rc_path, kept + end + "\n");
            return ok("Drop settings saved. They apply when you start or resume a game.");
        }
        if (kind == "cloud-status")
        {
            auto result = ok(); result["account"] = impl->account.is_null() ? Json("") : impl->account["username"];
            result["status"] = impl->account.is_null() ? "Sign in to enable automatic cloud saves."
                : impl->phase == "ready" ? "Automatic cloud saves: up to date"
                : impl->phase == "conflict" ? "Both copies are kept. Choose a direction below."
                : impl->message.empty() ? "Automatic cloud saves: waiting for a connection" : impl->message;
            result["canUnlock"] = false; result["archives"] = Json::array();
            std::vector<std::pair<double, fs::path>> entries;
            for (const auto &entry : fs::directory_iterator(impl->archives))
                if (entry.path().extension() == ".pzsave" && fs::exists(entry.path().u8string() + ".json"))
                    entries.emplace_back(Json::parse(read(entry.path().u8string() + ".json")).value("when", 0.0), entry.path());
            std::sort(entries.rbegin(), entries.rend());
            for (const auto &entry : entries)
            {
                const auto metadata = Json::parse(read(entry.second.u8string() + ".json"));
                result["archives"].push_back({{"id", entry.second.stem().u8string()}, {"title", metadata.value("reason", "Previous copy")}});
            }
            return result;
        }
        if (kind == "cloud-login" || kind == "cloud-signup")
        {
            auto name = values.at("username").get<std::string>();
            const auto password = values.at("password").get<std::string>();
            const auto first = name.find_first_not_of(" \t\r\n"), last = name.find_last_not_of(" \t\r\n");
            name = first == name.npos ? "" : name.substr(first, last - first + 1);
            std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) { return char(std::tolower(c)); });
            if (!std::regex_match(name, std::regex("[a-z0-9_]{3,32}"))) throw std::runtime_error("Use 3-32 letters, digits or _ for the username.");
            size_t password_units = 0;
            for (unsigned char c : password)
                if ((c & 192) != 128) password_units += c >= 240 ? 2 : 1;
            if (password_units < 6)
                throw std::runtime_error("Use at least 6 characters for the password.");
            const auto login_key = digest(Bytes("DCSS-HNS-login-v1") + '\0' + name + '\0' + password);
            if (impl->rpc(kind == "cloud-login" ? "hns_login" : "hns_signup", {{"p_id", name}, {"p_password", login_key}}, false) != name)
                throw std::runtime_error("Account could not be verified.");
            impl->account = {{"id", name}, {"username", name}, {"loginKey", login_key}};
            atomic_write(impl->state / "account.json", impl->account.dump());
            impl->sync_safely(false);
            auto result = ok(); result["reload"] = true; return result;
        }
        if (kind == "cloud-logout")
        {
            atomic_write(impl->state / "account.json", "null"); impl->account = nullptr; impl->phase = "off";
            return ok("Signed out. Local saves are kept.");
        }
        if (kind == "cloud-upload" || kind == "cloud-download")
        {
            impl->sync(false, nullptr, kind == "cloud-upload" ? "upload" : "download");
            auto result = ok(kind == "cloud-upload" ? "Local -> Cloud complete." : "Cloud -> Local complete.");
            result["reload"] = kind == "cloud-download"; return result;
        }
        if (kind == "cloud-export" || kind == "cloud-restore")
        {
            const auto id = values.at("id").get<std::string>();
            if (!std::regex_match(id, std::regex("[a-f0-9]{64}"))) throw std::runtime_error("Invalid recovery copy.");
            const auto saved = decode(read(impl->archives / (id + ".pzsave")));
            impl->require_compatible(saved);
            if (kind == "cloud-restore")
            {
                impl->archive("Before restoring previous copy", impl->local()); replace_files(impl->root, saved);
                auto result = ok("Recovery copy restored."); result["reload"] = true; return result;
            }
            if (!values.contains("path")) return {{"ok", true}, {"chooseFile", "save"}, {"filename", "dcss-hns-recovery.pzsave"}};
            atomic_write(fs::u8path(values.at("path").get<std::string>()), encode(saved)); return ok("Recovery copy exported.");
        }
        if (kind == "backup-import" || kind == "backup-export")
        {
            const bool importing = kind == "backup-import";
            if (!values.contains("path")) return {{"ok", true}, {"chooseFile", importing ? "open" : "save"}, {"filename", "dcss-hns-backup.pzsave"}};
            const auto path = fs::u8path(values.at("path").get<std::string>());
            if (!importing) { atomic_write(path, encode(impl->local())); return ok("Save backup exported."); }
            const auto incoming = decode(read(path)); impl->require_compatible(incoming);
            auto files = impl->local().files;
            for (const auto &entry : incoming.files) files[entry.first] = entry.second;
            std::vector<File> merged;
            for (const auto &entry : files) merged.push_back(entry.second);
            impl->archive("Before importing a backup", impl->local()); replace_files(impl->root, snapshot(merged, impl->build));
            auto result = ok("Save backup imported."); result["reload"] = true; return result;
        }
        const auto logfile = impl->crawl / "saves/logfile";
        if (kind == "records")
        {
            auto result = ok(); result["items"] = Json::array();
            std::vector<Json> rows;
            if (fs::exists(logfile))
            {
                std::istringstream stream(read(logfile)); std::string line;
                while (std::getline(stream, line)) if (!line.empty()) rows.push_back(xlog(line));
            }
            std::stable_sort(rows.begin(), rows.end(), [&](const auto &a, const auto &b) {
                if (values.value("sort", "recent") == "score")
                    return std::strtoll(a.value("sc", "0").c_str(), nullptr, 10) > std::strtoll(b.value("sc", "0").c_str(), nullptr, 10);
                return a.value("end", "") > b.value("end", "");
            });
            for (const auto &row : rows)
            {
                result["items"].push_back({{"id", row.dump()}, {"title", row.value("name", "?") + " · " + row.value("char", "")
                    + " · " + row.value("sc", "0") + " points · " + row.value("end", "")}});
            }
            return result;
        }
        if (kind == "record-detail" || kind == "record-export" || kind == "record-delete")
        {
            const auto wanted = Json::parse(values.at("id").get<std::string>());
            std::istringstream stream(fs::exists(logfile) ? read(logfile) : Bytes());
            std::string line, remaining; bool found = false;
            while (std::getline(stream, line))
                if (!found && xlog(line) == wanted) found = true;
                else remaining += line + "\n";
            if (!found) throw std::runtime_error("Record not found.");
            const auto filename = morgue_name(wanted);
            const auto path = impl->crawl / "morgue" / fs::u8path(filename);
            if (kind == "record-delete")
            {
                impl->archive("Before removing a record", impl->local()); atomic_write(logfile, remaining);
                if (!filename.empty())
                    for (const auto *suffix : {".txt", ".lst", ".doll.png"})
                        fs::remove(impl->crawl / "morgue" / fs::u8path(filename.substr(0, filename.size() - 4) + suffix));
                auto result = ok("Record removed."); result["reload"] = true; return result;
            }
            const auto text = filename.empty() || !fs::exists(path) ? Bytes("No morgue file is available.") : read(path);
            if (kind == "record-export")
            {
                if (filename.empty() || !fs::exists(path)) return ok("No morgue file is available.");
                if (!values.contains("path")) return {{"ok", true}, {"chooseFile", "save"}, {"filename", filename}};
                atomic_write(fs::u8path(values.at("path").get<std::string>()), text); return ok("Morgue exported.");
            }
            auto result = ok(); result["title"] = filename; result["text"] = text; return result;
        }
        throw std::runtime_error("Unknown in-game action.");
    }
    catch (const std::exception &error)
    {
        if (impl->phase == "syncing") impl->phase = "error";
        impl->message = safe_error(error);
        return {{"ok", false}, {"message", impl->message}};
    }
}
}
