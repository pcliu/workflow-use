# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Workflow Use is a deterministic, self-healing workflow automation system (RPA 2.0) that records browser interactions and converts them into reusable, structured workflows. Built on top of Browser Use, it allows users to record workflows once and replay them indefinitely with variables.

## Architecture

This is a multi-component system with three main parts:

### 1. Browser Extension (`/extension/`)
- **Technology**: TypeScript, React, WXT framework, Tailwind CSS
- **Purpose**: Records user browser interactions using rrweb and Chrome extension APIs
- **Key Files**:
  - `src/entrypoints/content.ts` - Content script that captures user interactions (clicks, inputs, navigation)
  - `src/entrypoints/background.ts` - Background script for event processing
  - `src/entrypoints/sidepanel/` - React-based UI for recording management

### 2. Workflow Engine (`/workflows/`)
- **Technology**: Python, FastAPI, Browser Use, LangChain, Playwright
- **Purpose**: Core workflow processing, recording, building, and execution
- **Key Components**:
  - `workflow_use/recorder/service.py` - Recording service that manages browser sessions
  - `workflow_use/builder/service.py` - LLM-powered workflow builder that converts recordings to executable workflows
  - `workflow_use/workflow/service.py` - Workflow execution engine with deterministic and agentic steps
  - `workflow_use/controller/service.py` - Browser automation controller with DOM-based actions

### 3. Web UI (`/ui/`)
- **Technology**: React, TypeScript, Vite, Tailwind CSS, XYFlow
- **Purpose**: Visual workflow management interface
- **Features**: Interactive workflow graphs, execution monitoring, parameter editing

## Development Commands

### Python Workflow Engine
```bash
cd workflows
uv sync                    # Install dependencies
source .venv/bin/activate  # REQUIRED: Activate virtual environment (macOS/Linux)
playwright install chromium # Install browser

# IMPORTANT: All Python commands must be run with virtual environment activated
# Use: source .venv/bin/activate before running any Python code

# CLI Commands
python cli.py --help                                    # Show all commands
python cli.py create-workflow                           # Record new workflow
python cli.py run-workflow examples/example.workflow.json  # Run with predefined variables
python cli.py run-as-tool examples/example.workflow.json --prompt "fill form"  # Run as tool
python cli.py launch-gui                                # Start web UI

# Backend API
uvicorn backend.api:app --reload  # Start FastAPI server
```

### Browser Extension
```bash
cd extension
npm install     # Install dependencies
npm run build   # Build extension
npm run dev     # Development mode
```

### Web UI
```bash
cd ui
npm install     # Install dependencies
npm run dev     # Start development server
npm run build   # Build for production
npm run lint    # Lint TypeScript/React code
```

### Code Quality
```bash
cd workflows
ruff check      # Lint Python code
ruff format     # Format Python code
```

## Workflow System Architecture

### Recording Flow
1. **Extension Capture**: Browser extension records user interactions with CSS selectors, XPath, and screenshots
2. **Event Processing**: Background script processes and stores events with timestamps and context
3. **Workflow Building**: LLM analyzes recorded events and generates structured workflow JSON with variables

### Execution Flow
1. **Workflow Loading**: Parse workflow JSON with input schema and steps
2. **Step Execution**: Execute deterministic steps (clicks, inputs) or agentic steps (Browser Use agent)
3. **Content Extraction**: `extract_page_content` action uses LLM to extract structured data from pages
4. **Fallback Mechanism**: Failed deterministic steps fallback to Browser Use agent

### Core Components

**WorkflowController** (`workflow_use/controller/service.py`):
- Extends Browser Use controller with deterministic actions
- Implements DOM-based element selection with multiple fallback strategies
- Provides `extract_page_content` for LLM-powered content extraction

**BuilderService** (`workflow_use/builder/service.py`):
- Converts recorded events to executable workflows using LLM analysis
- Generates dynamic input schemas for workflow reusability
- Supports vision-enabled LLMs for screenshot analysis

**Workflow** (`workflow_use/workflow/service.py`):
- Orchestrates step execution with variable substitution
- Supports structured output via Pydantic models
- Handles both deterministic and agentic workflow steps

### Key Workflow Step Types
- **Deterministic**: `click`, `input`, `navigation`, `scroll`, `select_dropdown`, `key_press`
- **Agentic**: `agent` - Uses Browser Use agent for dynamic content interaction
- **Extraction**: 
  - `extract_page_content` - LLM-powered content extraction with structured output
  - `extract_dom_content` - NEW: Two-stage DOM content extraction with intelligent parsing

## DOM Content Extraction - Two-Stage Approach

### Stage 1: Recording (Low-complexity User Input)
**Simplified User Experience**:
1. Right-click on any HTML element
2. **Single menu option**: "Extract Content..." opens intelligent dialog
3. Rich modal dialog for natural language input:
   ```
   Smart Content Extraction
   ┌─────────────────────────────────────┐
   │ Describe what content to extract:   │
   │ ┌─────────────────────────────────┐ │
   │ │ Extract rating, title and review│ │
   │ │ content from each comment,      │ │
   │ │ ignore ads and timestamps       │ │
   │ └─────────────────────────────────┘ │
   │                                   │
   │ ⚙️ Common Scenarios:                │
   │ [Reviews] [Products] [Articles]     │
   │                                   │
   │ 📊 Extraction Mode:                │
   │ ○ Single element ● Multiple items  │
   │                                   │
   │ [Extract] [Cancel]                  │
   └─────────────────────────────────────┘
   ```

**Menu Simplification**:
- **Before**: 5+ technical options (Extract Text, Extract HTML, Extract Attribute, etc.)
- **After**: Single "Extract Content..." option
- **Rationale**: Natural language can express all extraction needs, reducing cognitive load

**Generated Initial JSON**:
```json
{
  "type": "extract_dom_content",
  "selectors": [{"type": "css", "value": "div.review-container"}],
  "extractConfig": {
    "contentType": "intelligent",
    "extractionRule": "Extract rating, title and content, ignore ads and timestamps",
    "multiple": true
  },
  "rawHTML": "<captured HTML sample>"
}
```

### Stage 2: LLM Refinement (High-precision Rule Generation)
**BuilderService Enhancement**:
- Analyzes captured HTML structure and natural language rules
- Uses LLM to generate precise CSS selectors for each target field
- Creates structured extraction schema with field mappings
- Handles edge cases and missing data scenarios

**Refined Output**:
```json
{
  "containerSelector": "div.review-item",
  "fields": [
    {"name": "rating", "selector": ".star-rating", "type": "text"},
    {"name": "title", "selector": "h3.title", "type": "text"},
    {"name": "content", "selector": ".review-text", "type": "text"}
  ],
  "excludeSelectors": [".ad-banner", ".timestamp"]
}
```

### Benefits:
- **Lower User Complexity**: Natural language vs technical selectors
- **Higher Accuracy**: LLM understanding vs manual rule creation
- **Better Resilience**: Adaptive to page structure changes
- **Improved UX**: Single interaction vs multiple precise clicks

### UI Event Filtering (Recording Clean-up)
**Problem**: Menu interactions were being recorded as workflow steps
**Solution**: Precise filtering strategy that preserves normal page interactions
- **Exact Element Filtering**: Only filter specific extraction UI elements
- **Event Prevention**: `preventDefault()` + `stopImmediatePropagation()` on UI interactions
- **Selective Detection**: Filter only by exact IDs and specific class matches
- **Result**: Clean workflows without UI pollution, normal page clicks still recorded

**Filtered Elements (Exact Match Only)**:
- `#smart-extraction-overlay`, `#smart-extraction-dialog`, `#content-marking-menu`
- `#extraction-description`, `#extraction-confirm`, `#extraction-cancel`
- `.scenario-btn`, `.highlight-overlay`, `.marked-content-highlight`
- **Normal page elements**: Still recorded as expected

## Environment Setup

1. Copy `.env.example` to `.env` and add your `OPENAI_API_KEY`
2. The system uses GPT-4o for workflow building and GPT-4o-mini for content extraction
3. Requires Chromium browser for automation (installed via Playwright)

## File Structure Notes

- `/workflows/examples/` contains sample workflow JSON files
- `/workflows/tmp/` stores temporary recordings during development
- Browser extension builds to `/extension/.output/`
- Workflow definitions follow JSON schema in `workflow_use/schema/views.py`

## MCP Integration

The system exposes workflows as MCP (Model Context Protocol) tools via `workflow_use/mcp/service.py`, allowing integration with Claude and other AI systems.