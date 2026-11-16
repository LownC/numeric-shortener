use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CreateOutcome {
    Created { id: String, short_url: String },
    InvalidUrl { message: String },
    Unavailable { kind: String, message: String },
}
