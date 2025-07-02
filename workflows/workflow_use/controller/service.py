import asyncio
import json
import logging
import re
from typing import List, Optional

from browser_use import Browser
from browser_use.agent.views import ActionResult
from browser_use.controller.service import Controller
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.prompts import PromptTemplate

from workflow_use.controller.utils import get_best_element_handle, truncate_selector
from workflow_use.controller.views import (
	ClickElementDeterministicAction,
	DOMExtractionAction,
	DOMExtractionField,
	InputTextDeterministicAction,
	KeyPressDeterministicAction,
	NavigationAction,
	PageExtractionAction,
	ScrollDeterministicAction,
	SelectDropdownOptionDeterministicAction,
)

logger = logging.getLogger(__name__)

DEFAULT_ACTION_TIMEOUT_MS = 1000

# List of default actions from browser_use.controller.service.Controller to disable
# todo: come up with a better way to filter out the actions (filter IN the actions would be much nicer in this case)
DISABLED_DEFAULT_ACTIONS = [
	'done',
	'search_google',
	'go_to_url',  # I am using this action from the main controller to avoid duplication
	'go_back',
	'wait',
	'click_element_by_index',
	'input_text',
	'save_pdf',
	'switch_tab',
	'open_tab',
	'close_tab',
	'extract_content',
	'scroll_down',
	'scroll_up',
	'send_keys',
	'scroll_to_text',
	'get_dropdown_options',
	'select_dropdown_option',
	'drag_drop',
	'get_sheet_contents',
	'select_cell_or_range',
	'get_range_contents',
	'clear_selected_range',
	'input_selected_cell_text',
	'update_range_contents',
]


class WorkflowController(Controller):
	def __init__(self, *args, **kwargs):
		# Pass the list of actions to exclude to the base class constructor
		super().__init__(*args, exclude_actions=DISABLED_DEFAULT_ACTIONS, **kwargs)
		self.__register_actions()

	def __register_actions(self):
		# Navigate to URL ------------------------------------------------------------
		@self.registry.action('Manually navigate to URL', param_model=NavigationAction)
		async def navigation(params: NavigationAction, browser_session: Browser) -> ActionResult:
			"""Navigate to the given URL."""
			page = await browser_session.get_current_page()
			await page.goto(params.url)
			await page.wait_for_load_state()

			msg = f'🔗  Navigated to URL: {params.url}'
			logger.info(msg)
			return ActionResult(extracted_content=msg, include_in_memory=True)

		# Click element by CSS selector --------------------------------------------------

		@self.registry.action(
			'Click element by all available selectors',
			param_model=ClickElementDeterministicAction,
		)
		async def click(params: ClickElementDeterministicAction, browser_session: Browser) -> ActionResult:
			"""Click the first element matching *params.cssSelector* with fallback mechanisms."""
			page = await browser_session.get_current_page()
			original_selector = params.cssSelector

			try:
				locator, selector_used = await get_best_element_handle(
					page,
					params.cssSelector,
					params,
					timeout_ms=DEFAULT_ACTION_TIMEOUT_MS,
				)
				await locator.click(force=True)

				msg = f'🖱️  Clicked element with CSS selector: {truncate_selector(selector_used)} (original: {truncate_selector(original_selector)})'
				logger.info(msg)
				return ActionResult(extracted_content=msg, include_in_memory=True)
			except Exception as e:
				error_msg = f'Failed to click element. Original selector: {truncate_selector(original_selector)}. Error: {str(e)}'
				logger.error(error_msg)
				raise Exception(error_msg)

		# Input text into element --------------------------------------------------------
		@self.registry.action(
			'Input text into an element by all available selectors',
			param_model=InputTextDeterministicAction,
		)
		async def input(
			params: InputTextDeterministicAction,
			browser_session: Browser,
			has_sensitive_data: bool = False,
		) -> ActionResult:
			"""Fill text into the element located with *params.cssSelector*."""
			page = await browser_session.get_current_page()
			original_selector = params.cssSelector

			try:
				locator, selector_used = await get_best_element_handle(
					page,
					params.cssSelector,
					params,
					timeout_ms=DEFAULT_ACTION_TIMEOUT_MS,
				)

				# Check if it's a SELECT element
				is_select = await locator.evaluate('(el) => el.tagName === "SELECT"')
				if is_select:
					return ActionResult(
						extracted_content='Ignored input into select element',
						include_in_memory=True,
					)

				# Add a small delay and click to ensure the element is focused
				await locator.fill(params.value)
				await asyncio.sleep(0.5)
				await locator.click(force=True)
				await asyncio.sleep(0.5)

				msg = f'⌨️  Input "{params.value}" into element with CSS selector: {truncate_selector(selector_used)} (original: {truncate_selector(original_selector)})'
				logger.info(msg)
				return ActionResult(extracted_content=msg, include_in_memory=True)
			except Exception as e:
				error_msg = f'Failed to input text. Original selector: {truncate_selector(original_selector)}. Error: {str(e)}'
				logger.error(error_msg)
				raise Exception(error_msg)

		# Select dropdown option ---------------------------------------------------------
		@self.registry.action(
			'Select dropdown option by all available selectors and visible text',
			param_model=SelectDropdownOptionDeterministicAction,
		)
		async def select_change(params: SelectDropdownOptionDeterministicAction, browser_session: Browser) -> ActionResult:
			"""Select dropdown option whose visible text equals *params.value*."""
			page = await browser_session.get_current_page()
			original_selector = params.cssSelector

			try:
				locator, selector_used = await get_best_element_handle(
					page,
					params.cssSelector,
					params,
					timeout_ms=DEFAULT_ACTION_TIMEOUT_MS,
				)

				await locator.select_option(label=params.selectedText)

				msg = f'Selected option "{params.selectedText}" in dropdown {truncate_selector(selector_used)} (original: {truncate_selector(original_selector)})'
				logger.info(msg)
				return ActionResult(extracted_content=msg, include_in_memory=True)
			except Exception as e:
				error_msg = f'Failed to select option. Original selector: {truncate_selector(original_selector)}. Error: {str(e)}'
				logger.error(error_msg)
				raise Exception(error_msg)

		# Key press action ------------------------------------------------------------
		@self.registry.action(
			'Press key on element by all available selectors',
			param_model=KeyPressDeterministicAction,
		)
		async def key_press(params: KeyPressDeterministicAction, browser_session: Browser) -> ActionResult:
			"""Press *params.key* on the element identified by *params.cssSelector*."""
			page = await browser_session.get_current_page()
			original_selector = params.cssSelector

			try:
				locator, selector_used = await get_best_element_handle(page, params.cssSelector, params, timeout_ms=5000)

				await locator.press(params.key)

				msg = f"🔑  Pressed key '{params.key}' on element with CSS selector: {truncate_selector(selector_used)} (original: {truncate_selector(original_selector)})"
				logger.info(msg)
				return ActionResult(extracted_content=msg, include_in_memory=True)
			except Exception as e:
				error_msg = f'Failed to press key. Original selector: {truncate_selector(original_selector)}. Error: {str(e)}'
				logger.error(error_msg)
				raise Exception(error_msg)

		# Scroll action --------------------------------------------------------------
		@self.registry.action('Scroll page', param_model=ScrollDeterministicAction)
		async def scroll(params: ScrollDeterministicAction, browser_session: Browser) -> ActionResult:
			"""Scroll the page by the given x/y pixel offsets."""
			page = await browser_session.get_current_page()
			await page.evaluate(f'window.scrollBy({params.scrollX}, {params.scrollY});')
			msg = f'📜  Scrolled page by (x={params.scrollX}, y={params.scrollY})'
			logger.info(msg)
			return ActionResult(extracted_content=msg, include_in_memory=True)

			# Extract content ------------------------------------------------------------

		@self.registry.action(
			'Extract page content to retrieve specific information from the page, e.g. all company names, a specific description, all information about, links with companies in structured format or simply links',
			param_model=PageExtractionAction,
		)
		async def extract_page_content(
			params: PageExtractionAction, browser_session: Browser, page_extraction_llm: BaseChatModel
		):
			page = await browser_session.get_current_page()
			import markdownify

			strip = ['a', 'img']

			content = markdownify.markdownify(await page.content(), strip=strip)

			# manually append iframe text into the content so it's readable by the LLM (includes cross-origin iframes)
			for iframe in page.frames:
				if iframe.url != page.url and not iframe.url.startswith('data:'):
					content += f'\n\nIFRAME {iframe.url}:\n'
					content += markdownify.markdownify(await iframe.content())

			prompt = 'Your task is to extract the content of the page. You will be given a page and a goal and you should extract all relevant information around this goal from the page. If the goal is vague, summarize the page. Respond in json format. Extraction goal: {goal}, Page: {page}'
			template = PromptTemplate(input_variables=['goal', 'page'], template=prompt)
			try:
				output = await page_extraction_llm.ainvoke(template.format(goal=params.goal, page=content))
				msg = f'📄  Extracted from page\n: {output.content}\n'
				logger.info(msg)
				return ActionResult(extracted_content=msg, include_in_memory=True)
			except Exception as e:
				logger.debug(f'Error extracting content: {e}')
				msg = f'📄  Extracted from page\n: {content}\n'
				logger.info(msg)
				return ActionResult(extracted_content=msg)

		# DOM Content Extraction --------------------------------------------------------
		@self.registry.action(
			'Extract specific DOM content using CSS selectors and XPath with intelligent parsing',
			param_model=DOMExtractionAction,
		)
		async def extract_dom_content(
			params: DOMExtractionAction, 
			browser_session: Browser, 
			page_extraction_llm: BaseChatModel
		) -> ActionResult:
			"""Extract content from DOM elements using selectors with fallback strategies."""
			page = await browser_session.get_current_page()
			
			try:
				extracted_data = await self._extract_dom_elements(page, params, page_extraction_llm)
				
				msg = f'🎯  Extracted DOM content: {extracted_data}'
				logger.info(msg)
				return ActionResult(extracted_content=json.dumps(extracted_data), include_in_memory=True)
				
			except Exception as e:
				error_msg = f'Failed to extract DOM content: {str(e)}'
				logger.error(error_msg)
				raise Exception(error_msg)

	async def _extract_dom_elements(self, page, params: DOMExtractionAction, llm: BaseChatModel):
		"""Core DOM extraction logic with structured field extraction supporting both XPath and CSS."""
		results = []
		
		# Find container elements - support both XPath and CSS selectors
		try:
			containers = []
			
			# Priority 1: Try containerXpath if available
			if hasattr(params, 'containerXpath') and params.containerXpath:
				try:
					# Convert XPath format like .id('info') to standard XPath
					xpath = self._normalize_xpath(params.containerXpath)
					containers = await self._query_elements_by_xpath(page, xpath)
					logger.info(f'Found {len(containers)} containers using XPath: {xpath}')
				except Exception as e:
					logger.warning(f'XPath container selection failed: {e}')
			
			# Fallback: Try CSS selector
			if not containers and hasattr(params, 'containerSelector') and params.containerSelector:
				try:
					containers = await page.query_selector_all(params.containerSelector)
					logger.info(f'Found {len(containers)} containers using CSS: {params.containerSelector}')
				except Exception as e:
					logger.warning(f'CSS container selection failed: {e}')
			
			if not containers:
				container_info = getattr(params, 'containerXpath', None) or getattr(params, 'containerSelector', 'unknown')
				raise Exception(f"No container elements found with selector: {container_info}")
			
			# If not multiple mode, take only first container
			if not params.multiple:
				containers = containers[:1]
			
			# Extract data from each container
			for container in containers:
				container_data = {}
				
				# Extract each field
				for field in params.fields:
					field_value = await self._extract_field_value(container, field, getattr(params, 'excludeSelectors', None) or getattr(params, 'excludeXpaths', None))
					container_data[field.name] = field_value
			
				results.append(container_data)
			
			return results[0] if len(results) == 1 else results
			
		except Exception as e:
			logger.error(f'DOM extraction failed: {e}')
			raise Exception(f"DOM extraction failed: {str(e)}")
	
	def _normalize_xpath(self, xpath: str) -> str:
		"""Normalize XPath expressions to standard format."""
		if xpath.startswith('id(') or xpath.startswith('.id('):
			# Convert id('info') or .id('info') to //*[@id='info']
			id_match = re.search(r"\.?id\(['\"]([^'\"]+)['\"]\)", xpath)
			if id_match:
				return f"//*[@id='{id_match.group(1)}']"
		return xpath
	
	async def _query_elements_by_xpath(self, page, xpath: str):
		"""Query elements using XPath with Playwright."""
		try:
			# Use Playwright's locator with XPath
			locator = page.locator(f"xpath={xpath}")
			elements = await locator.all()
			return elements
		except Exception as e:
			logger.error(f'XPath query failed: {e}')
			return []
	
	async def _extract_field_value(self, container, field: DOMExtractionField, exclude_selectors: Optional[List[str]] = None):
		"""Extract value for a specific field from a container element with XPath and CSS support."""
		try:
			# Primary selector attempt - support both XPath and CSS
			field_element = await self._find_field_element_with_fallback(container, field)
			if not field_element:
				field_selector = getattr(field, 'xpath', None) or getattr(field, 'selector', 'unknown')
				logger.warning(f'Field element not found with selector: {field_selector}')
				return None
			
			# Check if element should be excluded
			if exclude_selectors:
				for exclude_selector in exclude_selectors:
					try:
						# Support both XPath and CSS exclude selectors
						if exclude_selector.startswith('.//') or exclude_selector.startswith('//'):
							# XPath exclude selector - use relative XPath from field element
							excluded_elements = await self._query_elements_by_xpath_relative(field_element, exclude_selector)
							if excluded_elements:
								logger.info(f'Field element excluded by XPath: {exclude_selector}')
								return None
						else:
							# CSS exclude selector
							if await field_element.query_selector(exclude_selector):
								logger.info(f'Field element excluded by CSS: {exclude_selector}')
								return None
					except Exception:
						# Ignore invalid exclude selectors
						continue
			
			# Extract value based on field type
			if field.type == 'text':
				return (await field_element.inner_text()).strip()
			elif field.type == 'href':
				return await field_element.get_attribute('href')
			elif field.type == 'src':
				return await field_element.get_attribute('src')
			elif field.type == 'attribute' and field.attribute:
				return await field_element.get_attribute(field.attribute)
			else:
				return (await field_element.inner_text()).strip()  # Default to text
				
		except Exception as e:
			logger.warning(f'Failed to extract field {field.name}: {e}')
			return None
	
	async def _query_elements_by_xpath_relative(self, element, xpath: str):
		"""Query elements using relative XPath from a given element."""
		try:
			# For relative XPath queries, we need to use the element's locator
			locator = element.locator(f"xpath={xpath}")
			elements = await locator.all()
			return elements
		except Exception as e:
			logger.error(f'Relative XPath query failed: {e}')
			return []
	
	async def _find_field_element_with_fallback(self, container, field: DOMExtractionField):
		"""Find field element with multiple fallback strategies supporting both XPath and CSS."""
		# Strategy 1: Try XPath if available
		if hasattr(field, 'xpath') and field.xpath:
			try:
				# Handle XPath that extracts text directly (ends with /text())
				xpath = field.xpath
				if xpath.endswith('/text()'):
					# For text() XPath, we need to evaluate and return the text content
					xpath_element = xpath[:-7]  # Remove /text() suffix
					elements = await self._query_elements_by_xpath_relative(container, xpath_element)
					if elements:
						return elements[0]  # Return first matching element
				else:
					# Regular XPath for elements
					elements = await self._query_elements_by_xpath_relative(container, xpath)
					if elements:
						return elements[0]
			except Exception as e:
				logger.warning(f'XPath selector failed for {field.name}: {e}')
		
		# Strategy 2: Try CSS selector if available
		if hasattr(field, 'selector') and field.selector:
			try:
				element = await container.query_selector(field.selector)
				if element:
					return element
			except Exception as e:
				logger.warning(f'CSS selector failed for {field.name}: {e}')
		
		# Strategy 3: Try fallback selectors based on field name
		fallback_selectors = self._generate_fallback_selectors(field.name)
		for fallback_selector in fallback_selectors:
			try:
				element = await container.query_selector(fallback_selector)
				if element:
					logger.info(f'Fallback selector worked for {field.name}: {fallback_selector}')
					return element
			except Exception:
				continue
		
		return None
	
	def _generate_fallback_selectors(self, field_name: str) -> List[str]:
		"""Generate fallback selectors based on common patterns."""
		fallback_selectors = []
		
		# Common patterns for different field types
		if 'author' in field_name.lower():
			fallback_selectors.extend([
				'[class*="author"]', '[id*="author"]', 
				'span[class*="author"]', 'div[class*="author"]',
				'.author', '#author'
			])
		elif 'year' in field_name.lower() or 'publish' in field_name.lower():
			fallback_selectors.extend([
				'[class*="year"]', '[class*="publish"]', '[class*="date"]',
				'span[class*="year"]', 'span[class*="publish"]',
				'.year', '.publish-year', '.date'
			])
		elif 'page' in field_name.lower():
			fallback_selectors.extend([
				'[class*="page"]', '[class*="length"]',
				'span[class*="page"]', 'div[class*="page"]',
				'.pages', '.page-count'
			])
		elif 'rating' in field_name.lower() or 'score' in field_name.lower():
			fallback_selectors.extend([
				'[class*="rating"]', '[class*="score"]', '[class*="star"]',
				'span[class*="rating"]', 'div[class*="score"]',
				'.rating', '.score', '.stars'
			])
		
		# Generic patterns
		fallback_selectors.extend([
			f'[class*="{field_name.lower()}"]',
			f'[id*="{field_name.lower()}"]',
			f'span[class*="{field_name.lower()}"]',
			f'div[class*="{field_name.lower()}"]'
		])
		
		return fallback_selectors

	async def _extract_element_content(self, element):
		"""Extract content from a single element - returns both text and HTML for LLM processing."""
		# For intelligent extraction, always get the full HTML content
		# The LLM will determine what to extract based on the natural language rule
		return await element.inner_html()

	async def _parse_complex_content(self, html_contents, goal, llm):
		"""Use LLM to parse complex HTML structure and extract structured data."""
		combined_html = '\n'.join(str(content) for content in html_contents)
		
		prompt = """
You are tasked with extracting structured information from HTML content.

HTML Content:
{html_content}

Extraction Goal: {goal}

Please extract the relevant information and return it as structured JSON. 
Focus on extracting:
- Individual fields (scores, dates, text content)
- Maintain structure and relationships
- Remove HTML tags but preserve meaningful content

Return only the JSON data, no explanation.
"""
		
		template = PromptTemplate(input_variables=['html_content', 'goal'], template=prompt)
		
		try:
			response = await llm.ainvoke(template.format(html_content=combined_html, goal=goal))
			# Try to parse as JSON, fall back to text if parsing fails
			import json
			try:
				return json.loads(response.content)
			except json.JSONDecodeError:
				return response.content
		except Exception as e:
			logger.warning(f'LLM parsing failed: {e}')
			return html_contents