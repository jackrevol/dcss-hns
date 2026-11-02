#include "catch_amalgamated.hpp"

#include "AppHdr.h"

#include "game-options.h"
#include "options.h"
#include "player.h"
#include "test_player_fixture.h"
#include "unwind.h"

TEST_CASE("HNS experience RC option defaults to 1x and validates its range", "[hns]")
{
    game_options settings;
    REQUIRE(settings.hns_experience_rate == 100);
    GameOption *rate = settings.option_from_name("hns_experience_rate");
    REQUIRE(rate);
    for (const int percent : {0, 1, 250, 1000})
    {
        REQUIRE(rate->loadFromString(to_string(percent), RCFILE_LINE_EQUALS).empty());
        REQUIRE(settings.hns_experience_rate == percent);
    }
    for (const string value : {"-1", "1001", "1.5"})
    {
        REQUIRE_FALSE(rate->loadFromString(value, RCFILE_LINE_EQUALS).empty());
        REQUIRE(settings.hns_experience_rate == 1000);
    }
}

TEST_CASE_METHOD(MockPlayerYouTestsFixture,
                 "HNS experience scales awards once before pooling", "[hns]")
{
    const auto sample = GENERATE(table<int, int, int>({
        {0, 100, 0}, {1, 100, 1}, {50, 100, 50}, {100, 100, 100},
        {250, 100, 250}, {1000, 100, 1000}, {150, 3, 5}, {1000, 0, 0}
    }));
    unwind_var<int> rate(Options.hns_experience_rate, get<0>(sample));
    you.experience_pool = 0;
    REQUIRE(gain_exp(get<1>(sample)) == unsigned(get<2>(sample)));
    REQUIRE(you.experience_pool == get<2>(sample));
    REQUIRE(gain_exp(get<1>(sample)) == unsigned(get<2>(sample)));
    REQUIRE(you.experience_pool == 2 * get<2>(sample));
}

TEST_CASE_METHOD(MockPlayerYouTestsFixture,
                 "HNS experience feeds both XL experience and skill training", "[hns]")
{
    unwind_var<int> rate(Options.hns_experience_rate, 200);
    const unsigned int before = you.experience;
    const unsigned int skill_before = you.total_experience + you.exp_available;
    you.experience_pool = 0;
    // Stay below XL 2 so the headless fixture does not open a level-up prompt.
    REQUIRE(gain_exp(3) == 6);
    apply_exp();
    REQUIRE(you.experience == before + 6);
    REQUIRE(you.total_experience + you.exp_available == skill_before + 60);
    REQUIRE(you.experience_pool == 0);
    apply_exp();
    REQUIRE(you.experience == before + 6);
}

TEST_CASE_METHOD(MockPlayerYouTestsFixture,
                 "HNS experience caps large awards and accumulated XP safely", "[hns]")
{
    unwind_var<int> rate(Options.hns_experience_rate, 1000);
    you.experience = 0;
    you.experience_pool = 0;
    REQUIRE(gain_exp(UINT_MAX) == MAX_EXP_TOTAL);
    REQUIRE(you.experience_pool == MAX_EXP_TOTAL);
    gain_exp(UINT_MAX);
    REQUIRE(you.experience_pool == MAX_EXP_TOTAL);
    you.experience = MAX_EXP_TOTAL - 1;
    REQUIRE(gain_exp(1) == 1);
}
