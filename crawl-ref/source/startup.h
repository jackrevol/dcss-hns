/**
 * @file
 * @brief Collection of startup related functions and objects
**/

#pragma once

struct hns_revival;

bool startup_step(const hns_revival *revival = nullptr);
void cio_init();
