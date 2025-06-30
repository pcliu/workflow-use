import React, { useState, useEffect } from "react";
import { useWorkflow } from "../context/workflow-provider";
import { Button } from "@/components/ui/button";
import { EventViewer } from "./event-viewer"; // Import EventViewer

export const RecordingView: React.FC = () => {
  const { stopRecording, workflow } = useWorkflow();
  const stepCount = workflow?.steps?.length || 0;
  const [isContentMarkingMode, setIsContentMarkingMode] = useState(false);
  
  // Listen for content marking status updates from background
  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === "content_marking_status_updated") {
        console.log("Content marking status updated:", message.payload);
        setIsContentMarkingMode(message.payload.enabled);
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  const toggleContentMarkingMode = () => {
    console.log("Toggling content marking mode");
    
    // Send message to background script to toggle state
    chrome.runtime.sendMessage({
      type: "TOGGLE_CONTENT_MARKING_REQUEST"
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error sending message:", chrome.runtime.lastError);
      } else {
        console.log("Toggle message sent successfully:", response);
        // State will be updated via the broadcast message
      }
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center space-x-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
          </span>
          <span className="text-sm font-medium">
            Recording ({stepCount} steps)
          </span>
        </div>
        <div className="flex space-x-2">
          <Button 
            variant={isContentMarkingMode ? "default" : "outline"} 
            size="sm" 
            onClick={toggleContentMarkingMode}
          >
            {isContentMarkingMode ? "Exit" : "Mark"} Content
          </Button>
          <Button variant="destructive" size="sm" onClick={stopRecording}>
            Stop Recording
          </Button>
        </div>
      </div>
      <div className="flex-grow overflow-hidden p-4">
        {/* EventViewer will now take full available space within this div */}
        <EventViewer />
      </div>
    </div>
  );
};
