// Local-only, dependency-light regression tests for the standalone SDL backend.
#include "../hns-native-core.h"
#include <cassert>
#include <iostream>
#include <random>
#include <stdexcept>

using namespace hns;
template<class F> void rejects(F action)
{
    bool rejected = false;
    try { action(); } catch (...) { rejected = true; }
    assert(rejected);
}
static Bytes fixed(uint64_t number, unsigned size)
{
    Bytes value;
    while (size--) { value += char(number & 255); number >>= 8; }
    return value;
}
static Bytes varint(uint64_t number)
{
    Bytes value;
    do { const auto byte = number & 127; number >>= 7; value += char(byte | (number ? 128 : 0)); } while (number);
    return value;
}
static Bytes sized(const Bytes &bytes) { return varint(bytes.size()) + bytes; }
static uint32_t crc(const Bytes &bytes)
{
    uint32_t value = ~0u;
    for (uint8_t byte : bytes)
    {
        value ^= byte;
        for (int i = 0; i < 8; ++i) value = (value >> 1) ^ (0x82f63b78u & (0u - (value & 1)));
    }
    value = ~value;
    return ((value >> 15) | (value << 17)) + 0xa282ead8u;
}
static Bytes log_record(const Bytes &data)
{
    const Bytes payload = Bytes(1, 1) + data;
    return fixed(crc(payload), 4) + fixed(data.size(), 2) + payload;
}
static Bytes block(const Bytes &data)
{
    return data + '\0' + fixed(crc(data + '\0'), 4);
}
static Bytes snappy_literal(const Bytes &data)
{
    const auto length = data.size() - 1;
    return length < 60 ? Bytes(1, char(length << 2)) + data
        : Bytes(1, char(61 << 2)) + fixed(length, 2) + data;
}
int main(int argc, char **argv)
{
    const auto temporary = fs::temp_directory_path() / ("hns-native-test-" + std::to_string(std::random_device()()));
    fs::create_directories(temporary);
    try
    {
        if (argc == 3 && std::string(argv[1]) == "--legacy")
        {
            const auto account = Json::parse(legacy_login(fs::u8path(argv[2]), "https://xviinjuhtvzgalqupddc.supabase.co"));
            assert(account["id"] == "native_test" && account["loginKey"] == std::string(64, 'a'));
            std::cout << "PASS: real Chromium localStorage login migration\n";
            fs::remove_all(temporary); return 0;
        }
        if (argc == 4 && std::string(argv[1]) == "--roundtrip")
        {
            const auto pack = decode(read(fs::u8path(argv[2])));
            atomic_write(fs::u8path(argv[3]), encode(pack));
            std::cout << "PASS: existing backup decoded and re-encoded\n";
            fs::remove_all(temporary); return 0;
        }
        assert(digest("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        const auto original = snapshot({{"/crawl/saves/hero.cs", 1000, "valid save"}, {"/crawl/init.txt", 2000, "options"}}, "old-build");
        assert(decode(encode(original)).hash == original.hash);
        assert(from_base64(to_base64(encode(original))) == encode(original));
        assert(from_base64(" \n" + to_base64(encode(original)) + "\r\n") == encode(original));
        rejects([] { snapshot({{"/crawl/../outside", 1, "x"}}); });
        rejects([] { snapshot({{"/crawl/C:/outside", 1, "x"}}); });
        rejects([] { snapshot({{"/crawl/saves/db/cache", 1, "x"}}); });
        rejects([] { snapshot({{"/crawl/saves/a.cs", 1, "a"}, {"/crawl/saves/a.cs", 2, "b"}}); });
        rejects([&] { decode(encode(original).substr(0, 14)); });
        const auto malformed_pack = [](const Json &manifest, const Bytes &data) {
            const auto header = manifest.dump();
            return Bytes("PZSAVE1\n") + fixed(header.size(), 4) + header + data;
        };
        Json oversized = {{"files", Json::array()}};
        for (int i = 0; i < 33; ++i)
            oversized["files"].push_back({{"path", "/crawl/file" + std::to_string(i)}, {"offset", 0u}, {"size", 1024u * 1024u}});
        rejects([&] { decode(malformed_pack(oversized, Bytes(1024 * 1024, 'a'))); });
        Json nested = Json::object();
        for (int i = 0; i < 20; ++i)
            nested = {{"nested", nested}};
        rejects([&] { decode(malformed_pack(nested, "")); });
        const auto newer = snapshot({{"/crawl/saves/hero.cs", 3000, "valid newer"}, {"/crawl/init.txt", 2000, "options"}}, "new-build");
        assert(merge(nullptr, original, newer).files.at("/crawl/saves/hero.cs").data == "valid newer");
        const auto tied = snapshot({{"/crawl/saves/hero.cs", 1000, "other"}, {"/crawl/init.txt", 2000, "options"}});
        rejects([&] { merge(nullptr, original, tied); });
        rejects([&] { merge(&original, snapshot({}), newer); });
        const auto home = temporary / "replace";
        fs::create_directories(home / "crawl/saves/db");
        atomic_write(home / "crawl/saves/db/open", "database");
        replace_files(home, original);
        assert(read(home / "crawl/saves/db/open") == "database");
        assert(local_snapshot(home / "crawl", "old-build").hash == original.hash);
        assert(std::abs(local_snapshot(home / "crawl", "old-build").files.at("/crawl/saves/hero.cs").mtime - 1000) < 1);
        assert(fs::exists(home / "crawl.previous"));
#ifndef _WIN32
        fs::create_symlink(home / "crawl/init.txt", home / "crawl/escape");
        rejects([&] { local_snapshot(home / "crawl", "build"); });
        fs::remove(home / "crawl/escape");
#endif
        std::cout << "PASS: backup codec, SHA-256, size/path guards, latest merge, deletions, atomic replacement, cache and timestamp preservation\n";

        const auto db = temporary / "legacy";
        const std::string url = "https://xviinjuhtvzgalqupddc.supabase.co";
        const Bytes key = "_https://appassets.dcsshns.invalid" + Bytes(1, '\0') + Bytes(1, '\1') + "hns-cloud-login:" + url;
        const Bytes login = Json({{"id", "native_test"}, {"username", "native_test"}, {"loginKey", std::string(64, 'a')}}).dump();
        atomic_write(db / "CURRENT", "MANIFEST-000001\n");
        atomic_write(db / "MANIFEST-000001", log_record(varint(2) + varint(2)));
        atomic_write(db / "000002.log", log_record(fixed(10, 8) + fixed(1, 4) + '\1' + sized(key) + sized(Bytes(1, 1) + login)));
        assert(legacy_login(db, url) == login);
        assert(legacy_login(db, "https://other.invalid").empty());
        atomic_write(db / "000002.log", log_record(fixed(11, 8) + fixed(1, 4) + '\0' + sized(key)));
        assert(legacy_login(db, url).empty());
        // A table with a higher sequence must still be ignored unless live in MANIFEST.
        const Bytes internal = key + fixed((20 << 8) | 1, 8);
        const Bytes data = varint(0) + varint(internal.size()) + varint(login.size() + 1) + internal + '\1' + login + fixed(0, 4) + fixed(1, 4);
        Bytes table = block(data);
        const Bytes handle = varint(0) + varint(data.size());
        const Bytes index = varint(0) + varint(internal.size()) + varint(handle.size()) + internal + handle + fixed(0, 4) + fixed(1, 4);
        const Bytes index_handle = varint(table.size()) + varint(index.size());
        table += block(index);
        Bytes footer = varint(0) + varint(0) + index_handle;
        footer.resize(40, '\0');
        table += footer + fixed(0xdb4775248b80fb57ULL, 8);
        atomic_write(db / "000003.ldb", table);
        assert(legacy_login(db, url).empty());
        const Bytes added = varint(7) + varint(0) + varint(3) + varint(table.size()) + sized(internal) + sized(internal);
        atomic_write(db / "MANIFEST-000001", log_record(varint(2) + varint(2) + added));
        assert(legacy_login(db, url) == login);
        // A compressed table exercises all three Snappy copy tags, including
        // overlapping backreferences, as Chromium's compacted tables do.
        const auto repeated = data.find(std::string(64, 'a'));
        assert(repeated != data.npos);
        const Bytes compressed = varint(data.size()) + snappy_literal(data.substr(0, repeated + 1))
            + char((6 << 2) | 1) + fixed(1, 1)
            + char((23 << 2) | 2) + fixed(1, 2)
            + char((28 << 2) | 3) + fixed(1, 4)
            + snappy_literal(data.substr(repeated + 64));
        Bytes compressed_table = compressed + '\1' + fixed(crc(compressed + '\1'), 4);
        const Bytes compressed_handle = varint(0) + varint(compressed.size());
        const Bytes compressed_index = varint(0) + varint(internal.size()) + varint(compressed_handle.size())
            + internal + compressed_handle + fixed(0, 4) + fixed(1, 4);
        Bytes compressed_footer = varint(0) + varint(0) + varint(compressed_table.size()) + varint(compressed_index.size());
        compressed_table += block(compressed_index);
        compressed_footer.resize(40, '\0');
        compressed_table += compressed_footer + fixed(0xdb4775248b80fb57ULL, 8);
        atomic_write(db / "000003.ldb", compressed_table);
        assert(legacy_login(db, url) == login);
        atomic_write(db / "MANIFEST-000001", log_record(varint(2) + varint(2) + added + varint(6) + varint(0) + varint(3)));
        assert(legacy_login(db, url).empty());
        std::cout << "PASS: live WAL/SST login migration, exact origin, logout tombstones and obsolete-file rejection\n";

        Bytes remote;
        int writes = 0;
        bool fail_network = false, race = false;
        const auto rpc = [&](const std::string &name, const Json &args) -> Json {
            if (fail_network) throw std::runtime_error("Network unavailable");
            assert(args.at("p_id") == "native_test");
            assert(args.at("p_password").get<std::string>().size() == 64);
            if (name == "hns_login" || name == "hns_signup") return "native_test";
            if (name == "hns_read_save") return to_base64(remote);
            if (name == "hns_write_save")
            {
                if (race || args.at("p_expected") != digest(remote)) throw std::runtime_error("Cloud changed");
                remote = from_base64(args.at("p_data")); ++writes; return nullptr;
            }
            throw std::runtime_error("Unknown RPC");
        };
        const auto profile = temporary / "profile";
        fs::create_directories(profile / "native/crawl");
        replace_files(profile / "native", original);
        {
            Backend backend(profile, "native-build", rpc);
            backend.start([](const std::string &path) { return read(fs::u8path(path)).rfind("valid", 0) == 0; });
            assert(backend.action("cloud-login", {{"username", " Native_Test "}, {"password", "secret123"}})["ok"] == true);
            assert(decode(remote).hash == original.hash && writes == 1);
            const auto uploaded = remote;
            assert(backend.action("cloud-status")["account"] == "native_test");
            rejects([&] { Backend duplicate(profile, "build", rpc); });
            assert(backend.action("rc-save", {{"text", "hns_floor_item_rate = 450\n"}})["ok"] == true);
            backend.saved();
            assert(backend.action("cloud-status")["ok"] == true); // joins background upload
            assert(writes == 2 && remote != uploaded);
            const auto incoming = snapshot({{"/crawl/saves/hero.cs", 9000, "valid remote"}, {"/crawl/cloud-only.txt", 1000, "remote"}}, "other-platform");
            remote = encode(incoming);
            backend.saved(); backend.action("cloud-status");
            assert(read(profile / "native/crawl/saves/hero.cs") == "valid save");
            assert(decode(remote).hash == incoming.hash && writes == 2); // never download/overwrite another device while playing
            assert(backend.action("cloud-download")["ok"] == true);
            assert(read(profile / "native/crawl/saves/hero.cs") == "valid remote");
            assert(!fs::exists(profile / "native/crawl/init.txt")); // directional replacement removes local-only files
            const auto before = local_snapshot(profile / "native/crawl", "native-build").hash;
            remote = encode(snapshot({{"/crawl/saves/hero.cs", 10000, "invalid"}}, "future"));
            assert(backend.action("cloud-download")["ok"] == false);
            assert(local_snapshot(profile / "native/crawl", "native-build").hash == before);
            remote = encode(incoming); race = true;
            backend.action("rc-save", {{"text", "new local"}});
            assert(backend.action("cloud-upload")["ok"] == false);
            assert(decode(remote).hash == incoming.hash);
            race = false; fail_network = true;
            assert(backend.action("cloud-upload")["ok"] == false);
            assert(read(profile / "native/crawl/init.txt") == "new local");
            fail_network = false;
            assert(backend.action("cloud-status")["archives"].size() >= 2);
            assert(backend.action("cloud-restore", {{"id", "../outside"}})["ok"] == false);
            assert(backend.action("cloud-logout")["ok"] == true);
            backend.finish();
        }
        {
            Backend reopened(profile, "native-build", rpc);
            assert(reopened.action("cloud-status")["account"] == "");
            assert(read(profile / "native/crawl/init.txt") == "new local");
        }
        std::cout << "PASS: login, automatic upload, background upload, push-only protection, directional replacement, compatibility rejection, CAS races, offline preservation, recovery archives, locks, logout and reopen\n";
        {
            const auto recovery_profile = temporary / "death-recovery";
            const auto crawl = recovery_profile / "native/crawl";
            atomic_write(crawl / "saves/recovery/Hero.cs", "valid checkpoint");
            atomic_write(crawl / "saves/recovery/Hero.json",
                Json({{"name", "Hero"}, {"when", now_ms()}, {"checkpoint", true}}).dump());
            atomic_write(crawl / "init.txt", "keep options");
            atomic_write(crawl / "saves/Other.cs", "valid other character");
            atomic_write(crawl / "saves/logfile", "keep death history\n");
            Backend backend(recovery_profile, "native-build", rpc);
            backend.start([](const std::string &path) { return read(fs::u8path(path)).rfind("valid", 0) == 0; });
            auto copies = backend.action("death-recoveries")["items"];
            assert(copies.size() == 1 && copies[0]["name"] == "Hero" && copies[0]["available"] == true);
            assert(backend.action("death-restore", {{"id", copies[0]["id"]}})["ok"] == true);
            assert(read(crawl / "saves/Hero.cs") == "valid checkpoint");
            assert(read(crawl / "saves/recovery/Hero.cs") == "valid checkpoint");
            assert(read(crawl / "saves/Other.cs") == "valid other character");
            assert(read(crawl / "init.txt") == "keep options");
            assert(read(crawl / "saves/logfile") == "keep death history\n");
            assert(backend.action("death-restore", {{"id", copies[0]["id"]}})["ok"] == false);
            assert(backend.action("death-restore", {{"id", "checkpoint:../../outside"}})["ok"] == false);
            atomic_write(recovery_profile / "native/archives/old.pzsave",
                encode(snapshot({{"/crawl/saves/Old.cs", 1234, "valid old backup"}})));
            atomic_write(recovery_profile / "native/archives/broken.pzsave", "corrupt pack");
            atomic_write(crawl / "saves/recovery/Broken.json", "invalid json");
            copies = backend.action("death-recoveries")["items"];
            assert(copies.size() == 2);
            for (const auto &copy : copies)
                if (copy["name"] == "Old")
                    assert(backend.action("death-restore", {{"id", copy["id"]}})["ok"] == true);
            assert(read(crawl / "saves/Old.cs") == "valid old backup");
            fs::remove(crawl / "saves/Hero.cs");
            atomic_write(crawl / "saves/recovery/Hero.cs", "incompatible save");
            assert(backend.action("death-restore", {{"id", copies[0]["id"]}})["ok"] == false);
            assert(!fs::exists(crawl / "saves/Hero.cs"));
            backend.finish();
        }
        std::cout << "PASS: per-character death recovery, old automatic backups, overwrite protection, compatibility and corrupt-copy isolation\n";
        fs::remove_all(temporary);
        return 0;
    }
    catch (const std::exception &error)
    {
        std::cerr << "FAIL: " << error.what() << "\nTest data: " << temporary << '\n';
        return 1;
    }
}
