export interface StoredCustomClickEvent {
  timestamp: number;
  url: string;
  frameUrl: string;
  xpath: string;
  cssSelector?: string;
  elementTag: string;
  elementText: string;
  tabId: number;
  messageType: "CUSTOM_CLICK_EVENT";
  screenshot?: string;
}

export interface StoredCustomInputEvent {
  timestamp: number;
  url: string;
  frameUrl: string;
  xpath: string;
  cssSelector?: string;
  elementTag: string;
  value: string;
  tabId: number;
  messageType: "CUSTOM_INPUT_EVENT";
  screenshot?: string;
}

export interface StoredCustomSelectEvent {
  timestamp: number;
  url: string;
  frameUrl: string;
  xpath: string;
  cssSelector?: string;
  elementTag: string;
  selectedValue: string;
  selectedText: string;
  tabId: number;
  messageType: "CUSTOM_SELECT_EVENT";
  screenshot?: string;
}

export interface StoredCustomKeyEvent {
  timestamp: number;
  url: string;
  frameUrl: string;
  key: string;
  xpath?: string; // XPath of focused element
  cssSelector?: string;
  elementTag?: string;
  tabId: number;
  messageType: "CUSTOM_KEY_EVENT";
  screenshot?: string;
}

export interface StoredTabEvent {
  timestamp: number;
  tabId: number;
  messageType:
    | "CUSTOM_TAB_CREATED"
    | "CUSTOM_TAB_UPDATED"
    | "CUSTOM_TAB_ACTIVATED"
    | "CUSTOM_TAB_REMOVED";
  url?: string;
  openerTabId?: number;
  windowId?: number;
  changeInfo?: chrome.tabs.TabChangeInfo; // Relies on chrome types
  isWindowClosing?: boolean;
  index?: number;
  title?: string;
}

export interface StoredRrwebEvent {
  type: number; // rrweb EventType (consider importing if needed)
  data: any;
  timestamp: number;
  tabId: number;
  messageType: "RRWEB_EVENT";
}

export interface StoredCustomExtractionMarkedEvent {
  timestamp: number;
  url: string;
  frameUrl: string;
  xpath: string;
  cssSelector: string;
  elementTag: string;
  elementText: string;
  extractionRule: string;
  multiple: boolean;
  htmlSample: string;
  selectors: Array<{
    type: string;
    value: string;
    priority: number;
  }>;
  tabId: number;
  messageType: "CUSTOM_EXTRACTION_MARKED_EVENT";
  screenshot?: string;
}

export type StoredEvent =
  | StoredCustomClickEvent
  | StoredCustomInputEvent
  | StoredCustomSelectEvent
  | StoredCustomKeyEvent
  | StoredTabEvent
  | StoredRrwebEvent
  | StoredCustomExtractionMarkedEvent;

// --- Data Structures ---

export interface TabData {
  info: { url?: string; title?: string };
  events: StoredEvent[];
}

export interface RecordingData {
  [tabId: number]: TabData;
}
