import base64
import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, cast

from langchain_core.exceptions import OutputParserException
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage
from pydantic import ValidationError

from workflow_use.builder.prompts import DOM_EXTRACTION_REFINEMENT_TEMPLATE, WORKFLOW_BUILDER_PROMPT_TEMPLATE
from workflow_use.controller.service import WorkflowController
from workflow_use.schema.views import WorkflowDefinitionSchema, DOMContentExtractionStep

logger = logging.getLogger(__name__)


class BuilderService:
	"""
	Service responsible for building executable workflow JSON definitions
	from recorded browser session events using an LLM.
	"""

	def __init__(self, llm: BaseChatModel):
		"""
		Initializes the BuilderService.

		Args:
		    llm: A LangChain BaseChatModel instance configured for use.
		         It should ideally support vision capabilities if screenshots are used.
		"""
		if llm is None:
			raise ValueError('A BaseChatModel instance must be provided.')

		# Store LLM with structured output configuration
		self.llm = self._configure_structured_llm(llm)
		self.prompt_template = WORKFLOW_BUILDER_PROMPT_TEMPLATE
		self._actions_markdown_cache = None  # Lazy load actions metadata
		logger.info('BuilderService initialized.')

	def _configure_structured_llm(self, llm: BaseChatModel) -> BaseChatModel:
		"""Configure LLM for structured output, falling back gracefully."""
		try:
			# Use function calling for better compatibility
			return llm.with_structured_output(WorkflowDefinitionSchema, method='function_calling')
		except NotImplementedError:
			logger.warning('LLM does not support structured output natively. Using fallback.')
			return llm

	@property
	def actions_markdown(self) -> str:
		"""Cached actions metadata to avoid repeated WorkflowController instantiation."""
		if self._actions_markdown_cache is None:
			self._actions_markdown_cache = self._get_available_actions_markdown()
		return self._actions_markdown_cache

	def _get_available_actions_markdown(self) -> str:
		"""Return a markdown list of available actions and their schema."""
		controller = WorkflowController()
		lines: List[str] = []
		for action in controller.registry.registry.actions.values():
			# Only include deterministic actions relevant for building from recordings
			# Exclude agent-specific or meta-actions if necessary
			# Based on schema/views.py, the recorder types seem to map directly
			# to controller action *names*, but the prompt uses the event `type` field.
			# Let's assume the prompt template correctly lists the *event types* expected.
			# This function provides the detailed schema for the LLM.
			schema_info = action.param_model.model_json_schema()
			# Simplify schema representation for the prompt if too verbose
			param_details = []
			props = schema_info.get('properties', {})
			required = schema_info.get('required', [])
			for name, details in props.items():
				req_star = '*' if name in required else ''
				param_details.append(f'`{name}`{req_star} ({details.get("type", "any")})')

			lines.append(f'- **`{action.name}`**: {action.description}')  # Using action name from controller
			if param_details:
				lines.append(f'  - Parameters: {", ".join(param_details)}')

		# Add descriptions for agent/extract_content types manually if not in controller
		if 'agent' not in [a.name for a in controller.registry.registry.actions.values()]:
			lines.append('- **`agent`**: Executes a task using an autonomous agent.')
			lines.append('  - Parameters: `task`* (string), `description` (string), `max_steps` (integer)')
		# if "extract_content" not in [
		#     a.name for a in controller.registry.registry.actions.values()
		# ]:
		#     lines.append(
		#         "- **`extract_content`**: Uses an LLM to extract specific information from the current page."
		#     )
		#     lines.append(
		#         "  - Parameters: `goal`* (string), `description` (string), `should_strip_link_urls` (boolean)"
		#     )

		logger.debug(f'Generated actions markdown:\n{lines}')
		return '\n'.join(lines)

	@staticmethod
	def _find_first_user_interaction_url(events: List[Dict[str, Any]]) -> Optional[str]:
		"""Finds the URL of the first recorded user interaction."""
		return next(
			(
				evt.get('frameUrl')
				for evt in events
				if evt.get('type')
				in [
					'input',
					'click',
					'scroll',
					'select_change',
					'key_press',
				]  # Added more types
			),
			None,
		)

	def _process_dom_content_marking(self, steps: List[Any]) -> List[Any]:
		"""Process DOM content marking events and enhance them with LLM-generated selectors."""
		processed_steps = []
		
		for step in steps:
			step_dict = step.model_dump() if hasattr(step, 'model_dump') else step
			step_type = step_dict.get('type')
			
			if step_type == 'extract_content_marked':
				# Convert extract_content_marked to extract_dom_content with LLM refinement
				extraction_rule = step_dict.get('extractionRule', '')
				html_sample = step_dict.get('htmlSample', '')
				multiple = step_dict.get('multiple', False)
				container_xpath = step_dict.get('xpath', '')
				
				logger.info(f"Processing extract_content_marked step: rule='{extraction_rule}', multiple={multiple}")
				
				# Skip LLM processing if no extraction rule
				if not extraction_rule:
					logger.warning("No extraction rule found, skipping LLM refinement")
					processed_steps.append(step)
					continue
				
				# Use LLM to refine extraction rules
				refined_extraction = self._refine_extraction_with_llm(
					extraction_rule, html_sample, multiple, container_xpath
				)
				
				# Create refined DOM extraction step
				refined_step = DOMContentExtractionStep(
					type='extract_dom_content',
					timestamp=step_dict.get('timestamp'),
					tabId=step_dict.get('tabId'),
					url=step_dict.get('url'),
					frameUrl=step_dict.get('frameUrl'),
					containerXpath=refined_extraction.get('containerXpath', container_xpath),
					fields=refined_extraction.get('fields', []),
					multiple=multiple,
					excludeXpaths=refined_extraction.get('excludeXpaths', []),
					extractionRule=extraction_rule,
					htmlSample=html_sample,
					description=f'Extract content: {extraction_rule}'
				)
				processed_steps.append(refined_step)
				logger.info(f"Refined extract_content_marked to extract_dom_content: {extraction_rule}")
			else:
				processed_steps.append(step)
		
		return processed_steps
	
	def _refine_extraction_with_llm(self, extraction_rule: str, html_sample: str, multiple: bool, container_xpath: str) -> Dict[str, Any]:
		"""Use LLM to convert natural language extraction rules into precise xpath selectors."""
		try:
			# Prepare the prompt using LangChain PromptTemplate
			prompt_inputs = {
				'extraction_rule': extraction_rule,
				'html_sample': html_sample,  # Limit HTML sample size
				'multiple': multiple,
				'container_xpath': container_xpath
			}
			# Prepare the prompt using LangChain PromptTemplate
			prompt = DOM_EXTRACTION_REFINEMENT_TEMPLATE.format(**prompt_inputs)
			
			# Call LLM synchronously 
			message = HumanMessage(content=prompt)
			response = self.model.invoke([message])
			
			# Parse JSON response
			response_text = response.content.strip() if hasattr(response, 'content') and response.content else ""
			
			if not response_text:
				raise ValueError("LLM returned empty response")
			
			# Use the common JSON extraction utility
			clean_response = self._extract_json_from_response(response_text)
			refined_extraction = json.loads(clean_response)
			logger.info(f"LLM refined extraction: {refined_extraction}")
			
			# Validate and fix xpath selectors
			refined_extraction = self._validate_and_fix_xpaths(refined_extraction)
			
			return refined_extraction
			
		except Exception as e:
			logger.error(f"Failed to refine extraction with LLM: {e}")
			logger.error(f"Extraction rule: {extraction_rule}")
			# Fallback to basic structure
			return {
				'containerXpath': container_xpath,
				'fields': [{'name': 'content', 'xpath': '.', 'type': 'text'}],
				'excludeXpaths': []
			}

	def _validate_and_fix_xpaths(self, extraction_config: Dict[str, Any]) -> Dict[str, Any]:
		"""Validate xpath selectors and fix common issues."""
		# Fix container xpath
		container_xpath = extraction_config.get('containerXpath', '')
		extraction_config['containerXpath'] = self._fix_xpath(container_xpath)
		
		# Fix field xpaths
		fields = extraction_config.get('fields', [])
		for field in fields:
			if 'xpath' in field:
				field['xpath'] = self._fix_xpath(field['xpath'])
		
		# Fix exclude xpaths
		exclude_xpaths = extraction_config.get('excludeXpaths', [])
		extraction_config['excludeXpaths'] = [
			self._fix_xpath(xpath) for xpath in exclude_xpaths
		]
		
		logger.info(f"Validated xpaths: {extraction_config}")
		return extraction_config
	
	def _fix_xpath(self, xpath: str) -> str:
		"""Fix common xpath issues."""
		if not xpath:
			return xpath
			
		# Clean up extra spaces
		fixed_xpath = re.sub(r'\s+', ' ', xpath).strip()
		
		# Ensure xpath starts with proper path syntax
		if fixed_xpath and not fixed_xpath.startswith(('.', '/', '(')):
			fixed_xpath = '.' + fixed_xpath
		
		if fixed_xpath != xpath:
			logger.warning(f"Fixed xpath: '{xpath}' -> '{fixed_xpath}'")
			
		return fixed_xpath

	@staticmethod
	def _filter_redundant_navigations(steps: List[Any]) -> List[Any]:
		"""Filter out redundant navigation events that are likely side effects."""
		filtered_steps = []
		last_navigation_url = None
		last_navigation_time = None
		
		for i, step in enumerate(steps):
			step_dict = step.model_dump() if hasattr(step, 'model_dump') else step
			step_type = step_dict.get('type')
			
			if step_type == 'navigation':
				current_url = step_dict.get('url', '')
				current_time = step_dict.get('timestamp', 0)
				
				# Check if this navigation is redundant
				is_redundant = False
				
				# 1. Same URL as previous navigation within 5 seconds
				if (last_navigation_url == current_url and 
					last_navigation_time and 
					(current_time - last_navigation_time) < 5000):
					is_redundant = True
					
				# 2. Navigation immediately after user action (likely side effect)
				if i > 0:
					prev_step = steps[i-1]
					prev_dict = prev_step.model_dump() if hasattr(prev_step, 'model_dump') else prev_step
					prev_type = prev_dict.get('type')
					prev_time = prev_dict.get('timestamp', 0)
					
					# If navigation happens within 2 seconds of click/submit/key_press
					if (prev_type in ['click', 'key_press', 'select_change'] and
						(current_time - prev_time) < 2000):
						is_redundant = True
				
				if not is_redundant:
					filtered_steps.append(step)
					last_navigation_url = current_url
					last_navigation_time = current_time
				else:
					logger.debug(f"Filtered redundant navigation to: {current_url}")
			else:
				filtered_steps.append(step)
		
		logger.info(f"Navigation filtering: {len(steps)} -> {len(filtered_steps)} steps")
		return filtered_steps

	def _extract_json_from_response(self, response_text: str) -> str:
		"""Extract JSON content from LLM response with markdown cleanup."""
		content = response_text.strip()
		
		# Extract JSON from markdown code blocks
		if '```json' in content:
			match = re.search(r'```json\s*([\s\S]*?)\s*```', content, re.DOTALL)
			if match:
				logger.debug('Extracted JSON from ```json block.')
				return match.group(1).strip()
		
		# Extract from generic code blocks
		if '```' in content:
			match = re.search(r'```\s*([\s\S]*?)\s*```', content, re.DOTALL)
			if match:
				potential_json = match.group(1).strip()
				if potential_json.startswith('{') and potential_json.endswith('}'):
					logger.debug('Extracted JSON from generic code block.')
					return potential_json
		
		# Assume raw JSON if it looks like it
		if content.startswith('{') and content.endswith('}'):
			logger.debug('Assuming raw output is JSON.')
			return content
			
		logger.warning('Could not reliably extract JSON from LLM output.')
		return content

	async def _invoke_llm_with_fallback(self, messages: list) -> WorkflowDefinitionSchema:
		"""Unified LLM invocation with structured output and fallback parsing."""
		try:
			# Try structured output first
			llm_response = await self.llm.ainvoke([HumanMessage(content=cast(Any, messages))])
			
			# Check if we got a structured response
			if isinstance(llm_response, WorkflowDefinitionSchema):
				return llm_response
			
			# Extract content and parse manually
			content = getattr(llm_response, 'content', str(llm_response))
			return self._parse_llm_output_to_workflow(str(content))
			
		except OutputParserException as ope:
			logger.error(f'LLM output parsing failed: {ope}')
			# Try to parse the raw output as fallback
			raw_output = getattr(ope, 'llm_output', str(ope))
			logger.info('Attempting to parse raw output as fallback...')
			return self._parse_llm_output_to_workflow(raw_output)
			
		except Exception as e:
			logger.exception(f'LLM invocation failed: {e}')
			raise

	def _parse_llm_output_to_workflow(self, llm_content: str) -> WorkflowDefinitionSchema:
		"""Parse LLM string output into WorkflowDefinitionSchema."""
		logger.debug(f'Raw LLM Output:\n{llm_content}')
		
		content_to_parse = self._extract_json_from_response(llm_content)
		
		try:
			workflow_data = WorkflowDefinitionSchema.model_validate_json(content_to_parse)
			logger.info('Successfully parsed LLM output into WorkflowDefinitionSchema.')
			return workflow_data
		except (json.JSONDecodeError, ValidationError) as e:
			logger.error(f'Failed to parse LLM output into WorkflowDefinitionSchema: {e}')
			logger.debug(f'Content attempted parsing:\n{content_to_parse}')
			raise ValueError(f'LLM output could not be parsed into a valid Workflow schema. Error: {e}') from e

	async def build_workflow(
		self,
		input_workflow: WorkflowDefinitionSchema,
		user_goal: str,
		use_screenshots: bool = False,
		max_images: int = 20,
	) -> WorkflowDefinitionSchema:
		"""
		Generates an enhanced Workflow definition from an input workflow object using an LLM.

		Args:
		    input_workflow: The initial WorkflowDefinitionSchema object containing steps to process.
		    user_goal: Optional high-level description of the workflow's purpose.
		               If None, the user might be prompted interactively.
		    use_screenshots: Whether to include screenshots as visual context for the LLM (if available in steps).
		    max_images: Maximum number of screenshots to include (to manage cost/tokens).

		Returns:
		    A new WorkflowDefinitionSchema object generated by the LLM.

		Raises:
		    ValueError: If the input workflow is invalid or the LLM output cannot be parsed.
		    Exception: For other LLM or processing errors.
		"""
		# Validate input slightly
		if not input_workflow or not isinstance(input_workflow.steps, list):
			raise ValueError('Invalid input_workflow object provided.')

		# Pre-filter redundant navigation events to reduce noise for LLM
		filtered_steps = self._filter_redundant_navigations(input_workflow.steps)
		input_workflow.steps = filtered_steps
		
		# Process DOM content marking events
		processed_steps = self._process_dom_content_marking(input_workflow.steps)
		input_workflow.steps = processed_steps

		# Handle user goal
		goal = user_goal
		if goal is None:
			try:
				goal = input('Please describe the high-level task for the workflow (optional, press Enter to skip): ').strip()
			except EOFError:  # Handle non-interactive environments
				goal = ''
		goal = goal or 'Automate the recorded browser actions.'  # Default goal if empty

		# Format the main instruction prompt
		prompt_str = self.prompt_template.format(
			actions=self.actions_markdown,
			goal=goal,
		)

		# Prepare the vision messages list
		vision_messages: List[Dict[str, Any]] = [{'type': 'text', 'text': prompt_str}]

		# Integrate message preparation logic here
		images_used = 0
		for step in input_workflow.steps:
			step_messages: List[Dict[str, Any]] = []  # Messages for this specific step

			# 1. Text representation (JSON dump)
			step_dict = step.model_dump(mode='json', exclude_none=True)
			screenshot_data = step_dict.pop('screenshot', None)  # Pop potential screenshot
			step_messages.append({'type': 'text', 'text': json.dumps(step_dict, indent=2)})

			# 2. Optional screenshot
			attach_image = use_screenshots and images_used < max_images
			step_type = getattr(step, 'type', step_dict.get('type'))

			if attach_image and step_type != 'input':  # Don't attach for inputs
				# Re-retrieve screenshot data if it wasn't popped (e.g., nested under 'data')
				# This assumes screenshot might still be in the original step model or dict
				# A bit redundant, ideally screenshot handling is consistent
				screenshot = screenshot_data or getattr(step, 'screenshot', None) or step_dict.get('data', {}).get('screenshot')

				if screenshot:
					if isinstance(screenshot, str) and screenshot.startswith('data:'):
						screenshot = screenshot.split(',', 1)[-1]

					# Validate base64 payload
					try:
						base64.b64decode(cast(str, screenshot), validate=True)
						meta = f"<Screenshot for event type '{step_type}'>"
						step_messages.append({'type': 'text', 'text': meta})
						step_messages.append(
							{
								'type': 'image_url',
								'image_url': {'url': f'data:image/png;base64,{screenshot}'},
							}
						)
						images_used += 1  # Increment image count *only* if successfully added
					except (TypeError, ValueError, Exception) as e:
						logger.warning(
							f"Invalid or missing screenshot for step type '{step_type}' "
							f'@ {step_dict.get("timestamp", "")}. Error: {e}'
						)
						# Don't add image messages if invalid

			# Add the messages for this step to the main list
			vision_messages.extend(step_messages)

		logger.info(f'Prepared {len(vision_messages)} total message parts, including {images_used} images.')

		# Simplified LLM invocation with unified error handling
		workflow_data = await self._invoke_llm_with_fallback(vision_messages)

		# Return the workflow data object directly
		return workflow_data

	# path handlers
	async def build_workflow_from_path(self, path: Path, user_goal: str) -> WorkflowDefinitionSchema:
		"""Build a workflow from a JSON file path."""
		with open(path, 'r') as f:
			workflow_data = json.load(f)

		workflow_data_schema = WorkflowDefinitionSchema.model_validate(workflow_data)
		return await self.build_workflow(workflow_data_schema, user_goal)

	async def save_workflow_to_path(self, workflow: WorkflowDefinitionSchema, path: Path):
		"""Save a workflow to a JSON file path."""
		with open(path, 'w') as f:
			json.dump(workflow.model_dump(mode='json'), f, indent=2)
