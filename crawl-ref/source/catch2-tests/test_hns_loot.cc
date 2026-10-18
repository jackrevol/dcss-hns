#include "catch_amalgamated.hpp"

#include "AppHdr.h"

#include "artefact.h"
#include "env.h"
#include "game-options.h"
#include "hns-loot.h"
#include "items.h"
#include "item-prop-enum.h"
#include "makeitem.h"
#include "options.h"
#include "test_player_fixture.h"
#include "unwind.h"

TEST_CASE("HNS loot scaling rounds and caps without overflow", "[hns]")
{
    REQUIRE(hns_scale_loot(17, 300, INT_MAX) == 51);
    REQUIRE(hns_scale_loot(17, 0, INT_MAX) == 0);
    REQUIRE(hns_scale_loot(3, 150, INT_MAX) == 5);
    REQUIRE(hns_scale_loot(INT_MAX, 1000, SHRT_MAX) == SHRT_MAX);
    REQUIRE(hns_scale_loot(-1, 300, INT_MAX) == 0);
}

TEST_CASE("HNS loot RC options retain defaults and reject unsafe values", "[hns]")
{
    game_options settings;
    REQUIRE(settings.hns_floor_item_rate == 300);
    REQUIRE(settings.hns_item_quality == 200);
    GameOption *rate = settings.option_from_name("hns_floor_item_rate");
    REQUIRE(rate);
    REQUIRE(rate->loadFromString("0", RCFILE_LINE_EQUALS).empty());
    REQUIRE(settings.hns_floor_item_rate == 0);
    REQUIRE_FALSE(rate->loadFromString("1001", RCFILE_LINE_EQUALS).empty());
    REQUIRE_FALSE(rate->loadFromString("-1", RCFILE_LINE_EQUALS).empty());
    REQUIRE(settings.hns_floor_item_rate == 0);
}

TEST_CASE_METHOD(MockPlayerYouTestsFixture,
                 "HNS loot settings affect only HNS-generated items", "[hns]")
{
    unwind_var<int> quality(Options.hns_item_quality, 1000);
    unwind_var<int> minimum(Options.hns_item_min_level, 20);
    unwind_var<int> good(Options.hns_good_item_chance, 100);
    unwind_var<int> randart(Options.hns_randart_chance, 100);
    unwind_var<int> gold(Options.hns_gold_amount, 200);
    unwind_var<int> consumable(Options.hns_consumable_amount, 300);

    REQUIRE(hns_loot_level(0) == 20);
    REQUIRE(hns_loot_level(100) == 50);
    const pair<object_class_type, int> eligible[] = {
        {OBJ_WEAPONS, WPN_LONG_SWORD}, {OBJ_ARMOUR, ARM_ROBE},
        {OBJ_JEWELLERY, RING_PROTECTION}, {OBJ_TALISMANS, TALISMAN_QUILL}
    };
    for (const auto &kind : eligible)
    {
        for (int i = 0; i < 30; ++i)
        {
            const int index = items(true, kind.first, kind.second, 0, 0,
                                    NO_AGENT, false, "", nullptr, nullptr, true);
            REQUIRE(index != NON_ITEM);
            REQUIRE(is_artefact(env.item[index]));
            destroy_item(index);
        }
    }
    const int regular = items(false, OBJ_WEAPONS, OBJ_RANDOM, 0);
    REQUIRE(regular != NON_ITEM);
    REQUIRE_FALSE(is_artefact(env.item[regular]));
    destroy_item(regular);

    for (const auto type : {OBJ_GOLD, OBJ_POTIONS, OBJ_SCROLLS, OBJ_MISSILES})
    {
        const int index = hns_create_loot(0, type);
        REQUIRE(index != NON_ITEM);
        const int multiplier = type == OBJ_GOLD ? 2 : 3;
        REQUIRE(env.item[index].quantity >= multiplier);
        REQUIRE(env.item[index].quantity % multiplier == 0);
        destroy_item(index);
    }
}
