#include "AppHdr.h"

#ifdef USE_TILE_LOCAL
#include "hns-desktop.h"
#include "end.h"
#include "files.h"
#include "json.h"
#include "outer-menu.h"
#include "scroller.h"
#include "state.h"
#include "stringutil.h"
#include "syscalls.h"
#include "ui.h"
#include "windowmanager.h"

namespace
{
using json_ptr = unique_ptr<JsonNode, void (*)(JsonNode*)>;
bool menu_busy = false;

string text(const JsonNode *node, const char *key)
{
    const auto item = node ? json_find_member(node, key) : nullptr;
    return item && item->tag == JSON_STRING ? item->string_ : "";
}

bool flag(const JsonNode *node, const char *key)
{
    const auto item = node ? json_find_member(node, key) : nullptr;
    return item && item->tag == JSON_BOOL && item->bool_;
}

void message(const string &title, const string &body)
{
    formatted_scroller view(FS_EASY_EXIT);
    view.set_title(formatted_string(title, YELLOW));
    view.add_raw_text(body);
    view.show();
}

json_ptr request(const string &kind, bool &reload, JsonNode *values = nullptr)
{
    unwind_bool busy(menu_busy, true);
    const char *response = getenv("HNS_DESKTOP_RESPONSE");
    if (!response || !*response)
        return json_ptr(nullptr, json_delete);
    static int sequence = 0;
    const int id = ++sequence;
    unlink_u(response);
    JsonNode *object = json_mkobject();
    json_append_member(object, "id", json_mknumber(id));
    json_append_member(object, "kind", json_mkstring(kind));
    if (values)
        json_append_member(object, "values", values);
    char *encoded = json_encode(object);
    // 계정 비밀번호는 파일에 남기지 않고 부모 프로세스의 전용 파이프로 보냅니다.
    printf("HNS_DESKTOP_ACTION %s\n", encoded);
    fflush(stdout);
    free(encoded);
    json_delete(object);

    json_ptr result(nullptr, json_delete);
    {
        ui::progress_popup progress("HNS settings / saves", 35);
        progress.set_status_text("Working... Local saves are preserved.");
        while (!crawl_state.seen_hups)
        {
            if (FILE *file = fopen_u(response, "rb"))
            {
                string content;
                char buffer[4096];
                size_t count;
                while ((count = fread(buffer, 1, sizeof(buffer), file)))
                {
                    content.append(buffer, count);
                    if (content.size() > 8 * 1024 * 1024)
                        break;
                }
                fclose(file);
                unlink_u(response);
                result.reset(json_decode(content.c_str()));
                const auto answer_id = result ? json_find_member(result.get(), "id") : nullptr;
                if (answer_id && answer_id->tag == JSON_NUMBER && answer_id->number_ == id)
                    break;
                result.reset();
            }
            ui::pump_events(100);
            progress.advance_progress();
        }
    }
    menu_busy = false;
    if (result && flag(result.get(), "fatal"))
        end(1, false, "%s", text(result.get(), "message").c_str());
    reload = reload || flag(result.get(), "reload");
    if (result && !flag(result.get(), "ok"))
    {
        string detail = text(result.get(), "message");
        // 원본 글꼴에 없는 문자가 포함된 서버 오류에도 읽을 수 있는 안내를 표시합니다.
        if (any_of(detail.begin(), detail.end(), [](unsigned char ch) { return ch >= 128; }))
            detail = "The operation could not be completed. Check your input, account and network connection. Local saves are preserved.";
        message("HNS", detail);
    }
    return result;
}

JsonNode *arguments(const char *key, const string &value)
{
    auto object = json_mkobject();
    json_append_member(object, key, json_mkstring(value));
    return object;
}

int choose(const string &title, const vector<string> &labels)
{
    auto box = make_shared<ui::Box>(ui::Box::VERT);
    box->set_cross_alignment(ui::Widget::STRETCH);
    auto heading = make_shared<ui::Text>(formatted_string(title, YELLOW));
    heading->set_margin_for_sdl(0, 0, 12, 0);
    box->add_child(heading);
    auto menu = make_shared<OuterMenu>(true, 1, labels.size());
    menu->min_size().height = 30 * min(8, static_cast<int>(labels.size()));
    menu->max_size().height = 420;
    menu->min_size().width = 580;
    bool done = false;
    int selected = -1;
    for (size_t i = 0; i < labels.size(); ++i)
    {
        auto button = make_shared<MenuButton>();
        auto label = make_shared<ui::Text>(formatted_string(labels[i], WHITE));
        label->set_ellipsize(true);
        label->set_margin_for_sdl(5, 8);
        button->set_child(label);
        button->on_activate_event([&, i](const ui::ActivateEvent&) {
            selected = i;
            done = true;
            return true;
        });
        menu->add_button(button, 0, i);
    }
    box->add_child(menu);
    auto hint = make_shared<ui::Text>(formatted_string("Arrow keys / mouse: select   Enter: open   Esc: back", DARKGREY));
    hint->set_margin_for_sdl(12, 0, 0, 0);
    box->add_child(hint);
    auto popup = make_shared<ui::Popup>(box);
    popup->on_keydown_event([&](const ui::KeyEvent &event) {
        if (!ui::key_exits_popup(event.key()))
            return false;
        done = true;
        return true;
    });
    ui::run_layout(popup, done);
    return selected;
}

class Entry : public ui::TextEntry
{
public:
    bool password = false;
    void _render() override
    {
        const string original = m_text;
        if (password)
            m_text.assign(m_text.size(), '*');
        ui::TextEntry::_render();
        m_text = original;
    }
    bool on_event(const ui::Event &event) override
    {
        if (event.type() == ui::Event::Type::KeyDown)
        {
            const int key = static_cast<const ui::KeyEvent&>(event).key();
            if (key == CK_ESCAPE || key == CK_ENTER)
                return false;
        }
        return ui::TextEntry::on_event(event);
    }
};

bool form(const string &title, const vector<string> &labels, vector<string> &values, int password = -1)
{
    auto box = make_shared<ui::Box>(ui::Box::VERT);
    box->set_cross_alignment(ui::Widget::STRETCH);
    auto heading = make_shared<ui::Text>(formatted_string(title, YELLOW));
    heading->set_margin_for_sdl(0, 0, 14, 0);
    box->add_child(heading);
    auto grid = make_shared<ui::Grid>();
    vector<shared_ptr<Entry>> entries;
    for (size_t i = 0; i < labels.size(); ++i)
    {
        auto label = make_shared<ui::Text>(labels[i]);
        label->set_margin_for_sdl(6, 14, 6, 0);
        auto input = make_shared<Entry>();
        input->password = static_cast<int>(i) == password;
        input->set_text(values[i]);
        input->min_size().width = 320;
        input->set_margin_for_sdl(4, 0, 4, 0);
        grid->add_child(label, 0, i);
        grid->add_child(input, 1, i);
        entries.push_back(input);
    }
    box->add_child(grid);
    bool done = false, accepted = false;
    auto save = make_shared<MenuButton>();
    auto save_text = make_shared<ui::Text>(formatted_string("[Enter] Save / continue    [Esc] Cancel", LIGHTCYAN));
    save_text->set_margin_for_sdl(14, 8, 4, 8);
    save->set_child(save_text);
    save->on_activate_event([&](const ui::ActivateEvent&) { accepted = done = true; return true; });
    box->add_child(save);
    auto popup = make_shared<ui::Popup>(box);
    popup->on_keydown_event([&](const ui::KeyEvent &event) {
        if (event.key() == CK_ENTER)
            accepted = done = true;
        else if (ui::key_exits_popup(event.key()))
            done = true;
        else
            return false;
        return true;
    });
    ui::run_layout(popup, done, entries.empty() ? nullptr : entries.front());
    if (accepted)
        for (size_t i = 0; i < values.size(); ++i)
            values[i] = entries[i]->get_text();
    return accepted;
}

void show_result(const json_ptr &result)
{
    if (result && flag(result.get(), "ok") && !text(result.get(), "message").empty())
        message("HNS", text(result.get(), "message"));
}

void loot(bool &reload)
{
    const char *keys[] = {"hns_floor_item_rate", "hns_item_quality", "hns_item_min_level",
        "hns_good_item_chance", "hns_randart_chance", "hns_gold_amount", "hns_consumable_amount"};
    const vector<string> labels = {"Floor item amount (0-10x)", "Item quality factor (0-10x)",
        "Minimum quality level (0-50)", "Good item chance (0-100%)", "Random artefact chance (0-100%)",
        "Gold stack amount (0.01-10x)", "Consumable stack amount (0.01-10x)"};
    const int scale[] = {100, 100, 1, 1, 1, 100, 100};
    const int minimum[] = {0, 0, 0, 0, 0, 1, 1};
    const int maximum[] = {1000, 1000, 50, 100, 100, 1000, 1000};
    auto current = request("loot-get", reload);
    if (!current || !flag(current.get(), "ok"))
        return;
    vector<string> values;
    const auto settings = json_find_member(current.get(), "values");
    for (size_t i = 0; i < labels.size(); ++i)
    {
        const auto value = settings ? json_find_member(settings, keys[i]) : nullptr;
        values.push_back(make_stringf("%g", value && value->tag == JSON_NUMBER ? value->number_ / scale[i] : 0));
    }
    while (true)
    {
        int choice = choose("Item drops", {"Edit drop settings", "Use HNS defaults", "Use original Crawl drops",
            "About drop settings", "Back to main menu"});
        if (choice < 0 || choice == 4)
            return;
        if (choice == 3)
        {
            message("Item drops", "Settings are shared by all characters and apply to newly generated items.\n\n"
                "Quality scales the depth quality factor, not enchantment bonuses.\n"
                "Set a minimum quality level to improve shallow-floor items.\n"
                "Artefact chances apply to weapons, armour, jewellery and talismans.\n"
                "Existing floors, monster equipment, shops and god gifts are unchanged.");
            continue;
        }
        if (choice == 1 || choice == 2)
            values = {choice == 1 ? "3" : "1", choice == 1 ? "2" : "1", "0", "0", "0", "1", "1"};
        if (choice == 0 && !form("Item drop settings", labels, values))
            continue;
        auto object = json_mkobject();
        bool valid = true;
        for (size_t i = 0; i < labels.size(); ++i)
        {
            char *tail;
            const double value = strtod(values[i].c_str(), &tail) * scale[i];
            if (values[i].empty() || *tail || !isfinite(value)
                || value < minimum[i] || value > maximum[i] || fabs(value - round(value)) > 0.00001)
                valid = false;
            json_append_member(object, keys[i], json_mknumber(valid ? round(value) : 0));
        }
        if (!valid)
        {
            json_delete(object);
            message("Item drops", "Enter numbers within the displayed ranges (multipliers support two decimal places).");
            continue;
        }
        auto result = request("loot-save", reload, object);
        show_result(result);
        if (result && flag(result.get(), "ok"))
            return;
    }
}

void options(bool &reload)
{
    auto result = request("rc-get", reload);
    if (!result || !flag(result.get(), "ok"))
        return;
    vector<string> lines = split_string("\n", text(result.get(), "text"), false, true);
    if (lines.empty())
        lines.push_back("");
    bool edited = false;
    while (true)
    {
        vector<string> labels = {"Save options and return", "Add a line", "Replace from clipboard", "Discard changes"};
        for (size_t i = 0; i < lines.size(); ++i)
            labels.push_back(make_stringf("%3u: %s", static_cast<unsigned>(i + 1), lines[i].c_str()));
        int choice = choose("Options file: init.txt", labels);
        if (choice < 0 || choice == 3)
        {
            if (!edited || choose("Discard option changes?", {"Keep editing", "Discard"}) == 1)
                return;
            continue;
        }
        if (choice == 0)
        {
            string rc;
            for (size_t i = 0; i < lines.size(); ++i)
                rc += (i ? "\n" : "") + lines[i];
            if (rc.size() > 4 * 1024 * 1024)
            {
                message("Options", "Options files must be smaller than 4 MiB.");
                continue;
            }
            auto saved = request("rc-save", reload, arguments("text", rc));
            show_result(saved);
            if (saved && flag(saved.get(), "ok"))
                return;
        }
        else if (choice == 2)
        {
            if (wm->has_clipboard() && choose("Replace the whole options file from clipboard?", {"Cancel", "Replace"}) == 1)
            {
                lines = split_string("\n", wm->get_clipboard(), false, true);
                edited = true;
            }
        }
        else
        {
            const int line = choice == 1 ? -1 : choice - 4;
            const int operation = line < 0 ? 0 : choose("Option line", {"Edit", "Insert a line before", "Delete", "Back"});
            if (operation < 0 || operation == 3)
                continue;
            if (operation == 2)
            {
                lines.erase(lines.begin() + line);
                edited = true;
                continue;
            }
            vector<string> content = {line < 0 || operation == 1 ? "" : lines[line]};
            if (content[0].size() > 1023)
            {
                message("Options", "This line exceeds the inline editor length. Use Replace from clipboard to edit the complete file.");
                continue;
            }
            if (form("Option line", {"Text"}, content))
            {
                if (line < 0)
                    lines.push_back(content[0]);
                else if (operation == 1)
                    lines.insert(lines.begin() + line, content[0]);
                else
                    lines[line] = content[0];
                edited = true;
            }
        }
    }
}

vector<pair<string, string>> items(const JsonNode *node, const char *key)
{
    vector<pair<string, string>> result;
    const auto array = node ? json_find_member(node, key) : nullptr;
    if (!array || array->tag != JSON_ARRAY)
        return result;
    for (auto row = json_first_child(array); row; row = row->next)
        result.emplace_back(text(row, "id"), text(row, "title"));
    return result;
}

void records(bool &reload)
{
    string order = "recent";
    while (true)
    {
        auto result = request("records", reload, arguments("sort", order));
        if (!result || !flag(result.get(), "ok"))
            return;
        const auto entries = items(result.get(), "items");
        vector<string> labels = {order == "recent" ? "Sort by score" : "Sort by most recent", "Back to main menu"};
        for (const auto &entry : entries)
            labels.push_back(entry.second);
        const int choice = choose("Past games / morgues", labels);
        if (choice < 0 || choice == 1)
            return;
        if (choice == 0)
        {
            order = order == "recent" ? "score" : "recent";
            continue;
        }
        const string id = entries[choice - 2].first;
        const int action = choose(entries[choice - 2].second, {"Read morgue", "Export morgue", "Delete record", "Back"});
        if (action == 0)
        {
            auto detail = request("record-detail", reload, arguments("id", id));
            if (detail && flag(detail.get(), "ok"))
                message(text(detail.get(), "title"), text(detail.get(), "text"));
        }
        else if (action == 1)
            show_result(request("record-export", reload, arguments("id", id)));
        else if (action == 2 && choose("Delete this record and morgue?", {"Cancel", "Delete"}) == 1)
            show_result(request("record-delete", reload, arguments("id", id)));
    }
}

void cloud(bool &reload)
{
    while (true)
    {
        auto result = request("cloud-status", reload);
        if (!result || !flag(result.get(), "ok"))
            return;
        const string account = text(result.get(), "account");
        vector<string> labels;
        vector<string> actions;
        auto add = [&](const string &label, const string &action) { labels.push_back(label); actions.push_back(action); };
        if (account.empty())
        {
            add("Sign in", "cloud-login");
            add("Create account", "cloud-signup");
        }
        else
        {
            if (!flag(result.get(), "linked"))
                add("Link this device's saves to this account", "cloud-link");
            else
                add("Synchronize now", "cloud-sync");
            if (text(result.get(), "phase") == "conflict")
            {
                add("View conflicting files", "conflicts");
                add("Conflicting files: keep this device's progress", "cloud-local");
                add("Conflicting files: use cloud progress", "cloud-remote");
            }
            add("Sign out (keep local saves)", "cloud-logout");
        }
        add("Recovery copies on this device", "archives");
        add("Recover a stale save lock", "cloud-unlock");
        add("Back to main menu", "back");
        const int choice = choose("Cloud saves: " + (account.empty() ? "not signed in" : account)
            + " [" + text(result.get(), "phase") + "]", labels);
        if (choice < 0 || actions[choice] == "back")
            return;
        const string action = actions[choice];
        if (action == "conflicts")
        {
            string paths;
            const auto conflicts = json_find_member(result.get(), "conflicts");
            if (conflicts && conflicts->tag == JSON_ARRAY)
                for (auto row = json_first_child(conflicts); row; row = row->next)
                    if (row->tag == JSON_STRING)
                        paths += string(row->string_) + "\n";
            message("Conflicting files (both recovery copies are kept)", paths);
        }
        else if (action == "cloud-unlock")
        {
            if (choose("Save and close other game windows before recovering a lock.", {"Cancel", "Other game windows are closed: recover lock"}) == 1)
                show_result(request(action, reload));
        }
        else if (action == "archives")
        {
            const auto entries = items(result.get(), "archives");
            vector<string> copies;
            for (const auto &entry : entries)
                copies.push_back(entry.second);
            copies.push_back("Back");
            const int copy = choose("Recovery copies (last 10)", copies);
            if (copy < 0 || copy >= static_cast<int>(entries.size()))
                continue;
            const int operation = choose(entries[copy].second, {"Restore on this device", "Export backup", "Back"});
            if (operation == 0 && choose("Replace saves with this recovery copy? Current progress will be archived.", {"Cancel", "Restore"}) == 1)
                show_result(request("cloud-restore", reload, arguments("id", entries[copy].first)));
            else if (operation == 1)
                show_result(request("cloud-export", reload, arguments("id", entries[copy].first)));
        }
        else if (action == "cloud-login" || action == "cloud-signup")
        {
            vector<string> credentials = {"", ""};
            if (!form(action == "cloud-login" ? "Cloud sign in" : "Create cloud account",
                {"Username (3-32 letters, digits or _)", "Password (6+ characters)"}, credentials, 1))
                continue;
            auto values = arguments("username", credentials[0]);
            json_append_member(values, "password", json_mkstring(credentials[1]));
            show_result(request(action, reload, values));
        }
        else
            show_result(request(action, reload));
    }
}
}

bool hns_desktop_menu(int menu)
{
    bool reload = false;
    switch (menu)
    {
    case 0: loot(reload); break;
    case 1: options(reload); break;
    case 2: records(reload); break;
    case 3: show_result(request("backup-export", reload)); break;
    case 4: show_result(request("backup-import", reload)); break;
    case 5: cloud(reload); break;
    }
    return reload;
}

bool hns_desktop_menu_busy()
{
    return menu_busy;
}
#endif
