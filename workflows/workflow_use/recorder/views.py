from typing import Any, Dict, Literal, Union

from pydantic import BaseModel

from workflow_use.schema.views import WorkflowDefinitionSchema

# --- Event Payloads ---


class RecordingStatusPayload(BaseModel):
	message: str


# --- Main Event Models (mirroring HttpEvent types from message-bus-types.ts) ---


class BaseHttpEvent(BaseModel):
	timestamp: int


class HttpWorkflowUpdateEvent(BaseHttpEvent):
	type: Literal['WORKFLOW_UPDATE'] = 'WORKFLOW_UPDATE'
	payload: WorkflowDefinitionSchema


class HttpRecordingStartedEvent(BaseHttpEvent):
	type: Literal['RECORDING_STARTED'] = 'RECORDING_STARTED'
	payload: RecordingStatusPayload


class HttpRecordingStoppedEvent(BaseHttpEvent):
	type: Literal['RECORDING_STOPPED'] = 'RECORDING_STOPPED'
	payload: RecordingStatusPayload


class HttpCustomExtractionMarkedEvent(BaseHttpEvent):
	type: Literal['CUSTOM_EXTRACTION_MARKED_EVENT'] = 'CUSTOM_EXTRACTION_MARKED_EVENT'
	payload: Dict[str, Any]  # Contains extraction data from extension


# Union of all possible event types received by the recorder
RecorderEvent = Union[
	HttpWorkflowUpdateEvent,
	HttpRecordingStartedEvent,
	HttpRecordingStoppedEvent,
	HttpCustomExtractionMarkedEvent,
]
