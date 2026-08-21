//! Engine-independent dictionary correction.
//!
//! The dictionary reaches Whisper as an initial prompt and the LLM as a cleanup
//! instruction, but Parakeet ignores the prompt argument and cleanup is
//! optional — so with cleanup off on Parakeet the feature did nothing at all.
//! This pass closes that hole: it runs on the raw transcript, for every engine,
//! with no model involved.
//!
//! It corrects near misses — wrong spacing, a swapped consonant, a dropped
//! letter, the wrong casing. It is deliberately NOT a homophone engine: "eye
//! phone" → "iPhone" is a leap only a language model should make, and the
//! threshold that would catch it also rewrites words the user meant.

/// Minimum letters in a dictionary term before it is allowed to match
/// approximately. Short terms are mostly ordinary words, where one edit is the
/// difference between two real words ("Sam" and "Sara" are one edit from "same"
/// and "sara").
const MIN_FUZZY_LEN: usize = 5;
/// Folded-form similarity a window needs to be rewritten. Tuned so one edit in
/// a 6-letter term passes and two do not.
const MIN_SIMILARITY: f32 = 0.82;
/// Widest run of transcript words compared against one term, so a term the
/// engine split across words ("post gres") is still found. Bounds the scan.
const MAX_WINDOW: usize = 3;

/// Rewrite near-misses of `dictionary`'s terms in `text` to the terms as the
/// user spelled them. `dictionary` is the comma-separated list the Dictionary
/// page stores.
pub fn apply(text: &str, dictionary: &str) -> String {
    let terms: Vec<&str> = dictionary
        .split(',')
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .collect();
    if terms.is_empty() || text.is_empty() {
        return text.to_string();
    }

    let words = word_spans(text);
    if words.is_empty() {
        return text.to_string();
    }

    // Every (span, term) rewrite worth making, best first.
    let mut candidates: Vec<(usize, usize, &str, f32)> = Vec::new();
    for term in &terms {
        let folded_term = fold(term);
        let letters = term.chars().filter(|c| c.is_alphanumeric()).count();
        if folded_term.is_empty() {
            continue;
        }
        for start in 0..words.len() {
            for size in 1..=MAX_WINDOW.min(words.len() - start) {
                let (from, _) = words[start];
                let (_, to) = words[start + size - 1];
                let window = &text[from..to];

                let folded_window = fold(window);
                if folded_window.is_empty() {
                    continue;
                }

                // An exact folded match is the casing/spacing case ("open ai" →
                // "OpenAI"). It is safe at any length, so it skips the length
                // floor that guards the fuzzy path. A window that already reads
                // exactly right lands here too, scoring 1.0 for a replacement
                // that changes nothing — that is the point. Skipping it instead
                // left its span unclaimed, and a longer window swallowing it
                // ("OpenAI is") then won on a technicality and ate the
                // following word.
                let similarity = if folded_window == folded_term {
                    1.0
                } else if letters < MIN_FUZZY_LEN {
                    continue
                } else {
                    similarity(&folded_window, &folded_term)
                };

                if similarity >= MIN_SIMILARITY {
                    candidates.push((from, to, term, similarity));
                }
            }
        }
    }

    if candidates.is_empty() {
        return text.to_string();
    }

    // Best score first, then the longest span — so "post gres sql" is claimed
    // by "PostgreSQL" rather than half-claimed by "Postgres".
    candidates.sort_by(|a, b| {
        b.3.partial_cmp(&a.3)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then((b.1 - b.0).cmp(&(a.1 - a.0)))
            .then(a.0.cmp(&b.0))
    });

    let mut accepted: Vec<(usize, usize, &str)> = Vec::new();
    for (from, to, term, _) in candidates {
        if accepted.iter().any(|(s, e, _)| from < *e && *s < to) {
            continue;
        }
        accepted.push((from, to, term));
    }
    accepted.sort_by_key(|(from, _, _)| *from);

    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;
    for (from, to, term) in accepted {
        out.push_str(&text[cursor..from]);
        out.push_str(term);
        cursor = to;
    }
    out.push_str(&text[cursor..]);
    out
}

/// Byte spans of each word, where a word is a run of alphanumerics and the
/// apostrophes inside them. Punctuation and whitespace between words is never
/// part of a span, so rewriting a span leaves the surrounding text untouched.
fn word_spans(text: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut start: Option<usize> = None;
    for (i, c) in text.char_indices() {
        let in_word = c.is_alphanumeric() || (c == '\'' && start.is_some());
        match (in_word, start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                spans.push((s, i));
                start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = start {
        spans.push((s, text.len()));
    }
    // A trailing apostrophe belongs to the punctuation, not the word.
    for span in spans.iter_mut() {
        while span.1 > span.0 && text[..span.1].ends_with('\'') {
            span.1 -= 1;
        }
    }
    spans.retain(|(s, e)| e > s);
    spans
}

/// Collapse a word to a rough phonetic skeleton: spacing, casing, punctuation
/// and the spellings that sound identical all disappear, so the edit distance
/// that follows measures how differently it *sounds* rather than how
/// differently it is written.
fn fold(s: &str) -> String {
    let lower: String = s
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    let chars: Vec<char> = lower.chars().collect();

    let mut out = String::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        // Digraphs first: each is one sound spelled two ways.
        match (c, next) {
            ('p', Some('h')) => {
                out.push('f');
                i += 2;
                continue;
            }
            ('c', Some('k')) => {
                out.push('k');
                i += 2;
                continue;
            }
            ('k', Some('n')) | ('g', Some('n')) if i == 0 => {
                out.push('n');
                i += 2;
                continue;
            }
            ('w', Some('r')) if i == 0 => {
                out.push('r');
                i += 2;
                continue;
            }
            _ => {}
        }
        match c {
            // Two letters, one sound.
            'x' => out.push_str("ks"),
            'q' => out.push('k'),
            'z' => out.push('s'),
            'y' => out.push('i'),
            // Soft before a front vowel, hard otherwise.
            'c' => out.push(if matches!(next, Some('e') | Some('i') | Some('y')) {
                's'
            } else {
                'k'
            }),
            _ => out.push(c),
        }
        i += 1;
    }

    // Doubled letters are never a second sound.
    let mut collapsed = String::with_capacity(out.len());
    for c in out.chars() {
        if collapsed.chars().last() != Some(c) {
            collapsed.push(c);
        }
    }
    // Silent tail.
    while collapsed.ends_with('e') || collapsed.ends_with('h') {
        collapsed.pop();
    }
    collapsed
}

/// How alike two words sound, on the same folded skeleton the correction pass
/// matches against. Exposed for `learn`, which uses it to tell a mishearing
/// apart from the user rewording their own sentence.
pub fn phonetic_similarity(a: &str, b: &str) -> f32 {
    similarity(&fold(a), &fold(b))
}

/// 1.0 for identical, 0.0 for nothing in common.
fn similarity(a: &str, b: &str) -> f32 {
    let longest = a.chars().count().max(b.chars().count());
    if longest == 0 {
        return 0.0;
    }
    1.0 - levenshtein(a, b) as f32 / longest as f32
}

fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.is_empty() {
        return b.len();
    }
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    let mut current = vec![0usize; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        current[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cost = if ca == cb { 0 } else { 1 };
            current[j + 1] = (previous[j] + cost)
                .min(current[j] + 1)
                .min(previous[j + 1] + 1);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    const DICT: &str = "PostgreSQL, Kubernetes, OpenAI, Anthropic, sherpa-onnx, Srikar";

    #[test]
    fn fixes_spacing_and_casing_exactly() {
        // The folded forms match exactly — no length floor applies.
        assert_eq!(apply("we use open ai for this", DICT), "we use OpenAI for this");
        assert_eq!(apply("openai is down", DICT), "OpenAI is down");
        // Already right: left completely alone. A correct term followed by a
        // short word used to be swallowed whole — "OpenAI is" scores well
        // enough against "OpenAI" to win if the exact span isn't claimed first.
        assert_eq!(apply("OpenAI is down", DICT), "OpenAI is down");
        assert_eq!(apply("Kubernetes is up", DICT), "Kubernetes is up");
        assert_eq!(apply("ask Anthropic if it", DICT), "ask Anthropic if it");
    }

    #[test]
    fn fixes_near_misses_in_spelling() {
        assert_eq!(apply("deploy to cubernetes", DICT), "deploy to Kubernetes");
        assert_eq!(apply("the postgres ql database", DICT), "the PostgreSQL database");
        assert_eq!(apply("antropic released it", DICT), "Anthropic released it");
    }

    #[test]
    fn leaves_surrounding_punctuation_and_text_intact() {
        assert_eq!(
            apply("(cubernetes), then antropic.", DICT),
            "(Kubernetes), then Anthropic."
        );
        // Nothing close to a term: byte-for-byte identical.
        let untouched = "The quick brown fox jumps over the lazy dog.";
        assert_eq!(apply(untouched, DICT), untouched);
        assert_eq!(apply("", DICT), "");
        assert_eq!(apply("anything", ""), "anything");
    }

    /// The failure that makes the whole pass a liability: quietly rewriting a
    /// word the user actually meant.
    #[test]
    fn does_not_rewrite_ordinary_words() {
        for text in [
            "open the door",       // "open" alone is not "OpenAI"
            "a sri lankan recipe", // near "Srikar" only if the floor is ignored
            "the car is red",      // short words never fuzzy-match
            "he is a scholar",
            "post the results",
        ] {
            assert_eq!(apply(text, DICT), text, "rewrote: {text}");
        }
    }

    #[test]
    fn short_terms_never_fuzzy_match() {
        // Under MIN_FUZZY_LEN, only an exact folded match counts — otherwise
        // "cat" would claim "cot", "cut" and "car".
        assert_eq!(apply("the cot is here", "Cat"), "the cot is here");
        assert_eq!(apply("the kat is here", "Cat"), "the Cat is here");
    }

    #[test]
    fn one_span_is_claimed_once_by_the_best_term() {
        // Both terms are close; the exact folded match has to win.
        let dict = "Postgres, PostgreSQL";
        assert_eq!(apply("we run postgresql here", dict), "we run PostgreSQL here");
        assert_eq!(apply("we run postgres here", dict), "we run Postgres here");
    }

    #[test]
    fn folds_spellings_that_sound_alike() {
        assert_eq!(fold("PostgreSQL"), fold("postgre sql"));
        assert_eq!(fold("phone"), "fon");
        assert_eq!(fold("Sarah"), fold("sara"));
        assert_eq!(fold("knight"), fold("night"));
        assert_ne!(fold("vine"), fold("fine"));
    }

    #[test]
    fn levenshtein_counts_single_edits() {
        assert_eq!(levenshtein("kitten", "sitting"), 3);
        assert_eq!(levenshtein("abc", "abc"), 0);
        assert_eq!(levenshtein("", "abc"), 3);
        assert_eq!(levenshtein("abc", ""), 3);
    }
}
