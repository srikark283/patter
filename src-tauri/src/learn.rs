//! Dictionary suggestions mined from the edits the user makes in History.
//!
//! When someone fixes a transcript by hand they are labelling an ASR error, and
//! the fix is exactly the kind of term the Dictionary exists to hold. This
//! module finds those pairs and proposes them. It never adds anything: the
//! dictionary rewrites future transcripts, so a term learned wrongly would
//! silently corrupt everything after it with no trace of where it came from.
//!
//! The signal that separates a correction from an ordinary rewrite is phonetic
//! distance. "antropic" → "Anthropic" is what the engine misheard; "we should"
//! → "let's" is the user changing their mind. `dictionary::fold` already
//! measures that, so this reuses it rather than inventing a second notion.

use crate::db::TranscriptionRecord;
use crate::dictionary;
use serde::Serialize;

/// Times a pair must appear before it is proposed. One, because nothing is
/// applied without the user accepting it: the phonetic filter and that approval
/// are the safety, not repetition. Requiring two corrections meant the first
/// one vanished silently and the feature read as broken — the cost of a
/// suggestion the user doesn't want is one click.
const MIN_OCCURRENCES: u32 = 1;
/// Most suggestions shown at once, so a noisy history can't bury the page.
/// Sorted by count first, so the systematic mishearings are the survivors.
const MAX_SUGGESTIONS: usize = 10;
/// How alike the two words must sound. Low enough to catch a mangled proper
/// noun, high enough that swapping one word for an unrelated one never counts.
const MIN_PHONETIC_SIMILARITY: f32 = 0.6;
/// Shortest replacement worth storing. Below this it is punctuation noise or a
/// word too common to be dictionary material.
const MIN_TERM_LEN: usize = 3;
/// Newest records scanned. The whole history is on disk and this runs whenever
/// the Dictionary page opens.
///
/// `add_record` prepends, so the newest record is index 0 and this takes from
/// the front. Iterating in reverse — the obvious way to say "most recent" —
/// scans the *oldest* records instead and silently skips every recent
/// correction, which is exactly the bug that made this look dead.
///
/// ponytail: a flat cap, not an index. Revisit if histories get long enough for
/// this to show up.
const MAX_RECORDS: usize = 500;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Suggestion {
    /// The term as the user typed it — what would be added to the dictionary.
    pub term: String,
    /// What the engine produced instead, newest spelling first.
    pub replaces: Vec<String>,
    /// How many times the correction was made.
    pub count: u32,
    /// Stable identity for dismissal, `"wrong→right"`.
    pub key: String,
}

/// Corrections worth proposing, most-corrected first.
pub fn suggestions(
    history: &[TranscriptionRecord],
    dictionary_terms: &str,
    dismissed: &[String],
) -> Vec<Suggestion> {
    // (wrong, right) -> count, in first-seen order so the output is stable.
    let mut counts: Vec<(String, String, u32)> = Vec::new();

    for record in history.iter().take(MAX_RECORDS) {
        let Some(original) = record.original_text.as_deref() else {
            continue;
        };
        for (wrong, right) in substitutions(original, &record.text) {
            if !is_correction(&wrong, &right, dictionary_terms) {
                continue;
            }
            match counts
                .iter_mut()
                .find(|(w, r, _)| *w == wrong && *r == right)
            {
                Some((_, _, count)) => *count += 1,
                None => counts.push((wrong, right, 1)),
            }
        }
    }

    // Distinct misspellings of one term are one suggestion: the user cares that
    // "Anthropic" keeps coming out wrong, not about each way it comes out wrong.
    let mut merged: Vec<Suggestion> = Vec::new();
    for (wrong, right, count) in counts {
        let key = format!("{}→{}", wrong, right);
        if dismissed.iter().any(|d| *d == key) {
            continue;
        }
        match merged.iter_mut().find(|s| s.term == right) {
            Some(existing) => {
                existing.count += count;
                existing.replaces.push(wrong);
            }
            None => merged.push(Suggestion {
                term: right,
                replaces: vec![wrong],
                count,
                key,
            }),
        }
    }

    merged.retain(|s| s.count >= MIN_OCCURRENCES);
    merged.sort_by(|a, b| b.count.cmp(&a.count).then(a.term.cmp(&b.term)));
    merged.truncate(MAX_SUGGESTIONS);
    merged
}

/// Whether a (wrong → right) pair looks like the engine mishearing a term
/// rather than the user rewriting their own words.
fn is_correction(wrong: &str, right: &str, dictionary_terms: &str) -> bool {
    if wrong == right || right.chars().count() < MIN_TERM_LEN {
        return false;
    }
    // A term is only useful if it is a word. Punctuation and bare numbers are
    // formatting, which cleanup owns.
    if !right.chars().any(char::is_alphabetic) || !wrong.chars().any(char::is_alphabetic) {
        return false;
    }
    // Already handled: adding it would change nothing.
    if dictionary::apply(wrong, dictionary_terms) == right {
        return false;
    }
    dictionary::phonetic_similarity(wrong, right) >= MIN_PHONETIC_SIMILARITY
}

/// Word pairs that differ between the two texts, aligned by longest common
/// subsequence so an inserted or deleted word shifts the rest into place
/// instead of misaligning everything after it.
///
/// Only 1:1 substitutions are reported. A term the engine split across words
/// ("post gres" → "Postgres") reads as a delete plus a substitute and is
/// skipped — `dictionary::apply` handles those windows once the term is in,
/// this just won't be the thing that discovers them.
fn substitutions(original: &str, edited: &str) -> Vec<(String, String)> {
    let a = words(original);
    let b = words(edited);
    if a.is_empty() || b.is_empty() {
        return Vec::new();
    }

    // ponytail: O(n*m) table over word counts. A dictation is tens of words;
    // if meetings ever route through here, switch to a diff crate.
    let mut lcs = vec![vec![0usize; b.len() + 1]; a.len() + 1];
    for i in (0..a.len()).rev() {
        for j in (0..b.len()).rev() {
            lcs[i][j] = if a[i].eq_ignore_ascii_case(b[j]) {
                lcs[i + 1][j + 1] + 1
            } else {
                lcs[i + 1][j].max(lcs[i][j + 1])
            };
        }
    }

    let mut pairs = Vec::new();
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        if a[i].eq_ignore_ascii_case(b[j]) {
            // Same word, different spelling of it — a casing fix is a
            // correction too ("openai" → "OpenAI").
            if a[i] != b[j] {
                pairs.push((a[i].to_string(), b[j].to_string()));
            }
            i += 1;
            j += 1;
        } else if lcs[i + 1][j] == lcs[i][j + 1] {
            // The LCS is indifferent here: `a[i]` may have been replaced by
            // `b[j]`, or one of them may simply have been inserted or deleted,
            // and the table scores those identically. Picking substitution
            // blindly reports the inserted word as the correction ("antropic"
            // → "the") and loses the real pair. Sound decides it — if either
            // side lines up better one word along, that word is the insertion.
            let direct = dictionary::phonetic_similarity(a[i], b[j]);
            let a_dropped = a
                .get(i + 1)
                .map_or(0.0, |w| dictionary::phonetic_similarity(w, b[j]));
            let b_inserted = b
                .get(j + 1)
                .map_or(0.0, |w| dictionary::phonetic_similarity(a[i], w));

            if a_dropped > direct && a_dropped >= b_inserted {
                i += 1;
            } else if b_inserted > direct {
                j += 1;
            } else {
                pairs.push((a[i].to_string(), b[j].to_string()));
                i += 1;
                j += 1;
            }
        } else if lcs[i + 1][j] > lcs[i][j + 1] {
            i += 1;
        } else {
            j += 1;
        }
    }
    pairs
}

/// Words, with the punctuation between them dropped.
fn words(text: &str) -> Vec<&str> {
    text.split(|c: char| !(c.is_alphanumeric() || c == '\'' || c == '-'))
        .filter(|w| !w.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(original: &str, edited: &str) -> TranscriptionRecord {
        TranscriptionRecord {
            id: String::new(),
            timestamp_ms: 0,
            text: edited.to_string(),
            duration_seconds: 0.0,
            words: 0,
            transcribe_ms: 0,
            cleanup_ms: 0,
            total_ms: 0,
            app_name: None,
            original_text: Some(original.to_string()),
        }
    }

    #[test]
    fn proposes_a_term_corrected_more_than_once() {
        let history = vec![
            record("deploy to antropic today", "deploy to Anthropic today"),
            record("antropic shipped it", "Anthropic shipped it"),
        ];
        let found = suggestions(&history, "", &[]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].term, "Anthropic");
        assert_eq!(found[0].count, 2);
        assert_eq!(found[0].replaces, vec!["antropic"]);
    }

    /// The case that made this look broken: one correction, nothing shown.
    #[test]
    fn proposes_a_single_correction() {
        let history = vec![record("use superbase for auth", "use Supabase for auth")];
        let found = suggestions(&history, "", &[]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].term, "Supabase");
        assert_eq!(found[0].count, 1);
    }

    #[test]
    fn shows_the_most_corrected_terms_first() {
        let mut history = vec![record("try superbase now", "try Supabase now")];
        for _ in 0..3 {
            history.push(record("deploy to antropic", "deploy to Anthropic"));
        }
        let found = suggestions(&history, "", &[]);
        assert_eq!(found[0].term, "Anthropic");
        assert_eq!(found[0].count, 3);
        assert_eq!(found[1].term, "Supabase");
    }

    /// The pass is only worth having if it can tell a mishearing from someone
    /// rewording their own sentence.
    #[test]
    fn ignores_rewrites_that_are_not_mishearings() {
        let history = vec![
            record("we should ship it", "let's ship it"),
            record("we should ship it", "let's ship it"),
            record("the meeting is tuesday", "the meeting is friday"),
            record("the meeting is tuesday", "the meeting is friday"),
        ];
        assert_eq!(suggestions(&history, "", &[]), Vec::new());
    }

    #[test]
    fn merges_distinct_misspellings_of_one_term() {
        let history = vec![
            record("use cubernetes here", "use Kubernetes here"),
            record("use kubernettes here", "use Kubernetes here"),
        ];
        let found = suggestions(&history, "", &[]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].term, "Kubernetes");
        assert_eq!(found[0].count, 2);
        assert_eq!(found[0].replaces.len(), 2);
    }

    #[test]
    fn skips_what_the_dictionary_already_fixes() {
        let history = vec![
            record("use cubernetes here", "use Kubernetes here"),
            record("use cubernetes here", "use Kubernetes here"),
        ];
        // Already a term: `dictionary::apply` would have made this correction
        // itself, so proposing it again is noise.
        assert!(suggestions(&history, "Kubernetes", &[]).is_empty());
    }

    #[test]
    fn never_proposes_a_dismissed_pair() {
        let history = vec![
            record("antropic shipped", "Anthropic shipped"),
            record("antropic shipped", "Anthropic shipped"),
        ];
        let dismissed = vec!["antropic→Anthropic".to_string()];
        assert!(suggestions(&history, "", &dismissed).is_empty());
    }

    #[test]
    fn records_never_edited_carry_no_signal() {
        let mut untouched = record("a", "a");
        untouched.original_text = None;
        assert!(suggestions(&[untouched], "", &[]).is_empty());
    }

    #[test]
    fn alignment_survives_inserted_and_deleted_words() {
        // One word inserted: everything after it must still line up, or every
        // later word reads as a substitution.
        assert_eq!(
            substitutions("deploy antropic now", "deploy the Anthropic now"),
            vec![("antropic".to_string(), "Anthropic".to_string())]
        );
        assert_eq!(
            substitutions("deploy the antropic now", "deploy Anthropic now"),
            vec![("antropic".to_string(), "Anthropic".to_string())]
        );
        // Identical text yields nothing at all.
        assert_eq!(substitutions("same words here", "same words here"), Vec::new());
    }

    #[test]
    fn casing_only_fixes_count_as_corrections() {
        let history = vec![
            record("openai released it", "OpenAI released it"),
            record("openai released it", "OpenAI released it"),
        ];
        let found = suggestions(&history, "", &[]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].term, "OpenAI");
    }
}
