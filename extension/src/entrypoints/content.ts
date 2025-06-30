import * as rrweb from "rrweb";
import { EventType, IncrementalSource } from "@rrweb/types";

let stopRecording: (() => void) | undefined = undefined;
let isRecordingActive = true; // Content script's local state
let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
let lastScrollY: number | null = null;
let lastDirection: "up" | "down" | null = null;
const DEBOUNCE_MS = 500; // Wait 500ms after scroll stops

// DOM content extraction state
let isContentMarkingMode = false;
let contentMarkingOverlay: HTMLDivElement | null = null;
let markedElements: Array<{
  xpath: string;
  cssSelector: string;
  elementTag: string;
  elementText: string;
  extractConfig: {
    extractionRule: string;
    multiple: boolean;
    htmlSample: string;
  };
}> = [];

// --- Helper function to generate XPath ---
function getXPath(element: HTMLElement): string {
  if (element.id !== "") {
    return `id("${element.id}")`;
  }
  if (element === document.body) {
    return element.tagName.toLowerCase();
  }

  let ix = 0;
  const siblings = element.parentNode?.children;
  if (siblings) {
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling === element) {
        return `${getXPath(
          element.parentElement as HTMLElement
        )}/${element.tagName.toLowerCase()}[${ix + 1}]`;
      }
      if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
        ix++;
      }
    }
  }
  // Fallback (should not happen often)
  return element.tagName.toLowerCase();
}
// --- End Helper ---

// --- Helper function to generate CSS Selector ---
// Expanded set of safe attributes (similar to Python)
const SAFE_ATTRIBUTES = new Set([
  "id",
  "name",
  "type",
  "placeholder",
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "role",
  "for",
  "autocomplete",
  "required",
  "readonly",
  "alt",
  "title",
  "src",
  "href",
  "target",
  // Add common data attributes if stable
  "data-id",
  "data-qa",
  "data-cy",
  "data-testid",
]);

function getEnhancedCSSSelector(element: HTMLElement, xpath: string): string {
  try {
    // Base selector from simplified XPath or just tagName
    let cssSelector = element.tagName.toLowerCase();

    // Handle class attributes
    if (element.classList && element.classList.length > 0) {
      const validClassPattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
      element.classList.forEach((className) => {
        if (className && validClassPattern.test(className)) {
          cssSelector += `.${CSS.escape(className)}`;
        }
      });
    }

    // Handle other safe attributes
    for (const attr of element.attributes) {
      const attrName = attr.name;
      const attrValue = attr.value;

      if (attrName === "class") continue;
      if (!attrName.trim()) continue;
      if (!SAFE_ATTRIBUTES.has(attrName)) continue;

      const safeAttribute = CSS.escape(attrName);

      if (attrValue === "") {
        cssSelector += `[${safeAttribute}]`;
      } else {
        const safeValue = attrValue.replace(/"/g, '"');
        if (/["'<>`\s]/.test(attrValue)) {
          cssSelector += `[${safeAttribute}*="${safeValue}"]`;
        } else {
          cssSelector += `[${safeAttribute}="${safeValue}"]`;
        }
      }
    }
    return cssSelector;
  } catch (error) {
    console.error("Error generating enhanced CSS selector:", error);
    return `${element.tagName.toLowerCase()}[xpath="${xpath.replace(
      /"/g,
      '"'
    )}"]`;
  }
}

function startRecorder() {
  if (stopRecording) {
    console.log("Recorder already running.");
    return; // Already running
  }
  console.log("Starting rrweb recorder for:", window.location.href);
  isRecordingActive = true;
  stopRecording = rrweb.record({
    emit(event) {
      if (!isRecordingActive) return;

      // Handle scroll events with debouncing and direction detection
      if (
        event.type === EventType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Scroll
      ) {
        const scrollData = event.data as { id: number; x: number; y: number };
        const currentScrollY = scrollData.y;

        // Round coordinates
        const roundedScrollData = {
          ...scrollData,
          x: Math.round(scrollData.x),
          y: Math.round(scrollData.y),
        };

        // Determine scroll direction
        let currentDirection: "up" | "down" | null = null;
        if (lastScrollY !== null) {
          currentDirection = currentScrollY > lastScrollY ? "down" : "up";
        }

        // Record immediately if direction changes
        if (
          lastDirection !== null &&
          currentDirection !== null &&
          currentDirection !== lastDirection
        ) {
          if (scrollTimeout) {
            clearTimeout(scrollTimeout);
            scrollTimeout = null;
          }
          chrome.runtime.sendMessage({
            type: "RRWEB_EVENT",
            payload: {
              ...event,
              data: roundedScrollData, // Use rounded coordinates
            },
          });
          lastDirection = currentDirection;
          lastScrollY = currentScrollY;
          return;
        }

        // Update direction and position
        lastDirection = currentDirection;
        lastScrollY = currentScrollY;

        // Debouncer
        if (scrollTimeout) {
          clearTimeout(scrollTimeout);
        }
        scrollTimeout = setTimeout(() => {
          chrome.runtime.sendMessage({
            type: "RRWEB_EVENT",
            payload: {
              ...event,
              data: roundedScrollData, // Use rounded coordinates
            },
          });
          scrollTimeout = null;
          lastDirection = null; // Reset direction for next scroll
        }, DEBOUNCE_MS);
      } else {
        // Pass through non-scroll events unchanged
        chrome.runtime.sendMessage({ type: "RRWEB_EVENT", payload: event });
      }
    },
    maskInputOptions: {
      password: true,
    },
    checkoutEveryNms: 10000,
    checkoutEveryNth: 200,
  });

  // Add the stop function to window for potential manual cleanup
  (window as any).rrwebStop = stopRecorder;

  // --- Attach Custom Event Listeners Permanently ---
  // These listeners are always active, but the handlers check `isRecordingActive`
  document.addEventListener("click", handleCustomClick, true);
  document.addEventListener("input", handleInput, true);
  document.addEventListener("change", handleSelectChange, true);
  document.addEventListener("keydown", handleKeydown, true);
  document.addEventListener("mouseover", handleMouseOver, true);
  document.addEventListener("mouseout", handleMouseOut, true);
  document.addEventListener("focus", handleFocus, true);
  document.addEventListener("blur", handleBlur, true);
  document.addEventListener("contextmenu", handleContextMenu, true);
  console.log("Permanently attached custom event listeners.");
}

function stopRecorder() {
  if (stopRecording) {
    console.log("Stopping rrweb recorder for:", window.location.href);
    stopRecording();
    stopRecording = undefined;
    isRecordingActive = false;
    (window as any).rrwebStop = undefined; // Clean up window property
    // Remove custom listeners when recording stops
    document.removeEventListener("click", handleCustomClick, true);
    document.removeEventListener("input", handleInput, true);
    document.removeEventListener("change", handleSelectChange, true); // Remove change listener
    document.removeEventListener("keydown", handleKeydown, true); // Remove keydown listener
    document.removeEventListener("mouseover", handleMouseOver, true);
    document.removeEventListener("mouseout", handleMouseOut, true);
    document.removeEventListener("focus", handleFocus, true);
    document.removeEventListener("blur", handleBlur, true);
    document.removeEventListener("contextmenu", handleContextMenu, true);
  } else {
    console.log("Recorder not running, cannot stop.");
  }
}

// --- Custom Click Handler ---
function handleCustomClick(event: MouseEvent) {
  if (!isRecordingActive) return;
  const targetElement = event.target as HTMLElement;
  if (!targetElement) return;

  // Only filter out our specific extraction UI elements
  if (shouldIgnoreUIElement(targetElement)) {
    console.log("Ignoring extraction UI element click:", targetElement.tagName, targetElement.id || targetElement.className);
    return;
  }

  try {
    const xpath = getXPath(targetElement);
    const clickData = {
      timestamp: Date.now(),
      url: document.location.href, // Use document.location for main page URL
      frameUrl: window.location.href, // URL of the frame where the event occurred
      xpath: xpath,
      cssSelector: getEnhancedCSSSelector(targetElement, xpath),
      elementTag: targetElement.tagName,
      elementText: targetElement.textContent?.trim().slice(0, 200) || "",
    };
    console.log("Sending CUSTOM_CLICK_EVENT:", clickData);
    chrome.runtime.sendMessage({
      type: "CUSTOM_CLICK_EVENT",
      payload: clickData,
    });
  } catch (error) {
    console.error("Error capturing click data:", error);
  }
}

// Helper function to determine if an element should be ignored from recording
function shouldIgnoreUIElement(element: HTMLElement): boolean {
  // Only filter elements that are specifically part of our extraction UI
  const exactUISelectors = [
    '#smart-extraction-overlay',
    '#smart-extraction-dialog', 
    '#content-marking-menu',
    '#content-marking-indicator'
  ];
  
  // Check if element or any ancestor matches our specific UI selectors
  for (const selector of exactUISelectors) {
    if (element.closest(selector)) {
      return true;
    }
  }
  
  // Check for specific extraction UI elements by ID (exact match)
  if (element.id === 'smart-extraction-overlay' ||
      element.id === 'smart-extraction-dialog' ||
      element.id === 'content-marking-menu' ||
      element.id === 'content-marking-indicator' ||
      element.id === 'extraction-description' ||
      element.id === 'extraction-confirm' ||
      element.id === 'extraction-cancel') {
    return true;
  }
  
  // Check for scenario buttons specifically
  if (element.classList.contains('scenario-btn')) {
    return true;
  }
  
  // Only ignore overlays that are specifically ours (not page overlays)
  if (element.className && typeof element.className === 'string') {
    const classNames = element.className;
    if (classNames.includes('highlight-overlay') || 
        classNames.includes('focus-overlay') ||
        classNames.includes('marked-content-highlight')) {
      return true;
    }
  }
  
  return false;
}
// --- End Custom Click Handler ---

// --- Custom Input Handler ---
function handleInput(event: Event) {
  if (!isRecordingActive) return;
  const targetElement = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (!targetElement || !("value" in targetElement)) return;

  // Filter out UI-related input elements from recording  
  if (shouldIgnoreUIElement(targetElement)) {
    console.log("Ignoring UI element input:", targetElement.tagName, targetElement.id);
    return;
  }

  const isPassword = targetElement.type === "password";

  try {
    const xpath = getXPath(targetElement);
    const inputData = {
      timestamp: Date.now(),
      url: document.location.href,
      frameUrl: window.location.href,
      xpath: xpath,
      cssSelector: getEnhancedCSSSelector(targetElement, xpath),
      elementTag: targetElement.tagName,
      value: isPassword ? "********" : targetElement.value,
    };
    console.log("Sending CUSTOM_INPUT_EVENT:", inputData);
    chrome.runtime.sendMessage({
      type: "CUSTOM_INPUT_EVENT",
      payload: inputData,
    });
  } catch (error) {
    console.error("Error capturing input data:", error);
  }
}
// --- End Custom Input Handler ---

// --- Custom Select Change Handler ---
function handleSelectChange(event: Event) {
  if (!isRecordingActive) return;
  const targetElement = event.target as HTMLSelectElement;
  // Ensure it's a select element
  if (!targetElement || targetElement.tagName !== "SELECT") return;

  try {
    const xpath = getXPath(targetElement);
    const selectedOption = targetElement.options[targetElement.selectedIndex];
    const selectData = {
      timestamp: Date.now(),
      url: document.location.href,
      frameUrl: window.location.href,
      xpath: xpath,
      cssSelector: getEnhancedCSSSelector(targetElement, xpath),
      elementTag: targetElement.tagName,
      selectedValue: targetElement.value,
      selectedText: selectedOption ? selectedOption.text : "", // Get selected option text
    };
    console.log("Sending CUSTOM_SELECT_EVENT:", selectData);
    chrome.runtime.sendMessage({
      type: "CUSTOM_SELECT_EVENT",
      payload: selectData,
    });
  } catch (error) {
    console.error("Error capturing select change data:", error);
  }
}
// --- End Custom Select Change Handler ---

// --- Custom Keydown Handler ---
// Set of keys we want to capture explicitly
const CAPTURED_KEYS = new Set([
  "Enter",
  "Tab",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Backspace",
  "Delete",
]);

function handleKeydown(event: KeyboardEvent) {
  if (!isRecordingActive) return;

  const key = event.key;
  let keyToLog = "";

  // Check if it's a key we explicitly capture
  if (CAPTURED_KEYS.has(key)) {
    keyToLog = key;
  }
  // Content marking toggle moved to sidepanel button
  // Check for common modifier combinations (Ctrl/Cmd + key)
  else if (
    (event.ctrlKey || event.metaKey) &&
    key.length === 1 &&
    /[a-zA-Z0-9]/.test(key)
  ) {
    // Use 'CmdOrCtrl' to be cross-platform friendly in logs
    keyToLog = `CmdOrCtrl+${key.toUpperCase()}`;
  }
  // You could add more specific checks here (Alt+, Shift+, etc.) if needed

  // If we have a key we want to log, send the event
  if (keyToLog) {
    const targetElement = event.target as HTMLElement;
    let xpath = "";
    let cssSelector = "";
    let elementTag = "document"; // Default if target is not an element
    if (targetElement && typeof targetElement.tagName === "string") {
      try {
        xpath = getXPath(targetElement);
        cssSelector = getEnhancedCSSSelector(targetElement, xpath);
        elementTag = targetElement.tagName;
      } catch (e) {
        console.error("Error getting selector for keydown target:", e);
      }
    }

    try {
      const keyData = {
        timestamp: Date.now(),
        url: document.location.href,
        frameUrl: window.location.href,
        key: keyToLog, // The key or combination pressed
        xpath: xpath, // XPath of the element in focus (if any)
        cssSelector: cssSelector, // CSS selector of the element in focus (if any)
        elementTag: elementTag, // Tag name of the element in focus
      };
      console.log("Sending CUSTOM_KEY_EVENT:", keyData);
      chrome.runtime.sendMessage({
        type: "CUSTOM_KEY_EVENT",
        payload: keyData,
      });
    } catch (error) {
      console.error("Error capturing keydown data:", error);
    }
  }
}
// --- End Custom Keydown Handler ---

// --- DOM Content Marking Functions ---
function toggleContentMarkingMode() {
  isContentMarkingMode = !isContentMarkingMode;
  console.log(`Content marking mode toggled: ${isContentMarkingMode ? 'ON' : 'OFF'}`);
  console.log('Current recording status:', isRecordingActive);
  
  if (isContentMarkingMode) {
    showContentMarkingIndicator();
  } else {
    hideContentMarkingIndicator();
  }
}

function showContentMarkingIndicator() {
  const indicator = document.createElement('div');
  indicator.id = 'content-marking-indicator';
  indicator.textContent = 'Content Marking Mode - Right-click to mark elements';
  Object.assign(indicator.style, {
    position: 'fixed',
    top: '10px',
    right: '10px',
    backgroundColor: 'rgba(255, 165, 0, 0.9)',
    color: 'white',
    padding: '8px 12px',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: 'bold',
    zIndex: '2147483647',
    fontFamily: 'Arial, sans-serif'
  });
  document.body.appendChild(indicator);
}

function hideContentMarkingIndicator() {
  const indicator = document.getElementById('content-marking-indicator');
  if (indicator) {
    indicator.remove();
  }
}

function handleContextMenu(event: MouseEvent) {
  console.log('Context menu triggered. Recording active:', isRecordingActive, 'Content marking mode:', isContentMarkingMode);
  
  if (!isContentMarkingMode) return;
  
  // Completely prevent this event from being recorded
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  
  const targetElement = event.target as HTMLElement;
  if (!targetElement) return;
  
  // Don't show menu on our own UI elements
  if (shouldIgnoreUIElement(targetElement)) {
    return;
  }
  
  console.log('Showing content marking menu for element:', targetElement.tagName);
  showContentMarkingMenu(event, targetElement);
}

function showContentMarkingMenu(event: MouseEvent, targetElement: HTMLElement) {
  // Remove existing menu if any
  removeContentMarkingMenu();
  
  const menu = document.createElement('div');
  menu.id = 'content-marking-menu';
  Object.assign(menu.style, {
    position: 'absolute',
    left: `${event.pageX}px`,
    top: `${event.pageY}px`,
    backgroundColor: 'white',
    border: '1px solid #ccc',
    borderRadius: '4px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    zIndex: '2147483647',
    fontFamily: 'Arial, sans-serif',
    fontSize: '14px',
    minWidth: '200px'
  });
  
  const menuItems = [
    { text: 'Extract Content...', action: () => showSmartExtractionDialog(targetElement) },
    { text: 'Cancel', action: removeContentMarkingMenu }
  ];
  
  menuItems.forEach((item, index) => {
    const menuItem = document.createElement('div');
    menuItem.textContent = item.text;
    Object.assign(menuItem.style, {
      padding: '8px 12px',
      cursor: 'pointer',
      borderBottom: index < menuItems.length - 1 ? '1px solid #eee' : 'none'
    });
    
    menuItem.addEventListener('mouseenter', () => {
      menuItem.style.backgroundColor = '#f0f0f0';
    });
    
    menuItem.addEventListener('mouseleave', () => {
      menuItem.style.backgroundColor = 'white';
    });
    
    menuItem.addEventListener('click', (clickEvent) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      clickEvent.stopImmediatePropagation();
      item.action();
    });
    
    menu.appendChild(menuItem);
  });
  
  document.body.appendChild(menu);
  
  // Close menu when clicking elsewhere
  setTimeout(() => {
    document.addEventListener('click', removeContentMarkingMenu, { once: true });
  }, 100);
}

function showSmartExtractionDialog(targetElement: HTMLElement) {
  removeContentMarkingMenu();
  
  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.id = 'smart-extraction-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  });
  
  // Create modal dialog
  const dialog = document.createElement('div');
  dialog.id = 'smart-extraction-dialog';
  Object.assign(dialog.style, {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '24px',
    width: '480px',
    maxWidth: '90vw',
    boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
    fontFamily: 'Arial, sans-serif'
  });
  
  dialog.innerHTML = `
    <div style="margin-bottom: 20px;">
      <h3 style="margin: 0 0 16px 0; font-size: 18px; color: #333;">Smart Content Extraction</h3>
      <p style="margin: 0 0 16px 0; color: #666; font-size: 14px;">Describe what content you want to extract:</p>
      
      <textarea id="extraction-description" placeholder="Examples:
• Extract rating, title and review content, ignore ads
• Get product name and price only  
• Extract all article text except timestamps" 
        style="width: 100%; height: 80px; padding: 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; resize: vertical; box-sizing: border-box;"></textarea>
    </div>
    
    <div style="margin-bottom: 20px;">
      <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #333;">⚙️ Common Scenarios:</h4>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button class="scenario-btn" data-scenario="reviews" style="padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; background: #f8f9fa; cursor: pointer; font-size: 12px;">Reviews</button>
        <button class="scenario-btn" data-scenario="products" style="padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; background: #f8f9fa; cursor: pointer; font-size: 12px;">Products</button>
        <button class="scenario-btn" data-scenario="articles" style="padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; background: #f8f9fa; cursor: pointer; font-size: 12px;">Articles</button>
        <button class="scenario-btn" data-scenario="listings" style="padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; background: #f8f9fa; cursor: pointer; font-size: 12px;">Listings</button>
      </div>
    </div>
    
    <div style="margin-bottom: 24px;">
      <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #333;">📊 Extraction Mode:</h4>
      <label style="display: flex; align-items: center; margin-bottom: 8px; cursor: pointer;">
        <input type="radio" name="extraction-mode" value="single" checked style="margin-right: 8px;">
        <span style="font-size: 14px;">Single element (this item only)</span>
      </label>
      <label style="display: flex; align-items: center; cursor: pointer;">
        <input type="radio" name="extraction-mode" value="multiple" style="margin-right: 8px;">
        <span style="font-size: 14px;">Multiple items (all similar elements)</span>
      </label>
    </div>
    
    <div style="display: flex; gap: 12px; justify-content: flex-end;">
      <button id="extraction-cancel" style="padding: 10px 20px; border: 1px solid #ddd; border-radius: 4px; background: white; cursor: pointer; font-size: 14px;">Cancel</button>
      <button id="extraction-confirm" style="padding: 10px 20px; border: none; border-radius: 4px; background: #007bff; color: white; cursor: pointer; font-size: 14px;">Extract</button>
    </div>
  `;
  
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  
  // Add event listeners for scenario buttons
  const scenarioButtons = dialog.querySelectorAll('.scenario-btn');
  const textarea = dialog.querySelector('#extraction-description') as HTMLTextAreaElement;
  
  scenarioButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      const scenario = btn.getAttribute('data-scenario');
      const templates = {
        reviews: 'Extract rating, title, review content and date, ignore ads and user avatars',
        products: 'Extract product name, price, description and main image, skip related items',
        articles: 'Extract headline, author, publication date and article text, exclude navigation',
        listings: 'Extract title, price, location and key details, ignore promoted listings'
      };
      textarea.value = templates[scenario as keyof typeof templates] || '';
    });
  });
  
  // Handle confirmation
  dialog.querySelector('#extraction-confirm')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    const description = textarea.value.trim();
    const isMultiple = (dialog.querySelector('input[name="extraction-mode"]:checked') as HTMLInputElement)?.value === 'multiple';
    
    if (description) {
      markElementForSmartExtraction(targetElement, description, isMultiple);
      overlay.remove();
    } else {
      alert('Please describe what content you want to extract.');
    }
  });
  
  // Handle cancellation
  dialog.querySelector('#extraction-cancel')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    overlay.remove();
  });
  
  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      overlay.remove();
    }
  });
  
  // Focus on textarea
  setTimeout(() => textarea.focus(), 100);
}

function markElementForSmartExtraction(
  element: HTMLElement,
  extractionDescription: string,
  isMultiple: boolean
) {
  try {
    const xpath = getXPath(element);
    const cssSelector = getEnhancedCSSSelector(element, xpath);
    
    // Capture HTML sample for LLM processing
    const htmlSample = element.outerHTML.length > 2000 
      ? element.outerHTML.substring(0, 2000) + '...'
      : element.outerHTML;
    
    const markedElement = {
      xpath,
      cssSelector,
      elementTag: element.tagName,
      elementText: element.textContent?.trim().slice(0, 100) || '',
      extractConfig: {
        extractionRule: extractionDescription,
        multiple: isMultiple,
        htmlSample: htmlSample
      }
    };
    
    markedElements.push(markedElement);
    
    // Visual feedback
    highlightMarkedElement(element);
    
    // 1. Send content marking event (for BuilderService processing)
    chrome.runtime.sendMessage({
      type: 'MARK_CONTENT_FOR_EXTRACTION',
      payload: {
        timestamp: Date.now(),
        url: document.location.href,
        frameUrl: window.location.href,
        ...markedElement
      }
    });
    
    // 2. Record as workflow step (for workflow execution)
    const extractionStepData = {
      timestamp: Date.now(),
      url: document.location.href,
      frameUrl: window.location.href,
      xpath: xpath,
      cssSelector: cssSelector,
      elementTag: element.tagName,
      elementText: element.textContent?.trim().slice(0, 200) || '',
      extractionRule: extractionDescription,
      multiple: isMultiple,
      htmlSample: htmlSample,
      // Additional context for LLM processing
      selectors: [
        { type: 'css', value: cssSelector, priority: 1 },
        { type: 'xpath', value: xpath, priority: 2 }
      ]
    };
    
    chrome.runtime.sendMessage({
      type: 'CUSTOM_EXTRACTION_MARKED_EVENT',
      payload: extractionStepData
    });
    
    console.log('Marked element for smart extraction:', markedElement);
    console.log('Recorded extraction step:', extractionStepData);
    
  } catch (error) {
    console.error('Error marking element for smart extraction:', error);
  }
}

function highlightMarkedElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const highlight = document.createElement('div');
  highlight.className = 'marked-content-highlight';
  
  Object.assign(highlight.style, {
    position: 'absolute',
    top: `${rect.top + window.scrollY}px`,
    left: `${rect.left + window.scrollX}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    border: '3px solid orange',
    backgroundColor: 'rgba(255, 165, 0, 0.1)',
    pointerEvents: 'none',
    zIndex: '2147483646'
  });
  
  document.body.appendChild(highlight);
  
  // Remove highlight after 3 seconds
  setTimeout(() => {
    if (highlight.parentNode) {
      highlight.remove();
    }
  }, 3000);
}

function removeContentMarkingMenu() {
  const menu = document.getElementById('content-marking-menu');
  if (menu) {
    menu.remove();
  }
}

// --- End DOM Content Marking Functions ---

// Store the current overlay to manage its lifecycle
let currentOverlay: HTMLDivElement | null = null;
let currentFocusOverlay: HTMLDivElement | null = null;

// Handle mouseover to create overlay
function handleMouseOver(event: MouseEvent) {
  if (!isRecordingActive) return;
  const targetElement = event.target as HTMLElement;
  if (!targetElement) return;

  // Remove any existing overlay to avoid duplicates
  if (currentOverlay) {
    // console.log('Removing existing overlay');
    currentOverlay.remove();
    currentOverlay = null;
  }

  try {
    const xpath = getXPath(targetElement);
    // console.log('XPath of target element:', xpath);
    let elementToHighlight: HTMLElement | null = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue as HTMLElement | null;
    if (!elementToHighlight) {
      const enhancedSelector = getEnhancedCSSSelector(targetElement, xpath);
      console.log("CSS Selector:", enhancedSelector);
      const elements = document.querySelectorAll<HTMLElement>(enhancedSelector);

      // Try to find the element under the mouse
      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        if (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        ) {
          elementToHighlight = el;
          break;
        }
      }
    }
    if (elementToHighlight) {
      const rect = elementToHighlight.getBoundingClientRect();
      const highlightOverlay = document.createElement("div");
      highlightOverlay.className = "highlight-overlay";
      Object.assign(highlightOverlay.style, {
        position: "absolute",
        top: `${rect.top + window.scrollY}px`,
        left: `${rect.left + window.scrollX}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        border: "2px solid lightgreen",
        backgroundColor: "rgba(144, 238, 144, 0.05)", // lightgreen tint
        pointerEvents: "none",
        zIndex: "2147483000",
      });
      document.body.appendChild(highlightOverlay);
      currentOverlay = highlightOverlay;
    } else {
      console.warn("No element found to highlight for xpath:", xpath);
    }
  } catch (error) {
    console.error("Error creating highlight overlay:", error);
  }
}

// Handle mouseout to remove overlay
function handleMouseOut(_event: MouseEvent) {
  if (!isRecordingActive) return;
  if (currentOverlay) {
    currentOverlay.remove();
    currentOverlay = null;
  }
}

// Handle focus to create red overlay for input elements
function handleFocus(event: FocusEvent) {
  if (!isRecordingActive) return;
  const targetElement = event.target as HTMLElement;
  if (
    !targetElement ||
    !["INPUT", "TEXTAREA", "SELECT"].includes(targetElement.tagName)
  )
    return;

  // Remove any existing focus overlay to avoid duplicates
  if (currentFocusOverlay) {
    currentFocusOverlay.remove();
    currentFocusOverlay = null;
  }

  try {
    const xpath = getXPath(targetElement);
    let elementToHighlight: HTMLElement | null = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue as HTMLElement | null;
    if (!elementToHighlight) {
      const enhancedSelector = getEnhancedCSSSelector(targetElement, xpath);
      elementToHighlight = document.querySelector(enhancedSelector);
    }
    if (elementToHighlight) {
      const rect = elementToHighlight.getBoundingClientRect();
      const focusOverlay = document.createElement("div");
      focusOverlay.className = "focus-overlay";
      Object.assign(focusOverlay.style, {
        position: "absolute",
        top: `${rect.top + window.scrollY}px`,
        left: `${rect.left + window.scrollX}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        border: "2px solid red",
        backgroundColor: "rgba(255, 0, 0, 0.05)", // Red tint
        pointerEvents: "none",
        zIndex: "2147483100", // Higher than mouseover overlay (2147483000)
      });
      document.body.appendChild(focusOverlay);
      currentFocusOverlay = focusOverlay;
    } else {
      console.warn("No element found to highlight for focus, xpath:", xpath);
    }
  } catch (error) {
    console.error("Error creating focus overlay:", error);
  }
}

// Handle blur to remove focus overlay  
function handleBlur(_event: FocusEvent) {
  if (!isRecordingActive) return;
  if (currentFocusOverlay) {
    currentFocusOverlay.remove();
    currentFocusOverlay = null;
  }
}

export default defineContentScript({
  matches: ["<all_urls>"],
  main(_ctx) {
    // Listener for status updates from the background script
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "SET_RECORDING_STATUS") {
        const shouldBeRecording = message.payload;
        console.log(`Received recording status update: ${shouldBeRecording}`);
        if (shouldBeRecording && !isRecordingActive) {
          startRecorder();
        } else if (!shouldBeRecording && isRecordingActive) {
          stopRecorder();
          // Also disable content marking when recording stops
          if (isContentMarkingMode) {
            toggleContentMarkingMode();
          }
        }
      } else if (message.type === "SET_CONTENT_MARKING_STATUS") {
        const shouldBeEnabled = message.payload;
        console.log(`Received content marking status update: ${shouldBeEnabled}`);
        if (shouldBeEnabled && !isContentMarkingMode) {
          toggleContentMarkingMode();
        } else if (!shouldBeEnabled && isContentMarkingMode) {
          toggleContentMarkingMode();
        }
      } else if (message.type === "GET_MARKED_ELEMENTS") {
        sendResponse({ markedElements });
        return true;
      }
      // If needed, handle other message types here
    });

    // Request initial status when the script loads
    console.log(
      "Content script loaded, requesting initial recording status..."
    );
    chrome.runtime.sendMessage(
      { type: "REQUEST_RECORDING_STATUS" },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "Error requesting initial status:",
            chrome.runtime.lastError.message
          );
          // Handle error - maybe default to not recording?
          return;
        }
        if (response && response.isRecordingEnabled) {
          console.log("Initial status: Recording enabled.");
          startRecorder();
        } else {
          console.log("Initial status: Recording disabled.");
          // Ensure recorder is stopped if it somehow started
          stopRecorder();
        }
      }
    );

    // Request initial content marking status
    console.log(
      "Content script loaded, requesting initial content marking status..."
    );
    chrome.runtime.sendMessage(
      { type: "REQUEST_CONTENT_MARKING_STATUS" },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "Error requesting initial content marking status:",
            chrome.runtime.lastError.message
          );
          return;
        }
        if (response && response.isContentMarkingEnabled && !isContentMarkingMode) {
          console.log("Initial content marking status: Enabled.");
          toggleContentMarkingMode();
        } else {
          console.log("Initial content marking status: Disabled.");
        }
      }
    );

    // Optional: Clean up recorder if the page is unloading
    window.addEventListener("beforeunload", () => {
      // Also remove permanent listeners on unload?
      // Might not be strictly necessary as the page context is destroyed,
      // but good practice if the script could somehow persist.
      document.removeEventListener("click", handleCustomClick, true);
      document.removeEventListener("input", handleInput, true);
      document.removeEventListener("change", handleSelectChange, true);
      document.removeEventListener("keydown", handleKeydown, true);
      document.removeEventListener("mouseover", handleMouseOver, true);
      document.removeEventListener("mouseout", handleMouseOut, true);
      document.removeEventListener("focus", handleFocus, true);
      document.removeEventListener("blur", handleBlur, true);
      document.removeEventListener("contextmenu", handleContextMenu, true);
      stopRecorder(); // Ensure rrweb is stopped
      
      // Clean up content marking mode
      if (isContentMarkingMode) {
        hideContentMarkingIndicator();
        removeContentMarkingMenu();
      }
    });

    // Optional: Log when the content script is injected
    // console.log("rrweb recorder injected into:", window.location.href);

    // Listener for potential messages from popup/background if needed later
    // chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    //   if (msg.type === 'GET_EVENTS') {
    //     sendResponse(events);
    //   }
    //   return true; // Keep the message channel open for asynchronous response
    // });
  },
});
