// Read-only Chromium localStorage migration. No browser runtime or DB writes.
// Formats: google/leveldb doc/{log_format,table_format}.md and google/snappy
// format_description.txt. Only the live manifest's files and the exact origin/key
// are read; obsolete tables must never resurrect a signed-out account.
#include "hns-native-core.h"
#include <set>
#include <stdexcept>

namespace hns
{
namespace
{
struct Cursor
{
    const Bytes &data;
    size_t pos = 0;
    uint64_t fixed(unsigned length)
    {
        if (length > 8 || pos + length > data.size())
            throw std::runtime_error("Truncated legacy database.");
        uint64_t value = 0;
        for (unsigned i = 0; i < length; ++i)
            value |= uint64_t(static_cast<unsigned char>(data[pos++])) << (8 * i);
        return value;
    }
    uint64_t varint()
    {
        uint64_t value = 0;
        for (unsigned shift = 0; shift < 64; shift += 7)
        {
            const auto byte = fixed(1);
            if (shift == 63 && byte > 1)
                throw std::runtime_error("Invalid legacy varint.");
            value |= (byte & 127) << shift;
            if (!(byte & 128))
                return value;
        }
        throw std::runtime_error("Invalid legacy varint.");
    }
    Bytes take(size_t size)
    {
        if (size > data.size() - pos)
            throw std::runtime_error("Truncated legacy value.");
        const auto result = data.substr(pos, size);
        pos += size;
        return result;
    }
    Bytes string() { return take(varint()); }
};
uint32_t crc32c(const Bytes &bytes)
{
    uint32_t crc = ~0u;
    for (unsigned char byte : bytes)
    {
        crc ^= byte;
        for (int bit = 0; bit < 8; ++bit)
            crc = (crc >> 1) ^ (0x82f63b78u & (0u - (crc & 1)));
    }
    return ((~crc >> 15) | (~crc << 17)) + 0xa282ead8u;
}
std::vector<Bytes> logs(const Bytes &bytes)
{
    std::vector<Bytes> result;
    Bytes fragments;
    bool fragmented = false;
    for (size_t offset = 0; offset + 7 <= bytes.size();)
    {
        const auto remain = 32768 - offset % 32768;
        if (remain < 7)
        {
            offset += remain;
            continue;
        }
        Cursor input{bytes, offset};
        const auto crc = input.fixed(4), length = input.fixed(2), type = input.fixed(1);
        if (!type && !length && !crc)
        {
            offset += remain;
            fragments.clear();
            fragmented = false;
            continue;
        }
        if (length + 7 > remain || length > bytes.size() - input.pos)
            break; // an interrupted final WAL write is not a committed value
        const Bytes data = input.take(length);
        if (crc32c(Bytes(1, char(type)) + data) != crc)
            throw std::runtime_error("Legacy database checksum mismatch.");
        offset += length + 7;
        if (type == 1)
        {
            fragmented = false;
            result.push_back(data);
        }
        else if (type == 2)
        {
            fragmented = true;
            fragments = data;
        }
        else if (type == 3 || type == 4)
        {
            if (!fragmented)
                throw std::runtime_error("Invalid legacy database fragments.");
            fragments += data;
            if (fragments.size() > max_bytes)
                throw std::runtime_error("Legacy database record too large.");
            if (type == 4)
            {
                result.push_back(fragments);
                fragments.clear();
                fragmented = false;
            }
        }
        else
            throw std::runtime_error("Unsupported legacy database log.");
    }
    return result;
}
Bytes unsnappy(const Bytes &bytes)
{
    Cursor input{bytes};
    const auto size = input.varint();
    if (size > max_bytes)
        throw std::runtime_error("Legacy compressed block too large.");
    Bytes result;
    result.reserve(size);
    while (input.pos < bytes.size())
    {
        const auto tag = input.fixed(1), type = tag & 3;
        size_t length, offset = 0;
        if (!type)
        {
            length = tag >> 2;
            length = length < 60 ? length + 1 : input.fixed(length - 59) + 1;
        }
        else if (type == 1)
        {
            length = 4 + ((tag >> 2) & 7);
            offset = ((tag & 224) << 3) | input.fixed(1);
        }
        else
        {
            length = 1 + (tag >> 2);
            offset = input.fixed(type == 2 ? 2 : 4);
        }
        if (length > size - result.size())
            throw std::runtime_error("Invalid legacy compressed size.");
        if (!type)
            result += input.take(length);
        else
        {
            if (!offset || offset > result.size())
                throw std::runtime_error("Invalid legacy compressed offset.");
            while (length--)
                result += result[result.size() - offset];
        }
    }
    if (result.size() != size)
        throw std::runtime_error("Truncated legacy compressed block.");
    return result;
}
Bytes block(const Bytes &table, uint64_t offset, uint64_t size)
{
    if (size > max_bytes || offset > table.size() || size + 5 > table.size() - offset)
        throw std::runtime_error("Invalid legacy block handle.");
    Bytes data = table.substr(offset, size);
    Cursor trailer{table, size_t(offset + size)};
    const auto type = trailer.fixed(1), crc = trailer.fixed(4);
    if (crc32c(data + char(type)) != crc)
        throw std::runtime_error("Legacy table checksum mismatch.");
    if (type == 1)
        return unsnappy(data);
    if (type != 0)
        throw std::runtime_error("Unsupported legacy table compression.");
    return data;
}
std::vector<std::pair<Bytes, Bytes>> entries(const Bytes &data)
{
    if (data.size() < 4)
        throw std::runtime_error("Invalid legacy block.");
    Cursor tail{data, data.size() - 4};
    const auto restarts = tail.fixed(4);
    if (restarts > (data.size() - 4) / 4)
        throw std::runtime_error("Invalid legacy restart table.");
    const auto end = data.size() - 4 - restarts * 4;
    std::vector<std::pair<Bytes, Bytes>> result;
    Bytes previous;
    Cursor input{data};
    while (input.pos < end)
    {
        const auto shared = input.varint(), fresh = input.varint(), size = input.varint();
        if (shared > previous.size() || result.size() > 100000)
            throw std::runtime_error("Invalid legacy prefix.");
        Bytes key = previous.substr(0, shared) + input.take(fresh), value = input.take(size);
        if (input.pos > end)
            throw std::runtime_error("Truncated legacy entry.");
        result.emplace_back(key, value);
        previous = key;
    }
    return result;
}
}
std::string legacy_login(const fs::path &directory, const std::string &url)
{
    if (!fs::exists(directory / "CURRENT"))
        return "";
    auto manifest_name = read(directory / "CURRENT", 256);
    if (!manifest_name.empty() && manifest_name.back() == '\n')
        manifest_name.pop_back();
    if (manifest_name.rfind("MANIFEST-", 0) != 0
        || manifest_name.find_first_not_of("0123456789", 9) != std::string::npos)
    {
        throw std::runtime_error("Invalid legacy database manifest.");
    }
    std::set<uint64_t> live;
    uint64_t log_number = 0, previous_log = 0;
    for (const auto &record : logs(read(directory / manifest_name)))
    {
        Cursor input{record};
        while (input.pos < record.size())
        {
            const auto tag = input.varint();
            switch (tag)
            {
            case 1: input.string(); break;
            case 2: log_number = input.varint(); break;
            case 3: case 4: input.varint(); break;
            case 5: input.varint(); input.string(); break;
            case 6: input.varint(); live.erase(input.varint()); break;
            case 7:
                input.varint(); live.insert(input.varint()); input.varint();
                input.string(); input.string(); break;
            case 9: previous_log = input.varint(); break;
            default: throw std::runtime_error("Unsupported legacy database manifest.");
            }
        }
    }
    const std::string key = "_https://appassets.dcsshns.invalid" + Bytes(1, '\0')
        + Bytes(1, '\1') + "hns-cloud-login:" + url;
    uint64_t latest = 0;
    Bytes value;
    const auto observe = [&](uint64_t sequence, uint64_t type, const Bytes &name, const Bytes &data) {
        if (name == key && sequence >= latest)
        {
            latest = sequence;
            value = type == 1 ? data : Bytes();
        }
    };
    for (const auto &file : fs::directory_iterator(directory))
    {
        const auto name = file.path().stem().u8string();
        if (name.empty() || name.find_first_not_of("0123456789") != name.npos)
            continue;
        const auto number = std::stoull(name);
        const auto extension = file.path().extension().u8string();
        if (extension == ".log" && (number >= log_number || number == previous_log))
        {
            for (const auto &record : logs(read(file.path())))
            {
                Cursor input{record};
                const auto sequence = input.fixed(8), count = input.fixed(4);
                if (count > 100000)
                    throw std::runtime_error("Too many legacy database entries.");
                for (uint64_t i = 0; i < count; ++i)
                {
                    const auto type = input.fixed(1);
                    if (type > 1)
                        throw std::runtime_error("Invalid legacy database operation.");
                    const auto name = input.string(), data = type == 1 ? input.string() : Bytes();
                    observe(sequence + i, type, name, data);
                }
            }
        }
        else if ((extension == ".ldb" || extension == ".sst") && live.count(number))
        {
            const auto table = read(file.path(), 64 * 1024 * 1024);
            if (table.size() < 48)
                throw std::runtime_error("Truncated legacy table.");
            Cursor magic{table, table.size() - 8};
            if (magic.fixed(8) != 0xdb4775248b80fb57ULL)
                throw std::runtime_error("Invalid legacy table magic.");
            Cursor footer{table, table.size() - 48};
            footer.varint(); footer.varint();
            const auto offset = footer.varint(), size = footer.varint();
            for (const auto &index : entries(block(table, offset, size)))
            {
                Cursor handle{index.second};
                const auto begin = handle.varint(), length = handle.varint();
                for (const auto &entry : entries(block(table, begin, length)))
                {
                    if (entry.first.size() < 8)
                        throw std::runtime_error("Invalid legacy internal key.");
                    Cursor tag{entry.first, entry.first.size() - 8};
                    const auto sequence_type = tag.fixed(8);
                    observe(sequence_type >> 8, sequence_type & 255,
                        entry.first.substr(0, entry.first.size() - 8), entry.second);
                }
            }
        }
    }
    if (value.empty())
        return "";
    if (value[0] == 1)
        return value.substr(1);
    if (value[0] == 0 && value.size() % 2 == 1)
    {
        Bytes ascii;
        for (size_t i = 1; i < value.size(); i += 2)
        {
            if (value[i + 1])
                throw std::runtime_error("Unsupported legacy login encoding.");
            ascii += value[i];
        }
        return ascii;
    }
    throw std::runtime_error("Unsupported legacy login value.");
}
}
