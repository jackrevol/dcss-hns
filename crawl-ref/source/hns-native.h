#pragma once

#include <functional>
#include <string>
#include <vector>

// The standalone SDL build owns its profile and cloud operations in-process.
std::string hns_native_prepare(int argc, char **argv, const std::string &version);
bool hns_native_enabled();
std::string hns_native_action(const std::string &kind, const std::string &values);
void hns_native_start(std::function<bool(const std::string&)> compatible);
bool hns_native_checkpoint_due(bool background);
void hns_native_saved();
void hns_native_finish();
std::vector<std::string> hns_native_files(const std::string &path);
