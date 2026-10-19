-- Run with an isolated RC and -script hns-consumables <expected multiplier>.
-- The same floor placement function is used by explicit vault rewards.
local multiplier = assert(tonumber(crawl.script_args()[1]), "Expected multiplier")
debug.goto_place("D:3")
dgn.reset_level()
dgn.fill_grd_area(1, 1, dgn.GXM - 2, dgn.GYM - 2, 'floor')

for index, sample in ipairs({
  {"potion of curing q:2", 2},
  {"scroll of identify q:3", 3},
  {"javelin q:4", 4},
}) do
  local x, y = 20 + index, 20
  dgn.create_item(x, y, sample[1])
  local items = dgn.items_at(x, y)
  assert(#items == 1, "Expected one stack: " .. sample[1])
  assert(items[1].quantity == sample[2] * multiplier,
         sample[1] .. ": expected " .. sample[2] * multiplier .. ", got " .. items[1].quantity)
end
