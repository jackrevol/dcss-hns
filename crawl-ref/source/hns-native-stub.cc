#include "AppHdr.h"
#include "hns-native.h"

std::string hns_native_prepare(int, char**, const std::string&) { return ""; }
bool hns_native_enabled() { return false; }
std::string hns_native_action(const std::string&, const std::string&) { return "{}"; }
void hns_native_start(std::function<bool(const std::string&)>) {}
bool hns_native_checkpoint_due(bool) { return false; }
void hns_native_saved() {}
void hns_native_finish() {}
std::vector<std::string> hns_native_files(const std::string&) { return {}; }
