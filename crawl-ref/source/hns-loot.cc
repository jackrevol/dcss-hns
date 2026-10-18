#include "AppHdr.h"

#include "hns-loot.h"

#include "makeitem.h"
#include "options.h"

int hns_scale_loot(int amount, int percent, int maximum)
{
    const int64_t scaled = (int64_t(max(0, amount)) * max(0, percent) + 50)
                          / 100;
    return int(min(int64_t(max(0, maximum)), scaled));
}

int hns_loot_level(int level)
{
    return max(Options.hns_item_min_level,
               hns_scale_loot(level, Options.hns_item_quality, 50));
}

int hns_create_loot(int level, object_class_type type)
{
    return items(true, type, OBJ_RANDOM, level, 0, NO_AGENT, false, "",
                 nullptr, nullptr, true);
}
