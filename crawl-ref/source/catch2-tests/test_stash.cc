#include "catch_amalgamated.hpp"

#include "AppHdr.h"

#include "artefact.h"
#include "clua.h"
#include "initfile.h"
#include "item-status-flag-type.h"
#include "items.h"
#include "stash.h"
#include "test_player_fixture.h"
#include "unwind.h"

static item_def _equipment(object_class_type type, int subtype, int plus = 0)
{
    item_def item;
    item.base_type = type;
    item.sub_type = subtype;
    item.quantity = 1;
    item.plus = plus;
    item.flags |= ISFLAG_IDENTIFIED;
    return item;
}

TEST_CASE("Stash totals compare signed numbers and reject malformed queries",
          "[stash]")
{
    const string tags = "{res:3} {stat:-12} armour";
    for (const string query : {"res>=3", "res>2", "res=3", "res<=3", "res<4",
                               "res!=4", " RES >= +3 ", "stat<-2", "stat=-12"})
    {
        INFO(query);
        const item_total_pattern pattern(query);
        REQUIRE(pattern.valid());
        CHECK(pattern.matches(tags));
        CHECK_FALSE(pattern.matches("shop feature"));
    }
    CHECK_FALSE(item_total_pattern("res>3").matches(tags));
    CHECK_FALSE(item_total_pattern("stat>=0").matches(tags));
    CHECK_FALSE(item_total_pattern("res=1").matches("{res:10}"));
    CHECK_FALSE(item_total_pattern("res!=0").matches("unidentified armour"));
    CHECK(item_total_pattern("stat=0").matches("{stat:0}"));
    CHECK(item_total_pattern("stat=-2147483648").valid());
    for (const string query : {"res>=", "res>=word", "stat=1.5", "res=3junk",
                               "res=>3", "res=2147483648", "stat=-2147483649"})
    {
        INFO(query);
        CHECK_FALSE(item_total_pattern(query).valid());
    }
    CHECK_FALSE(item_total_pattern::is_total_pattern("resistance"));
    CHECK_FALSE(item_total_pattern::is_total_pattern("/res>=3"));
    CHECK_FALSE(item_total_pattern::is_total_pattern("=stat=6"));
}

TEST_CASE_METHOD(MockPlayerYouTestsFixture,
                 "Stash totals include equipment bases, egos and penalties",
                 "[stash]")
{
    CHECK(stash_item_totals(_equipment(OBJ_ARMOUR, ARM_FIRE_DRAGON_ARMOUR))
          == "{res:1} {stat:0} "); // rF++ and rC-
    CHECK(stash_item_totals(_equipment(OBJ_ARMOUR, ARM_GOLDEN_DRAGON_ARMOUR))
          == "{res:3} {stat:0} ");
    item_def armour = _equipment(OBJ_ARMOUR, ARM_ROBE);
    armour.brand = SPARM_RESISTANCE;
    CHECK(stash_item_totals(armour) == "{res:2} {stat:0} ");
    armour.brand = SPARM_GUILE;
    CHECK(stash_item_totals(armour) == "{res:-2} {stat:0} ");
    armour.brand = SPARM_STRENGTH;
    CHECK(stash_item_totals(armour) == "{res:0} {stat:3} ");
    CHECK(stash_item_totals(_equipment(OBJ_JEWELLERY, RING_WILLPOWER))
          == "{res:1} {stat:0} ");
    CHECK(stash_item_totals(_equipment(OBJ_JEWELLERY, RING_STRENGTH, 6))
          == "{res:0} {stat:6} ");
    CHECK(stash_item_totals(_equipment(OBJ_JEWELLERY, RING_DEXTERITY, -4))
          == "{res:0} {stat:-4} ");
    CHECK(stash_item_totals(_equipment(OBJ_STAVES, STAFF_AIR))
          == "{res:1} {stat:0} ");
    CHECK(stash_item_totals(_equipment(OBJ_WEAPONS, WPN_DAGGER, 9))
          == "{res:0} {stat:0} ");
    armour.flags &= ~ISFLAG_IDENTIFIED;
    CHECK(stash_item_totals(armour).empty());
    CHECK(stash_item_totals(_equipment(OBJ_POTIONS, POT_RESISTANCE)).empty());
}

TEST_CASE_METHOD(MockPlayerYouTestsFixture,
                 "Stash totals add artefact bonuses once and combine searches",
                 "[stash]")
{
    item_def armour = _equipment(OBJ_ARMOUR, ARM_FIRE_DRAGON_ARMOUR);
    REQUIRE(make_item_randart(armour, true));
    for (int prop = 0; prop < ARTP_NUM_PROPERTIES; ++prop)
        artefact_set_property(armour, static_cast<artefact_prop_type>(prop), 0);
    artefact_set_property(armour, ARTP_FIRE, 1);
    artefact_set_property(armour, ARTP_WILLPOWER, 2);
    artefact_set_property(armour, ARTP_RCORR, 1);
    artefact_set_property(armour, ARTP_STRENGTH, 6);
    artefact_set_property(armour, ARTP_INTELLIGENCE, -2);
    artefact_set_property(armour, ARTP_DEXTERITY, 3);
    CHECK(stash_item_totals(armour) == "{res:5} {stat:7} ");

    unwind_var<string> crawl_dir(SysEnv.crawl_dir, ".");
    clua.init_libraries();
    REQUIRE(clua.execfile("clua/stash.lua") == 0);
    const string annotation = stash_annotate_item(STASH_LUA_SEARCH_ANNOTATE,
                                                 &armour);
    CHECK(item_total_pattern("res>=5").matches(annotation));
    lua_text_pattern both("armour && res>=5 && stat>=7");
    REQUIRE(both.valid());
    CHECK(both.matches(annotation));
    CHECK_FALSE(both.matches("{res:4} {stat:7} {armour}"));
    lua_text_pattern either("res>=6 || stat=7");
    REQUIRE(either.valid());
    CHECK(either.matches(annotation));
    lua_text_pattern grouped("armour && <<res<0 || stat>=7>>");
    REQUIRE(grouped.valid());
    CHECK(grouped.matches(annotation));
    lua_text_pattern negated("armour && !!stat<0");
    REQUIRE(negated.valid());
    CHECK(negated.matches(annotation));

    ShopInfo shop;
    shop.shop.type = SHOP_ARMOUR;
    shop.shop.pos = coord_def(10, 10);
    shop.shop.stock.push_back(armour);
    CHECK(shop.matches_search("D:1", item_total_pattern("res>=5")).size() == 1);
    CHECK(shop.matches_search("D:1", both).size() == 1);
    CHECK(shop.matches_search("D:1", item_total_pattern("stat>=8")).empty());

    armour.flags &= ~ISFLAG_IDENTIFIED;
    CHECK(stash_item_totals(armour).empty());
}

TEST_CASE_METHOD(MockPlayerYouTestsFixture,
                 "Stash artefact totals preserve bases without duplicate rCorr",
                 "[stash]")
{
    const pair<object_class_type, int> bases[] = {
        {OBJ_STAVES, STAFF_AIR}, {OBJ_JEWELLERY, RING_STRENGTH},
        {OBJ_ARMOUR, ARM_ACID_DRAGON_ARMOUR}
    };
    for (const auto &base : bases)
    {
        item_def item = _equipment(base.first, base.second, 6);
        REQUIRE(make_item_randart(item, true));
        for (int prop = 0; prop < ARTP_NUM_PROPERTIES; ++prop)
            artefact_set_property(item, static_cast<artefact_prop_type>(prop), 0);
        artefact_set_property(item, ARTP_RCORR, 1);
        artefact_set_property(item, ARTP_STRENGTH, 3);
        artefact_set_property(item, ARTP_INTELLIGENCE, -1);
        const int res = base.first == OBJ_STAVES ? 2 : 1;
        const int stat = base.first == OBJ_JEWELLERY ? 8 : 2;
        CHECK(item_total_pattern("res=" + to_string(res))
              .matches(stash_item_totals(item)));
        CHECK(item_total_pattern("stat=" + to_string(stat))
              .matches(stash_item_totals(item)));
    }
}
