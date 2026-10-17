#include "catch_amalgamated.hpp"

#include "AppHdr.h"

#include "files.h"
#include "hns-revival.h"
#include "package.h"
#include "random.h"
#include "tags.h"

TEST_CASE("HNS revival restores a complete persistent checkpoint", "[hns]")
{
    const string filename = "hns-revival-test.cs";
    REQUIRE_FALSE(file_exists(filename));
    const auto cleanup = [](package *save)
    {
        save->unlink();
        delete save;
    };
    std::unique_ptr<package, decltype(cleanup)> save(
        new package(filename.c_str(), true, true), cleanup);
    const auto put = [&](const string &name, const string &value)
    {
        chunk_writer output(save.get(), name);
        output.write(value.data(), value.size());
    };
    const auto get = [&](const string &name)
    {
        vector<char> data;
        chunk_reader input(save.get(), name);
        input.read_all(data);
        return string(data.begin(), data.end());
    };

    put("you", "alive, gold=10, rng=123");
    put("chr", "character");
    put("D:1", "sword on floor");
    put("D:2", "monster alive");
    put("empty", "");
    REQUIRE_FALSE(hns_has_checkpoint(*save));
    REQUIRE_FALSE(hns_restore_checkpoint(*save));
    REQUIRE(get("you") == "alive, gold=10, rng=123");

    hns_write_checkpoint(*save);
    REQUIRE(hns_has_checkpoint(*save));
    put("you", "dead, gold=99, rng=456");
    put("D:1", "sword taken");
    put("D:2", "monster killed");
    put("D:3", "newly generated level");

    // 저장 후 다시 열어도 복귀 지점과 이후 진행 상태가 모두 남습니다.
    save->commit();
    delete save.release();
    save.reset(new package(filename.c_str(), true));
    REQUIRE(get("you") == "dead, gold=99, rng=456");
    REQUIRE(hns_restore_checkpoint(*save));
    REQUIRE(get("you") == "alive, gold=10, rng=123");
    REQUIRE(get("D:1") == "sword on floor");
    REQUIRE(get("D:2") == "monster alive");
    REQUIRE_FALSE(save->has_chunk("D:3"));
    REQUIRE(get("empty").empty());

    // 복귀 횟수를 소모하지 않으며 새 층 진입 시 이전 지점을 대체합니다.
    put("you", "dead again");
    REQUIRE(hns_restore_checkpoint(*save));
    REQUIRE(get("you") == "alive, gold=10, rng=123");
    put("you", "next level entry");
    save->delete_chunk("D:1");
    hns_write_checkpoint(*save);
    put("you", "dead on next level");
    REQUIRE(hns_restore_checkpoint(*save));
    REQUIRE(get("you") == "next level entry");
    REQUIRE_FALSE(save->has_chunk("D:1"));
    REQUIRE_FALSE(save->has_chunk("hns-revival/D:1"));
    REQUIRE_FALSE(save->has_chunk("hns-revival/hns-revival/you"));
}

TEST_CASE( "Test save version reading/writing works", "[single-file]" ) {

    SECTION ("Major version is stored as a single unsigned byte") {

        SECTION ("reading") {
            vector<unsigned char> input = { 0xff, 0x00, };
            auto r = reader(input);

            const auto version = get_save_version(r);

            REQUIRE(version.major == 255);
            REQUIRE(r.valid() == false);
        }

        SECTION ("writing") {
            vector<unsigned char> output;
            vector<unsigned char> expected_output = { 0xff, 0x00, };
            const auto version = save_version(255, 0);
            auto w = writer(&output);

            write_save_version(w, version);

            REQUIRE(output == expected_output);
        }
    }

    SECTION ("Minor version < 255 is stored as a single unsigned byte") {

        SECTION ("reading") {
            vector<unsigned char> input = { 0x00, 0xfe, };
            auto r = reader(input);

            const auto version = get_save_version(r);

            REQUIRE(version.minor == 254);
            REQUIRE(r.valid() == false);
        }

        SECTION ("writing") {
            vector<unsigned char> output;
            vector<unsigned char> expected_output = { 0x00, 0xfe, };
            const auto version = save_version(0, 254);
            auto w = writer(&output);

            write_save_version(w, version);

            REQUIRE(output == expected_output);
        }
    }

    SECTION ("Minor version >= 255 is stored as a big-endian 4-byte integer") {

        SECTION ("reading") {
            vector<unsigned char> input = { 0x00, 0xff, 0x01, 0x02, 0x03, 0x04 };
            auto r = reader(input);
            const auto expected_minor = (1 << 24) + (2 << 16) + (3 << 8) + 4;

            const auto version = get_save_version(r);

            REQUIRE(version.minor == expected_minor);
            REQUIRE(r.valid() == false);
        }

        SECTION ("writing") {
            vector<unsigned char> output;
            vector<unsigned char> expected_output = { 0x00, 0xff, 0x01, 0x02, 0x03, 0x04 };
            const auto version = save_version(0, (1 << 24) + (2 << 16) + (3 << 8) + 4);
            auto w = writer(&output);

            write_save_version(w, version);

            REQUIRE(output == expected_output);
        }
    }

    SECTION ("Saving and loading is a reversible operation") {
        rng::subgenerator subgen(0, 0);

        for (auto i = 0; i < 1000; i++)
        {
            const auto version = save_version(random2(255), random2(1000));

            vector<unsigned char> buf;
            auto w = writer(&buf);
            write_save_version(w, version);

            auto r = reader(buf);
            const auto roundtrip_version = get_save_version(r);

            REQUIRE(version == roundtrip_version);
            REQUIRE(r.valid() == false);
        }
    }
}
