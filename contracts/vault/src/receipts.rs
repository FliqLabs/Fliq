use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};

#[near_sdk::near(event_json(standard = "fliq", version = "1.0.0"))]
#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrderRegisteredEvent {
    pub order_id: String,
}

#[near_sdk::near(event_json(standard = "fliq", version = "1.0.0"))]
#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PayoutExecutedEvent {
    pub order_id: String,
}

#[near_sdk::near(event_json(standard = "fliq", version = "1.0.0"))]
#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatusSetEvent {
    pub order_id: String,
    pub status: String,
}

#[near_sdk::near(event_json(standard = "fliq", version = "1.0.0"))]
#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecreditedEvent {
    pub order_id: String,
    pub amount: String,
}

// OPEN: event payload fields need backend approval; these payloads contain no personal data.
