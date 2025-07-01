// import { eventWithTime } from 'rrweb'; // Type not directly available
import { EventType, IncrementalSource } from "@rrweb/types";
import {
  StoredCustomClickEvent,
  StoredCustomInputEvent,
  StoredCustomKeyEvent,
  StoredEvent,
  StoredRrwebEvent,
  StoredCustomExtractionMarkedEvent,
} from "../lib/types";
import {
  ClickStep,
  InputStep,
  KeyPressStep,
  NavigationStep,
  ScrollStep,
  ExtractionMarkedStep,
  Step,
  Workflow,
} from "../lib/workflow-types";
import {
  HttpEvent,
  HttpRecordingStartedEvent,
  HttpRecordingStoppedEvent,
  HttpWorkflowUpdateEvent,
  HttpContentMarkingEvent,
} from "../lib/message-bus-types";

export default defineBackground(() => {
  // In-memory store for rrweb events, keyed by tabId
  const sessionLogs: { [tabId: number]: StoredEvent[] } = {}; // Use StoredEvent type

  // Store tab information (URL, potentially title)
  const tabInfo: { [tabId: number]: { url?: string; title?: string } } = {};

  let isRecordingEnabled = true; // Default to disabled (OFF)
  let isContentMarkingEnabled = false; // Content marking mode state
  let lastWorkflowHash: string | null = null; // Cache for the last logged workflow hash

  const PYTHON_SERVER_ENDPOINT = "http://127.0.0.1:7331/event";

  // Hashing function using SubtleCrypto (SHA-256)
  async function calculateSHA256(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return hashHex;
  }

  // Helper function to get base URL (without hash/query params)
  function getBaseUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    } catch {
      return url; // Return original if invalid URL
    }
  }

  // Helper function to send data to the Python server
  async function sendEventToServer(eventData: HttpEvent) {
    try {
      await fetch(PYTHON_SERVER_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventData),
      });
    } catch (error) {
      console.warn(
        `Failed to send event to Python server at ${PYTHON_SERVER_ENDPOINT}:`,
        error
      );
    }
  }

  // Function to broadcast workflow data updates to the console bus
  async function broadcastWorkflowDataUpdate(): Promise<Workflow> {
    // console.log("[DEBUG] broadcastWorkflowDataUpdate: Entered function"); // Optional: Keep for debugging
    const allSteps: Step[] = Object.keys(sessionLogs)
      .flatMap((tabIdStr) => {
        const tabId = parseInt(tabIdStr, 10);
        return convertStoredEventsToSteps(sessionLogs[tabId] || []);
      })
      .sort((a, b) => a.timestamp - b.timestamp); // Sort chronologically

    // Create the workflowData object *after* sorting steps, but hash only steps
    const workflowData: Workflow = {
      name: "Recorded Workflow",
      description: `Recorded on ${new Date().toLocaleString()}`,
      version: "1.0.0",
      input_schema: [],
      steps: allSteps, // allSteps is used here
    };

    const allStepsString = JSON.stringify(allSteps); // Hash based on allSteps
    const currentWorkflowHash = await calculateSHA256(allStepsString);

    // console.log("[DEBUG] broadcastWorkflowDataUpdate: Current steps hash:", currentWorkflowHash, "Last steps hash:", lastWorkflowHash); // Optional

    // Condition to skip logging if the hash of steps is the same
    if (lastWorkflowHash !== null && currentWorkflowHash === lastWorkflowHash) {
      // console.log("[DEBUG] broadcastWorkflowDataUpdate: Steps unchanged, skipping log."); // Optional
      return workflowData;
    }

    lastWorkflowHash = currentWorkflowHash;
    // console.log("[DEBUG] broadcastWorkflowDataUpdate: Steps changed, workflowData object:", JSON.parse(JSON.stringify(workflowData))); // Optional

    // Send workflow update to Python server
    const eventToSend: HttpWorkflowUpdateEvent = {
      type: "WORKFLOW_UPDATE",
      timestamp: Date.now(),
      payload: workflowData,
    };
    sendEventToServer(eventToSend);
    return workflowData;
  }

  // Function to broadcast the recording status to all content scripts and sidepanel
  function broadcastRecordingStatus() {
    const statusString = isRecordingEnabled ? "recording" : "stopped"; // Map boolean to string status
    // Broadcast to Tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id) {
          chrome.tabs
            .sendMessage(tab.id, {
              type: "SET_RECORDING_STATUS",
              payload: isRecordingEnabled,
            })
            .catch((_err: Error) => {
              // Optional: Log if sending to a specific tab failed (e.g., script not injected)
              // console.debug(`Could not send status to tab ${tab.id}: ${_err.message}`);
            });
        }
      });
    });
    // Broadcast to Sidepanel (using runtime message)
    chrome.runtime
      .sendMessage({
        type: "recording_status_updated",
        payload: { status: statusString }, // Send string status
      })
      .catch((_err) => {
        // console.debug("Could not send status update to sidepanel (might be closed)", _err.message);
      });
  }

  // Function to broadcast content marking status to all content scripts and sidepanel
  function broadcastContentMarkingStatus() {
    // Broadcast to Tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id) {
          chrome.tabs
            .sendMessage(tab.id, {
              type: "SET_CONTENT_MARKING_STATUS",
              payload: isContentMarkingEnabled,
            })
            .catch((_err: Error) => {
              // Optional: Log if sending to a specific tab failed
            });
        }
      });
    });
    // Broadcast to Sidepanel (using runtime message)
    chrome.runtime
      .sendMessage({
        type: "content_marking_status_updated",
        payload: { enabled: isContentMarkingEnabled },
      })
      .catch((_err) => {
        // console.debug("Could not send content marking status update to sidepanel", _err.message);
      });
  }

  // --- Tab Event Listeners ---

  // Function to send tab events (only if recording is enabled)
  function sendTabEvent(type: string, payload: any) {
    if (!isRecordingEnabled) return;
    console.log(`Sending ${type}:`, payload);
    const tabId = payload.tabId;
    if (tabId) {
      if (!sessionLogs[tabId]) {
        sessionLogs[tabId] = [];
      }
      sessionLogs[tabId].push({
        messageType: type,
        timestamp: Date.now(),
        tabId: tabId,
        ...payload,
      });
      broadcastWorkflowDataUpdate(); // Call is async, will not block
    } else {
      console.warn(
        "Tab event received without tabId in payload:",
        type,
        payload
      );
      // Optionally store in a global log?
    }
  }

  chrome.tabs.onCreated.addListener((tab) => {
    sendTabEvent("CUSTOM_TAB_CREATED", {
      tabId: tab.id,
      openerTabId: tab.openerTabId,
      url: tab.pendingUrl || tab.url,
      windowId: tab.windowId,
      index: tab.index,
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Filter for relevant changes - only actual URL changes, not status updates
    if (changeInfo.url) {
      sendTabEvent("CUSTOM_TAB_UPDATED", {
        tabId: tabId,
        changeInfo: changeInfo, // includes URL, status, title etc.
        windowId: tab.windowId,
        url: tab.url,
        title: tab.title,
      });
    }
    // Remove status === "complete" to reduce noise from page reloads/DOM changes
  });

  chrome.tabs.onActivated.addListener((activeInfo) => {
    sendTabEvent("CUSTOM_TAB_ACTIVATED", {
      tabId: activeInfo.tabId,
      windowId: activeInfo.windowId,
    });
  });

  chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    sendTabEvent("CUSTOM_TAB_REMOVED", {
      tabId: tabId,
      windowId: removeInfo.windowId,
      isWindowClosing: removeInfo.isWindowClosing,
    });
    // Optional: Clean up logs for the closed tab if desired (we keep them by default)
    // if (sessionLogs[tabId]) {
    //   console.log(`Tab ${tabId} closed, removing logs.`);
    //   delete sessionLogs[tabId];
    //   delete tabInfo[tabId];
    // }
  });

  // --- End Tab Event Listeners ---

  // --- Conversion Function ---

  function convertStoredEventsToSteps(events: StoredEvent[]): Step[] {
    const steps: Step[] = [];

    for (const event of events) {
      switch (event.messageType) {
        case "CUSTOM_CLICK_EVENT": {
          const clickEvent = event as StoredCustomClickEvent;
          // Ensure required fields are present, even if optional in source type for some reason
          if (
            clickEvent.url &&
            clickEvent.frameUrl &&
            clickEvent.xpath &&
            clickEvent.elementTag
          ) {
            const step: ClickStep = {
              type: "click",
              timestamp: clickEvent.timestamp,
              tabId: clickEvent.tabId,
              url: clickEvent.url,
              frameUrl: clickEvent.frameUrl,
              xpath: clickEvent.xpath,
              cssSelector: clickEvent.cssSelector,
              elementTag: clickEvent.elementTag,
              elementText: clickEvent.elementText,
              screenshot: clickEvent.screenshot,
            };
            steps.push(step);
          } else {
            console.warn("Skipping incomplete CUSTOM_CLICK_EVENT:", clickEvent);
          }
          break;
        }

        case "CUSTOM_INPUT_EVENT": {
          const inputEvent = event as StoredCustomInputEvent;
          if (
            inputEvent.url &&
            // inputEvent.frameUrl && // frameUrl might be null/undefined in some cases, let's allow merging if only one is present or both match
            inputEvent.xpath &&
            inputEvent.elementTag
          ) {
            const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;

            // Check if the last step was a mergeable input event
            if (
              lastStep &&
              lastStep.type === "input" &&
              lastStep.tabId === inputEvent.tabId &&
              lastStep.url === inputEvent.url &&
              lastStep.frameUrl === inputEvent.frameUrl && // Ensure frameUrls match if both exist
              lastStep.xpath === inputEvent.xpath &&
              lastStep.cssSelector === inputEvent.cssSelector &&
              lastStep.elementTag === inputEvent.elementTag
            ) {
              // Update the last input step
              (lastStep as InputStep).value = inputEvent.value;
              lastStep.timestamp = inputEvent.timestamp; // Update to latest timestamp
              (lastStep as InputStep).screenshot = inputEvent.screenshot; // Update to latest screenshot
            } else {
              // Add a new input step
              const newStep: InputStep = {
                type: "input",
                timestamp: inputEvent.timestamp,
                tabId: inputEvent.tabId,
                url: inputEvent.url,
                frameUrl: inputEvent.frameUrl,
                xpath: inputEvent.xpath,
                cssSelector: inputEvent.cssSelector,
                elementTag: inputEvent.elementTag,
                value: inputEvent.value,
                screenshot: inputEvent.screenshot,
              };
              steps.push(newStep);
            }
          } else {
            console.warn("Skipping incomplete CUSTOM_INPUT_EVENT:", inputEvent);
          }
          break;
        }

        case "CUSTOM_KEY_EVENT": {
          const keyEvent = event as StoredCustomKeyEvent;
          // Key press might not always have a target element (xpath, etc.)
          // but needs at least url and key
          if (keyEvent.url && keyEvent.key) {
            const step: KeyPressStep = {
              type: "key_press",
              timestamp: keyEvent.timestamp,
              tabId: keyEvent.tabId,
              url: keyEvent.url,
              frameUrl: keyEvent.frameUrl, // Can be missing
              key: keyEvent.key,
              xpath: keyEvent.xpath,
              cssSelector: keyEvent.cssSelector,
              elementTag: keyEvent.elementTag,
              screenshot: keyEvent.screenshot,
            };
            steps.push(step);
          } else {
            console.warn("Skipping incomplete CUSTOM_KEY_EVENT:", keyEvent);
          }
          break;
        }

        case "CUSTOM_EXTRACTION_MARKED_EVENT": {
          const extractionEvent = event as StoredCustomExtractionMarkedEvent;
          if (
            extractionEvent.url &&
            extractionEvent.frameUrl &&
            extractionEvent.xpath &&
            extractionEvent.extractionRule
          ) {
            const step: ExtractionMarkedStep = {
              type: "extract_content_marked",
              timestamp: extractionEvent.timestamp,
              tabId: extractionEvent.tabId,
              url: extractionEvent.url,
              frameUrl: extractionEvent.frameUrl,
              xpath: extractionEvent.xpath,
              cssSelector: extractionEvent.cssSelector,
              elementTag: extractionEvent.elementTag,
              elementText: extractionEvent.elementText,
              extractionRule: extractionEvent.extractionRule,
              multiple: extractionEvent.multiple,
              htmlSample: extractionEvent.htmlSample,
              selectors: extractionEvent.selectors,
              screenshot: extractionEvent.screenshot,
            };
            steps.push(step);
          } else {
            console.warn("Skipping incomplete CUSTOM_EXTRACTION_MARKED_EVENT:", extractionEvent);
          }
          break;
        }

        case "RRWEB_EVENT": {
          // We only care about scroll events from rrweb for now
          const rrEvent = event as StoredRrwebEvent;
          if (
            rrEvent.type === EventType.IncrementalSnapshot &&
            rrEvent.data.source === IncrementalSource.Scroll
          ) {
            const scrollData = rrEvent.data as {
              id: number;
              x: number;
              y: number;
            }; // Type assertion for clarity
            const currentTabInfo = tabInfo[rrEvent.tabId]; // Get associated tab info for URL

            // Check if the last step added was a mergeable scroll event
            const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
            if (
              lastStep &&
              lastStep.type === "scroll" &&
              lastStep.tabId === rrEvent.tabId &&
              (lastStep as ScrollStep).targetId === scrollData.id
            ) {
              // Update the last scroll step
              (lastStep as ScrollStep).scrollX = scrollData.x;
              (lastStep as ScrollStep).scrollY = scrollData.y;
              lastStep.timestamp = rrEvent.timestamp; // Update to latest timestamp
              // URL should already be set from the first event in the sequence
            } else {
              // Add a new scroll step
              const newStep: ScrollStep = {
                type: "scroll",
                timestamp: rrEvent.timestamp,
                tabId: rrEvent.tabId,
                targetId: scrollData.id,
                scrollX: scrollData.x,
                scrollY: scrollData.y,
                url: currentTabInfo?.url, // Add URL if available
              };
              steps.push(newStep);
            }
          } else if (rrEvent.type === EventType.Meta && rrEvent.data?.href) {
            // Be much more conservative about Meta events -> Navigation
            // Only treat as navigation if URL actually changed significantly
            const metaData = rrEvent.data as { href: string };
            const newUrl = metaData.href;
            
            // Find the most recent navigation step
            let lastNavigationStep: NavigationStep | null = null;
            for (let i = steps.length - 1; i >= 0; i--) {
              if (steps[i].type === "navigation") {
                lastNavigationStep = steps[i] as NavigationStep;
                break;
              }
            }
            
            // Only create navigation if:
            // 1. No previous navigation exists, OR
            // 2. URL is genuinely different (not just hash/query changes), AND
            // 3. Sufficient time has passed (not just DOM updates)
            const isGenuineNavigation = !lastNavigationStep || 
              (getBaseUrl(lastNavigationStep.url) !== getBaseUrl(newUrl) &&
               (rrEvent.timestamp - lastNavigationStep.timestamp) > 1000); // At least 1 second
            
            if (isGenuineNavigation) {
              const step: NavigationStep = {
                type: "navigation",
                timestamp: rrEvent.timestamp,
                tabId: rrEvent.tabId,
                url: newUrl,
              };
              steps.push(step);
              console.log(`Created navigation step for URL change: ${lastNavigationStep?.url || 'none'} -> ${newUrl}`);
            } else {
              console.log(`Filtered Meta event (not genuine navigation): ${newUrl}`);
            }
          }
          break;
        }

        // Add cases for other StoredEvent types to Step types if needed
        // e.g., CUSTOM_SELECT_EVENT -> SelectStep
        // e.g., CUSTOM_TAB_CREATED -> TabCreatedStep
        // RRWEB_EVENT type 4 (Meta) or 3 (FullSnapshot) could potentially map to NavigationStep if needed.

        default:
          // Ignore other event types for now
          // console.log("Ignoring event type:", event.messageType);
          break;
      }
    }

    return steps;
  }

  // --- Message Listener ---

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    let isAsync = false; // Flag to indicate if sendResponse will be called asynchronously

    // --- Event Listener from Content Scripts ---
    const customEventTypes = [
      "CUSTOM_CLICK_EVENT",
      "CUSTOM_INPUT_EVENT",
      "CUSTOM_SELECT_EVENT",
      "CUSTOM_KEY_EVENT",
      "CUSTOM_EXTRACTION_MARKED_EVENT",
    ];
    
    // Handle DOM content marking events
    if (message.type === "MARK_CONTENT_FOR_EXTRACTION") {
      if (!isRecordingEnabled) {
        return false; // Don't process if recording is disabled
      }
      
      const eventToSend: HttpContentMarkingEvent = {
        type: "MARK_CONTENT_FOR_EXTRACTION",
        timestamp: Date.now(),
        payload: message.payload,
      };
      sendEventToServer(eventToSend);
      console.log("Forwarded content marking event to server:", message.payload);
      return false;
    }
    if (
      message.type === "RRWEB_EVENT" ||
      customEventTypes.includes(message.type)
    ) {
      if (!isRecordingEnabled) {
        return false; // Don't process if disabled, not async
      }
      if (!sender.tab?.id) {
        console.warn("Received event without tab ID:", message);
        return false; // Ignore events without a tab ID, not async
      }

      const tabId = sender.tab.id;
      const isCustomEvent = customEventTypes.includes(message.type);

      // Function to store the event
      const storeEvent = (eventPayload: any, screenshotDataUrl?: string) => {
        if (!sessionLogs[tabId]) {
          sessionLogs[tabId] = [];
        }
        if (!tabInfo[tabId]) {
          tabInfo[tabId] = {};
        }
        if (sender.tab?.url && !tabInfo[tabId].url) {
          tabInfo[tabId].url = sender.tab.url;
        }
        if (sender.tab?.title && !tabInfo[tabId].title) {
          tabInfo[tabId].title = sender.tab.title;
        }

        const eventWithMeta = {
          ...eventPayload,
          tabId: tabId,
          messageType: message.type,
          screenshot: screenshotDataUrl,
        };
        sessionLogs[tabId].push(eventWithMeta);
        broadcastWorkflowDataUpdate(); // Call is async, will not block
        // console.log(`Stored ${message.type} from tab ${tabId}`);
      };

      // If it's a custom event from content script, try capture screenshot
      if (isCustomEvent && sender.tab?.windowId) {
        isAsync = true; // Indicate async response for screenshot capture
        chrome.tabs.captureVisibleTab(
          sender.tab.windowId,
          { format: "jpeg", quality: 75 },
          (dataUrl) => {
            if (chrome.runtime.lastError) {
              console.error(
                "Screenshot failed:",
                chrome.runtime.lastError.message
              );
              storeEvent(message.payload); // Store event without screenshot
            } else {
              storeEvent(message.payload, dataUrl); // Store event with screenshot
            }
            // Note: sendResponse is not called here, as the event listener just stores data
          }
        );
      } else if (message.type === "RRWEB_EVENT") {
        // For RRWEB_EVENT, store immediately (synchronous)
        storeEvent(message.payload);
      } else if (isCustomEvent) {
        // Custom event but couldn't get screenshot (e.g., missing windowId)
        console.warn(
          "Storing custom event without screenshot due to missing windowId or other issue."
        );
        storeEvent(message.payload);
      }
    }

    // --- Control Messages from Sidepanel ---
    else if (message.type === "GET_RECORDING_DATA") {
      isAsync = true; // Indicate async response for sendResponse
      (async () => {
        const workflowData = await broadcastWorkflowDataUpdate();

        const statusString = isRecordingEnabled
          ? "recording"
          : workflowData.steps.length > 0
          ? "stopped"
          : "idle";

        sendResponse({ workflow: workflowData, recordingStatus: statusString });
      })();
      return isAsync; // Crucial: return true to keep message channel open for async sendResponse
    } else if (message.type === "START_RECORDING") {
      console.log("Received START_RECORDING request.");
      // Clear previous data
      Object.keys(sessionLogs).forEach(
        (key) => delete sessionLogs[parseInt(key)]
      );
      Object.keys(tabInfo).forEach((key) => delete tabInfo[parseInt(key)]);
      console.log("Cleared previous recording data.");

      // Start recording
      if (!isRecordingEnabled) {
        isRecordingEnabled = true;
        console.log("Recording status set to: true");
        broadcastRecordingStatus(); // Inform content scripts and sidepanel

        // Send recording started event to Python server
        const eventToSend: HttpRecordingStartedEvent = {
          type: "RECORDING_STARTED",
          timestamp: Date.now(),
          payload: { message: "Recording has started" },
        };
        sendEventToServer(eventToSend);
      }
      sendResponse({ status: "started" }); // Send simple confirmation
    } else if (message.type === "STOP_RECORDING") {
      console.log("Received STOP_RECORDING request.");
      if (isRecordingEnabled) {
        isRecordingEnabled = false;
        console.log("Recording status set to: false");
        
        // Also disable content marking when recording stops
        if (isContentMarkingEnabled) {
          isContentMarkingEnabled = false;
          console.log("Content marking disabled because recording stopped");
          broadcastContentMarkingStatus();
        }
        
        broadcastRecordingStatus(); // Inform content scripts and sidepanel

        // Send recording stopped event to Python server
        const eventToSend: HttpRecordingStoppedEvent = {
          type: "RECORDING_STOPPED",
          timestamp: Date.now(),
          payload: { message: "Recording has stopped" },
        };
        sendEventToServer(eventToSend);
      }
      sendResponse({ status: "stopped" }); // Send simple confirmation
    }
    // --- Status Request from Content Script ---
    else if (message.type === "REQUEST_RECORDING_STATUS" && sender.tab?.id) {
      console.log(
        `Sending initial status (${isRecordingEnabled}) to tab ${sender.tab.id}`
      );
      sendResponse({ isRecordingEnabled });
    } else if (message.type === "TOGGLE_CONTENT_MARKING_REQUEST") {
      console.log("Received TOGGLE_CONTENT_MARKING_REQUEST from sidepanel");
      // Toggle the state in background
      isContentMarkingEnabled = !isContentMarkingEnabled;
      console.log("Content marking status set to:", isContentMarkingEnabled);
      // Broadcast new status to all tabs and sidepanel
      broadcastContentMarkingStatus();
      sendResponse({ success: true, enabled: isContentMarkingEnabled });
    } else if (message.type === "REQUEST_CONTENT_MARKING_STATUS" && sender.tab?.id) {
      console.log(`Sending initial content marking status (${isContentMarkingEnabled}) to tab ${sender.tab.id}`);
      sendResponse({ isContentMarkingEnabled });
    }

    // --- Removed Handlers ---
    // else if (message.type === "CLEAR_RECORDING_DATA") { ... } // Now handled by START_RECORDING
    // else if (message.type === "GET_RECORDING_STATUS") { ... } // Sidepanel uses GET_RECORDING_DATA
    // else if (message.type === "TOGGLE_RECORDING") { ... } // Replaced by START/STOP

    // Return true if sendResponse will be called asynchronously (screenshotting, GET_RECORDING_DATA)
    // Otherwise, return false or undefined (implicitly false).
    return isAsync;
  });

  // Optional: Save data periodically or on browser close (less reliable)
  // chrome.storage.local.set({ sessionLogs, tabInfo });

  console.log(
    "Background script loaded. Initial recording status:",
    isRecordingEnabled,
    "(EventType:",
    EventType,
    ", IncrementalSource:",
    IncrementalSource,
    ")" // Log imported constants
  );

  // Automatically open the side panel on install/update during development
  // Note: chrome.sidePanel.open() typically requires a user gesture,
  // but onInstalled sometimes works for development reloads.
  if (import.meta.env.DEV) {
    chrome.runtime.onInstalled.addListener(async (details) => {
      // Only run on development install/update
      if (details.reason === "install" || details.reason === "update") {
        console.log(
          `[DEV] Extension ${details.reason}ed. Attempting to open side panel...`
        );
        try {
          // We need to specify the window ID to open the global side panel.
          // Using getLastFocused is generally safer than getCurrent() here.
          const window = await chrome.windows.getLastFocused();
          if (window?.id) {
            await chrome.sidePanel.open({ windowId: window.id });
            console.log(
              `[DEV] Side panel open call successful for window ${window.id}.`
            );
          } else {
            console.warn(
              "[DEV] Could not get window ID to open side panel (no focused window?)."
            );
          }
        } catch (error) {
          console.error("[DEV] Error opening side panel:", error);
          console.warn(
            "[DEV] Note: Automatic side panel opening might fail without a direct user gesture or if no window is focused."
          );
        }
      }
    });
  }

  // Also allow opening via the action icon click (works in dev and prod)
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("Failed to set panel behavior:", error));
});
