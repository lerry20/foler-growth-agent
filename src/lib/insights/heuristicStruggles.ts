import type { StruggleEvidence } from "./evidence";
import { MAX_STRUGGLE_TAGS, quoteDenies } from "./evidence";
import type { StruggleTag } from "./taxonomy";

const NO = "(no|zero|not seeing|haven'?t (seen|noticed|had)|not noticed?|not seen|didn'?t (see|get|notice|experience|have) any|barely any|hardly any|little to no)";
const RESULT = "(visible |noticeable |real |any |new )?(results?|improvement|difference|progress|regrowth|change|growth)";
const PERIOD = "(month|year|week)s?";

/**
 * Keyword fallback used when Claude is unavailable. Each rule must match a phrase that
 * on its own expresses the struggle, so the matched sentence doubles as the evidence quote.
 * The phrase must be the person's own current case: first person where the tag depends on
 * who is choosing / feeling / experiencing. Order = priority.
 */
const RULES: [StruggleTag, RegExp][] = [
  [
    "UNCERTAINTY_IF_WORKING",
    /(can'?t|cannot|hard to|unable to|impossible to|difficult to|no idea|not sure|unsure|don'?t know|do not know|wondering|no way to)\b[^.!?\n]{0,60}\b(if|whether)\b[^.!?\n]{0,60}\b(work(s|ing|ed)?|help(s|ing|ed)?|doing anything|(any|an) effect|effective|made (a|any) difference|improv\w*|regrow\w*|growth|growing|new hairs?|kicked in)\b|\bis (it|this|fin|min|minoxidil|finasteride|dutasteride|the (treatment|foam|oral)) (even |actually |really )?working\b|\bhard to (know|tell|say)[^.!?\n]{0,20}\b(what|how much) (effect|difference|impact)\b/i,
  ],
  [
    "MEASUREMENT_TRACKING",
    /\b(how (do|can|should) (i|you) (measure|track|compare|document|monitor)|hard to (compare|measure|track|judge)|(same|different|bad|poor) lighting|(before|progress|baseline) (and after |)(photos?|pics?|pictures?)|hair count|photos? (look|make|show)[^.!?\n]{0,30}(different|worse|better)|can'?t (compare|measure|track))\b/i,
  ],
  [
    "SIDE_EFFECTS",
    /\b(side ?effects?|libido|erectile|\bED\b|brain fog|gyno|gynecomastia|watery|heart (rate|palpitations)|hypertrichosis|facial hair|itch(y|ing|iness)|irritation|dandruff from|dizzy|dizziness|weight (gain|fluctuations?)|dried (out )?my scalp|depress\w* (from|since|after)|shed(ding)? (from|since|after|because of) (fin|min|oral|topical|starting))\b/i,
  ],
  ["COST", /\b(too expensive|can'?t afford|afford|cost(s|ly)?|price|insurance|cheaper|budget|financial (stress|strain|burden)|\$\d)/i],
  [
    "ACCESS_TO_CARE",
    /\b(can'?t (get|find|see) (a |an )?(derm\w*|doctor|prescription|appointment)|no derm\w* (near|in)|waiting list|wait(ing)? (\d+ )?(weeks?|months?) (for|to see)|won'?t prescribe|refused to prescribe|need a prescription|without a prescription|get (it|fin|minoxidil) prescribed|appointment[^.!?\n]{0,30}\b(\d+|two|three|four|five|six) months (away|out|from now))\b/i,
  ],
  [
    "CONFLICTING_INFO",
    /\b(conflicting|contradict\w*|some (people|say|studies) [^.!?\n]{0,40} others|mixed (reviews|opinions|info)|so much (misinformation|conflicting)|don'?t know (who|what) to (believe|trust)|everyone says something different)\b/i,
  ],
  [
    "EMOTIONAL_DISTRESS",
    /\b(anxiety|anxious|depress\w*|hopeless|los(e|ing) hope|ruin(ing|ed)? my life|crying|cried|panic\w*|suicid\w*|hate (myself|how i look)|so ashamed|embarrass\w*|losing my mind|mentally (draining|exhausting|destroying)|can'?t (cope|stop thinking))\b/i,
  ],
  [
    "CONSISTENCY_ADHERENCE",
    /\b(forget(ting)? to (apply|take)|miss(ed|ing) doses?|hard to (stay|keep) consistent|stopped (and|then) (re)?started|(for|the rest of) (my )?(life|lifetime)|every ?day for(ever| life)|twice a day is|can'?t keep up|fell off)\b/i,
  ],
  [
    "DIAGNOSIS_UNCLEAR",
    /\b(is this (normal|hair ?loss|thinning|balding|\bTE\b|telogen|male pattern|mpb|aga)|\b(te|telogen effluvium) or (aga|mpb|androgen\w*)|what('?s| is) causing|(not sure|no idea|don'?t know) what (this|it) (could be |is |was |might be )?caused by|don'?t know (what|why) (is causing|this is|i'?m losing)|is (this|it) (just )?(seasonal|stress|hormonal)|(am i|is this) (going )?bald(ing)?|normal shedding|is my hairline (receding|normal|maturing)|mature(d|ing)? hairline or|no (metabolic |clear |obvious |identifiable )?(reason|cause|explanation) for (the |my )?(hair ?loss|shedding|thinning)|could it (possibly )?be (something to do with|the|my)|not sure (if|whether) (it'?s|this is) (te|aga|hormonal|genetic|stress))\b/i,
  ],
  [
    "TIME_TO_RESULTS",
    new RegExp(
      [
        "how long (until|till|before|does it take)",
        "when (will|do|should) (i|you|it) (see|start|notice|expect|kick)",
        "too early to (tell|judge|see)",
        "(still|only) (\\d+|a few|two|three|four|five|six) (weeks?|months?) in",
        "results? take(s)? (forever|so long|too long)",
        "patien(ce|t) is (hard|running)",
        "what (results |kind of results |sort of results )?(should|can|do|to) (i|you) expect",
        "(set|manage) (my )?expectations",
        "over (a|what) time ?frame",
        "what('?s| is) the (realistic |expected |usual )?time ?frame",
        "(shed|shedding)[^.!?\\n]{0,30}\\b(lasting|lasts?|going on|dragging on) (too|so|this|way too) long",
        "no sign of (it |the shed |shedding )?(slowing|stopping|ending|letting up|regrowth)",
        "(min|fin|dut|minoxidil|finasteride|dutasteride|treatment|topical|oral|the (foam|pill|drops?)|it|this)( is|'s| has| had)? (isn'?t|is not|not|wasn'?t|hasn'?t been|stopped|no longer) working( great| well| for me| at all| anymore)?\\b",
        "(worse|no better|thinner) than (when i started|baseline|before (i )?start\\w*)",
        "(still|kept|keeps) (getting (thinner|worse)|going (thinner|bald\\w*)|declining)",
        "(density|hairline|thinning) (kept|keeps|is still|still) (declining|receding|getting worse|spreading)",
        `${NO}\\b[^.!?\\n]{0,25}\\b${RESULT}\\b[^.!?\\n]{0,40}\\b${PERIOD}\\b`,
        `\\b${PERIOD}\\b[^.!?\\n]{0,40}\\b${NO}\\b[^.!?\\n]{0,25}\\b${RESULT}\\b`,
        "didn'?t (experience|see|get|notice) any results",
        "non[- ]?responder",
      ].join("|"),
      "i",
    ),
  ],
  [
    "PRODUCT_CHOICE",
    new RegExp(
      [
        "should i (start|take|add|switch|try|use|go|continue|stop|up|increase|lower)",
        "which (one|is better|should i|would you|do i)",
        "(oral|topical) (or|vs\\.?|versus) (oral|topical)",
        "what (else )?(to|should i|can i) (add|use|take|stack)",
        "(is it|is (fin|min|dut|oral|topical|\\w+) (even )?|would it be|be) worth (it|trying|adding|starting|the)",
        "(would you|do you|anyone|what do you|(you|anyone) (would|could|can|'d)) recommend",
        "recommend(ations?)? (trying|on what|for (someone|my|thin|regrow))",
        "(deciding|choosing|torn|stuck) between",
        "(anything|something) else (to|i should) (use|add|try)",
        "fin(asteride)? (or|vs\\.?) (dut|dutasteride|min|minoxidil)",
        "i('?m| am|'?ve been| have been| keep) (thinking (about|of)|considering|debating|torn between|leaning towards?|tempted to|on the fence about)",
        "debating (whether|if|between|min|fin|oral|topical|starting|adding)",
        "how (to|do i|should i|often (do|should) i) (use|layer|combine|stack|apply|take|space)",
        "what('?s| is) the best (stuff|thing|treatment|product|option|route|thing to take)( to (take|use|try))?",
        "best (stuff|thing|thing to take) to (take|use|try)",
        "(recommendations?|advice|suggestions?) on (what|which) (i should|to)",
        "what (should|can) i (be doing|do|use|take|try) to (improve|fix|stop|regrow|help|slow)",
        "(not strong enough|need (something stronger|to (take|add|switch to)) (dut|dutasteride|fin|finasteride|min|minoxidil|oral))",
        "(should|can|could|do|shall) i (switch|move|change) (to|from|over)",
        "(thinking|considering|contemplating|planning|debating|wondering) (about |of |on )?(switching|moving|changing|a switch)",
        "thinking (to|about|of) (gradually |slowly |eventually |maybe )?(switch|move|start|add|try|stack)",
        "^switching (from|to) ",
        "switch(ing)? (to|from) (dut|dutasteride|fin|finasteride|oral|topical)[^.!?\\n]{0,60}\\?",
        "(taper|cold turkey)[^.!?\\n]{0,30}(dut|fin|min)",
      ].join("|"),
      "i",
    ),
  ],
  [
    "SOCIAL_STIGMA",
    /\b(people (notice|comment|point|ask|make fun)|(gf|girlfriend|bf|wife|partner|friends?|coworkers?|colleagues?) (said|noticed|commented|joked)|made fun of|(dating|tinder|hinge)|hide (it|my (hair|scalp))|wearing (a )?(hat|cap|beanie) (everywhere|all the time|to hide)|self[- ]conscious|judged)\b/i,
  ],
];

/** The full sentence containing the match, plus a ≤220-char quote window around the matched phrase. */
function sentenceAround(text: string, index: number, matchLength: number): { sentence: string; quote: string } {
  let start = index;
  while (start > 0 && !/[.!?\n]/.test(text[start - 1])) start--;
  let end = index + matchLength;
  while (end < text.length && !/[.!?\n]/.test(text[end])) end++;
  if (end < text.length && /[.!?]/.test(text[end])) end++;
  const sentence = text.slice(start, end).trim().replace(/\s+/g, " ");
  if (end - start <= 220) return { sentence, quote: sentence };
  const from = Math.max(start, Math.min(index - 80, end - 214));
  const to = Math.min(end, from + 214);
  const s = text.slice(from, to).trim().replace(/\s+/g, " ");
  return { sentence, quote: (from > start ? "..." : "") + s + (to < end ? "..." : "") };
}

/**
 * Struggles detectable from the person's own text, each with the sentence that triggered it.
 * A sentence that denies the problem (or is about someone else / a hypothetical) is skipped and
 * the next match for that tag is tried, so one "no side effects" does not hide a real complaint
 * two sentences later.
 */
export function detectStruggles(text: string): StruggleEvidence[] {
  const out: StruggleEvidence[] = [];
  for (const [tag, re] of RULES) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = global.exec(text)) !== null) {
      if (m[0].length === 0) {
        global.lastIndex++;
        continue;
      }
      const { sentence, quote } = sentenceAround(text, m.index, m[0].length);
      if (quoteDenies(tag, sentence)) continue;
      out.push({ tag, quote });
      break;
    }
    if (out.length >= MAX_STRUGGLE_TAGS) break;
  }
  return out;
}
