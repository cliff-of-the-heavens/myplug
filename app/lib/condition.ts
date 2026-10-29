/**
 * The condition a physical item is in, from brand new to only good for parts. Merchants pick
 * one per listing; customers see it on the item with an explanation of what it means.
 */
export const ITEM_CONDITIONS = [
  {
    value: "new_with_tags",
    label: "Brand new, with tags",
    meaning: "Never used. In its original sealed box or packaging, or with the shop tags still attached.",
    tip: "Only if it has never been used or worn and still has its seal, box or tags. Opened to check it works? Choose Brand new, no tags.",
    tone: "success",
  },
  {
    value: "new_without_tags",
    label: "Brand new, no tags",
    meaning: "Never used or worn, but the tags, seal or original box are missing, or it was opened to check it.",
    tip: "Unused stock without its tags or box, ex-display items with no wear, and gifts that were opened but never used.",
    tone: "success",
  },
  {
    value: "mint",
    label: "Mint",
    meaning: "Used before, but looks and works like new: no scratches, marks or wear, and nothing missing.",
    tip: "Only when you can't find a single mark, and it comes with all its parts and accessories. A small scratch makes it Fairly used.",
    tone: "success",
  },
  {
    value: "fairly_used",
    label: "Fairly used",
    meaning: "Lightly used and works perfectly. Small signs of wear, such as fine scratches, that you only notice up close.",
    tip: "Light, careful use: most imported second-hand phones, laptops and clothes in good shape. Photograph any marks.",
    tone: "accent",
  },
  {
    value: "used",
    label: "Used",
    meaning: "Clearly used, and works as it should. Expect visible wear: scratches, dents, fading or worn edges.",
    tip: "Normal everyday wear you can see at arm's length, with everything still working. Describe and photograph the wear.",
    tone: "accent",
  },
  {
    value: "fair",
    label: "Fair",
    meaning: "Heavily used. It works, but has visible damage or small faults, such as a cracked case or a weak battery.",
    tip: "It works, but has damage or minor faults. List every fault in the description so nobody is surprised.",
    tone: "warning",
  },
  {
    value: "not_working",
    label: "Not working",
    meaning: "Doesn't work as it should. It may be repairable; the seller says what is wrong.",
    tip: "It powers on badly or not at all, or a main function fails. Say exactly what's wrong and what you've tried.",
    tone: "destructive",
  },
  {
    value: "for_parts",
    label: "For parts",
    meaning: "Sold only for its parts or materials. Not expected to work or be repaired, and parts may be missing.",
    tip: "Scrap, spares and broken items for repairers. Say which parts are there and which are missing.",
    tone: "destructive",
  },
] as const;

export type ItemCondition = (typeof ITEM_CONDITIONS)[number]["value"];

export const CONDITION_VALUES = ITEM_CONDITIONS.map((c) => c.value) as [ItemCondition, ...ItemCondition[]];

export function isItemCondition(v: unknown): v is ItemCondition {
  return typeof v === "string" && (CONDITION_VALUES as string[]).includes(v);
}

export function conditionInfo(v: ItemCondition) {
  return ITEM_CONDITIONS.find((c) => c.value === v)!;
}
