use anyhow::{ensure, Result};
use monocode_companion_core::validate_command;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingCommand {
    pub version: u8,
    pub host_id: String,
    pub request_id: String,
    pub action: String,
    pub input: Value,
}

pub fn is_mutation(action: &str) -> bool {
    matches!(
        action,
        "sessions.send"
            | "sessions.approve"
            | "sessions.answer"
            | "sessions.question.keepOpen"
            | "sessions.stop"
            | "sessions.configure"
            | "sessions.create"
    )
}

impl PendingCommand {
    pub fn validate(&self, host_id: &str) -> Result<()> {
        ensure!(self.version == 1, "Unsupported saved command version");
        ensure!(
            self.host_id == host_id,
            "Saved command belongs to a different Mac"
        );
        ensure!(is_mutation(&self.action), "Invalid saved command action");
        validate_command(&self.request_id, &self.action, &self.input)?;
        ensure!(
            serde_json::to_vec(self)?.len() <= 256 * 1024,
            "Saved command is too large"
        );
        Ok(())
    }

    pub fn matches_retry(&self, next: &Self) -> bool {
        self == next
    }
}

pub fn definitive_response(response: &Value, is_retry: bool) -> bool {
    // Malformed replies must never erase the only recovery record.
    match response.get("ok").and_then(Value::as_bool) {
        Some(true) => {
            response
                .pointer("/result/accepted")
                .and_then(Value::as_bool)
                == Some(true)
        }
        // A rejected retry does not establish whether its earlier attempt ran.
        Some(false) => {
            // Older desktop builds omit the flag on control timeouts. Match the
            // UI's legacy interpretation so app termination cannot lose recovery.
            let uncertain = response
                .get("outcomeUnknown")
                .and_then(Value::as_bool)
                .unwrap_or_else(|| {
                    let error = response["error"]
                        .as_str()
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    ["unknown", "timeout", "time out", "timedout", "timed out"]
                        .iter()
                        .any(|word| error.contains(word))
                });
            !is_retry && !uncertain
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn command() -> PendingCommand {
        PendingCommand {
            version: 1,
            host_id: "host-one".into(),
            request_id: "request-one".into(),
            action: "sessions.send".into(),
            input: json!({"epoch":"e", "sessionId":"s", "turn":1, "text":"once"}),
        }
    }

    #[test]
    fn restored_command_keeps_exact_retry_and_host_binding() {
        let original = command();
        let restored: PendingCommand =
            serde_json::from_slice(&serde_json::to_vec(&original).unwrap()).unwrap();
        restored.validate("host-one").unwrap();
        assert!(original.matches_retry(&restored));
        assert!(restored.validate("host-two").is_err());
        let mut changed = restored;
        changed.input["text"] = json!("twice");
        assert!(!original.matches_retry(&changed));
    }

    #[test]
    fn configuration_changes_keep_exact_values_for_recovery() {
        let mut original = command();
        original.action = "sessions.configure".into();
        original.input =
            json!({"epoch":"e", "sessionId":"s", "turn":1, "runtimeMode":"supervised"});
        let restored: PendingCommand =
            serde_json::from_slice(&serde_json::to_vec(&original).unwrap()).unwrap();
        restored.validate("host-one").unwrap();
        assert!(is_mutation(&restored.action));
        assert!(original.matches_retry(&restored));
        let mut changed = restored;
        changed.input["runtimeMode"] = json!("autonomous");
        assert!(!original.matches_retry(&changed));
    }

    #[test]
    fn question_answers_preserve_nested_choices_for_recovery() {
        let mut original = command();
        original.action = "sessions.answer".into();
        original.input = json!({"epoch":"e", "sessionId":"s", "turn":1, "questionId":7,
            "reply":{"kind":"answered","answers":{"section":["docs"]}}});
        let restored: PendingCommand =
            serde_json::from_slice(&serde_json::to_vec(&original).unwrap()).unwrap();
        restored.validate("host-one").unwrap();
        assert!(is_mutation(&restored.action));
        assert!(is_mutation("sessions.question.keepOpen"));
        assert!(!is_mutation("sessions.review.read"));
        assert!(original.matches_retry(&restored));
        let mut changed = restored;
        changed.input["reply"]["answers"]["section"] = json!(["tasks"]);
        assert!(!original.matches_retry(&changed));
    }

    #[test]
    fn session_creation_keeps_the_same_project_and_session_on_retry() {
        let mut original = command();
        original.action = "sessions.create".into();
        original.input = json!({"epoch":"e", "sessionId":"new-session", "projectId":"/app"});
        let restored: PendingCommand =
            serde_json::from_slice(&serde_json::to_vec(&original).unwrap()).unwrap();
        restored.validate("host-one").unwrap();
        assert!(original.matches_retry(&restored));
        let mut changed = restored;
        changed.input["sessionId"] = json!("duplicate-session");
        assert!(!original.matches_retry(&changed));
    }

    #[test]
    fn uncertainty_and_malformed_responses_keep_the_record() {
        assert!(!definitive_response(
            &json!({"ok":false,"outcomeUnknown":true}),
            false
        ));
        assert!(!definitive_response(&json!({"error":"broken"}), false));
        assert!(!definitive_response(&json!({"ok":true}), false));
        assert!(definitive_response(
            &json!({"ok":true,"result":{"accepted":true}}),
            true
        ));
        assert!(definitive_response(
            &json!({"ok":false,"error":"stale epoch"}),
            false
        ));
        assert!(!definitive_response(
            &json!({"ok":false,"error":"stale epoch"}),
            true
        ));
    }

    #[test]
    fn legacy_desktop_timeouts_keep_recovery_unless_explicitly_rejected() {
        for message in [
            "Control request timed out. Retry with the same request ID.",
            "TIMEOUT",
            "Command outcome unknown",
            "Receipt timedout",
            "Receipt time out",
        ] {
            let mut response = json!({"ok":false,"error":message});
            assert!(!definitive_response(&response, false));
            response["outcomeUnknown"] = json!(false);
            assert!(definitive_response(&response, false));
            assert!(!definitive_response(&response, true));
        }
    }
}
