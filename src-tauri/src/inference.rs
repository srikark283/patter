use crate::db::Settings;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CleanupProvider {
    #[default]
    Ollama,
    #[serde(alias = "s1_mini", alias = "patter")]
    BuiltIn,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BuiltInModel {
    #[default]
    #[serde(alias = "qwen3_4b", alias = "qwen3_1_7b")]
    S1Mini,
}

pub fn cleanup(
    settings: &Settings,
    text: &str,
    extra: Option<&str>,
    app_name: Option<&str>,
    on_partial: impl FnMut(&str),
    cancelled: impl Fn() -> bool,
) -> Result<String, String> {
    match settings.cleanup_provider {
        CleanupProvider::Ollama => crate::ollama::cleanup(
            settings
                .ollama_model
                .as_deref()
                .ok_or("Select an Ollama cleanup model")?,
            text,
            extra,
            settings.ollama_keep_alive_minutes,
            on_partial,
            cancelled,
        ),
        CleanupProvider::BuiltIn => {
            crate::s1::cleanup(settings, text, extra, app_name, on_partial, cancelled)
        }
    }
}

impl BuiltInModel {
    pub fn name(self) -> &'static str {
        "S1-mini"
    }
}

/// Retire experimental models without discarding other preferences or silently
/// activating a different model with different capabilities.
pub fn load_settings(content: &str) -> Result<Settings, serde_json::Error> {
    let value: serde_json::Value = serde_json::from_str(content)?;
    let retired = matches!(
        value["built_in_model"].as_str(),
        Some("qwen3_4b" | "qwen3_1_7b")
    );
    let mut settings: Settings = serde_json::from_value(value)?;
    if retired && settings.cleanup_provider == CleanupProvider::BuiltIn {
        settings.llm_cleanup_enabled = false;
    }
    Ok(settings)
}
pub fn app_profile<'a>(settings: &'a Settings, app: &str) -> Option<&'a crate::db::AppProfile> {
    let app = app.to_lowercase();
    settings.app_profiles.iter().find(|p| {
        p.app
            .to_lowercase()
            .split(',')
            .map(str::trim)
            .any(|name| !name.is_empty() && app.contains(name))
    })
}

// Preserve older facts without embeddings when using Ollama cleanup.
pub fn local_memory_context<'a>(
    memories: impl Iterator<Item = &'a crate::db::MemoryFact>,
    transcript: &str,
) -> String {
    fn words(text: &str) -> std::collections::HashSet<String> {
        text.to_lowercase()
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| {
                w.len() >= 3
                    && ![
                        "the", "and", "for", "that", "this", "with", "from", "have", "please",
                        "about",
                    ]
                    .contains(w)
            })
            .map(str::to_owned)
            .collect()
    }
    let query = words(transcript);
    let mut memories: Vec<_> = memories
        .enumerate()
        .filter_map(|(index, fact)| {
            let score = words(&fact.content).intersection(&query).count();
            (score > 0).then_some((score, index, &fact.content))
        })
        .collect();
    memories.sort_by_key(|(score, index, _)| (std::cmp::Reverse(*score), *index));
    let facts: Vec<_> = memories
        .into_iter()
        .take(3)
        .map(|(_, _, fact)| format!("- {}", fact.chars().take(1200).collect::<String>()))
        .collect();
    if facts.is_empty() {
        String::new()
    } else {
        format!("Relevant facts from user's memory:\n{}", facts.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_providers_migrate_without_changing_ollama_selection() {
        for (saved, expected) in [
            ("ollama", CleanupProvider::Ollama),
            ("s1_mini", CleanupProvider::BuiltIn),
            ("patter", CleanupProvider::BuiltIn),
            ("built_in", CleanupProvider::BuiltIn),
        ] {
            let mut value = serde_json::to_value(Settings::default()).unwrap();
            value["cleanup_provider"] = saved.into();
            value["ollama_model"] = "my-local-model".into();
            value.as_object_mut().unwrap().remove("built_in_model");
            // Old manual controls are ignored rather than silently remaining active.
            value["s1_options"] =
                serde_json::json!({"styling":"casual","structure":"lists","context":"email"});
            let settings: Settings = serde_json::from_value(value).unwrap();
            assert_eq!(settings.cleanup_provider, expected);
            assert_eq!(settings.built_in_model, BuiltInModel::S1Mini);
            assert_eq!(settings.ollama_model.as_deref(), Some("my-local-model"));
            assert!(serde_json::to_value(settings)
                .unwrap()
                .get("s1_options")
                .is_none());
        }
        assert_eq!(
            serde_json::to_value(CleanupProvider::BuiltIn).unwrap(),
            "built_in"
        );
        assert_eq!(
            serde_json::to_value(BuiltInModel::S1Mini).unwrap(),
            "s1_mini"
        );
    }

    #[test]
    fn retired_models_require_setup_and_preserve_unrelated_preferences() {
        for retired in ["qwen3_4b", "qwen3_1_7b"] {
            let mut value = serde_json::to_value(Settings::default()).unwrap();
            value["cleanup_provider"] = "built_in".into();
            value["built_in_model"] = retired.into();
            value["llm_cleanup_enabled"] = true.into();
            value["ollama_model"] = "keep-my-model".into();
            value["language"] = "fr".into();
            let settings = load_settings(&value.to_string()).unwrap();
            assert_eq!(settings.built_in_model, BuiltInModel::S1Mini);
            assert!(!settings.llm_cleanup_enabled);
            assert_eq!(settings.ollama_model.as_deref(), Some("keep-my-model"));
            assert_eq!(settings.language, "fr");
            value["cleanup_provider"] = "ollama".into();
            assert!(
                load_settings(&value.to_string())
                    .unwrap()
                    .llm_cleanup_enabled
            );
        }
    }
    #[test]
    fn local_memory_lookup_works_without_embeddings_and_excludes_unrelated_facts() {
        let mut settings = Settings::default();
        settings.memories = [
            "Orbit deploys on Thursdays.",
            "I like green tea.",
            "Orbit's owner is Maya.",
        ]
        .into_iter()
        .enumerate()
        .map(|(i, content)| crate::db::MemoryFact {
            id: i.to_string(),
            content: content.into(),
            embedding: vec![],
        })
        .collect();
        let context = local_memory_context(settings.memories.iter(), "send an Orbit update");
        assert!(context.contains("Thursdays") && context.contains("Maya"));
        assert!(!context.contains("tea"));
        assert!(local_memory_context(settings.memories.iter(), "hello there").is_empty());
    }
    #[test]
    fn old_settings_still_select_ollama() {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        value.as_object_mut().unwrap().remove("cleanup_provider");
        let settings: Settings = serde_json::from_value(value).unwrap();
        assert_eq!(settings.cleanup_provider, CleanupProvider::Ollama);
    }
}
