from typing import List, Literal, Optional

from pydantic import BaseModel


# Shared config allowing extra fields so recorder payloads pass through
class _BaseExtra(BaseModel):
	"""Base model ignoring unknown fields."""

	class Config:
		extra = 'ignore'


# Mixin for shared step metadata (timestamp and tab context)
class StepMeta(_BaseExtra):
	timestamp: Optional[int] = None
	tabId: Optional[int] = None


# Common optional fields present in recorder events
class RecorderBase(StepMeta):
	xpath: Optional[str] = None
	elementTag: Optional[str] = None
	elementText: Optional[str] = None
	frameUrl: Optional[str] = None
	screenshot: Optional[str] = None


class ClickElementDeterministicAction(RecorderBase):
	"""Parameters for clicking an element identified by CSS selector."""

	type: Literal['click']
	cssSelector: str


class InputTextDeterministicAction(RecorderBase):
	"""Parameters for entering text into an input field identified by CSS selector."""

	type: Literal['input']
	cssSelector: str
	value: str


class SelectDropdownOptionDeterministicAction(RecorderBase):
	"""Parameters for selecting a dropdown option identified by *selector* and *text*."""

	type: Literal['select_change']
	cssSelector: str
	selectedValue: str
	selectedText: str


class KeyPressDeterministicAction(RecorderBase):
	"""Parameters for pressing a key on an element identified by CSS selector."""

	type: Literal['key_press']
	cssSelector: str
	key: str


class NavigationAction(_BaseExtra):
	"""Parameters for navigating to a URL."""

	type: Literal['navigation']
	url: str


class ScrollDeterministicAction(_BaseExtra):
	"""Parameters for scrolling the page by x/y offsets (pixels)."""

	type: Literal['scroll']
	scrollX: int = 0
	scrollY: int = 0
	targetId: Optional[int] = None


class PageExtractionAction(_BaseExtra):
	"""Parameters for extracting content from the page."""

	type: Literal['extract_page_content']
	goal: str


class DOMExtractionField(BaseModel):
	"""Schema for individual fields to extract from DOM elements."""
	name: str
	selector: Optional[str] = None
	xpath: Optional[str] = None  # Support both CSS selector and XPath
	type: Literal['text', 'href', 'src', 'attribute'] = 'text'
	attribute: Optional[str] = None


class DOMExtractionAction(RecorderBase):
	"""Parameters for extracting DOM content using structured field definitions."""

	type: Literal['extract_dom_content']
	containerSelector: Optional[str] = None      # CSS selector for container element
	containerXpath: Optional[str] = None         # XPath for container element (support both formats)
	fields: List[DOMExtractionField]             # Structured field definitions
	multiple: bool = False                       # Whether to extract multiple containers
	excludeSelectors: Optional[List[str]] = None # CSS selectors to exclude
	excludeXpaths: Optional[List[str]] = None    # XPath selectors to exclude
	extractionRule: Optional[str] = None         # Original natural language rule (informational)
	htmlSample: Optional[str] = None             # HTML sample for reference (informational)
