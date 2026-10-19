#pragma once

#include "item-prop-enum.h"

struct item_def;
int hns_scale_loot(int amount, int percent, int maximum);
void hns_scale_consumable_stack(item_def &item);
int hns_loot_level(int level);
int hns_create_loot(int level, object_class_type type = OBJ_RANDOM);
