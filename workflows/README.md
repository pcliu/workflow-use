# Workflow Engine for Workflow Use

The Python workflow engine is the core processing component that converts browser recordings into executable, LLM-enhanced workflows with deterministic automation capabilities.

## Architecture Overview

Built with **Python**, **FastAPI**, **Browser Use**, **LangChain**, and **Playwright**, the workflow engine provides intelligent workflow generation, robust execution, and seamless integration with the browser extension.

### Core Services

#### 1. RecordingService (`workflow_use/recorder/service.py`)
**Browser Recording Coordinator** - Manages browser sessions and captures workflow data from the extension.

**Core Responsibilities:**
- **Browser Management**: Launches Chromium with extension pre-loaded using Playwright
- **HTTP Event Server**: FastAPI server accepting real-time events from extension (port 7331)
- **Session Lifecycle**: Manages recording start/stop and browser lifecycle
- **Event Queue Processing**: Asynchronous event processing pipeline
- **Workflow Capture**: Converts session events to WorkflowDefinitionSchema

**Event Processing Pipeline:**
```python
# Event Reception Flow
Extension HTTP POST → _handle_event_post() → Event Queue → _process_event_queue()
                  ↓
HTTP Events: WORKFLOW_UPDATE, RECORDING_STARTED, RECORDING_STOPPED
                  ↓
Final Workflow: WorkflowDefinitionSchema with structured steps
```

**Key Methods:**
```python
async def capture_workflow() -> WorkflowDefinitionSchema:
    # 1. Launch browser with extension
    # 2. Start FastAPI server for event reception  
    # 3. Process events in real-time
    # 4. Return final workflow on recording stop

async def _handle_event_post(event_data: RecorderEvent):
    # Process HTTP events from extension
    # Store latest workflow updates
    # Queue events for processing
```

#### 2. BuilderService (`workflow_use/builder/service.py`)
**LLM-Powered Workflow Generator** - Converts raw recordings into optimized, executable workflows.

**Core Responsibilities:**
- **LLM Analysis**: Uses GPT-4o to analyze recorded events and generate structured workflows
- **Vision Integration**: Processes screenshots for visual context understanding
- **DOM Content Refinement**: Converts natural language extraction rules to precise XPath selectors
- **Event Optimization**: Filters redundant events and optimizes step sequences
- **Schema Validation**: Ensures output conforms to WorkflowDefinitionSchema

**Workflow Building Pipeline:**
```python
# Workflow Generation Flow
Raw Recording → LLM Analysis → Event Filtering → DOM Content Refinement → Final Workflow
```

**Key Features:**
```python
# Optimized LLM-Powered Analysis with Caching
async def build_workflow_from_path(recording_path: str) -> WorkflowDefinitionSchema:
    # 1. Load and validate recording
    # 2. Filter redundant navigation events
    # 3. Process DOM content extraction with unified LLM invocation
    # 4. Generate input schema for workflow reusability
    # 5. Create final optimized workflow using cached actions metadata

# DOM Content Extraction Enhancement (Synchronous)
def _process_dom_content_marking(self, steps: List[Any]) -> List[Any]:
    # Convert natural language extraction rules to precise selectors
    # Use unified JSON parsing with markdown cleanup
    # Create robust XPath selectors with validation and normalization
    
# Unified LLM Invocation with Fallback
async def _invoke_llm_with_fallback(self, messages: list) -> WorkflowDefinitionSchema:
    # Single point for all LLM invocations with structured output
    # Graceful fallback to manual JSON parsing
    # Unified error handling and response processing
```

#### 3. WorkflowController (`workflow_use/controller/service.py`)
**Workflow Execution Engine** - Executes workflows with deterministic actions and intelligent fallbacks.

**Core Responsibilities:**
- **Step Execution**: Deterministic browser automation with multiple selector strategies
- **Content Extraction**: LLM-powered page content extraction with structured output
- **Fallback Mechanisms**: Failed deterministic steps automatically fall back to Browser Use agent
- **DOM Operations**: Advanced element selection with XPath, CSS, and visual targeting

**Execution Flow:**
```python
# Workflow Execution Pipeline
Workflow JSON → Step Processing → Browser Actions → Content Extraction → Results
                    ↓
Deterministic Steps: click, input, navigation, scroll
                    ↓
Agentic Steps: agent (Browser Use), extract_page_content (LLM)
```

**Key Capabilities:**
```python
# Enhanced Browser Actions with Multi-Strategy Selection
async def click(params: ClickElementDeterministicAction, browser_session: Browser):
    # Multi-strategy element selection (XPath, CSS, fallback)
    # Native browser element targeting with timeout handling
    # Detailed logging and error reporting

# Advanced DOM Content Extraction
async def extract_dom_content(params: DOMExtractionAction, browser_session: Browser):
    # Native XPath evaluation with document.evaluate()
    # Support for text nodes, attributes, and complex selectors
    # Intelligent XPath normalization (id() → //*[@id='...'])
    # Multiple fallback strategies for robust element selection

# LLM-Powered Page Content Extraction
async def extract_page_content(params: PageExtractionAction, browser_session: Browser):
    # Markdown conversion with iframe content inclusion
    # Structured output with Pydantic validation
    # Context-aware content understanding with goal-based extraction
```

## Data Flow Architecture

### Phase 1: Recording Capture
```
Browser Extension → HTTP Events → RecordingService
├── Real-time event streaming
├── Session management
└── Workflow data aggregation
```

### Phase 2: Workflow Building
```
RecordingService → Raw Recording → BuilderService → LLM Analysis → Optimized Workflow
├── Event filtering and deduplication
├── DOM content extraction refinement
├── Vision-enhanced understanding
└── Input schema generation
```

### Phase 3: Workflow Execution
```
Workflow JSON → WorkflowController → Browser Automation → Results
├── Deterministic step execution
├── Agentic fallback mechanisms
└── Structured content extraction
```

## Key Data Structures

### Recording Schema
```python
# Event Types (from Extension)
HttpWorkflowUpdateEvent: {
    type: "WORKFLOW_UPDATE",
    payload: WorkflowDefinitionSchema
}

HttpRecordingStoppedEvent: {
    type: "RECORDING_STOPPED", 
    payload: RecordingStatusPayload
}
```

### Workflow Schema
```python
# Step Types
ClickStep: {
    type: "click",
    xpath: str,
    cssSelector: str,
    elementTag: str
}

InputStep: {
    type: "input", 
    xpath: str,
    value: str
}

AgentTaskWorkflowStep: {
    type: "agent",
    task: str,
    max_steps: int
}

DOMContentExtractionStep: {
    type: "extract_dom_content",
    containerXpath: str,
    fields: List[ExtractionField]
}

# Top-level Workflow
WorkflowDefinitionSchema: {
    name: str,
    description: str,
    version: str,
    steps: List[WorkflowStep],
    input_schema: List[WorkflowInputSchemaDefinition]
}
```

## Development Commands

### Environment Setup
```bash
# Install dependencies with uv
uv sync

# Activate virtual environment (REQUIRED)
source .venv/bin/activate

# Install browser automation
playwright install chromium
```

### CLI Commands
```bash
# Record new workflow
python cli.py create-workflow

# Run workflow with variables
python cli.py run-workflow examples/example.workflow.json

# Run workflow as tool with natural language
python cli.py run-as-tool examples/example.workflow.json --prompt "fill form with data"

# Launch web UI
python cli.py launch-gui
```

### Backend API
```bash
# Start FastAPI server for web UI
uvicorn backend.api:app --reload
```

### Code Quality
```bash
# Lint Python code
ruff check

# Format Python code  
ruff format
```

## Service Integration

### 1. RecordingService ↔ Extension
```python
# HTTP API Integration
@app.post("/event")
async def _handle_event_post(event_data: RecorderEvent):
    # Real-time event processing from browser extension
    # Workflow data aggregation and storage
    return {"status": "accepted"}
```

### 2. BuilderService ↔ RecordingService
```python
# Workflow Enhancement Pipeline
recording_data = await recording_service.capture_workflow()
enhanced_workflow = await builder_service.build_workflow_from_path(recording_data)
```

### 3. WorkflowController ↔ Browser Use
```python
# Intelligent Automation Integration  
from browser_use import Browser, BrowserController

class WorkflowController(BrowserController):
    # Enhanced browser automation with workflow-specific features
    # Seamless integration with Browser Use agent capabilities
```

## Advanced Features

### 1. Optimized LLM-Powered Workflow Building
**Performance-Enhanced Analysis** with caching, unified JSON parsing, and intelligent workflow generation.

```python
# Optimized LLM Configuration with Caching
class BuilderService:
    def __init__(self, llm: BaseChatModel):
        self.llm = self._configure_structured_llm(llm)
        self._actions_markdown_cache = None  # Performance optimization
    
    @property 
    def actions_markdown(self) -> str:
        # Cached actions metadata to avoid repeated WorkflowController instantiation

# Unified JSON Response Processing
def _extract_json_from_response(self, response_text: str) -> str:
    # Handles ```json blocks, generic ``` blocks, and raw JSON
    # Single utility for all LLM response parsing needs
```

### 2. Advanced DOM Content Extraction
**Native XPath Evaluation** with intelligent normalization and multi-strategy selection.

```python
# Native Browser XPath Evaluation
async def _extract_text_via_xpath(self, element, xpath: str):
    # Uses document.evaluate() in browser context
    # Supports text nodes (/text()), attributes (/@attr), and element queries
    # Returns TextElementWrapper for unified handling

# XPath Normalization and Validation
def _normalize_xpath(self, xpath: str) -> str:
    # Converts .id('info') → //*[@id='info']
    # Handles various XPath format variations
    
# Multi-Strategy Element Selection
async def _find_field_element_with_fallback(self, container, field):
    # 1. Try XPath (with text node support)
    # 2. Try CSS selector fallback
    # 3. Try generated fallback selectors based on field name
```

### 3. Enhanced Self-Healing Execution
**Intelligent Element Selection** with native XPath evaluation and fallback strategies.

```python
# Advanced Element Selection Pipeline
async def get_best_element_handle(page, css_selector, params, timeout_ms):
    # 1. Primary CSS selector with timeout
    # 2. XPath selector from params.xpath if available
    # 3. Attribute-based targeting (data-*, id, class)
    # 4. Text content matching with normalization
    # 5. Generated fallback selectors based on element context
    # 6. Browser Use agent as final fallback

# Native XPath Support with Validation
def _is_text_xpath(self, xpath: str) -> bool:
    # Detects text nodes: /text(), /following-sibling::text()
    # Detects attributes: /@href, /@class
    # Ensures proper evaluation strategy selection
```

### 4. Structured Content Extraction
**LLM-Powered Content Understanding** with Pydantic schema validation.

```python
# Type-Safe Content Extraction
@dataclass
class ProductInfo:
    name: str
    price: float
    rating: Optional[float]

result = await controller.extract_page_content(
    "Extract product information",
    output_schema=ProductInfo
)
```

## Configuration

### 1. Environment Variables
```bash
# Required
OPENAI_API_KEY=your_openai_api_key

# Optional  
RECORDING_SERVER_PORT=7331
BROWSER_HEADLESS=false
```

### 2. Service Configuration
```python
# RecordingService Settings
USER_DATA_DIR = SCRIPT_DIR / 'user_data_dir'
EXT_DIR = SCRIPT_DIR.parent.parent.parent / 'extension' / '.output' / 'chrome-mv3'

# BuilderService Settings  
DEFAULT_LLM_MODEL = "gpt-4o"
EXTRACTION_LLM_MODEL = "gpt-4o-mini"
```

### 3. Browser Configuration
```python
# Browser Profile for Extension Loading
BrowserProfile(
    headless=False,
    user_data_dir=str(USER_DATA_DIR),
    args=[
        f'--disable-extensions-except={EXT_DIR}',
        f'--load-extension={EXT_DIR}',
        '--no-default-browser-check'
    ]
)
```

## File Structure

```
workflows/
├── cli.py                     # Command-line interface
├── backend/                   # FastAPI web server
│   ├── api.py                # Main API routes
│   └── service.py            # Backend service logic
├── workflow_use/
│   ├── recorder/             # Recording service
│   │   ├── service.py        # Browser recording coordination
│   │   └── views.py          # HTTP event schemas
│   ├── builder/              # Workflow building service
│   │   ├── service.py        # LLM-powered workflow generation
│   │   └── prompts.py        # LLM prompt templates
│   ├── controller/           # Workflow execution
│   │   ├── service.py        # Enhanced browser controller
│   │   └── utils.py          # Utility functions
│   ├── workflow/             # Workflow processing
│   │   ├── service.py        # Workflow orchestration
│   │   └── views.py          # Workflow execution schemas
│   ├── schema/               # Pydantic schemas
│   │   └── views.py          # Core data models
│   └── mcp/                  # Model Context Protocol
│       └── service.py        # MCP integration
├── examples/                 # Sample workflows
└── tmp/                      # Temporary files and recordings
```

## Integration Points

### 1. Browser Extension Integration
- **Real-time Communication**: HTTP event streaming from extension
- **Schema Alignment**: TypeScript/Pydantic type synchronization  
- **Event Processing**: Seamless workflow data aggregation

### 2. LLM Integration
- **OpenAI GPT-4o**: Workflow analysis and generation
- **Vision Capabilities**: Screenshot understanding for context
- **Structured Output**: Pydantic schema enforcement

### 3. Browser Use Integration
- **Enhanced Controller**: Extended BrowserController with workflow features
- **Agent Fallbacks**: Automatic fallback to Browser Use agent
- **Deterministic + Agentic**: Hybrid automation approach

### 4. MCP Integration
- **Tool Exposure**: Workflows as MCP tools for Claude integration
- **Service Discovery**: Automatic workflow tool registration
- **Parameter Handling**: Dynamic input schema management

This workflow engine provides the intelligent automation backbone for the Workflow Use system, combining deterministic browser automation with LLM-powered workflow generation and execution capabilities.