#pragma once

#include "item-prop-enum.h"

int hns_scale_loot(int amount, int percent, int maximum);
int hns_loot_level(int level);
int hns_create_loot(int level, object_class_type type = OBJ_RANDOM);
