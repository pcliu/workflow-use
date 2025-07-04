# Browser Extension for Workflow Use

The browser extension is the core data capture component of the Workflow Use system, responsible for recording user interactions and converting them into structured workflow data.

## Architecture Overview

Built with **WXT framework**, **TypeScript**, **React**, and **rrweb**, the extension provides comprehensive browser interaction recording with real-time processing and intelligent event filtering.

### Key Components

#### 1. Content Script (`src/entrypoints/content.ts`)
**Event Capture Engine** - The primary interface between user interactions and the recording system.

**Core Responsibilities:**
- **DOM Event Recording**: Uses rrweb library for comprehensive page interaction capture
- **Custom Event Handling**: Enhances standard events with selector generation and metadata
- **Smart Element Selection**: Generates both XPath and CSS selectors for robust targeting
- **Visual Feedback**: Provides real-time overlay highlighting for recorded interactions
- **DOM Content Marking**: Advanced feature for marking elements with natural language extraction rules

**Event Types Captured:**
```typescript
// Enhanced Click Events
StoredCustomClickEvent: {
  xpath: string;           // Generated XPath selector
  cssSelector: string;     // Generated CSS selector  
  elementTag: string;      // HTML tag name
  screenshot: string;      // Base64 screenshot
  timestamp: number;
}

// Enhanced Input Events  
StoredCustomInputEvent: {
  value: string;          // Input value
  xpath: string;          // Element selector
  cssSelector: string;    // CSS selector
  timestamp: number;
}

// DOM Content Extraction Events
StoredCustomExtractionMarkedEvent: {
  extractionRule: string; // Natural language rule
  htmlSample: string;     // Captured HTML context
  multiple: boolean;      // Single vs multiple extraction
  selectors: Selector[];  // Generated selectors
}
```

**Smart Filtering Features:**
- **UI Element Filtering**: Prevents recording of extension UI interactions
- **Duplicate Prevention**: Filters consecutive identical events
- **Context Preservation**: Maintains page state and navigation context

#### 2. Background Script (`src/entrypoints/background.ts`)
**Event Processing Hub** - Central coordinator for all browser events and communication.

**Core Responsibilities:**
- **Session Management**: Maintains `sessionLogs` per tab with event aggregation
- **HTTP Communication**: Real-time event streaming to Python backend (port 7331)
- **State Synchronization**: Manages recording and content marking modes across tabs
- **Event Transformation**: Converts browser events to structured workflow steps
- **Screenshot Coordination**: Captures page screenshots for visual context

**Data Flow Architecture:**
```typescript
User Interaction → Content Script → Background Script → sessionLogs → HTTP Events → Python Backend
```

**Event Processing Pipeline:**
1. **Event Collection**: Receives events from content scripts across all tabs
2. **Event Merging**: Combines rapid sequential events (e.g., typing)
3. **Step Conversion**: Transforms events into structured workflow steps
4. **Workflow Building**: Creates complete workflow objects with metadata
5. **HTTP Transmission**: Sends workflow updates to RecordingService

#### 3. Sidepanel UI (`src/entrypoints/sidepanel/`)
**Recording Management Interface** - React-based control panel for workflow recording.

**Features:**
- **Recording Controls**: Start/stop workflow recording
- **Event Viewer**: Real-time display of captured events
- **Content Marking Mode**: Toggle for DOM content extraction
- **Session Status**: Visual indicators for recording state

## Data Capture Mechanisms

### 1. rrweb Integration
**Comprehensive DOM Recording** using the rrweb library for pixel-perfect interaction capture.

```typescript
// rrweb Event Types
Navigation Events: Page loads, URL changes, history navigation
Interaction Events: Mouse clicks, scrolls, keyboard input
DOM Mutations: Element additions, removals, attribute changes
Style Changes: CSS modifications, layout shifts
```

### 2. Custom Event Enhancement
**Enhanced Event Data** with additional context and selector information.

```typescript
// Event Enhancement Process
Browser Event → Selector Generation → Screenshot Capture → Context Addition → Storage
```

### 3. DOM Content Extraction
**Intelligent Content Marking** with natural language rule generation.

**Two-Stage Process:**
1. **User Marking**: Right-click → "Extract Content..." → Natural language input
2. **Rule Generation**: LLM converts natural language to precise extraction selectors

## Communication Protocols

### 1. Internal Communication (Content ↔ Background)
```typescript
// Chrome Runtime Messages
chrome.runtime.sendMessage({
  type: "CUSTOM_CLICK_EVENT" | "CUSTOM_INPUT_EVENT" | "RRWEB_EVENT",
  payload: EventData
});
```

### 2. External Communication (Extension ↔ Python Backend)
```typescript
// HTTP API Communication
POST http://127.0.0.1:7331/event
Content-Type: application/json

{
  type: "WORKFLOW_UPDATE",
  timestamp: number,
  payload: WorkflowDefinitionSchema
}
```

## Development Commands

```bash
# Install dependencies
npm install

# Development mode with hot reload
npm run dev

# Build for production
npm run build

# Development build (debug mode)
npm run build:dev
```

## Extension Structure

```
extension/
├── src/
│   ├── entrypoints/
│   │   ├── content.ts          # Content script - event capture
│   │   ├── background.ts       # Background script - event processing
│   │   └── sidepanel/          # React UI components
│   ├── lib/
│   │   ├── types.ts           # TypeScript type definitions
│   │   ├── message-bus-types.ts # HTTP event types
│   │   └── workflow-types.ts   # Workflow schema types
│   └── assets/                # Extension icons and resources
├── wxt.config.ts              # WXT framework configuration
└── package.json               # Dependencies and scripts
```

## Event Flow Details

### 1. Event Capture Flow
```
User Interaction → DOM Event → Content Script Handler → Event Enhancement → Background Message
```

### 2. Event Processing Flow  
```
Background Receiver → sessionLogs Storage → Step Conversion → Workflow Building → HTTP Transmission
```

### 3. Session Management Flow
```
Tab Creation → Session Init → Event Collection → Recording Stop → Session Cleanup
```

## Advanced Features

### 1. Smart Event Filtering
**Prevents UI Pollution** by filtering out extension-related interactions.

```typescript
// Filtered Elements (prevent self-recording)
#smart-extraction-overlay
#smart-extraction-dialog
#content-marking-menu
.scenario-btn
.highlight-overlay
```

### 2. Element Selector Generation
**Multi-Strategy Approach** for robust element targeting.

```typescript
// Selector Generation Strategy
1. XPath Generation: Precise path-based selectors
2. CSS Selector Generation: Modern CSS-based targeting  
3. Fallback Strategies: Multiple selector options for resilience
4. Context Preservation: Maintains element relationships
```

### 3. Visual Feedback System
**Real-time User Feedback** during recording and content marking.

```typescript
// Visual Indicators
Recording State: Red recording indicator
Content Marking: Element highlighting and overlays
Event Capture: Flash effects on interaction
Error States: Warning indicators for issues
```

## Integration Points

### 1. Python Backend Integration
- **RecordingService**: Receives real-time workflow updates
- **Event Streaming**: Continuous HTTP event transmission
- **Session Coordination**: Recording start/stop synchronization

### 2. Workflow Engine Integration
- **Schema Compliance**: Events conform to WorkflowDefinitionSchema
- **Type Safety**: Full TypeScript/Pydantic type alignment
- **Data Validation**: Client-side validation before transmission

### 3. Browser API Integration
- **Chrome Extensions API**: Tab management, runtime messaging
- **Web APIs**: DOM manipulation, screenshot capture
- **Event APIs**: Mouse, keyboard, navigation event handling

## Configuration

### 1. Server Endpoint Configuration
```typescript
// Default Python backend endpoint
const PYTHON_SERVER_ENDPOINT = "http://127.0.0.1:7331/event";
```

### 2. Recording Modes
```typescript
// Recording States
isRecordingEnabled: boolean;     // Main recording toggle
isContentMarkingEnabled: boolean; // Content extraction mode
```

### 3. Event Filtering Configuration
```typescript
// Customizable event filtering rules
UI_ELEMENT_FILTERS: string[];    // Elements to exclude from recording
EVENT_DEBOUNCE_MS: number;       // Event merging timeframe
```

This extension provides the foundation for the Workflow Use system, enabling precise browser interaction capture with intelligent processing and seamless integration with the Python workflow engine.