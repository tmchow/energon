/** Short common words. Three hyphenated picks is enough for an internal share link. */
export const MEMORABLE_WORDS = [
  "acorn", "amber", "anchor", "apple", "apron", "arrow", "atlas", "attic",
  "badge", "baker", "bamboo", "basin", "beach", "beacon", "beaver", "berry",
  "birch", "blanket", "blossom", "blue", "board", "bobcat", "bottle", "branch",
  "breeze", "brick", "bridge", "brisk", "brook", "bubble", "bucket", "button",
  "cactus", "camel", "candle", "canyon", "cedar", "cello", "chalk", "cherry",
  "cider", "cinnamon", "circus", "citron", "cliff", "cloud", "clover", "cobalt",
  "comet", "compass", "copper", "coral", "cotton", "cradle", "crane", "creek",
  "crisp", "crown", "crystal", "cupola", "curry", "cycle", "daisy", "dawn",
  "delta", "denim", "dew", "dove", "dragon", "drift", "drum", "dusk",
  "eagle", "earth", "echo", "ember", "fable", "falcon", "feather", "fennel",
  "fern", "ferry", "field", "finch", "fjord", "flame", "flint", "flood",
  "flute", "fog", "forest", "forge", "fossil", "fountain", "fox", "frost",
  "garden", "garlic", "gate", "ginger", "glacier", "glass", "glen", "gold",
  "goose", "grain", "grape", "grass", "green", "grove", "guitar", "harbor",
  "harvest", "haven", "hazel", "hearth", "heron", "honey", "horizon", "horse",
  "island", "ivory", "ivy", "jacket", "jade", "jasper", "jungle", "kayak",
  "kettle", "key", "kite", "koala", "ladder", "lagoon", "lantern", "lark",
  "lasso", "latte", "leaf", "lemon", "lilac", "linen", "lion", "lotus",
  "lumen", "larkspur", "mango", "maple", "marble", "meadow", "melon", "mesa",
  "mint", "mirror", "mist", "moon", "moss", "moth", "mountain", "mushroom",
  "mustard", "nectar", "needle", "nickel", "night", "noble", "north", "nova",
  "oak", "oasis", "ocean", "olive", "onyx", "opal", "orange", "orchid",
  "otter", "oven", "owl", "oxbow", "oyster", "paddle", "pagoda", "paint",
  "palm", "panda", "paper", "parch", "peach", "pearl", "pebble", "pepper",
  "petal", "piano", "picnic", "pine", "pioneer", "plaid", "plain", "planet",
  "plaza", "plum", "pocket", "polar", "pollen", "pond", "poppy", "portal",
  "prairie", "prism", "puffin", "pumpkin", "quail", "quartz", "quilt", "quince",
  "rabbit", "radar", "rain", "raven", "reef", "ridge", "river", "robin",
  "rocket", "roost", "rose", "rowan", "royal", "ruby", "saddle", "saffron",
  "sail", "salmon", "sand", "satin", "scale", "scout", "seed", "shade",
  "shadow", "shell", "silver", "skiff", "sky", "slate", "sleet", "slope",
  "smoke", "snow", "solar", "spark", "spice", "spruce", "squash", "squid",
  "star", "steam", "steel", "stone", "storm", "stove", "sugar", "summit",
  "sun", "swan", "swift", "table", "teal", "temple", "thicket", "thistle",
  "tide", "tiger", "timber", "toast", "topaz", "trail", "train", "tree",
  "trout", "tulip", "tunnel", "turtle", "valley", "vapor", "velvet", "vessel",
  "violet", "vista", "vivid", "walnut", "wave", "wheat", "willow", "wind",
  "window", "wren", "yarn", "yellow", "yonder", "zebra", "zenith", "zest",
] as const;

export function pickMemorableWords(count: number, random = defaultRandom): string[] {
  const n = Math.max(2, Math.min(3, count | 0));
  const out: string[] = [];
  const buf = new Uint32Array(n);
  random(buf);
  for (let i = 0; i < n; i++) out.push(MEMORABLE_WORDS[buf[i]! % MEMORABLE_WORDS.length]!);
  return out;
}

export function memorablePassword(count = 3, random = defaultRandom): string {
  return pickMemorableWords(count, random).join("-");
}

function defaultRandom(buf: Uint32Array): Uint32Array {
  return crypto.getRandomValues(buf);
}
