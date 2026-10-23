// Kid-safe chat filter (server/game/chatFilter.ts): evasion techniques, the innocent-word list,
// each tier, and the ship-name check.
import { describe, expect, it } from "vitest";
import { isNameAllowed, moderateText } from "../chatFilter";
import { sanitizeChatText } from "@shared/protocol";

const masked = (s: string) => {
  const r = moderateText(s);
  return r.action === "mask" ? r.text : r.action;
};
const category = (s: string) => {
  const r = moderateText(s);
  return r.action === "drop" ? r.category : r.action;
};

describe("innocent words pass (Scunthorpe problem)", () => {
  const INNOCENT = [
    "class", "assassin", "Scunthorpe", "cocktail", "spice", "grape", "therapist", "Dickens", "Sussex", "Essex",
    "Middlesex", "shitake", "shiitake", "hell", "damn", "bloody hell", "blast ye", "damn it all to hell",
    "Moby Dick", "cockpit", "cockatoo", "peacock", "Hancock", "Rio Negro", "cumin", "cumulative", "sextant",
    "analysis", "canal", "title", "titanic", "Matsushita", "spick and span", "scatter", "pass hit", "compass",
    "cutlass", "molasses", "assume", "bass", "Nassau", "Lake Titicaca", "cape cod", "snigger", "raccoon",
    "homo sapiens", "assist", "grass", "embarrass", "harass", "hitchhike", "pistol", "arsenal", "scrape",
    "you scurvy bilge rat", "crap, missed", "I'll sink you", "I'll send you to Davy Jones", "where are you",
    "call me Captain", "roblox is fun", "thanks. me too", "go to port royal. me first", "ok.so what",
    "e.g. this", "wait 5 min", "full steam ahead", "ur epic", "selling 500 sugar for 1500 gold",
    "I have 1000000 gold", "1,000,000 gold", "sugar at 5.5 each", "I am at 120 300", "headed to St. Augustine",
    "nice shot!! gg", "gg wp", "a b c d", "u r a b c", "port side!", "ahoy matey \u{1F3F4}‍☠️",
    "ships ahoy at 3 o'clock", "dick turpin rides again",
  ];
  it.each(INNOCENT)("%s", (w) => {
    expect(moderateText(w)).toEqual({ action: "allow" });
  });
});

describe("mild profanity is masked (tier a)", () => {
  it("masks whole words with asterisks of the same length, keeping punctuation", () => {
    expect(masked("what the fuck")).toBe("what the ****");
    expect(masked("SHIT happens")).toBe("**** happens");
    expect(masked("you fucking rat")).toBe("you ******* rat");
    expect(masked("motherfucker")).toBe("************");
    expect(masked("(shit!)")).toBe("(****!)");
    expect(masked("bitch!")).toBe("*****!");
    expect(masked("piss off")).toBe("**** off");
  });

  it("no longer allows bastard / cock / dick for a kid audience", () => {
    expect(masked("you scurvy bastard")).toBe("you scurvy *******");
    expect(masked("cock the pistol")).toBe("**** the pistol");
    expect(masked("you dick")).toBe("you ****");
  });

  it("catches our own mild additions", () => {
    expect(masked("dumbass")).toBe("*******");
    expect(masked("jackass")).toBe("*******");
    expect(masked("phuck")).toBe("*****");
    expect(masked("wtf")).toBe("***");
  });
});

describe("evasion techniques", () => {
  it("leet substitutions", () => {
    expect(masked("sh1t")).toBe("****");
    expect(masked("B1TCH")).toBe("*****");
    expect(masked("a$$hole")).toBe("*******");
    expect(masked("sh!t")).toBe("****");
    expect(category("n1gg3r")).toBe("slur");
    expect(category("s3x")).toBe("sexual");
    expect(category("p0rn")).toBe("sexual");
  });

  it("repeated letters", () => {
    expect(masked("fuuuuuck")).toBe("********");
    expect(masked("shhhiiiitttt")).toBe("************");
    expect(category("niiiiggggerrr")).toBe("slur");
  });

  it("spacing and punctuation between letters", () => {
    expect(masked("f u c k")).toBe("* * * *");
    expect(masked("f.u.c.k this")).toBe("*.*.*.* this");
    expect(masked("s-h-i-t")).toBe("*-*-*-*");
    expect(masked("f_u_c_k")).toBe("*_*_*_*");
    expect(category("n i g g e r")).toBe("slur");
    expect(category("k y s")).toBe("threat");
    expect(category("p o r n")).toBe("sexual");
  });

  it("homoglyphs: fullwidth, Cyrillic, Greek, accents, math letters", () => {
    expect(masked("ｆｕｃｋ")).toBe("****"); // ｆｕｃｋ
    expect(masked("fυck")).toBe("****"); // Greek upsilon
    expect(masked("fцck")).toBe("****"); // Cyrillic ц
    expect(masked("ѕhit")).toBe("****"); // Cyrillic ѕ
    expect(masked("fück")).toBe("****"); // ü
    expect(masked("fúck")).toBe("****"); // combining accent (dropped inside the mask)
    expect(masked("\u{1D41F}\u{1D42E}\u{1D41C}\u{1D424}")).toBe("****"); // 𝐟𝐮𝐜𝐤 (astral)
    expect(category("ｎｉｇｇｅｒ")).toBe("slur");
    expect(category("рorn")).toBe("sexual"); // Cyrillic р
    expect(category("кys")).toBe("threat"); // Cyrillic к
  });

  it("zero-width characters (stripped by sanitizeChatText first)", () => {
    const sneaky = sanitizeChatText("f​u‌c‍k ⁠n﻿igger")!;
    expect(sneaky).toBe("fuck nigger");
    expect(category(sneaky)).toBe("slur");
  });

  it("common misspellings", () => {
    expect(masked("fck off")).toBe("*** off");
    expect(masked("fuk")).toBe("***");
    expect(masked("fvck")).toBe("****");
    expect(category("nigga")).toBe("slur");
    expect(category("fagot")).toBe("slur");
  });

  it("run-together phrases", () => {
    expect(category("killyourself")).toBe("threat");
    expect(category("howoldareyou")).toBe("personal");
    expect(category("snapme")).toBe("personal");
  });
});

describe("severe lines are dropped (tier b)", () => {
  it.each([
    ["nigger", "slur"], ["faggot", "slur"], ["spic", "slur"], ["retard", "slur"], ["chink", "slur"],
    ["tranny", "slur"], ["kike", "slur"], ["heil hitler", "slur"], ["sieg heil", "slur"], ["1488", "slur"],
    ["gas the jews", "slur"], ["white power", "slur"],
    ["porn", "sexual"], ["send nudes", "sexual"], ["send pics", "sexual"], ["im horny", "sexual"],
    ["suck my", "sexual"], ["you whore", "sexual"], ["cunt", "sexual"], ["wanna have sex", "sexual"],
    ["i will rape you", "sexual"], ["blowjob", "sexual"],
    ["kys", "threat"], ["kill yourself", "threat"], ["kill urself", "threat"], ["go die", "threat"],
    ["hang yourself", "threat"], ["i will find your house", "threat"],
  ])("%s -> %s", (text, cat) => {
    expect(category(text)).toBe(cat);
  });

  it("a severe word drops the whole line even next to mild words", () => {
    expect(category("fuck you retard")).toBe("slur");
  });
});

describe("child-safety lines are dropped (tier c)", () => {
  it.each([
    // links
    ["visit google.com", "link"], ["www.example", "link"], ["http://x.y", "link"], ["https everything", "link"],
    ["x dot com", "link"], ["discord.gg/abc", "link"], ["discord gg abc", "link"], ["my site is pirates . net", "link"],
    ["bit.ly/abc", "link"], ["ｇｏｏｇｌｅ．ｃｏｍ", "link"], ["roblox(dot)com", "link"],
    // email
    ["email me at bob@gmail.com", "email"], ["bob (at) gmail (dot) com", "email"],
    // phone
    ["call 555-123-4567", "phone"], ["my number is 5551234567", "phone"], ["555 1234", "phone"],
    ["+44 7700 900123", "phone"], ["(555) 123-4567", "phone"],
    // personal info / off-site contact
    ["add me on discord", "personal"], ["snap me", "personal"], ["whats ur insta", "personal"],
    ["what's your snap", "personal"], ["follow me on tiktok", "personal"], ["add me on roblox", "personal"],
    ["my roblox username", "personal"], ["dm me", "personal"], ["text me", "personal"], ["hmu", "personal"],
    ["how old r u", "personal"], ["how old are you", "personal"], ["what's ur age", "personal"], ["asl", "personal"],
    ["where do you live", "personal"], ["where u live", "personal"], ["where are you from", "personal"],
    ["what school do you go to", "personal"], ["what's your address", "personal"], ["your real name?", "personal"],
    ["im 12 years old", "personal"], ["i am 9 yo", "personal"], ["i live in ohio", "personal"],
    ["i live at 12 elm street", "personal"], ["meet me irl", "personal"],
  ])("%s -> %s", (text, cat) => {
    expect(category(text)).toBe(cat);
  });
});

describe("isNameAllowed (ship names)", () => {
  it("allows ordinary pirate names", () => {
    for (const n of ["Blackbeard", "Sea Dog", "Captain Hook", "Dickens", "Moby Dick", "Black Pearl 7", "Assassin", "Scunthorpe Raider"]) {
      expect(isNameAllowed(n)).toBe(true);
    }
  });
  it("refuses profane, hateful, sexual and contact names", () => {
    for (const n of ["Fuck Ships", "Sh1tLord", "xXniggerXx", "S h i t", "Captain Bastard", "Porn Star", "snap me pls", "join discord.gg", "555-123-4567", "ｆｕｃｋ"]) {
      expect(isNameAllowed(n)).toBe(false);
    }
  });
});
