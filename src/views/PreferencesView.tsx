import { invoke } from "@tauri-apps/api/core";

interface Props {
  outputMode: string;
  setOutputMode: (mode: string) => void;
}

export function PreferencesView({ outputMode, setOutputMode }: Props) {
  const handleSetOutputMode = async (mode: string) => {
    try {
      await invoke("set_output_mode", { mode });
      setOutputMode(mode);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h2 className="text-2xl font-bold">Preferences</h2>
      
      <div className="bg-[#1a1a1a] rounded-xl border border-[#2a2a2a] p-6">
        <h3 className="text-lg font-semibold mb-4">Output Mode</h3>
        <div className="space-y-3">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${outputMode === "paste" ? "border-blue-500" : "border-gray-500 group-hover:border-gray-400"}`}>
              {outputMode === "paste" && <div className="w-2 h-2 rounded-full bg-blue-500" />}
            </div>
            <input 
              type="radio" 
              name="outputMode" 
              value="paste" 
              checked={outputMode === "paste"} 
              onChange={() => handleSetOutputMode("paste")} 
              className="hidden"
            />
            <div>
              <p className="text-sm font-medium text-gray-200">Instant Paste</p>
              <p className="text-xs text-gray-500">Copies to clipboard and simulates Cmd+V (Fastest)</p>
            </div>
          </label>
          
          <label className="flex items-center space-x-3 cursor-pointer group">
            <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${outputMode === "type" ? "border-blue-500" : "border-gray-500 group-hover:border-gray-400"}`}>
              {outputMode === "type" && <div className="w-2 h-2 rounded-full bg-blue-500" />}
            </div>
            <input 
              type="radio" 
              name="outputMode" 
              value="type" 
              checked={outputMode === "type"} 
              onChange={() => handleSetOutputMode("type")} 
              className="hidden"
            />
            <div>
              <p className="text-sm font-medium text-gray-200">Simulate Typing</p>
              <p className="text-xs text-gray-500">Injects keystrokes sequentially (Best for remote desktop)</p>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}
