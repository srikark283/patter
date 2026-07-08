import { TranscriptionRecord } from "../types";
import { Trash2, Copy } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  history: TranscriptionRecord[];
  setHistory: (h: TranscriptionRecord[]) => void;
}

export function HistoryView({ history, setHistory }: Props) {
  const handleClearHistory = async () => {
    if (confirm("Are you sure you want to clear your transcription history? Stats will be preserved.")) {
      try {
        await invoke("clear_history");
        setHistory([]);
      } catch(e) {
        console.error(e);
      }
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">History</h2>
        <button 
          onClick={handleClearHistory}
          className="flex items-center space-x-2 text-sm text-red-400 hover:text-red-300 transition-colors px-3 py-1.5 rounded bg-red-400/10 hover:bg-red-400/20 cursor-pointer"
        >
          <Trash2 size={16} />
          <span>Clear History</span>
        </button>
      </div>

      <div className="space-y-4">
        {history.length === 0 ? (
          <p className="text-gray-500 text-center py-12">No dictation history yet.</p>
        ) : (
          history.map((record) => (
            <div key={record.id} className="bg-[#1a1a1a] p-5 rounded-xl border border-[#2a2a2a] group">
              <div className="flex justify-between items-start mb-3">
                <span className="text-xs font-medium text-gray-500">
                  {new Date(record.timestamp_ms).toLocaleString()}
                </span>
                <div className="flex space-x-3 text-xs text-gray-500">
                  <span>{record.words} words</span>
                  <span>{record.duration_seconds.toFixed(1)}s audio</span>
                </div>
              </div>
              <p className="text-gray-200 text-sm leading-relaxed">{record.text}</p>
              <div className="mt-4 pt-4 border-t border-[#2a2a2a] opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={() => navigator.clipboard.writeText(record.text)}
                  className="flex items-center space-x-2 text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
                >
                  <Copy size={14} />
                  <span>Copy Text</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
