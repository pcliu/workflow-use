#!/usr/bin/env python3
"""MCP Server for Workflow Use via stdio transport."""

from langchain_openai import ChatOpenAI
from workflow_use.mcp.service import get_mcp_server

def main():
    """Run MCP server with stdio transport."""
    llm_instance = ChatOpenAI(model='gpt-4o', temperature=0)
    page_extraction_llm = ChatOpenAI(model='gpt-4o-mini', temperature=0)
    
    # Get workflow directory from environment or use default
    import os
    workflow_dir = os.getenv('WORKFLOW_DIR', './tmp')
    
    mcp = get_mcp_server(
        llm_instance=llm_instance, 
        page_extraction_llm=page_extraction_llm,
        workflow_dir=workflow_dir,
        name='WorkflowUse',
        description='Workflow Use automation tools via MCP'
    )
    
    # Run with stdio transport (default)
    mcp.run()

if __name__ == '__main__':
    main()