import type { StruggleEvidence } from "./evidence";
import { MAX_STRUGGLE_TAGS, quoteDenies } from "./evidence";
import type { StruggleTag } from "./taxonomy";

/**
 * Keyword fallback used when Claude is unavailable. Each rule must match a phrase that
 * on its own expresses the struggle, so the matched sentence doubles as the evidence quote.
 * Order = priority.
 */
const RULES: [StruggleTag, RegExp][] = [
  [
    "UNCERTAINTY_IF_WORKING",
    /(can'?t|cannot|hard to|unable to|impossible to|difficult to|no idea|not sure|unsure|don'?t know|do not know|wondering|no way to)\b[^.!?\n]{0,60}\b(if|whether)\b[^.!?\n]{0,60}\b(work(s|ing|ed)?|help(s|ing|ed)?|doing anything|(any|an) effect|effective|made (a|any) difference|improv\w*|regrow\w*|growth|growing|new hairs?|kicked in)\b|\b(no|zero|not seeing|haven'?t (seen|noticed)|not noticed?|not seen)\b[^.!?\n]{0,25}\b(visible |noticeable |real |any )?(results?|improvement|difference|progress|regrowth|change)\b[^.!?\n]{0,40}\b(month|year|week)s?\b|\b(month|year|week)s?\b[^.!?\n]{0,40}\b(no|zero|not seeing|haven'?t (seen|noticed)|not noticed?|not seen)\b[^.!?\n]{0,25}\b(visible |noticeable |real |any )?(results?|improvement|difference|progress|regrowth|change)\b|\bis (it|this|fin|min|minoxidil|finasteride|dutasteride|the (treatment|foam|oral)) (even |actually |really )?working\b/i,
  ],
  [
    "MEASUREMENT_TRACKING",
    /\b(how (do|can|should) (i|you) (measure|track|compare|document|monitor)|hard to (compare|measure|track|judge)|(same|different|bad|poor) lighting|(before|progress|baseline) (and after |)(photos?|pics?|pictures?)|hair count|photos? (look|make|show)[^.!?\n]{0,30}(different|worse|better)|can'?t (compare|measure|track))\b/i,
  ],
  [
    "SIDE_EFFECTS",
    /\b(side ?effects?|libido|erectile|\bED\b|brain fog|gyno|gynecomastia|watery|heart (rate|palpitations)|hypertrichosis|facial hair|itch(y|ing|iness)|irritation|dandruff from|dizzy|dizziness|depress\w* (from|since|after)|shed(ding)? (from|since|after|because of) (fin|min|oral|topical|starting))\b/i,
  ],
  ["COST", /\b(too expensive|can'?t afford|afford|cost(s|ly)?|price|insurance|cheaper|budget|\$\d)/i],
  [
    "ACCESS_TO_CARE",
    /\b(can'?t (get|find|see) (a |an )?(derm\w*|doctor|prescription|appointment)|no derm\w* (near|in)|waiting list|wait(ing)? (\d+ )?(weeks?|months?) (for|to see)|won'?t prescribe|refused to prescribe|need a prescription|without a prescription|get (it|fin|minoxidil) prescribed)\b/i,
  ],
  [
    "CONFLICTING_INFO",
    /\b(conflicting|contradict\w*|some (people|say|studies) [^.!?\n]{0,40} others|mixed (reviews|opinions|info)|so much (misinformation|conflicting)|don'?t know (who|what) to (believe|trust)|everyone says something different)\b/i,
  ],
  [
    "EMOTIONAL_DISTRESS",
    /\b(anxiety|anxious|depress\w*|hopeless|ruin(ing|ed)? my life|crying|cried|panic\w*|suicid\w*|hate (myself|how i look)|so ashamed|embarrass\w*|losing my mind|mentally (draining|exhausting|destroying)|can'?t (cope|stop thinking))\b/i,
  ],
  [
    "CONSISTENCY_ADHERENCE",
    /\b(forget(ting)? to (apply|take)|miss(ed|ing) doses?|hard to (stay|keep) consistent|stopped (and|then) (re)?started|(for|the rest of) (my )?(life|lifetime)|every ?day for(ever| life)|twice a day is|can'?t keep up|fell off)\b/i,
  ],
  [
    "DIAGNOSIS_UNCLEAR",
    /\b(is this (normal|hair ?loss|thinning|balding|\bTE\b|telogen|male pattern|mpb|aga)|\b(te|telogen effluvium) or (aga|mpb|androgen\w*)|what('?s| is) causing|don'?t know (what|why) (is causing|this is|i'?m losing)|is (this|it) (just )?(seasonal|stress|hormonal)|(am i|is this) (going )?bald(ing)?|normal shedding|is my hairline (receding|normal|maturing)|mature(d|ing)? hairline or)\b/i,
  ],
  [
    "TIME_TO_RESULTS",
    /\b(how long (until|till|before|does it take)|when (will|do|should) (i|you|it) (see|start|notice|expect|kick)|too early to (tell|judge|see)|(still|only) (\d+|a few|two|three|four|five|six) (weeks?|months?) in|results? take(s)? (forever|so long|too long)|patien(ce|t) is (hard|running))\b/i,
  ],
  [
    "PRODUCT_CHOICE",
    /\b(should i (start|take|add|switch|try|use|go)|which (one|is better|should i|would you)|(oral|topical) (or|vs\.?|versus) (oral|topical)|what (else )?(to|should i|can i) (add|use|take|stack)|(worth|recommend) (it|trying|adding|starting)|(anything|something) else (to|i should) (use|add|try)|fin(asteride)? (or|vs\.?) (dut|dutasteride|min|minoxidil)|thinking (about|of) starting|considering (starting|taking|adding|switching))\b/i,
  ],
  [
    "SOCIAL_STIGMA",
    /\b(people (notice|comment|point|ask|make fun)|(gf|girlfriend|bf|wife|partner|friends?|coworkers?|colleagues?) (said|noticed|commented|joked)|made fun of|(dating|tinder|hinge)|hide (it|my (hair|scalp))|wearing (a )?(hat|cap|beanie) (everywhere|all the time|to hide)|self[- ]conscious|judged)\b/i,
  ],
];

function sentenceAround(text: string, index: number, matchLength: number): string {
  let start = index;
  while (start > 0 && !/[.!?\n]/.test(text[start - 1])) start--;
  let end = index + matchLength;
  while (end < text.length && !/[.!?\n]/.test(text[end])) end++;
  if (end < text.length && /[.!?]/.test(text[end])) end++;
  const s = text.slice(start, end).trim().replace(/\s+/g, " ");
  return s.length > 220 ? s.slice(0, 217).trimEnd() + "..." : s;
}

/** Struggles detectable from the person's own text, each with the sentence that triggered it. */
export function detectStruggles(text: string): StruggleEvidence[] {
  const out: StruggleEvidence[] = [];
  for (const [tag, re] of RULES) {
    const m = re.exec(text);
    if (!m || m.index === undefined) continue;
    const quote = sentenceAround(text, m.index, m[0].length);
    if (quoteDenies(tag, quote)) continue;
    out.push({ tag, quote });
    if (out.length >= MAX_STRUGGLE_TAGS) break;
  }
  return out;
}
