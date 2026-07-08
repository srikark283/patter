import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Mic, Check } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

export default function HUD() {
  const [status, setStatus] = useState("Ready");
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    // Initial check
    invoke<boolean>("is_recording")
      .then(setIsRecording)
      .catch(console.error);

    const unlistenState = listen<string>("patter://state", (event) => {
      setStatus(event.payload);
      if (event.payload === "Idle") {
        setStatus("Ready");
        setIsRecording(false);
      } else if (event.payload === "Listening...") {
        setIsRecording(true);
      }
    });

    return () => {
      unlistenState.then(f => f());
    };
  }, []);

  return (
    <div className="bg-[#1e1e1e]/90 backdrop-blur-md border border-[#3a3a3a] rounded-full px-5 py-2.5 shadow-2xl flex items-center space-x-3 transition-all duration-300">
      {isRecording ? (
        <div className="relative flex items-center justify-center">
          <Mic size={16} className="text-red-400 animate-pulse z-10" />
          <div className="absolute inset-0 bg-red-500/20 rounded-full animate-ping" />
        </div>
      ) : status.startsWith("✓") ? (
        <Check size={16} className="text-green-400" />
      ) : (
        <Mic size={16} className="text-gray-400" />
      )}
      
      <span className="text-sm font-medium text-gray-200">
        {status}
      </span>
    </div>
  );
}
