#pragma once

#include <string>

#include "game-type.h"

class package;

// 사망 처리 스택을 벗어난 뒤 정상적인 로드 경로로 복귀합니다.
struct hns_revival
{
    std::string filename;
    game_type type;
};

bool hns_has_checkpoint(package &save);
void hns_write_checkpoint(package &save);
bool hns_restore_checkpoint(package &save);
// Copy a complete, playable checkpoint without changing the source package.
bool hns_copy_checkpoint(package &save, const std::string &filename);
// False means the recovery write failed: keep the original save instead.
bool hns_keep_death_recovery();
void hns_checkpoint();
void hns_offer_revival();
