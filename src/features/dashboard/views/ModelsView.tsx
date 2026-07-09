import { invoke } from "@tauri-apps/api/core";
import { CheckCircle2, Download } from "lucide-react";

interface Props {
  activeEngine: string;
  setActiveEngine: (engine: string) => void;
  isDownloading: boolean;
  setIsDownloading: (dl: boolean) => void;
  downloadProgress: number;
}

export function ModelsView({ activeEngine, setActiveEngine, isDownloading, setIsDownloading, downloadProgress }: Props) {
  const handleDownloadParakeet = async () => {
    setIsDownloading(true);
    try {
      await invoke("download_model", { id: "parakeet" });
    } catch (e) {
      console.error(e);
      alert("Download failed: " + e);
      setIsDownloading(false);
    }
  };

  const handleSetEngine = async (id: string) => {
    try {
      await invoke("set_engine", { id });
      setActiveEngine(id);
    } catch (e) {
      console.error(e);
      alert("Failed to set engine: " + e);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h2 className="text-2xl font-bold">Models</h2>
      
      <div className="grid grid-cols-1 gap-4">
        {/* Whisper */}
        <div className={`bg-[#1a1a1a] rounded-xl border ${activeEngine === "whisper" ? 'border-blue-500' : 'border-[#2a2a2a]'} p-6 transition-colors`}>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-lg font-semibold">OpenAI Whisper</h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400">ACTIVE</span>
              </div>
              <p className="text-sm text-gray-400 mt-1">Base English • ~140MB • Highly accurate</p>
            </div>
            <div className="flex items-center space-x-2 text-green-400 text-sm font-medium">
              <CheckCircle2 size={16} />
              <span>Downloaded</span>
            </div>
          </div>
          {activeEngine !== "whisper" && (
            <button 
              onClick={() => handleSetEngine("whisper")}
              className="mt-4 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded transition-colors cursor-pointer"
            >
              Set Active
            </button>
          )}
        </div>

        {/* Parakeet */}
        <div className={`bg-[#1a1a1a] rounded-xl border ${activeEngine === "parakeet" ? 'border-blue-500' : 'border-[#2a2a2a]'} p-6 transition-colors`}>
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold">Nvidia Parakeet</h3>
              <p className="text-sm text-gray-400 mt-1">TDT 1.1B • Fast & Efficient Streaming</p>
            </div>
            <div>
              {isDownloading ? (
                <div className="flex flex-col items-end">
                  <span className="text-xs text-gray-400 mb-1">{downloadProgress.toFixed(0)}%</span>
                  <div className="w-24 h-1.5 bg-[#2a2a2a] rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${downloadProgress}%` }} />
                  </div>
                </div>
              ) : (
                <button 
                  onClick={handleDownloadParakeet}
                  className="flex items-center space-x-2 text-sm text-blue-400 hover:text-blue-300 bg-blue-400/10 px-3 py-1.5 rounded transition-colors cursor-pointer"
                >
                  <Download size={16} />
                  <span>Download</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
