import json as _json
from inspect import Parameter, Signature
from pathlib import Path
from typing import Any, Dict, List, Union

from fastmcp import FastMCP
from langchain_core.language_models.chat_models import BaseChatModel

from workflow_use.schema.views import WorkflowDefinitionSchema
from workflow_use.workflow.service import Workflow
from workflow_use.workflow.views import WorkflowRunOutput


def _extract_workflow_results(raw_result: WorkflowRunOutput) -> Dict[str, Any]:
	"""Extract clean, user-friendly results from workflow execution."""
	
	# Initialize clean result structure
	clean_result = {
		"status": "success",
		"data": {},
		"error": None
	}
	
	try:
		# Use structured output model if available (highest priority)
		if raw_result.output_model is not None:
			if hasattr(raw_result.output_model, 'dict'):
				clean_result["data"] = raw_result.output_model.dict()
			else:
				clean_result["data"] = raw_result.output_model
		else:
			# Extract data from step results
			extracted_items = []
			
			# Process step results to find extracted content
			for step_result in raw_result.step_results:
				if hasattr(step_result, 'extracted_content') and step_result.extracted_content:
					content = step_result.extracted_content
					
					# Skip technical operation logs (browser automation details)
					if any(skip_phrase in content for skip_phrase in [
						'Navigated to URL', 'Clicked element', 'Input ', 'Pressed key', 
						'Scrolled page', 'Selected option', 'with CSS selector'
					]):
						continue
					
					# Try to parse JSON content (from extraction steps)
					try:
						if content.startswith('{') or content.startswith('['):
							parsed_data = _json.loads(content)
							extracted_items.append(parsed_data)
						elif 'Extracted' in content and ('{' in content or '[' in content):
							# Extract JSON from "Extracted DOM content: {...}" or similar formats
							json_start = max(content.find('{'), content.find('['))
							if json_start != -1:
								json_content = content[json_start:]
								parsed_data = _json.loads(json_content)
								extracted_items.append(parsed_data)
					except (_json.JSONDecodeError, ValueError):
						# If not JSON but substantial content, store as text
						content_cleaned = content.strip()
						if len(content_cleaned) > 20 and not any(tech_word in content_cleaned.lower() for tech_word in [
							'selector', 'xpath', 'css', 'element', 'clicked', 'navigated'
						]):
							extracted_items.append({"content": content_cleaned})
			
			# Organize extracted data
			if len(extracted_items) == 1:
				# Single extraction result
				clean_result["data"] = extracted_items[0]
			elif len(extracted_items) > 1:
				# Multiple extraction results - use descriptive keys
				clean_result["data"] = {"extracted_data": extracted_items}
			else:
				# No extracted data found
				clean_result["data"] = {}
		
		# Check for any errors in step results
		error_messages = []
		for step_result in raw_result.step_results:
			if hasattr(step_result, 'error') and step_result.error:
				error_messages.append(str(step_result.error))
		
		if error_messages:
			clean_result["status"] = "partial_success" if clean_result["data"] else "error"
			clean_result["error"] = "; ".join(error_messages)
			
	except Exception as e:
		clean_result["status"] = "error"
		clean_result["error"] = f"Failed to process workflow results: {str(e)}"
		clean_result["data"] = {}
	
	return clean_result


def get_mcp_server(
	llm_instance: BaseChatModel,
	page_extraction_llm: BaseChatModel | None = None,
	workflow_dir: str = './tmp',
	name: str = 'WorkflowService',
	description: str = 'Exposes workflows as MCP tools.',
):
	mcp_app = FastMCP(name=name, description=description)

	_setup_workflow_tools(mcp_app, llm_instance, page_extraction_llm, workflow_dir)
	return mcp_app


def _setup_workflow_tools(
	mcp_app: FastMCP, llm_instance: BaseChatModel, page_extraction_llm: BaseChatModel | None, workflow_dir: str
):
	"""
	Scans a directory for workflow.json files, loads them, and registers them as tools
	with the FastMCP instance by dynamically setting function signatures.
	"""
	workflow_files = list(Path(workflow_dir).glob('*.workflow.json'))
	print(f"[FastMCP Service] Found workflow files in '{workflow_dir}': {len(workflow_files)}")

	for wf_file_path in workflow_files:
		try:
			print(f'[FastMCP Service] Loading workflow from: {wf_file_path}')
			schema = WorkflowDefinitionSchema.load_from_json(str(wf_file_path))

			# Instantiate the workflow
			workflow = Workflow(
				workflow_schema=schema, llm=llm_instance, page_extraction_llm=page_extraction_llm, browser=None, controller=None
			)

			params_for_signature = []
			annotations_for_runner = {}

			if hasattr(workflow._input_model, 'model_fields'):
				for field_name, model_field in workflow._input_model.model_fields.items():
					param_annotation = model_field.annotation if model_field.annotation is not None else Any

					param_default = Parameter.empty
					if not model_field.is_required():
						param_default = model_field.default if model_field.default is not None else None

					params_for_signature.append(
						Parameter(
							name=field_name,
							kind=Parameter.POSITIONAL_OR_KEYWORD,
							default=param_default,
							annotation=param_annotation,
						)
					)
					annotations_for_runner[field_name] = param_annotation

			dynamic_signature = Signature(params_for_signature)

			# Sanitize workflow name for the function name
			safe_workflow_name_for_func = ''.join(c if c.isalnum() else '_' for c in schema.name)
			dynamic_func_name = f'tool_runner_{safe_workflow_name_for_func}_{schema.version.replace(".", "_")}'

			# Define the actual function that will be called by FastMCP
			# It uses a closure to capture the specific 'workflow' instance
			def create_runner(wf_instance: Workflow):
				async def actual_workflow_runner(**kwargs):
					# kwargs will be populated by FastMCP based on the dynamic_signature
					try:
						raw_result = await wf_instance.run(inputs=kwargs)
						
						# Extract clean, user-friendly results
						clean_result = _extract_workflow_results(raw_result)
						
						return _json.dumps(clean_result, ensure_ascii=False, indent=2)
						
					except Exception as e:
						# Return structured error response
						error_result = {
							"status": "error",
							"data": {},
							"error": f"Workflow execution failed: {str(e)}"
						}
						return _json.dumps(error_result, ensure_ascii=False, indent=2)

				return actual_workflow_runner

			runner_func_impl = create_runner(workflow)

			# Set the dunder attributes that FastMCP will inspect
			runner_func_impl.__name__ = dynamic_func_name
			runner_func_impl.__doc__ = schema.description
			runner_func_impl.__signature__ = dynamic_signature
			runner_func_impl.__annotations__ = annotations_for_runner

			# Tool name and description for FastMCP registration
			unique_tool_name = f'{schema.name.replace(" ", "_")}_{schema.version}'
			tool_description = schema.description

			tool_decorator = mcp_app.tool(name=unique_tool_name, description=tool_description)
			tool_decorator(runner_func_impl)

			param_names_for_log = list(dynamic_signature.parameters.keys())
			print(
				f"[FastMCP Service] Registered tool (via signature): '{unique_tool_name}' for '{schema.name}'. Params: {param_names_for_log}"
			)

		except Exception as e:
			print(f'[FastMCP Service] Failed to load or register workflow from {wf_file_path}: {e}')
			import traceback

			traceback.print_exc()
